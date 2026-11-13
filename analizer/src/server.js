import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import archiver from 'archiver';
import { analyzePlaylist } from './spotify.js';
import {
  inspectAndValidateAudio,
  isAllowedAudioFile,
  buildLocalFilesName,
  ensureDir,
  uniquePath,
} from './packaging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const UPLOADS = path.join(ROOT, 'uploads');
const PORT = Number(process.env.PORT) || 3847;

ensureDir(UPLOADS);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(ROOT, 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS),
  filename: (_req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\- ()\[\]]+/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 40 },
  fileFilter: (_req, file, cb) => {
    const check = isAllowedAudioFile(file.originalname, file.mimetype);
    if (!check.ok) return cb(new Error(check.reason));
    cb(null, true);
  },
});

app.get('/api/health', (_req, res) => {
  const configured = Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
  res.json({
    ok: true,
    spotifyConfigured: configured,
    formats: { preferred: 'mp3', also: 'm4a (AAC, non-ALAC)' },
    scope: {
      allowed: [
        'Spotify Web API metadata',
        'packaging of user-provided local audio for Spotify Local Files',
      ],
      forbidden: [
        'searching pirate/free MP3 sites',
        'downloading copyrighted tracks from the internet',
        'scraping lyrics sites for uncensored audio',
      ],
    },
  });
});

app.post('/api/analyze', async (req, res) => {
  try {
    const playlist = req.body?.playlist;
    if (!playlist) {
      return res.status(400).json({ error: 'Передайте поле playlist (URL или ID)' });
    }
    const result = await analyzePlaylist(playlist);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message || String(err) });
  }
});

app.post('/api/package', upload.array('files', 40), async (req, res) => {
  const staged = [];
  try {
    const files = req.files || [];
    if (!files.length) {
      return res.status(400).json({ error: 'Загрузите хотя бы один файл .mp3 или .m4a, который у вас уже есть локально' });
    }

    let renames = {};
    if (req.body?.renames) {
      try {
        renames = typeof req.body.renames === 'string' ? JSON.parse(req.body.renames) : req.body.renames;
      } catch {
        return res.status(400).json({ error: 'Поле renames должно быть JSON-объектом' });
      }
    }

    const workDir = path.join(UPLOADS, `pack-${Date.now()}`);
    ensureDir(workDir);
    staged.push(workDir);

    const manifest = [];

    for (const file of files) {
      staged.push(file.path);
      const inspection = await inspectAndValidateAudio(file.path, file.originalname);
      if (!inspection.ok) {
        return res.status(400).json({ error: `${file.originalname}: ${inspection.reason}` });
      }

      const override = renames[file.originalname] || renames[file.fieldname];
      const outName =
        override?.artist || override?.title
          ? buildLocalFilesName(
              override.artist || inspection.artist,
              override.title || inspection.title,
              inspection.ext
            )
          : inspection.suggestedName;

      const dest = uniquePath(workDir, outName);
      fs.renameSync(file.path, dest);
      staged.pop(); // moved off uploads root

      manifest.push({
        original: file.originalname,
        packagedAs: path.basename(dest),
        artist: override?.artist || inspection.artist,
        title: override?.title || inspection.title,
        codec: inspection.codec,
        container: inspection.container,
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="spotify-local-files.zip"');
    res.setHeader('X-Package-Manifest', encodeURIComponent(JSON.stringify(manifest)));

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
      else res.end();
    });
    archive.pipe(res);

    for (const entry of fs.readdirSync(workDir)) {
      archive.file(path.join(workDir, entry), { name: entry });
    }
    await archive.finalize();

    // cleanup after response finishes
    res.on('finish', () => {
      fs.rmSync(workDir, { recursive: true, force: true });
    });
  } catch (err) {
    for (const p of staged) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    const message = err.message || String(err);
    if (!res.headersSent) res.status(400).json({ error: message });
  }
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || String(err) });
});

app.listen(PORT, () => {
  console.log(`analizer listening on http://127.0.0.1:${PORT}`);
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) {
    console.warn('⚠ SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET не заданы — анализ плейлистов не заработает, пока не заполните .env');
  }
});
