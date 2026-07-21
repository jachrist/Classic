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

app.listen(PORT, () => {
  console.log(`🎼 Classic-API kjører på http://localhost:${PORT}`);
  console.log(`   Database: ${db.DB_PATH}`);
});
