'use strict';

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { successResponse, errorResponse, generateId, validateRequired, now } = require('../lib/helpers');
const { KINDS, kindOf } = require('../lib/kinds');

/** GET /api/themes — alle tema med antall stykker. */
router.get('/', (req, res) => {
  const themes = db.listEntities('themes', { orderBy: 'name' });
  const pieces = db.listEntities('pieces');
  const counts = {};
  for (const p of pieces) counts[p.theme] = (counts[p.theme] || 0) + 1;
  const data = themes.map((t) => ({
    id: t.id,
    name: t.name,
    kind: t.kind,
    kindLabel: (KINDS[t.kind] || KINDS.classical).label,
    count: counts[t.name] || 0,
  }));
  successResponse(res, { data, kinds: Object.entries(KINDS).map(([k, v]) => ({ kind: k, label: v.label })) });
});

/** POST /api/themes — nytt tema { name, kind }. */
router.post('/', (req, res) => {
  const missing = validateRequired(req.body, ['name', 'kind']);
  if (missing.length) return errorResponse(res, `Mangler felt: ${missing.join(', ')}`);
  const name = String(req.body.name).trim();
  const kind = kindOf(req.body.kind);
  if (db.findOne('themes', { name })) return errorResponse(res, 'Det finnes allerede et tema med dette navnet', 409);
  const id = generateId();
  const theme = { name, kind, createdAt: now() };
  const saved = db.upsertEntity('themes', 'theme', id, theme);
  successResponse(res, { id, item: saved }, 201);
});

/** PUT /api/themes/:id — endre navn/type. */
router.put('/:id', (req, res) => {
  const existing = db.getEntity('themes', req.params.id);
  if (!existing) return errorResponse(res, 'Fant ikke temaet', 404);
  const updated = { ...existing };
  if ('name' in req.body) updated.name = String(req.body.name).trim();
  if ('kind' in req.body) updated.kind = kindOf(req.body.kind);
  updated.updatedAt = now();
  const saved = db.upsertEntity('themes', 'theme', req.params.id, updated);
  successResponse(res, { item: saved });
});

/** DELETE /api/themes/:id — kun hvis temaet er tomt. */
router.delete('/:id', (req, res) => {
  const theme = db.getEntity('themes', req.params.id);
  if (!theme) return errorResponse(res, 'Fant ikke temaet', 404);
  const used = db.listEntities('pieces', { filter: { theme: theme.name } });
  if (used.length) return errorResponse(res, `Temaet har ${used.length} stykke(r) — flytt eller slett dem først`, 409);
  db.deleteEntity('themes', req.params.id);
  successResponse(res, { deleted: true });
});

module.exports = router;
