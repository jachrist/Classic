'use strict';

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./lib/db');
const { seedIfEmpty } = require('./seed');

const app = express();
const PORT = process.env.PORT || 3001;

// CORS
const origins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: origins.length ? origins : true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-leader-token'],
  })
);

app.use(express.json({ limit: '1mb' }));

// Init DB
db.ensureTables();
seedIfEmpty();

// Ruter
app.use('/api/themes', require('./routes/themes'));
app.use('/api/pieces', require('./routes/pieces'));
app.use('/api/games', require('./routes/games'));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok', service: 'classic-api', time: new Date().toISOString() });
});

// Valgfritt: server frontend statisk hvis FRONTEND_DIR er satt (nyttig for enkel drift)
if (process.env.FRONTEND_DIR) {
  const dir = path.resolve(process.env.FRONTEND_DIR);
  app.use(express.static(dir));
}

// 404 for ukjente API-ruter
app.use('/api', (req, res) => {
  res.status(404).json({ success: false, error: 'Ukjent endepunkt' });
});

// Finn LAN-adresser (nyttig for testing fra mobil/iPad på samme Wi-Fi)
function lanAddresses() {
  const os = require('os');
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

app.listen(PORT, '0.0.0.0', () => {
  const servesFrontend = !!process.env.FRONTEND_DIR;
  console.log(`\n🎼 Classic kjører på port ${PORT}`);
  console.log(`   Lokalt:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) {
    console.log(`   Nettverk: http://${ip}:${PORT}   ← åpne denne i Safari på iPad`);
  }
  if (!servesFrontend) {
    console.log('   (Tips: sett FRONTEND_DIR=../frontend i .env for å teste alt fra én adresse)');
  }
  console.log(`   Database: ${db.DB_PATH}\n`);
});
