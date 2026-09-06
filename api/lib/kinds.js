'use strict';

/**
 * Tematyper («kind») styrer feltnavn og poengfordeling.
 *
 * Databasekolonnene er felles (composer/epoch/year/work/movement), men tolkes
 * ulikt per type: for pop er `composer` = artist og `epoch` = album, og `movement`
 * brukes ikke. Frontenden henter etikettene herfra (via meta/state), så det finnes
 * kun én kilde til sannhet.
 *
 * Vektene summerer til 100 i begge typer.
 */
const KINDS = {
  classical: {
    label: 'Klassisk',
    labels: { composer: 'Komponist', epoch: 'Epoke', year: 'Årstall', work: 'Verk', movement: 'Sats' },
    field2Source: 'epochs', // epoke velges fra fast liste
    useMovement: true,
    weights: { composer: 30, epoch: 20, year: 25, work: 15, movement: 10 },
    // Årstall spenner over århundrer → romslig slingringsmonn
    year: { full: 5, zero: 60 },
  },
  pop: {
    label: 'Pop',
    labels: { composer: 'Artist', epoch: 'Album', year: 'Årstall', work: 'Låt', movement: '' },
    field2Source: 'library', // album velges fra album i temaet
    useMovement: false,
    weights: { composer: 30, epoch: 20, year: 25, work: 25 },
    // Pop ligger innenfor noen tiår → strengere krav til årstall
    year: { full: 2, zero: 10 },
  },
};

function kindOf(name) {
  return KINDS[name] ? name : 'classical';
}

/** Er temaet et «tiårs»-tema (nevner et bestemt tiår, f.eks. «90-tallet»,
 * «2000-tallet» eller «Norsk 60-tallspop»)? Da stilles strengere årstallskrav. */
function isDecadeTheme(name) {
  return /\d{2,4}-tall/i.test(String(name == null ? '' : name).trim());
}

/**
 * Årstall-toleranse ut fra tema + type + hvor bredt temaet spenner:
 *  - Klassisk: romslig (spenner over århundrer).
 *  - Tiårs-tema: strengt — årstallet ligger innenfor ett tiår, så «rett tiår»
 *    skal ikke holde; du må treffe nær selve året.
 *  - Blandede epoker (svært langt årsspenn, f.eks. «Norske julehits» med salmer
 *    fra middelalderen ved siden av nye innspillinger): romslig — ellers blir
 *    årstallet nesten umulig.
 *  - Øvrige pop (sjangre som spenner over noen tiår): middels.
 * `yearSpan` = maks-år − min-år for temaets stykker (valgfritt).
 */
function yearToleranceFor(themeName, kind, yearSpan) {
  const k = kindOf(kind);
  if (k === 'classical') return KINDS.classical.year; // { full: 5, zero: 60 }
  if (isDecadeTheme(themeName)) return { full: 1, zero: 5 };
  if (typeof yearSpan === 'number' && yearSpan > 100) return { full: 5, zero: 60 };
  return KINDS.pop.year; // { full: 2, zero: 10 }
}

module.exports = { KINDS, kindOf, isDecadeTheme, yearToleranceFor };
