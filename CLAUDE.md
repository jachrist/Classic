# Classic — gjettelek med klassisk musikk

## Prosjektoversikt

Flerspiller-gjettelek som spilles fra mobil. **Spill-lederen** starter et
tilfeldig klassisk musikkstykke (fra et bibliotek i databasen) og spiller et
utdrag via Spotify. **Deltakerne** sitter hver med sin mobil og gjetter
komponist, epoke, årstall, verk og sats innen en tidsfrist. API-et beregner
poeng: eksakt treff på komponist og epoke, slingringsmonn på årstall og
fuzzy tekstmatch på verk/sats.

Arkitekturen følger samme mønster som Gartha/korportal: Node/Express + SQLite
bak, ren HTML/CSS/JS foran (ingen rammeverk, ingen byggsteg), responsivt og
mobil-først, PWA med service worker.

## Arkitektur

### Frontend (`frontend/`)
- Ren HTML/CSS/JS, ES modules (`type="module"`). Én HTML-side per rolle:
  - `index.html` — landing: bli med (romkode + kallenavn) eller start som leder.
  - `spill.html` (`js/spill.js`) — deltakerens gjettevisning (poller tilstand).
  - `leder.html` (`js/leder.js`) — spill-lederens konsoll (romkode, Spotify, runder).
  - `admin.html` (`js/admin.js`) — administrasjon av musikkbiblioteket (CRUD).
- Felles: `js/api.js` (API-klient, base-URL auto: localhost → `:3001/api`, ellers `/api`),
  `js/util.js` (DOM-hjelpere, escaping, Spotify-embed, tema, localStorage).
- CSS: `css/style.css`, `gth`-lignende, mørkt/lyst tema via CSS custom properties
  (`--accent` = gull), `data-theme` på `<html>`.
- PWA: `manifest.json` + `sw.js` (network-first for HTML/JS/CSS, cache-first for
  bilder; `/api` og eksterne ressurser caches aldri).
- **Ingen server-side auth.** Deltakere identifiseres av `playerId` i
  `localStorage['classic-player']`; lederen av `leaderToken` i
  `localStorage['classic-leader']` (sendes som `x-leader-token`-header).

### Backend (`api/`)
- Express på port 3001, SQLite via `better-sqlite3`.
- `lib/db.js` — hybrid lagringsmodell (`id/partitionKey/<søkbare>/jsonData`) med
  `buildEntity/parseEntity/getEntity/listEntities/upsertEntity/deleteEntity/findOne`.
  Skjema i `TABLE_SCHEMAS`; `ensureTables()` auto-migrerer manglende kolonner.
  Tabeller: `pieces, games, players, rounds, guesses`.
- `lib/scoring.js` — poengberegning. Vekter (sum 100): komponist 30, epoke 20,
  årstall 25, verk 15, sats 10. Årstall gradert (full ±5 år → 0 ved ±60).
  Tekst: normalisering (fjerner aksenter, katalogforkortelser) + Levenshtein/
  token-overlapp/delstreng. Juster konstanter øverst i fila.
- `lib/epochs.js` — kanoniske epoker med årsintervaller (nedtrekksliste + seeding).
- `lib/helpers.js` — `successResponse/errorResponse/generateId/generateRoomCode/
  generateToken/validateRequired/now`.
- `routes/pieces.js` — bibliotek-CRUD + `GET /api/pieces/meta` (komponistliste,
  epoker, årsintervall til gjetteskjemaet).
- `routes/games.js` — spill-livssyklus (se under).
- `seed.js` — seeder ~30 kjente stykker i tomt bibliotek (uten Spotify-URL).
- `server.js` — CORS, JSON, route-mounting, `/api/health`, valgfri statisk
  frontend via `FRONTEND_DIR`.

### Spill-livssyklus (states)
`lobby` → `playing` (aktiv runde) → runden avsløres (`reveal`) → ny runde …
→ `finished`. Hovedendepunkter (alle under `/api/games`):
- `POST /` — leder oppretter spill → `{ code, leaderToken }`.
- `POST /:code/join` — deltaker `{ name }` → `{ playerId }`.
- `GET  /:code/state?playerId=` — polles hvert 2. sek. Fasit skjules for
  deltakere under aktiv runde; leder ser den (via `x-leader-token`).
  Auto-avslører runden når tiden er ute.
- `POST /:code/start-round` — leder, tilfeldig ubrukt stykke (eller `{ pieceId }`).
- `POST /:code/guess` — deltaker `{ playerId, composer, year, epoch, work, movement }`
  (kan oppdateres til tiden er ute; én gjetning per deltaker per runde).
- `POST /:code/reveal` — leder avslutter runden, poeng beregnes (idempotent).
- `POST /:code/finish` — leder avslutter spillet.

### Spotify
Hvert stykke kan ha en `spotifyUrl` (track/album). Lederskjermen viser en
innebygd Spotify-`iframe` (`/embed/...`) — ~30 sek utdrag uten innlogging, full
lengde hvis lederen er logget inn i Spotify i nettleseren. Mangler URL, vises en
«Søk på Spotify»-knapp. Seed-data har tom URL — legg inn lenker via Admin.

## Utvikling lokalt
```bash
cd api && npm install && cp .env.example .env && npm start   # API på 3001
cd frontend && python3 -m http.server 3000                   # frontend på 3000
```
Åpne http://localhost:3000. Biblioteket seedes automatisk første gang.
Test poengberegningen: `cd api && npm test`.

## Deploy
Se `deploy/README.md` (samme mønster som Gartha: nginx + systemd + backup).
Kjapp variant: sett `FRONTEND_DIR=../frontend` i `api/.env` så serverer API-et
alt i én prosess.

## Konvensjoner
- Rutesvar: `{ success: true, ... }` / `{ success: false, error }`. Lister via
  `successResponse(res, { data: [...] })`, opprett via `{ id, item }`.
- Frontend leser `res.data` / `res.item` / `res.round` / `res.players`.
- Ny side `x.html` → modul `js/x.js` som importerer fra `api.js` + `util.js`.
