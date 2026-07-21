'use strict';

/**
 * Startbibliotek for Classic. Kjøres kun når `pieces`-tabellen er tom.
 *
 * MERK: `spotifyUrl` er bevisst tomt. Legg inn eksakte Spotify-lenker via
 * Admin-siden (lim inn track-/album-URL) for å få innebygd avspilling. Uten URL
 * viser lederskjermen en «Søk på Spotify»-knapp basert på komponist + verk.
 */
const db = require('./lib/db');
const { generateId, now } = require('./lib/helpers');

const SEED_PIECES = [
  // Renessanse
  { composer: 'Thomas Tallis', year: 1570, epoch: 'Renessanse', work: 'Spem in alium', movement: '' },
  // Barokk
  { composer: 'Antonio Vivaldi', year: 1725, epoch: 'Barokk', work: 'De fire årstider – Våren', movement: '1. sats – Allegro' },
  { composer: 'Johann Sebastian Bach', year: 1721, epoch: 'Barokk', work: 'Brandenburgkonsert nr. 3', movement: '1. sats – Allegro' },
  { composer: 'Johann Sebastian Bach', year: 1741, epoch: 'Barokk', work: 'Goldbergvariasjonene', movement: 'Aria' },
  { composer: 'Georg Friedrich Händel', year: 1741, epoch: 'Barokk', work: 'Messias', movement: 'Hallelujah' },
  // Klassisisme
  { composer: 'Wolfgang Amadeus Mozart', year: 1787, epoch: 'Klassisisme', work: 'Eine kleine Nachtmusik', movement: '1. sats – Allegro' },
  { composer: 'Wolfgang Amadeus Mozart', year: 1788, epoch: 'Klassisisme', work: 'Symfoni nr. 40 g-moll', movement: '1. sats – Molto allegro' },
  { composer: 'Joseph Haydn', year: 1791, epoch: 'Klassisisme', work: 'Symfoni nr. 94 «Overraskelsen»', movement: '2. sats – Andante' },
  { composer: 'Ludwig van Beethoven', year: 1808, epoch: 'Klassisisme', work: 'Symfoni nr. 5 c-moll', movement: '1. sats – Allegro con brio' },
  // Romantikk
  { composer: 'Ludwig van Beethoven', year: 1801, epoch: 'Romantikk', work: 'Måneskinnssonaten', movement: '1. sats – Adagio sostenuto' },
  { composer: 'Franz Schubert', year: 1825, epoch: 'Romantikk', work: 'Ave Maria', movement: '' },
  { composer: 'Frédéric Chopin', year: 1832, epoch: 'Romantikk', work: 'Nocturne Es-dur op. 9 nr. 2', movement: '' },
  { composer: 'Johannes Brahms', year: 1869, epoch: 'Romantikk', work: 'Ungarsk dans nr. 5', movement: '' },
  { composer: 'Edvard Grieg', year: 1875, epoch: 'Romantikk', work: 'Peer Gynt-suite nr. 1', movement: 'I Dovregubbens hall' },
  { composer: 'Edvard Grieg', year: 1875, epoch: 'Romantikk', work: 'Peer Gynt-suite nr. 1', movement: 'Morgenstemning' },
  { composer: 'Pjotr Tsjajkovskij', year: 1876, epoch: 'Romantikk', work: 'Svanesjøen', movement: 'Scene – Moderato' },
  { composer: 'Pjotr Tsjajkovskij', year: 1892, epoch: 'Romantikk', work: 'Nøtteknekkeren', movement: 'Blomstervalsen' },
  { composer: 'Antonín Dvořák', year: 1893, epoch: 'Romantikk', work: 'Symfoni nr. 9 «Fra den nye verden»', movement: '4. sats – Allegro con fuoco' },
  // Impresjonisme
  { composer: 'Erik Satie', year: 1888, epoch: 'Impresjonisme', work: 'Gymnopédie nr. 1', movement: '' },
  { composer: 'Claude Debussy', year: 1905, epoch: 'Impresjonisme', work: 'Suite bergamasque', movement: 'Clair de lune' },
  { composer: 'Maurice Ravel', year: 1928, epoch: 'Impresjonisme', work: 'Boléro', movement: '' },
  // Modernisme
  { composer: 'Gustav Holst', year: 1916, epoch: 'Modernisme', work: 'Planetene', movement: 'Mars, krigsbringeren' },
  { composer: 'Igor Stravinskij', year: 1913, epoch: 'Modernisme', work: 'Vårofferet', movement: 'De unge jentenes dans' },
  { composer: 'George Gershwin', year: 1924, epoch: 'Modernisme', work: 'Rhapsody in Blue', movement: '' },
  { composer: 'Sergej Prokofjev', year: 1935, epoch: 'Modernisme', work: 'Romeo og Julie', movement: 'Ridderdansen' },
  { composer: 'Carl Orff', year: 1936, epoch: 'Modernisme', work: 'Carmina Burana', movement: 'O Fortuna' },
  { composer: 'Dmitrij Sjostakovitsj', year: 1938, epoch: 'Modernisme', work: 'Jazzsuite nr. 2', movement: 'Vals nr. 2' },
  // Samtid
  { composer: 'Arvo Pärt', year: 1978, epoch: 'Samtid', work: 'Spiegel im Spiegel', movement: '' },
  { composer: 'Max Richter', year: 2004, epoch: 'Samtid', work: 'The Blue Notebooks', movement: 'On the Nature of Daylight' },
  { composer: 'Ludovico Einaudi', year: 2004, epoch: 'Samtid', work: 'Una Mattina', movement: 'Nuvole bianche' },
];

function seedIfEmpty() {
  const existing = db.listEntities('pieces');
  if (existing.length) return { seeded: 0 };
  let count = 0;
  for (const p of SEED_PIECES) {
    db.upsertEntity('pieces', 'piece', generateId(), { ...p, spotifyUrl: '', createdAt: now() });
    count++;
  }
  console.log(`🎵 Seeder ${count} musikkstykker i biblioteket.`);
  return { seeded: count };
}

module.exports = { seedIfEmpty, SEED_PIECES };
