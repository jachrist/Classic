'use strict';

/**
 * SQLite-lag for Classic — hybrid lagringsmodell (samme mønster som Gartha/korportal).
 *
 * Hver tabell har kolonnene `id` (PK), `partitionKey`, et sett søkbare felt og
 * `jsonData` (komplett objekt som JSON). `buildEntity`/`parseEntity` abstraherer
 * dette, `ensureTables()` oppretter tabeller og legger til manglende kolonner ved
 * oppstart.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'classic.db');

// Sørg for at katalogen finnes
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
// Journalmodus er konfigurerbar: WAL er raskest lokalt, men på Azure App Service
// ligger /home på et SMB-volum (Azure Files) der WAL kan gi låsefeil — sett da
// SQLITE_JOURNAL_MODE=DELETE.
const ALLOWED_JOURNAL = ['WAL', 'DELETE', 'TRUNCATE', 'PERSIST', 'MEMORY', 'OFF'];
const journalMode = (process.env.SQLITE_JOURNAL_MODE || 'WAL').toUpperCase();
db.pragma(`journal_mode = ${ALLOWED_JOURNAL.includes(journalMode) ? journalMode : 'WAL'}`);
db.pragma('foreign_keys = ON');

/**
 * Skjemadefinisjon. `searchable` er kolonner vi vil kunne filtrere/sortere på
 * direkte; alt annet ligger i jsonData. Alle tabeller får implisitt id +
 * partitionKey + jsonData.
 */
const TABLE_SCHEMAS = {
  // Musikkbiblioteket — stykkene spill-lederen kan trekke fra
  pieces: {
    searchable: ['composer', 'year', 'epoch', 'work'],
  },
  // Et spill / en «rom»-økt
  games: {
    searchable: ['code', 'status', 'leaderToken'],
  },
  // Deltakere i et spill
  players: {
    searchable: ['gameId', 'name'],
  },
  // En runde (ett stykke som spilles)
  rounds: {
    searchable: ['gameId', 'pieceId', 'status', 'roundNumber'],
  },
  // Én deltakers gjetning i en runde
  guesses: {
    searchable: ['roundId', 'gameId', 'playerId'],
  },
};

const COLUMN_TYPES = { year: 'INTEGER', roundNumber: 'INTEGER' };

function columnType(name) {
  return COLUMN_TYPES[name] || 'TEXT';
}

function ensureTables() {
  for (const [table, schema] of Object.entries(TABLE_SCHEMAS)) {
    const cols = ['id TEXT PRIMARY KEY', 'partitionKey TEXT'];
    for (const field of schema.searchable) cols.push(`${field} ${columnType(field)}`);
    cols.push('jsonData TEXT');
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (${cols.join(', ')})`);

    // Legg til manglende kolonner (enkel auto-migrering)
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
    for (const field of schema.searchable) {
      if (!existing.has(field)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${field} ${columnType(field)}`);
      }
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_pk ON ${table} (partitionKey)`);
  }
  // Nyttig ekstra-indeks for raske romkode-oppslag
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_games_code ON games (code)');
}

/** Bygg en radrepresentasjon av en entitet. */
function buildEntity(table, partitionKey, id, fullData) {
  const schema = TABLE_SCHEMAS[table];
  if (!schema) throw new Error(`Ukjent tabell: ${table}`);
  const row = { id, partitionKey, jsonData: JSON.stringify(fullData) };
  for (const field of schema.searchable) {
    row[field] = fullData[field] !== undefined ? fullData[field] : null;
  }
  return row;
}

/** Slå en databaserad tilbake til et komplett objekt. */
function parseEntity(row) {
  if (!row) return null;
  const data = row.jsonData ? JSON.parse(row.jsonData) : {};
  return { id: row.id, partitionKey: row.partitionKey, ...data };
}

function upsertEntity(table, partitionKey, id, fullData) {
  const row = buildEntity(table, partitionKey, id, { ...fullData, id });
  const keys = Object.keys(row);
  const placeholders = keys.map((k) => `@${k}`).join(', ');
  const updates = keys.filter((k) => k !== 'id').map((k) => `${k} = excluded.${k}`).join(', ');
  db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})
     ON CONFLICT(id) DO UPDATE SET ${updates}`
  ).run(row);
  return parseEntity(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
}

function getEntity(table, id) {
  return parseEntity(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
}

/**
 * List entiteter. `filter` er et objekt med likhetsbetingelser på søkbare felt,
 * f.eks. { gameId: 'abc', status: 'active' }. `orderBy` er kolonnenavn.
 */
function listEntities(table, { filter = {}, orderBy, order = 'ASC' } = {}) {
  const schema = TABLE_SCHEMAS[table];
  const where = [];
  const params = {};
  for (const [key, value] of Object.entries(filter)) {
    if (!schema.searchable.includes(key) && key !== 'partitionKey' && key !== 'id') continue;
    where.push(`${key} = @${key}`);
    params[key] = value;
  }
  let sql = `SELECT * FROM ${table}`;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  if (orderBy && (schema.searchable.includes(orderBy) || orderBy === 'id')) {
    sql += ` ORDER BY ${orderBy} ${order === 'DESC' ? 'DESC' : 'ASC'}`;
  }
  return db.prepare(sql).all(params).map(parseEntity);
}

function deleteEntity(table, id) {
  return db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id).changes > 0;
}

function findOne(table, filter) {
  const rows = listEntities(table, { filter });
  return rows[0] || null;
}

module.exports = {
  db,
  ensureTables,
  buildEntity,
  parseEntity,
  upsertEntity,
  getEntity,
  listEntities,
  deleteEntity,
  findOne,
  TABLE_SCHEMAS,
  DB_PATH,
};
