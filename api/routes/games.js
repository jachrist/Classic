'use strict';

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { scoreGuess } = require('../lib/scoring');
const { KINDS, kindOf, yearToleranceFor } = require('../lib/kinds');
const {
  successResponse,
  errorResponse,
  generateId,
  generateRoomCode,
  generateToken,
  validateRequired,
  now,
} = require('../lib/helpers');

const DEFAULT_DURATION = 60; // sekunder

// ---------- Hjelpere ----------

function getGameByCode(code) {
  if (!code) return null;
  return db.findOne('games', { code: String(code).toUpperCase() });
}

function leaderTokenFrom(req) {
  return (
    req.get('x-leader-token') ||
    (req.body && req.body.leaderToken) ||
    (req.query && req.query.leaderToken) ||
    ''
  );
}

function requireLeader(req, res, game) {
  const token = leaderTokenFrom(req);
  if (!token || token !== game.leaderToken) {
    errorResponse(res, 'Kun spill-lederen kan gjøre dette', 403);
    return false;
  }
  return true;
}

function activeRound(game) {
  if (!game.currentRoundId) return null;
  return db.getEntity('rounds', game.currentRoundId);
}

function timeLeft(round) {
  if (!round) return 0;
  // «pending» = klar, men tiden er ikke startet ennå → vis full varighet
  if (round.status === 'pending' || !round.endsAt) return round ? round.durationSec || 0 : 0;
  return Math.max(0, Math.round((new Date(round.endsAt).getTime() - Date.now()) / 1000));
}

function leaderboard(gameId) {
  return db
    .listEntities('players', { filter: { gameId } })
    .map((p) => ({ id: p.id, name: p.name, totalScore: p.totalScore || 0 }))
    .sort((a, b) => b.totalScore - a.totalScore);
}

/**
 * Avslør en runde: beregn poeng for alle gjetninger og legg til spillernes total.
 * Idempotent — gjør ingenting hvis runden allerede er avslørt.
 */
function revealRound(round) {
  if (!round || round.status === 'revealed') return round;
  const piece = db.getEntity('pieces', round.pieceId);
  const game = db.getEntity('games', round.gameId);
  const kind = kindOf(game && game.kind);
  const yearTol = yearToleranceFor(game && game.theme, kind);
  const guesses = db.listEntities('guesses', { filter: { roundId: round.id } });
  for (const guess of guesses) {
    const { total, breakdown } = scoreGuess(guess, piece || {}, kind, yearTol);
    guess.total = total;
    guess.breakdown = breakdown;
    db.upsertEntity('guesses', round.id, guess.id, guess);
    const player = db.getEntity('players', guess.playerId);
    if (player) {
      player.totalScore = (player.totalScore || 0) + total;
      db.upsertEntity('players', 'player', player.id, player);
    }
  }
  round.status = 'revealed';
  round.revealedAt = now();
  db.upsertEntity('rounds', round.gameId, round.id, round);
  return round;
}

/** Avslør automatisk hvis tiden er ute. */
function maybeAutoReveal(round) {
  if (round && round.status === 'active' && timeLeft(round) <= 0) {
    return revealRound(round);
  }
  return round;
}

function publicPiece(piece) {
  if (!piece) return null;
  return {
    composer: piece.composer,
    year: piece.year,
    epoch: piece.epoch,
    work: piece.work,
    movement: piece.movement,
    spotifyUrl: piece.spotifyUrl,
  };
}

/** Bygg tilstands-objekt tilpasset mottakeren (leder ser fasit under aktiv runde). */
function buildState(game, { playerId, isLeader } = {}) {
  let round = activeRound(game);
  round = maybeAutoReveal(round);

  const kind = kindOf(game.kind);
  const cfg = KINDS[kind];
  const state = {
    game: {
      code: game.code,
      status: game.status,
      leaderName: game.leaderName,
      settings: game.settings || {},
      roundCount: (game.usedPieceIds || []).length,
      theme: game.theme || 'Klassisk',
      kind,
      kindLabel: cfg.label,
      labels: cfg.labels,
      useMovement: cfg.useMovement,
    },
    players: leaderboard(game.id),
    round: null,
  };

  if (playerId) {
    const me = db.getEntity('players', playerId);
    if (me) state.you = { id: me.id, name: me.name, totalScore: me.totalScore || 0 };
  }

  if (round) {
    const revealed = round.status === 'revealed';
    const piece = db.getEntity('pieces', round.pieceId);
    const guesses = db.listEntities('guesses', { filter: { roundId: round.id } });
    const myGuess = playerId ? guesses.find((g) => g.playerId === playerId) : null;

    state.round = {
      id: round.id,
      roundNumber: round.roundNumber,
      status: round.status,
      durationSec: round.durationSec,
      endsAt: round.endsAt,
      timeLeft: timeLeft(round),
      guessCount: guesses.length,
      // Leder ser fasit + Spotify allerede under aktiv runde; deltakere først ved avsløring
      piece: revealed || isLeader ? publicPiece(piece) : null,
      yourGuess: myGuess
        ? {
            composer: myGuess.composer,
            year: myGuess.year,
            epoch: myGuess.epoch,
            work: myGuess.work,
            movement: myGuess.movement,
            submitted: true,
          }
        : null,
    };

    if (revealed) {
      state.round.results = guesses
        .map((g) => ({
          playerId: g.playerId,
          name: (db.getEntity('players', g.playerId) || {}).name || '—',
          total: g.total || 0,
          breakdown: g.breakdown || null,
          guess: {
            composer: g.composer,
            year: g.year,
            epoch: g.epoch,
            work: g.work,
            movement: g.movement,
          },
        }))
        .sort((a, b) => b.total - a.total);
      if (playerId) {
        state.round.yourResult = state.round.results.find((r) => r.playerId === playerId) || null;
      }
    }
  }

  return state;
}

// ---------- Ruter ----------

/** POST /api/games — spill-lederen oppretter et nytt spill. */
router.post('/', (req, res) => {
  const missing = validateRequired(req.body, ['leaderName']);
  if (missing.length) return errorResponse(res, `Mangler felt: ${missing.join(', ')}`);

  // Unik romkode
  let code;
  for (let i = 0; i < 20; i++) {
    code = generateRoomCode(4);
    if (!getGameByCode(code)) break;
  }

  // Tema bestemmer tematype (klassisk/pop). Default «Klassisk» hvis ikke oppgitt.
  let themeName = (req.body.theme || '').trim();
  let themeRow = themeName ? db.findOne('themes', { name: themeName }) : null;
  if (!themeRow) {
    themeRow = db.findOne('themes', { name: 'Klassisk' }) || db.listEntities('themes', { orderBy: 'name' })[0] || null;
  }
  themeName = themeRow ? themeRow.name : 'Klassisk';
  const kind = kindOf(themeRow && themeRow.kind);

  const id = generateId();
  const leaderToken = generateToken();
  const durationSec = Math.max(15, Math.min(600, parseInt(req.body.durationSec, 10) || DEFAULT_DURATION));
  const game = {
    code,
    status: 'lobby',
    leaderToken,
    leaderName: String(req.body.leaderName).trim(),
    theme: themeName,
    kind,
    currentRoundId: null,
    usedPieceIds: [],
    settings: { durationSec },
    createdAt: now(),
  };
  db.upsertEntity('games', 'game', id, game);
  successResponse(
    res,
    {
      code,
      leaderToken,
      game: { code, status: game.status, leaderName: game.leaderName, theme: themeName, kind, settings: game.settings },
    },
    201
  );
});

/** POST /api/games/:code/join — deltaker blir med (romkode + kallenavn). */
router.post('/:code/join', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet — sjekk romkoden', 404);
  if (game.status === 'finished') return errorResponse(res, 'Spillet er avsluttet', 410);

  const name = (req.body && req.body.name ? String(req.body.name) : '').trim();
  if (!name) return errorResponse(res, 'Du må skrive inn et kallenavn');

  const id = generateId();
  const player = { gameId: game.id, name, totalScore: 0, joinedAt: now() };
  db.upsertEntity('players', 'player', id, player);
  successResponse(res, { playerId: id, player: { id, name, totalScore: 0 }, code: game.code }, 201);
});

/** GET /api/games/:code/state — polles av både leder og deltakere. */
router.get('/:code/state', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet', 404);
  const isLeader = leaderTokenFrom(req) === game.leaderToken;
  successResponse(res, buildState(game, { playerId: req.query.playerId, isLeader }));
});

/** POST /api/games/:code/start-round — leder starter ny runde (tilfeldig stykke). */
router.post('/:code/start-round', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet', 404);
  if (!requireLeader(req, res, game)) return;

  // Avslør evt. forrige runde før ny startes
  const prev = activeRound(game);
  if (prev && prev.status === 'active') revealRound(prev);

  // Kun stykker fra spillets tema
  const allPieces = db.listEntities('pieces', { filter: { theme: game.theme || 'Klassisk' } });
  if (!allPieces.length)
    return errorResponse(res, `Temaet «${game.theme || 'Klassisk'}» har ingen stykker — legg til noen i admin først`, 409);

  const used = new Set(game.usedPieceIds || []);
  let pool = allPieces.filter((p) => !used.has(p.id));
  let cleared = false;
  if (!pool.length) {
    pool = allPieces; // alle brukt — start på nytt
    cleared = true;
  }

  // Konkret stykke kan overstyres av leder, ellers tilfeldig
  let piece;
  if (req.body && req.body.pieceId) {
    piece = allPieces.find((p) => p.id === req.body.pieceId) || null;
    if (!piece) return errorResponse(res, 'Fant ikke valgt stykke', 404);
  } else {
    piece = pool[Math.floor(Math.random() * pool.length)];
  }

  const durationSec = Math.max(
    15,
    Math.min(600, parseInt(req.body && req.body.durationSec, 10) || (game.settings && game.settings.durationSec) || DEFAULT_DURATION)
  );
  const roundNumber = (game.usedPieceIds || []).length + 1;
  const roundId = generateId();
  // Runden starter i «pending»: lederen cuer musikken, tiden starter med begin-round.
  const round = {
    gameId: game.id,
    pieceId: piece.id,
    roundNumber,
    status: 'pending',
    durationSec,
    startedAt: null,
    endsAt: null,
  };
  db.upsertEntity('rounds', game.id, roundId, round);

  game.currentRoundId = roundId;
  game.status = 'playing';
  game.usedPieceIds = cleared ? [piece.id] : [...(game.usedPieceIds || []), piece.id];
  db.upsertEntity('games', 'game', game.id, game);

  successResponse(res, {
    round: { id: roundId, ...round, timeLeft: durationSec, piece: publicPiece(piece) },
  });
});

/** POST /api/games/:code/begin-round — leder starter tiden (etter at musikken er i gang). */
router.post('/:code/begin-round', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet', 404);
  if (!requireLeader(req, res, game)) return;
  const round = activeRound(game);
  if (!round || round.status !== 'pending') return errorResponse(res, 'Ingen klargjort runde å starte', 409);
  round.status = 'active';
  round.startedAt = now();
  round.endsAt = new Date(Date.now() + (round.durationSec || DEFAULT_DURATION) * 1000).toISOString();
  db.upsertEntity('rounds', game.id, round.id, round);
  successResponse(res, buildState(game, { isLeader: true }));
});

/** POST /api/games/:code/guess — deltaker sender/oppdaterer gjetning. */
router.post('/:code/guess', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet', 404);

  let round = activeRound(game);
  round = maybeAutoReveal(round);
  if (!round || round.status !== 'active') return errorResponse(res, 'Ingen aktiv runde å gjette på', 409);
  if (timeLeft(round) <= 0) return errorResponse(res, 'Tiden er ute', 409);

  const playerId = req.body && req.body.playerId;
  const player = playerId ? db.getEntity('players', playerId) : null;
  if (!player || player.gameId !== game.id) return errorResponse(res, 'Ukjent deltaker', 403);

  // Én gjetning per deltaker per runde — oppdateres til tiden er ute
  const existing = db
    .listEntities('guesses', { filter: { roundId: round.id } })
    .find((g) => g.playerId === playerId);
  const id = existing ? existing.id : generateId();
  const guess = {
    roundId: round.id,
    gameId: game.id,
    playerId,
    composer: (req.body.composer || '').trim(),
    year: req.body.year != null && req.body.year !== '' ? parseInt(req.body.year, 10) : null,
    epoch: (req.body.epoch || '').trim(),
    work: (req.body.work || '').trim(),
    movement: (req.body.movement || '').trim(),
    submittedAt: now(),
  };
  db.upsertEntity('guesses', round.id, id, guess);
  successResponse(res, { saved: true, timeLeft: timeLeft(round) });
});

/** POST /api/games/:code/reveal — leder avslutter runden manuelt. */
router.post('/:code/reveal', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet', 404);
  if (!requireLeader(req, res, game)) return;
  const round = activeRound(game);
  if (!round) return errorResponse(res, 'Ingen runde å avsløre', 409);
  revealRound(round);
  successResponse(res, buildState(game, { isLeader: true }));
});

/** POST /api/games/:code/finish — leder avslutter hele spillet. */
router.post('/:code/finish', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet', 404);
  if (!requireLeader(req, res, game)) return;
  const round = activeRound(game);
  if (round && round.status === 'active') revealRound(round);
  game.status = 'finished';
  db.upsertEntity('games', 'game', game.id, game);
  successResponse(res, { finished: true, players: leaderboard(game.id) });
});

/**
 * POST /api/games/:code/change-theme — bytt tema og fortsett med samme deltakere.
 * Beholder spillere og deres poeng; nullstiller brukte stykker for det nye temaet.
 */
router.post('/:code/change-theme', (req, res) => {
  const game = getGameByCode(req.params.code);
  if (!game) return errorResponse(res, 'Fant ikke spillet', 404);
  if (!requireLeader(req, res, game)) return;

  const themeName = (req.body && req.body.theme ? String(req.body.theme) : '').trim();
  const themeRow = themeName ? db.findOne('themes', { name: themeName }) : null;
  if (!themeRow) return errorResponse(res, 'Ukjent tema', 404);
  if (!db.listEntities('pieces', { filter: { theme: themeRow.name } }).length) {
    return errorResponse(res, `Temaet «${themeRow.name}» har ingen stykker`, 409);
  }

  // Avslutt evt. aktiv runde før bytte
  const round = activeRound(game);
  if (round && round.status === 'active') revealRound(round);

  game.theme = themeRow.name;
  game.kind = kindOf(themeRow.kind);
  game.currentRoundId = null;
  game.usedPieceIds = [];
  game.status = 'lobby';
  db.upsertEntity('games', 'game', game.id, game);
  successResponse(res, buildState(game, { isLeader: true }));
});

module.exports = router;
