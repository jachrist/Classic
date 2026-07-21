# Drift & deploy — Classic

Samme mønster som Gartha/korportal: Ubuntu + nginx (serverer frontend, proxyer
`/api` → 3001) + systemd-service for Express. SQLite-fil og opplastinger på disk.

## Kataloger (forslag)
```
/opt/classic/frontend        # statiske filer (kopi av frontend/)
/opt/classic/api             # Express-app (kopi av api/)
/var/data/classic/classic.db # SQLite-database
```

## Førstegangsoppsett
```bash
# Node 22 + nginx antas installert
sudo useradd -r -s /usr/sbin/nologin classic || true
sudo mkdir -p /opt/classic/{frontend,api} /var/data/classic
# kopier koden
sudo cp -r frontend/. /opt/classic/frontend/
sudo cp -r api/. /opt/classic/api/
cd /opt/classic/api && sudo -u classic npm install --omit=dev
# miljø
sudo cp .env.example .env   # sett SQLITE_DB_PATH=/var/data/classic/classic.db, CORS_ORIGINS, PORT
sudo chown -R classic:classic /opt/classic /var/data/classic
```

## systemd — `/etc/systemd/system/classic.service`
```ini
[Unit]
Description=Classic API
After=network.target

[Service]
Type=simple
User=classic
WorkingDirectory=/opt/classic/api
EnvironmentFile=/opt/classic/api/.env
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload && sudo systemctl enable --now classic
```

## nginx (utdrag)
```nginx
server {
    listen 80;
    server_name classic.example.no;

    root /opt/classic/frontend;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```
SSL via `certbot --nginx -d classic.example.no`.

## Oppdatere etter merge til `main`
```bash
git -C /tmp/Classic pull
cp -r /tmp/Classic/api/{routes,lib,server.js,seed.js} /opt/classic/api/
cp -r /tmp/Classic/frontend/. /opt/classic/frontend/
chown -R classic:classic /opt/classic
systemctl restart classic
```

## Én-prosess-variant (uten nginx statisk)
Sett `FRONTEND_DIR=../frontend` i `api/.env` — da serverer Express både API og
frontend på samme port. Praktisk for enkel hosting; nginx anbefales i prod for
statiske filer og SSL.

## Backup
SQLite-fila er alt som må sikres. Enkel cron:
```bash
sqlite3 /var/data/classic/classic.db ".backup '/var/backups/classic/classic-$(date +\%F).db'"
```
Krypter + send til OneDrive via rclone som i Gartha om ønskelig.
```
