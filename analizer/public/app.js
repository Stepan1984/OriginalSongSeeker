const analyzeForm = document.getElementById('analyze-form');
const analyzeError = document.getElementById('analyze-error');
const summaryEl = document.getElementById('summary');
const tracksEl = document.getElementById('tracks');
const analyzeBtn = document.getElementById('analyze-btn');

const packageForm = document.getElementById('package-form');
const filesInput = document.getElementById('files');
const fileList = document.getElementById('file-list');
const packageBtn = document.getElementById('package-btn');
const packageError = document.getElementById('package-error');
const packageOk = document.getElementById('package-ok');

const STATUS_LABEL = {
  explicit: 'Explicit',
  clean: 'Clean',
  clean_censored: 'Clean / censored',
  unavailable: 'N/A',
};

function showError(el, message) {
  el.hidden = !message;
  el.textContent = message || '';
}

analyzeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(analyzeError, '');
  summaryEl.hidden = true;
  tracksEl.hidden = true;
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Загрузка…';

  try {
    const playlist = document.getElementById('playlist').value.trim();
    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlist }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Ошибка анализа');

    renderSummary(data);
    renderTracks(data.tracks || []);
  } catch (err) {
    showError(analyzeError, err.message || String(err));
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.textContent = 'Анализировать';
  }
});

function renderSummary(data) {
  const { playlist, summary } = data;
  summaryEl.hidden = false;
    summaryEl.innerHTML = `
    <div class="playlist-meta">
      ${playlist.image ? `<img src="${playlist.image}" alt="" />` : ''}
      <div>
        <strong>${escapeHtml(playlist.name)}</strong>
        <div class="artists">${escapeHtml(playlist.owner || '')}</div>
        ${playlist.url ? `<a href="${playlist.url}" target="_blank" rel="noopener">Открыть в Spotify</a>` : ''}
      </div>
    </div>
    <div class="stats-row">
      <div class="stat"><strong>${summary.total}</strong><span>всего</span></div>
      <div class="stat"><strong>${summary.explicit}</strong><span>explicit</span></div>
      <div class="stat"><strong>${summary.clean}</strong><span>clean</span></div>
      <div class="stat"><strong>${summary.cleanCensored}</strong><span>clean/censored</span></div>
      <div class="stat"><strong>${summary.unavailable}</strong><span>недоступно</span></div>
    </div>
  `;
}

function renderTracks(tracks) {
  tracksEl.hidden = false;
  tracksEl.innerHTML = tracks
    .map((t) => {
      const status = t.classification?.status || 'unavailable';
      const title = escapeHtml(t.name || '');
      const artists = escapeHtml(t.artistString || (t.artists || []).join(', '));
      const tip = escapeHtml(t.classification?.reason || '');
      return `
        <article class="track" title="${tip}">
          <div class="idx">${t.index}</div>
          <div>
            <div class="name">${title}</div>
            <div class="artists">${artists}</div>
          </div>
          <span class="badge ${status}">${STATUS_LABEL[status] || status}</span>
        </article>
      `;
    })
    .join('');
}

filesInput.addEventListener('change', () => {
  const files = [...(filesInput.files || [])];
  fileList.innerHTML = files.map((f) => `<li>${escapeHtml(f.name)} · ${formatBytes(f.size)}</li>`).join('');
  packageBtn.disabled = files.length === 0;
  showError(packageError, '');
  packageOk.hidden = true;
});

packageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError(packageError, '');
  packageOk.hidden = true;
  packageBtn.disabled = true;
  packageBtn.textContent = 'Упаковка…';

  try {
    const form = new FormData();
    for (const file of filesInput.files || []) {
      form.append('files', file, file.name);
    }

    const res = await fetch('/api/package', { method: 'POST', body: form });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Ошибка ${res.status}`);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'spotify-local-files.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    packageOk.hidden = false;
    packageOk.textContent = 'ZIP готов — файлы переименованы в формат Artist - Title для Spotify Local Files.';
  } catch (err) {
    showError(packageError, err.message || String(err));
  } finally {
    packageBtn.disabled = !(filesInput.files && filesInput.files.length);
    packageBtn.textContent = 'Упаковать в ZIP';
  }
});

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
