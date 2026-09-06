'use strict';

// Enkle assertion-tester for poengberegning (ingen rammeverk).
const assert = require('assert');
const { scoreGuess, similarity, normalize } = require('../lib/scoring');
const { yearToleranceFor, isDecadeTheme } = require('../lib/kinds');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const piece = {
  composer: 'Ludwig van Beethoven',
  year: 1808,
  epoch: 'Klassisisme',
  work: 'Symfoni nr. 5 c-moll',
  movement: '1. sats – Allegro con brio',
};

console.log('scoring:');

test('perfekt gjetning gir full pott', () => {
  const r = scoreGuess({ composer: 'Ludwig van Beethoven', year: 1808, epoch: 'Klassisisme', work: 'Symfoni nr. 5 c-moll', movement: '1. sats – Allegro con brio' }, piece);
  assert.strictEqual(r.total, 100);
});

test('feil komponist og epoke gir 0 der', () => {
  const r = scoreGuess({ composer: 'Mozart', year: 1808, epoch: 'Barokk', work: '', movement: '' }, piece);
  assert.strictEqual(r.breakdown.composer.points, 0);
  assert.strictEqual(r.breakdown.epoch.points, 0);
  assert.strictEqual(r.breakdown.year.points, 25);
});

test('årstall innenfor slingringsmonn gir full', () => {
  const r = scoreGuess({ year: 1811 }, piece);
  assert.strictEqual(r.breakdown.year.points, 25);
});

test('årstall langt unna gir 0', () => {
  const r = scoreGuess({ year: 1600 }, piece);
  assert.strictEqual(r.breakdown.year.points, 0);
});

test('årstall middels avvik gir delvis', () => {
  const r = scoreGuess({ year: 1838 }, piece); // 30 år bom
  assert.ok(r.breakdown.year.points > 0 && r.breakdown.year.points < 25, `fikk ${r.breakdown.year.points}`);
});

test('fuzzy verk uten katalognummer teller', () => {
  const r = scoreGuess({ work: 'symfoni 5' }, piece);
  assert.ok(r.breakdown.work.points >= 10, `fikk ${r.breakdown.work.points}`);
});

test('normalisering fjerner aksenter', () => {
  assert.strictEqual(normalize('Fauré'), 'faure');
});

test('delstreng gir høy likhet', () => {
  assert.ok(similarity('måneskinnssonaten', 'Måneskinn') >= 0.85);
});

test('tomt fasit-felt gir 0 uten å krasje', () => {
  const r = scoreGuess({ work: 'noe' }, { work: '' });
  assert.strictEqual(r.breakdown.work.points, 0);
});

test('pop: perfekt gjetning gir 100 uten sats', () => {
  const pop = { composer: 'Nirvana', epoch: 'Nevermind', year: 1991, work: 'Smells Like Teen Spirit', movement: '' };
  const r = scoreGuess({ composer: 'Nirvana', epoch: 'Nevermind', year: 1992, work: 'Smells Like Teen Spirit' }, pop, 'pop');
  assert.strictEqual(r.total, 100, `fikk ${r.total}`);
  assert.strictEqual(r.breakdown.movement, undefined, 'pop skal ikke ha sats');
  assert.strictEqual(r.breakdown.work.max, 25, 'verk skal være verdt 25 i pop');
});

test('pop: riktig artist+album, bom på år og låt', () => {
  const pop = { composer: 'Oasis', epoch: 'Morning Glory', year: 1995, work: 'Wonderwall' };
  const r = scoreGuess({ composer: 'Oasis', epoch: 'Morning Glory', year: 1930, work: '' }, pop, 'pop');
  assert.strictEqual(r.breakdown.composer.points, 30);
  assert.strictEqual(r.breakdown.epoch.points, 20);
  assert.strictEqual(r.breakdown.year.points, 0);
  assert.strictEqual(r.breakdown.work.points, 0);
  assert.strictEqual(r.total, 50);
});

test('pop: årstall 10 år bom gir 0 (strengere enn klassisk)', () => {
  const pop = { composer: 'Nirvana', epoch: 'Nevermind', year: 1991, work: 'x' };
  assert.strictEqual(scoreGuess({ year: 2001 }, pop, 'pop').breakdown.year.points, 0);
  // ±2 år gir fortsatt full
  assert.strictEqual(scoreGuess({ year: 1993 }, pop, 'pop').breakdown.year.points, 25);
});

test('pop er strengere på årstall enn klassisk ved samme avvik', () => {
  const piece = { year: 1990 };
  const popPts = scoreGuess({ year: 1998 }, piece, 'pop').breakdown.year.points; // 8 år
  const classPts = scoreGuess({ year: 1998 }, piece, 'classical').breakdown.year.points;
  assert.ok(popPts < classPts, `pop ${popPts} skal være < klassisk ${classPts}`);
  assert.ok(popPts <= 7, `pop 8-år-avvik skal gi få poeng, fikk ${popPts}`);
});

test('isDecadeTheme kjenner igjen tiårs-tema', () => {
  assert.ok(isDecadeTheme('90-tallet'));
  assert.ok(isDecadeTheme('2000-tallet'));
  assert.ok(isDecadeTheme('Norsk 60-tallspop'));
  assert.ok(!isDecadeTheme('Progrock'));
  assert.ok(!isDecadeTheme('Norsk pop'));
  assert.ok(!isDecadeTheme('Klassisk'));
});

test('tiårs-tema er strengere på årstall enn øvrige pop-tema', () => {
  const tol = yearToleranceFor('90-tallet', 'pop');
  assert.deepStrictEqual(tol, { full: 1, zero: 5 });
  const piece = { year: 1991 };
  const decadePts = scoreGuess({ year: 1994 }, piece, 'pop', tol).breakdown.year.points; // 3 år bom
  const genrePts = scoreGuess({ year: 1994 }, piece, 'pop').breakdown.year.points; // default pop {2,10}
  assert.ok(decadePts < genrePts, `tiårs ${decadePts} < sjanger ${genrePts}`);
  // 5 år bom → 0 i tiårs-tema
  assert.strictEqual(scoreGuess({ year: 1996 }, piece, 'pop', tol).breakdown.year.points, 0);
  // sjanger-tema (ikke tiårs) beholder middels toleranse
  assert.deepStrictEqual(yearToleranceFor('Progrock', 'pop'), { full: 2, zero: 10 });
});

test('tema med svært langt årsspenn (blandede epoker) får romslig toleranse', () => {
  // Julehits spenner fra middelalder til i dag → romslig som klassisk
  assert.deepStrictEqual(yearToleranceFor('Norske julehits', 'pop', 682), { full: 5, zero: 60 });
  // Uten stort spenn beholdes middels pop-toleranse
  assert.deepStrictEqual(yearToleranceFor('Norske julehits', 'pop', 40), { full: 2, zero: 10 });
  // 8 års bom gir langt mer poeng i et bredt tema enn i et vanlig pop-tema
  const piece = { year: 1946 };
  const wide = scoreGuess({ year: 1954 }, piece, 'pop', yearToleranceFor('x', 'pop', 682)).breakdown.year.points;
  const normal = scoreGuess({ year: 1954 }, piece, 'pop').breakdown.year.points;
  assert.ok(wide > normal, `bredt ${wide} > vanlig ${normal}`);
});

console.log(`\n${passed} tester ok`);
