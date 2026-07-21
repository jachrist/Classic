# Deploy til Azure App Service (Linux, Node)

Kjører hele Classic (Express-API + statisk frontend) i én prosess på Azure App
Service. Ingen server å drifte, HTTPS er inkludert på `*.azurewebsites.net`
(så PWA-installasjon på iPad fungerer), og SQLite-fila lagres på den persistente
`/home`-disken så rom, poeng og Spotify-lenker overlever omstart.

## Hvorfor det virker uten store endringer
- Rot-`package.json` har `start` → `node api/server.js` og en `postinstall` som
  installerer API-avhengighetene. Azure (Oryx) bygger dette automatisk.
- `server.js` leser `PORT` fra miljøet (som App Service setter), og serverer
  frontend når `FRONTEND_DIR` er satt → alt på samme origin, `/api` treffer rett.
- `SQLITE_DB_PATH=/home/data/...` peker på persistent lagring.
- `SQLITE_JOURNAL_MODE=DELETE` unngår WAL-låsing på Azure Files.

## Forutsetninger
- En Azure-konto (gratis prøveperiode holder).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`).
- En **ren klone** av repoet (ikke kjør `npm install` lokalt før deploy — da
  slipper du å laste opp `node_modules`; Azure bygger på serveren):
  ```bash
  git clone https://github.com/jachrist/Classic.git
  cd Classic
  git checkout claude/classical-music-game-xi6i38
  ```

## 1. Logg inn
```bash
az login
```

## 2. Opprett og deploy (én kommando)
Bytt `<UNIKT-NAVN>` med noe globalt unikt (blir en del av URL-en).
```bash
az webapp up \
  --name classic-<UNIKT-NAVN> \
  --resource-group classic-rg \
  --plan classic-plan \
  --runtime "NODE:22-lts" \
  --sku F1 \
  --location westeurope \
  --os-type Linux
```
`az webapp up` oppretter ressursgruppe, plan og web-app, zipper mappa, laster den
opp og bygger den (installerer avhengigheter, henter `better-sqlite3`-binær).

> **F1** er gratis (1 GB, 60 CPU-min/døgn — nok til spillkvelder). Har du allerede
> en gratis-app i regionen, bruk `--sku B1` (billig, alltid på).

## 3. Miljøvariabler
```bash
az webapp config appsettings set \
  --name classic-<UNIKT-NAVN> --resource-group classic-rg \
  --settings \
    FRONTEND_DIR=./frontend \
    SQLITE_DB_PATH=/home/data/classic.db \
    SQLITE_JOURNAL_MODE=DELETE \
    SCM_DO_BUILD_DURING_DEPLOYMENT=true
```
Sett gjerne oppstartskommandoen eksplisitt (valgfritt — `npm start` er default):
```bash
az webapp config set --name classic-<UNIKT-NAVN> --resource-group classic-rg \
  --startup-file "npm start"
```

## 4. Restart og åpne
```bash
az webapp restart --name classic-<UNIKT-NAVN> --resource-group classic-rg
```
Åpne **https://classic-<UNIKT-NAVN>.azurewebsites.net** — også i Safari på iPad.
Biblioteket seedes automatisk med ~30 stykker første gang.

## Oppdatere etter kodeendringer
Fra repo-rota (ren klone, oppdatert med `git pull`):
```bash
az webapp up --name classic-<UNIKT-NAVN> --resource-group classic-rg
```

## Nyttig
- **Logger:** `az webapp log tail --name classic-<UNIKT-NAVN> --resource-group classic-rg`
- **Legg inn Spotify-lenker:** gå til `/admin.html` på den deployede URL-en og lim
  inn track-lenker for innebygd avspilling.
- **Egen database-backup:** last ned `/home/data/classic.db` via
  `az webapp ssh` eller Kudu (`https://classic-<UNIKT-NAVN>.scm.azurewebsites.net`).
- **Slette alt igjen:** `az group delete --name classic-rg --yes`

## Feilsøking
- *Bygg feiler på `better-sqlite3`* → sjekk at runtime er `NODE:22-lts` og at
  `SCM_DO_BUILD_DURING_DEPLOYMENT=true` er satt; se byggelogg i Kudu.
- *«database is locked» / I/O-feil* → sjekk at `SQLITE_JOURNAL_MODE=DELETE` er satt.
- *Siden laster, men `/api` gir 404* → sjekk at `FRONTEND_DIR=./frontend` er satt
  og at oppstartskommandoen er `npm start`.
