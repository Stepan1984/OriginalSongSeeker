# analizer

Легальный веб-инструмент для разбора публичных плейлистов Spotify и упаковки **уже имеющихся у вас** аудиофайлов под Spotify Local Files.

## Что делает

1. Принимает URL или ID плейлиста Spotify.
2. Загружает треки через **Spotify Web API** (Client Credentials).
3. Помечает каждый трек как **explicit**, **clean** или **clean/censored** по полю `explicit` и подсказкам в названии (`Clean`, `Censored`, `Radio Edit` и т.п.).
4. Опционально: принимает папку/загрузку ваших локальных файлов (**MP3**, **M4A AAC**), переименовывает в `Artist - Title.ext` и отдаёт ZIP для Local Files.

## Что не делает (жёсткие границы)

- ❌ Не ищет музыку на пиратских / «бесплатных MP3» сайтах
- ❌ Не скачивает чужие защищённые треки из интернета
- ❌ Не парсит lyric-сайты ради «uncensored» аудио
- ✅ Только метаданные Spotify API + упаковка файлов, которые вы уже легально храните локально

## Форматы для упаковки

| Формат | Статус |
|--------|--------|
| **MP3** | Предпочтительный |
| **M4A (AAC)** | Поддерживается |
| M4A **ALAC** (Apple Lossless) | Не принимается |
| WAV / FLAC / другие | Не принимаются этим инструментом |

Имена в ZIP: `Artist - Title.mp3` (или `.m4a`) — удобный шаблон для Spotify Local Files.

## Получение ключей Spotify API

1. Откройте [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) и войдите в аккаунт Spotify.
2. Нажмите **Create app**, укажите имя (например, `analizer`) и согласитесь с условиями.
3. В настройках приложения скопируйте **Client ID** и **Client Secret**.
4. Для **публичных** плейлистов достаточно **Client Credentials Flow** (логин пользователя не нужен). Приватные плейлисты этим приложением не читаются.

Redirect URI для Authorization Code здесь не требуется — используется только Client Credentials.

## Запуск локально

Требования: Node.js **18+**.

```bash
cd analizer
cp .env.example .env
# отредактируйте .env: SPOTIFY_CLIENT_ID и SPOTIFY_CLIENT_SECRET

npm install
npm start
```

Откройте в браузере: [http://127.0.0.1:3847](http://127.0.0.1:3847)

Переменные окружения (см. `.env.example`):

- `SPOTIFY_CLIENT_ID` — Client ID приложения
- `SPOTIFY_CLIENT_SECRET` — Client Secret
- `PORT` — порт HTTP (по умолчанию `3847`)

Режим разработки с автоперезапуском:

```bash
npm run dev
```

## HTTP API

### `GET /api/health`

Статус сервиса и напоминание о границах использования.

### `POST /api/analyze`

Тело JSON:

```json
{ "playlist": "https://open.spotify.com/playlist/…" }
```

Ответ: метаданные плейлиста, сводка (explicit / clean / clean_censored) и список треков.

### `POST /api/package`

`multipart/form-data` с полем `files` (один или несколько `.mp3` / `.m4a`).  
Ответ: ZIP-архив с переименованными файлами.

Опционально поле `renames` (JSON): `{ "исходное_имя.mp3": { "artist": "…", "title": "…" } }`.

## Структура

```
analizer/
  package.json
  .env.example
  README.md
  public/          # UI
  src/
    server.js      # Express
    spotify.js     # Client Credentials + анализ
    packaging.js   # валидация MP3/M4A и имена Local Files
```

## Правовая оговорка

Вы сами отвечаете за то, что загружаемые аудиофайлы законно находятся у вас (купленные, собственного сочинения, разрешённые к копированию). Сервис не предоставляет и не ищет источники для скачивания музыки.
