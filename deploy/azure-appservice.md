# Deploy til Azure App Service

Kjører hele Classic (Express-API + statisk frontend) i én prosess på Azure App
Service. Ingen server å drifte, HTTPS er inkludert på `*.azurewebsites.net`
(så PWA-installasjon på iPad fungerer), og SQLite-fila lagres på den persistente
`/home`-disken så rom, poeng og Spotify-lenker overlever omstart.

## Enklest: alt fra Azure-portalen (uten kommandolinje / iPad-vennlig)

Denne veien bruker Azures **Deployment Center**, som kobler GitHub til App Service
og setter opp auto-deploy automatisk — ingen publish-profil eller script.

### 1. Merge koden til `main` (github.com i Safari)
Åpne pull requesten, sjekk at «Tester»-sjekken er grønn, og trykk
**Merge pull request → Confirm merge**.

### 2. Opprett web-appen (portal.azure.com)
**Create a resource → Web App**, og fyll ut:
| Felt | Verdi |
|------|-------|
| Resource Group | opprett ny, f.eks. `classic-rg` |
| Name | et globalt unikt navn, f.eks. `classic-utsikten` → blir `classic-utsikten.azurewebsites.net` |
| Publish | **Code** |
| Runtime stack | **Node 22 LTS** |
| Operating System | **Linux** |
| Region | **North Europe** (eller West Europe) |
| Pricing plan | **Free F1** |

**Review + create → Create**. Vent til «Go to resource».

### 3. Legg inn miljøvariabler (i web-appen)
**Settings → Environment variables → Application settings → + Add** for hver av disse:
| Navn | Verdi |
|------|-------|
| `FRONTEND_DIR` | `./frontend` |
| `SQLITE_DB_PATH` | `/home/data/classic.db` |
| `SQLITE_JOURNAL_MODE` | `DELETE` |

Trykk **Apply/Save** (appen restarter).

### 4. Koble til GitHub (Deployment Center)
**Deployment → Deployment Center**:
- **Source: GitHub** → *Authorize* / logg inn på GitHub om du blir spurt.
- **Organization:** `jachrist`  •  **Repository:** `Classic`  •  **Branch:** `main`
- La byggevalget stå på **GitHub Actions** (standard).
- **Save.** Azure legger en workflow-fil i repoet og starter første deploy.

### 5. Vent og åpne
Under **Deployment Center → Logs** ser du kjøringen (~2–3 min). Når den er grønn,
åpne **https://DITT-NAVN.azurewebsites.net** — også i Safari på iPad.
Biblioteket seedes automatisk med ~30 stykker.

### 6. Legg inn Spotify-lenker (valgfritt)
Gå til `…/admin.html` på den deployede URL-en og lim inn track-lenker for
innebygd avspilling.

**Videre:** hver merge til `main` deployer nå automatisk. PR-er kjører testene
(`.github/workflows/test.yml`) så du ser grønt før du merger.

> **Om Free F1:** appen «sovner» etter ~20 min uten trafikk, så første åpning
> etter en pause kan bruke 20–30 sek (kaldstart). Deretter er den kjapp. Vil du
> unngå det, oppgrader planen til **B1** (App Service plan → Scale up).

---

## Miljøvariabler — hva de gjør
| Variabel | Hvorfor |
|----------|---------|
| `FRONTEND_DIR=./frontend` | Får API-et til å servere frontend også → alt på samme adresse, `/api` treffer rett. |
| `SQLITE_DB_PATH=/home/data/classic.db` | Legger databasen på persistent lagring som overlever omstart. |
| `SQLITE_JOURNAL_MODE=DELETE` | Unngår WAL-låsing på Azure Files (`/home`). |
| `PORT` | Settes automatisk av App Service — appen leser den. Ikke rør. |

## Hvorfor det virker uten kodeendringer
- Rot-`package.json` har `start` → `node api/server.js` og en `postinstall` som
  installerer API-avhengighetene. Byggesteget (i GitHub Actions) håndterer dette
  automatisk, inkludert ferdigbygd `better-sqlite3` for linux-x64.
- `server.js` leser `PORT` fra miljøet og serverer frontend når `FRONTEND_DIR`
  er satt.

---

## Alternativ: via Azure CLI (fra PC/Mac, ikke iPad)
Har du `az` installert og vil hoppe over portalen:
```bash
APP_NAME=classic-<UNIKT-NAVN> ./deploy/azure-appservice.sh
```
Skriptet oppretter ressursgruppe, plan og app, setter miljøvariablene og
deployer. Deretter kan du enten koble på Deployment Center (som over) eller
kjøre skriptet på nytt for å oppdatere.

---

## Feilsøking
- *Siden laster, men `/` gir 404* → sjekk at `FRONTEND_DIR=./frontend` er satt og
  at appen er restartet. (Startkommando skal være `npm start` — standard for Node.)
- *«Cannot find module 'express'»* → åpne web-appen → **Deployment Center → Logs**
  og sjekk at bygget kjørte `npm install`. Prøv en ny deploy (tomt commit eller
  «Sync» i Deployment Center).
- *«database is locked» / I/O-feil* → sjekk at `SQLITE_JOURNAL_MODE=DELETE` er satt.
- *Vil se live-logg* → web-appen → **Monitoring → Log stream**.
- *Slette alt igjen* → slett ressursgruppa `classic-rg` (Resource groups → Delete).
