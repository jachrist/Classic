'use strict';

/**
 * Poengberegning for en gjetning mot fasit.
 *
 * Regler (jf. spesifikasjon):
 *  - Eksakt treff på komponist og epoke gir full uttelling.
 *  - Slingringsmonn på årstall (gradert etter avvik) og på verk/sats (fuzzy tekst).
 *
 * Vektene under summerer til 100 og kan justeres fritt.
 */
const { KINDS, kindOf } = require('./kinds');

// Beholdt for bakoverkompatibilitet (klassiske vekter); autoritativt i lib/kinds.js.
const WEIGHTS = {
  composer: 30,
  epoch: 20,
  year: 25,
  work: 15,
  movement: 10,
};

// Årstall: fullt innenfor ±YEAR_FULL, lineært ned til 0 ved ±YEAR_ZERO.
const YEAR_FULL = 5;
const YEAR_ZERO = 60;

// Tekst (verk/sats): full uttelling ved likhet ≥ TEXT_FULL, 0 under TEXT_MIN.
const TEXT_FULL = 0.82;
const TEXT_MIN = 0.4;

/** Normaliser tekst for sammenligning: små bokstaver, uten aksenter/tegnsetting. */
function normalize(str) {
  return String(str == null ? '' : str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // fjern diakritiske tegn
    .replace(/\b(no|nr|op|opus|bwv|kv|k|d|hob|the|der|die|das|le|la|les)\b\.?/g, ' ') // vanlige fyllord/katalogforkortelser
    .replace(/[^a-z0-9æøå\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Levenshtein-avstand mellom to strenger. */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Token-overlapp (Dice-koeffisient) på ordnivå. */
function tokenOverlap(a, b) {
  const ta = new Set(a.split(' ').filter(Boolean));
  const tb = new Set(b.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return (2 * inter) / (ta.size + tb.size);
}

/** Likhet i [0,1] — maks av Levenshtein-ratio og token-overlapp. */
function similarity(guess, answer) {
  const g = normalize(guess);
  const a = normalize(answer);
  if (!g && !a) return 1;
  if (!g || !a) return 0;
  if (g === a) return 1;
  const maxLen = Math.max(g.length, a.length);
  const lev = 1 - levenshtein(g, a) / maxLen;
  const tok = tokenOverlap(g, a);
  // Delstreng-treff (f.eks. «måneskinn» i «måneskinnssonaten») teller også
  const sub = g.includes(a) || a.includes(g) ? 0.9 : 0;
  return Math.max(lev, tok, sub);
}

function exactMatchScore(guess, answer, weight) {
  const hit = normalize(guess) === normalize(answer) && normalize(answer) !== '';
  return { points: hit ? weight : 0, max: weight, hit, guess: guess || '', answer };
}

function yearScore(guess, answer, weight, full = YEAR_FULL, zero = YEAR_ZERO) {
  const g = parseInt(guess, 10);
  const a = parseInt(answer, 10);
  if (Number.isNaN(g) || Number.isNaN(a)) {
    return { points: 0, max: weight, diff: null, guess: guess || '', answer };
  }
  const diff = Math.abs(g - a);
  let ratio;
  if (diff <= full) ratio = 1;
  else if (diff >= zero) ratio = 0;
  else ratio = (zero - diff) / (zero - full);
  return { points: Math.round(weight * ratio), max: weight, diff, guess: g, answer: a };
}

function textScore(guess, answer, weight) {
  if (!answer) return { points: 0, max: weight, similarity: 0, guess: guess || '', answer: '' };
  const sim = similarity(guess, answer);
  let ratio;
  if (sim >= TEXT_FULL) ratio = 1;
  else if (sim <= TEXT_MIN) ratio = 0;
  else ratio = (sim - TEXT_MIN) / (TEXT_FULL - TEXT_MIN);
  return {
    points: Math.round(weight * ratio),
    max: weight,
    similarity: Math.round(sim * 100) / 100,
    guess: guess || '',
    answer,
  };
}

/**
 * Beregn poeng for én gjetning mot et stykke (fasit), avhengig av tematype.
 * For pop brukes ikke `movement`, og vektene er ulike (se lib/kinds.js).
 * Breakdown-nøklene er alltid composer/epoch/year/work(/movement) — frontenden
 * setter riktige etiketter (Artist/Album …) ut fra typen.
 * @returns { total, max, breakdown }
 */
function scoreGuess(guess, piece, kind = 'classical') {
  const cfg = KINDS[kindOf(kind)];
  const w = cfg.weights;
  const y = cfg.year || {};
  const breakdown = {
    composer: exactMatchScore(guess.composer, piece.composer, w.composer),
    epoch: exactMatchScore(guess.epoch, piece.epoch, w.epoch),
    year: yearScore(guess.year, piece.year, w.year, y.full, y.zero),
    work: textScore(guess.work, piece.work, w.work),
  };
  if (cfg.useMovement) {
    breakdown.movement = textScore(guess.movement, piece.movement, w.movement);
  }
  const total = Object.values(breakdown).reduce((s, b) => s + b.points, 0);
  const max = Object.values(breakdown).reduce((s, b) => s + b.max, 0);
  return { total, max, breakdown };
}

module.exports = {
  scoreGuess,
  similarity,
  normalize,
  WEIGHTS,
  YEAR_FULL,
  YEAR_ZERO,
};
