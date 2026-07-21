'use strict';

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { successResponse, errorResponse, generateId, validateRequired, now } = require('../lib/helpers');
const { EPOCHS } = require('../lib/epochs');

/** GET /api/pieces — hele biblioteket (admin). */
router.get('/', (req, res) => {
  const pieces = db.listEntities('pieces', { orderBy: 'composer' });
  successResponse(res, { data: pieces });
});

/** GET /api/pieces/meta — data til gjettelister (komponister + epoker). */
router.get('/meta', (req, res) => {
  const pieces = db.listEntities('pieces');
  const composers = [...new Set(pieces.map((p) => p.composer).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'no')
  );
  const years = pieces.map((p) => parseInt(p.year, 10)).filter((y) => !Number.isNaN(y));
  successResponse(res, {
    composers,
    epochs: EPOCHS.map((e) => e.name),
    epochsFull: EPOCHS,
    count: pieces.length,
    yearRange: years.length ? { min: Math.min(...years), max: Math.max(...years) } : { min: 1600, max: 2025 },
  });
});

/** GET /api/pieces/:id */
router.get('/:id', (req, res) => {
  const piece = db.getEntity('pieces', req.params.id);
  if (!piece) return errorResponse(res, 'Fant ikke stykket', 404);
  successResponse(res, { item: piece });
});

/** POST /api/pieces — nytt stykke (admin). */
router.post('/', (req, res) => {
  const missing = validateRequired(req.body, ['composer', 'year', 'epoch', 'work']);
  if (missing.length) return errorResponse(res, `Mangler felt: ${missing.join(', ')}`);

  const id = generateId();
  const piece = {
    composer: String(req.body.composer).trim(),
    year: parseInt(req.body.year, 10),
    epoch: String(req.body.epoch).trim(),
    work: String(req.body.work).trim(),
    movement: (req.body.movement || '').trim(),
    spotifyUrl: (req.body.spotifyUrl || '').trim(),
    createdAt: now(),
  };
  const saved = db.upsertEntity('pieces', 'piece', id, piece);
  successResponse(res, { id, item: saved }, 201);
});

/** PUT /api/pieces/:id — oppdater stykke (admin). */
router.put('/:id', (req, res) => {
  const existing = db.getEntity('pieces', req.params.id);
  if (!existing) return errorResponse(res, 'Fant ikke stykket', 404);
  const updated = {
    ...existing,
    ...('composer' in req.body ? { composer: String(req.body.composer).trim() } : {}),
    ...('year' in req.body ? { year: parseInt(req.body.year, 10) } : {}),
    ...('epoch' in req.body ? { epoch: String(req.body.epoch).trim() } : {}),
    ...('work' in req.body ? { work: String(req.body.work).trim() } : {}),
    ...('movement' in req.body ? { movement: (req.body.movement || '').trim() } : {}),
    ...('spotifyUrl' in req.body ? { spotifyUrl: (req.body.spotifyUrl || '').trim() } : {}),
    updatedAt: now(),
  };
  const saved = db.upsertEntity('pieces', 'piece', req.params.id, updated);
  successResponse(res, { item: saved });
});

/** DELETE /api/pieces/:id (admin). */
router.delete('/:id', (req, res) => {
  const ok = db.deleteEntity('pieces', req.params.id);
  if (!ok) return errorResponse(res, 'Fant ikke stykket', 404);
  successResponse(res, { deleted: true });
});

module.exports = router;
