import fs from 'node:fs';
import path from 'node:path';
import { parseFile } from 'music-metadata';

const ALLOWED_EXT = new Set(['.mp3', '.m4a']);

/** Prefer MP3; allow M4A (AAC/MP4 audio). Reject ALAC and other codecs. */
export function isAllowedAudioFile(filename, mime) {
  const ext = path.extname(filename || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return { ok: false, reason: `Расширение ${ext || '(нет)'} не поддерживается. Разрешены: .mp3, .m4a` };

  if (mime && !/audio\/(mpeg|mp4|x-m4a|aac|m4a)/i.test(mime) && mime !== 'application/octet-stream') {
    return { ok: false, reason: `MIME ${mime} не похож на MP3/M4A` };
  }

  return { ok: true, ext };
}

export function sanitizeFilenamePart(value) {
  return String(value || 'Unknown')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'Unknown';
}

export function buildLocalFilesName(artist, title, ext) {
  const a = sanitizeFilenamePart(artist);
  const t = sanitizeFilenamePart(title);
  const e = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return `${a} - ${t}${e}`;
}

export async function inspectAndValidateAudio(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  const check = isAllowedAudioFile(originalName || filePath);
  if (!check.ok) {
    return { ok: false, reason: check.reason };
  }

  let metadata;
  try {
    metadata = await parseFile(filePath);
  } catch (err) {
    return { ok: false, reason: `Не удалось прочитать метаданные: ${err.message}` };
  }

  const codec = (metadata.format.codec || '').toLowerCase();
  const container = (metadata.format.container || '').toLowerCase();

  if (ext === '.m4a' || container.includes('mp4') || container.includes('m4a')) {
    if (codec.includes('alac') || codec.includes('apple lossless')) {
      return {
        ok: false,
        reason: 'ALAC (Apple Lossless) не поддерживается для Spotify Local Files в этом инструменте. Используйте AAC M4A или MP3.',
      };
    }
  }

  if (ext === '.mp3' && codec && !codec.includes('mpeg') && !codec.includes('mp3') && !codec.includes('layer')) {
    // music-metadata often reports "MPEG 1 Layer 3" — soft check only
  }

  const artist =
    metadata.common.artist ||
    (metadata.common.artists && metadata.common.artists[0]) ||
    'Unknown Artist';
  const title = metadata.common.title || path.basename(originalName, ext);

  return {
    ok: true,
    ext,
    artist,
    title,
    codec: metadata.format.codec || null,
    container: metadata.format.container || null,
    duration: metadata.format.duration || null,
    suggestedName: buildLocalFilesName(artist, title, ext),
  };
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function uniquePath(dir, filename) {
  let candidate = path.join(dir, filename);
  if (!fs.existsSync(candidate)) return candidate;

  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let i = 2;
  while (fs.existsSync(path.join(dir, `${base} (${i})${ext}`))) i += 1;
  return path.join(dir, `${base} (${i})${ext}`);
}
