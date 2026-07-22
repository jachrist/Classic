'use strict';

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { successResponse, errorResponse, generateId, validateRequired, now } = require('../lib/helpers');
const { EPOCHS } = require('../lib/epochs');
const { KINDS, kindOf } = require('../lib/kinds');
const { resolveMany } = require('../lib/spotify-resolve');

/** Finn tematype ut fra temanavn (default klassisk). */
function themeKind(themeName) {
  const t = themeName ? db.findOne('themes', { name: themeName }) : null;
  return t ? kindOf(t.kind) : 'classical';
}

/** GET /api/pieces — hele biblioteket (admin), evt. filtrert på ?theme=. */
router.get('/', (req, res) => {
  const filter = req.query.theme ? { theme: req.query.theme } : {};
  const pieces = db.listEntities('pieces', { filter, orderBy: 'composer' });
  successResponse(res, { data: pieces });
});

/**
 * GET /api/pieces/meta?theme=NAVN — data til gjetteskjemaet for ett tema:
 * feltnavn, om «Album»/«Epoke» hentes fra fast liste eller biblioteket, artist-/
 * komponistliste, epoke-/albumliste og årsintervall.
 */
router.get('/meta', (req, res) => {
  const themeName = req.query.theme || null;
  const kind = themeKind(themeName);
  const cfg = KINDS[kind];
  const pieces = db.listEntities('pieces', themeName ? { filter: { theme: themeName } } : {});

  const field1Options = [...new Set(pieces.map((p) => p.composer).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'no')
  );
  const field2Options =
    cfg.field2Source === 'epochs'
      ? EPOCHS.map((e) => e.name)
      : [...new Set(pieces.map((p) => p.epoch).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'no'));

  const years = pieces.map((p) => parseInt(p.year, 10)).filter((y) => !Number.isNaN(y));

  successResponse(res, {
    theme: themeName,
    kind,
    labels: cfg.labels,
    useMovement: cfg.useMovement,
    field2Source: cfg.field2Source,
    field1Options,
    field2Options,
    epochsFull: EPOCHS,
    count: pieces.length,
    yearRange: years.length
      ? { min: Math.min(...years), max: Math.max(...years) }
      : { min: 1900, max: 2025 },
    // Bakoverkompatible aliaser
    composers: field1Options,
    epochs: field2Options,
  });
});

/**
 * POST /api/pieces/resolve-spotify — slå opp manglende Spotify-lenker automatisk
 * (server-side, krever åpen internett-tilgang). Body/spm: { theme?, limit?, all? }.
 * Fyller kun inn stykker uten lenke, med mindre all=true.
 */
router.post('/resolve-spotify', async (req, res) => {
  const themeName = req.body.theme || req.query.theme || null;
  const onlyMissing = !(req.body.all === true || req.query.all === 'true');
  const limit = Math.max(1, Math.min(50, parseInt(req.body.limit || req.query.limit, 10) || 25));
  const pieces = db.listEntities('pieces', themeName ? { filter: { theme: themeName } } : {});
  try {
    const result = await resolveMany(pieces, { onlyMissing, limit }, (piece, url) => {
      db.upsertEntity('pieces', 'piece', piece.id, { ...piece, spotifyUrl: url, updatedAt: now() });
    });
    successResponse(res, result);
  } catch (err) {
    errorResponse(res, 'Oppslag feilet: ' + (err.message || 'ukjent feil'), 502);
  }
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
    theme: (req.body.theme || 'Klassisk').trim(),
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
    ...('theme' in req.body ? { theme: String(req.body.theme).trim() } : {}),
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
