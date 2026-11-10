const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

let cachedToken = null;
let tokenExpiresAt = 0;

export function extractPlaylistId(input) {
  if (!input || typeof input !== 'string') {
    throw new Error('Укажите URL или ID плейлиста Spotify');
  }

  const trimmed = input.trim();

  const uriMatch = trimmed.match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uriMatch) return uriMatch[1];

  const urlMatch = trimmed.match(
    /(?:open\.spotify\.com\/(?:intl-[a-z]{2}\/)?playlist\/|spotify\.com\/playlist\/)([a-zA-Z0-9]+)/i
  );
  if (urlMatch) return urlMatch[1];

  if (/^[a-zA-Z0-9]{22}$/.test(trimmed)) return trimmed;

  throw new Error('Не удалось распознать ID плейлиста. Ожидается URL open.spotify.com/playlist/... или 22-символьный ID');
}

async function getAccessToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      'Не заданы SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET. Скопируйте .env.example → .env и заполните ключи из Spotify Developer Dashboard.'
    );
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30_000) {
    return cachedToken;
  }

  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ошибка получения токена Spotify (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}

async function spotifyGet(path) {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) {
    throw new Error('Плейлист не найден или недоступен для Client Credentials (нужен публичный плейлист).');
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Spotify API ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Classify clean vs explicit using Spotify metadata only.
 * - explicit === true → explicit
 * - name/hints like (Clean)/(Censored) → clean (likely censored edit)
 * - otherwise → clean
 */
export function classifyTrack(track) {
  const name = track?.name || '';
  const explicit = Boolean(track?.explicit);
  const lowered = name.toLowerCase();

  const cleanHint = /\b(clean|censored|radio\s*edit|edited)\b/i.test(name);
  const explicitHint = /\b(explicit|uncensored)\b/i.test(name);

  let status;
  let reason;

  if (explicit || explicitHint) {
    status = 'explicit';
    reason = explicit
      ? 'Spotify: explicit = true'
      : 'В названии есть пометка Explicit/Uncensored';
  } else if (cleanHint) {
    status = 'clean_censored';
    reason = 'Spotify: explicit = false и в названии Clean/Censored/Radio Edit';
  } else {
    status = 'clean';
    reason = 'Spotify: explicit = false (чистая/неидентифицированная как цензурированная версия)';
  }

  return {
    status,
    reason,
    explicitFlag: explicit,
    nameHints: { cleanHint, explicitHint, loweredSnippet: lowered.slice(0, 80) },
  };
}

function mapTrackItem(item, index) {
  const track = item?.track;
  if (!track || track.type !== 'track') {
    return {
      index: index + 1,
      available: false,
      name: item?.track?.name || '(недоступный трек)',
      artists: [],
      album: null,
      explicit: null,
      classification: { status: 'unavailable', reason: 'Трек недоступен через API' },
      spotifyUrl: null,
      durationMs: null,
      id: null,
    };
  }

  const artists = (track.artists || []).map((a) => a.name);
  const classification = classifyTrack(track);

  return {
    index: index + 1,
    available: true,
    id: track.id,
    name: track.name,
    artists,
    artistString: artists.join(', '),
    album: track.album?.name || null,
    explicit: track.explicit,
    classification,
    spotifyUrl: track.external_urls?.spotify || null,
    durationMs: track.duration_ms,
    isrc: track.external_ids?.isrc || null,
  };
}

export async function analyzePlaylist(playlistInput) {
  const playlistId = extractPlaylistId(playlistInput);
  const playlist = await spotifyGet(
    `/playlists/${playlistId}?fields=id,name,description,owner(display_name),external_urls,tracks(total),images`
  );

  const tracks = [];
  let url = `/playlists/${playlistId}/tracks?limit=100&fields=next,items(track(id,name,explicit,duration_ms,external_urls,external_ids,artists(name),album(name),type))`;

  while (url) {
    const page = url.startsWith('http')
      ? await (async () => {
          const token = await getAccessToken();
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) throw new Error(`Spotify API ${res.status}: ${await res.text()}`);
          return res.json();
        })()
      : await spotifyGet(url);

    for (const item of page.items || []) {
      tracks.push(mapTrackItem(item, tracks.length));
    }

    url = page.next || null;
  }

  const summary = {
    total: tracks.length,
    explicit: tracks.filter((t) => t.classification?.status === 'explicit').length,
    clean: tracks.filter((t) => t.classification?.status === 'clean').length,
    cleanCensored: tracks.filter((t) => t.classification?.status === 'clean_censored').length,
    unavailable: tracks.filter((t) => !t.available).length,
  };

  return {
    playlist: {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      owner: playlist.owner?.display_name || null,
      url: playlist.external_urls?.spotify || null,
      image: playlist.images?.[0]?.url || null,
      trackTotal: playlist.tracks?.total ?? tracks.length,
    },
    summary,
    tracks,
  };
}
