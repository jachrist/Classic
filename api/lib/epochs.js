'use strict';

/**
 * Kanoniske epoker/stilperioder med omtrentlige årsintervaller.
 * Brukes både som nedtrekksliste i gjettefeltet og som referanse ved seeding.
 */
const EPOCHS = [
  { name: 'Middelalder', from: 500, to: 1400 },
  { name: 'Renessanse', from: 1400, to: 1600 },
  { name: 'Barokk', from: 1600, to: 1750 },
  { name: 'Klassisisme', from: 1730, to: 1820 },
  { name: 'Romantikk', from: 1800, to: 1910 },
  { name: 'Impresjonisme', from: 1875, to: 1925 },
  { name: 'Modernisme', from: 1900, to: 1975 },
  { name: 'Samtid', from: 1975, to: 2100 },
];

module.exports = { EPOCHS };
