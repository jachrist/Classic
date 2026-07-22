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
  },
  pop: {
    label: 'Pop',
    labels: { composer: 'Artist', epoch: 'Album', year: 'Årstall', work: 'Låt', movement: '' },
    field2Source: 'library', // album velges fra album i temaet
    useMovement: false,
    weights: { composer: 30, epoch: 20, year: 25, work: 25 },
  },
};

function kindOf(name) {
  return KINDS[name] ? name : 'classical';
}

module.exports = { KINDS, kindOf };
