# 🎼 Classic

En flerspiller-gjettelek om klassisk musikk, spilt fra mobil.

Spill-lederen spiller et tilfeldig utdrag (via Spotify), og deltakerne gjetter
**komponist, epoke, årstall, verk og sats** fra hver sin mobil. API-et beregner
poeng med slingringsmonn — nærmest vinner.

## Slik spiller dere
1. **Spill-lederen** åpner appen → «Jeg er spill-leder» → får en **romkode**.
2. **Deltakerne** åpner appen på mobil → skriver inn romkoden + kallenavn.
3. Lederen trykker **Start runde** — et tilfeldig stykke spilles via Spotify.
4. Deltakerne fyller ut det de kan før tiden er ute.
5. Runden avsløres med fasit og poeng. Kjør flere runder — høyest total vinner.

## Poeng (maks 100 per runde)
| Felt | Poeng | Regel |
|------|-------|-------|
| Komponist | 30 | Eksakt treff (nedtrekksliste) |
| Epoke | 20 | Eksakt treff (nedtrekksliste) |
| Årstall | 25 | Full ±5 år, gradvis ned til 0 ved ±60 år |
| Verk | 15 | Fuzzy tekstmatch |
| Sats | 10 | Fuzzy tekstmatch |

## Teknologi
- **Backend:** Node/Express + SQLite (`better-sqlite3`)
- **Frontend:** Ren HTML/CSS/JS (ingen rammeverk), PWA, responsiv/mobil-først
- **Musikk:** Spotify-embed (utdrag)

## Kom i gang
```bash
# Backend
cd api && npm install && cp .env.example .env && npm start   # http://localhost:3001

# Frontend (eget vindu)
cd frontend && python3 -m http.server 3000                   # http://localhost:3000
```
Biblioteket seedes automatisk med ~30 kjente stykker. Legg inn Spotify-lenker
via **⚙️ Admin** for innebygd avspilling.

### Teste fra mobil/iPad
Kjør i én-prosess-modus (API-et serverer også frontend, samme adresse for alt):
```bash
cd api && npm install && cp .env.example .env
echo "FRONTEND_DIR=../frontend" >> .env && npm start
```
Serveren skriver ut en `Nettverk: http://<din-ip>:3001`-adresse — åpne den i
Safari på iPaden (samme Wi-Fi). Da kan du være spill-leder på PC-en og deltaker
på iPaden.

### Kjøre i skyen (uten egen server)
`deploy/azure-appservice.md` viser hvordan du legger hele appen på **Azure App
Service** (gratis F1-nivå, HTTPS inkludert). Kortversjon:
```bash
APP_NAME=classic-<unikt-navn> ./deploy/azure-appservice.sh
```

Se `CLAUDE.md` for arkitektur og `deploy/README.md` for drift på egen Ubuntu-server.
