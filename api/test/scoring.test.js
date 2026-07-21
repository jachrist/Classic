'use strict';

// Enkle assertion-tester for poengberegning (ingen rammeverk).
const assert = require('assert');
const { scoreGuess, similarity, normalize } = require('../lib/scoring');

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

console.log(`\n${passed} tester ok`);
