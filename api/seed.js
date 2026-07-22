'use strict';

/**
 * Startdata og migrering for Classic. Kjøres ved oppstart:
 *  1. Sørger for at temaene finnes (idempotent).
 *  2. Backfiller `theme='Klassisk'` på gamle stykker uten tema (migrering).
 *  3. Seeder klassiske stykker kun ved helt tomt bibliotek.
 *  4. Seeder pop-eksempler per tema når temaet er tomt.
 *
 * MERK: `spotifyUrl` er bevisst tomt — legg inn eksakte lenker via Admin.
 * Pop-metadataen er «startdata» og kan finpusses/utvides i Admin.
 */
const db = require('./lib/db');
const { generateId, now } = require('./lib/helpers');

const SEED_THEMES = [
  { name: 'Klassisk', kind: 'classical' },
  { name: '60-tallet', kind: 'pop' },
  { name: '90-tallet', kind: 'pop' },
  { name: 'Progrock', kind: 'pop' },
  { name: 'Country', kind: 'pop' },
  { name: 'Flower power', kind: 'pop' },
];

const SEED_PIECES = [
  { composer: 'Thomas Tallis', year: 1570, epoch: 'Renessanse', work: 'Spem in alium', movement: '' },
  { composer: 'Antonio Vivaldi', year: 1725, epoch: 'Barokk', work: 'De fire årstider – Våren', movement: '1. sats – Allegro' },
  { composer: 'Johann Sebastian Bach', year: 1721, epoch: 'Barokk', work: 'Brandenburgkonsert nr. 3', movement: '1. sats – Allegro' },
  { composer: 'Johann Sebastian Bach', year: 1741, epoch: 'Barokk', work: 'Goldbergvariasjonene', movement: 'Aria' },
  { composer: 'Georg Friedrich Händel', year: 1741, epoch: 'Barokk', work: 'Messias', movement: 'Hallelujah' },
  { composer: 'Wolfgang Amadeus Mozart', year: 1787, epoch: 'Klassisisme', work: 'Eine kleine Nachtmusik', movement: '1. sats – Allegro' },
  { composer: 'Wolfgang Amadeus Mozart', year: 1788, epoch: 'Klassisisme', work: 'Symfoni nr. 40 g-moll', movement: '1. sats – Molto allegro' },
  { composer: 'Joseph Haydn', year: 1791, epoch: 'Klassisisme', work: 'Symfoni nr. 94 «Overraskelsen»', movement: '2. sats – Andante' },
  { composer: 'Ludwig van Beethoven', year: 1808, epoch: 'Klassisisme', work: 'Symfoni nr. 5 c-moll', movement: '1. sats – Allegro con brio' },
  { composer: 'Ludwig van Beethoven', year: 1801, epoch: 'Romantikk', work: 'Måneskinnssonaten', movement: '1. sats – Adagio sostenuto' },
  { composer: 'Franz Schubert', year: 1825, epoch: 'Romantikk', work: 'Ave Maria', movement: '' },
  { composer: 'Frédéric Chopin', year: 1832, epoch: 'Romantikk', work: 'Nocturne Es-dur op. 9 nr. 2', movement: '' },
  { composer: 'Johannes Brahms', year: 1869, epoch: 'Romantikk', work: 'Ungarsk dans nr. 5', movement: '' },
  { composer: 'Edvard Grieg', year: 1875, epoch: 'Romantikk', work: 'Peer Gynt-suite nr. 1', movement: 'I Dovregubbens hall' },
  { composer: 'Edvard Grieg', year: 1875, epoch: 'Romantikk', work: 'Peer Gynt-suite nr. 1', movement: 'Morgenstemning' },
  { composer: 'Pjotr Tsjajkovskij', year: 1876, epoch: 'Romantikk', work: 'Svanesjøen', movement: 'Scene – Moderato' },
  { composer: 'Pjotr Tsjajkovskij', year: 1892, epoch: 'Romantikk', work: 'Nøtteknekkeren', movement: 'Blomstervalsen' },
  { composer: 'Antonín Dvořák', year: 1893, epoch: 'Romantikk', work: 'Symfoni nr. 9 «Fra den nye verden»', movement: '4. sats – Allegro con fuoco' },
  { composer: 'Erik Satie', year: 1888, epoch: 'Impresjonisme', work: 'Gymnopédie nr. 1', movement: '' },
  { composer: 'Claude Debussy', year: 1905, epoch: 'Impresjonisme', work: 'Suite bergamasque', movement: 'Clair de lune' },
  { composer: 'Maurice Ravel', year: 1928, epoch: 'Impresjonisme', work: 'Boléro', movement: '' },
  { composer: 'Gustav Holst', year: 1916, epoch: 'Modernisme', work: 'Planetene', movement: 'Mars, krigsbringeren' },
  { composer: 'Igor Stravinskij', year: 1913, epoch: 'Modernisme', work: 'Vårofferet', movement: 'De unge jentenes dans' },
  { composer: 'George Gershwin', year: 1924, epoch: 'Modernisme', work: 'Rhapsody in Blue', movement: '' },
  { composer: 'Sergej Prokofjev', year: 1935, epoch: 'Modernisme', work: 'Romeo og Julie', movement: 'Ridderdansen' },
  { composer: 'Carl Orff', year: 1936, epoch: 'Modernisme', work: 'Carmina Burana', movement: 'O Fortuna' },
  { composer: 'Dmitrij Sjostakovitsj', year: 1938, epoch: 'Modernisme', work: 'Jazzsuite nr. 2', movement: 'Vals nr. 2' },
  { composer: 'Arvo Pärt', year: 1978, epoch: 'Samtid', work: 'Spiegel im Spiegel', movement: '' },
  { composer: 'Max Richter', year: 2004, epoch: 'Samtid', work: 'The Blue Notebooks', movement: 'On the Nature of Daylight' },
  { composer: 'Ludovico Einaudi', year: 2004, epoch: 'Samtid', work: 'Una Mattina', movement: 'Nuvole bianche' },
];

// Pop-startdata: { artist, album, year, song } (artist→composer, album→epoch, song→work).
const SEED_POP = {
  '60-tallet': [
    { artist: 'The Beatles', album: 'Abbey Road', year: 1969, song: 'Come Together' },
    { artist: 'The Rolling Stones', album: 'Aftermath', year: 1966, song: 'Paint It Black' },
    { artist: 'The Beach Boys', album: 'Pet Sounds', year: 1966, song: 'Wouldn’t It Be Nice' },
    { artist: 'Bob Dylan', album: 'Highway 61 Revisited', year: 1965, song: 'Like a Rolling Stone' },
    { artist: 'The Supremes', album: 'Where Did Our Love Go', year: 1964, song: 'Baby Love' },
  ],
  '90-tallet': [
    { artist: 'Nirvana', album: 'Nevermind', year: 1991, song: 'Smells Like Teen Spirit' },
    { artist: 'Oasis', album: '(What’s the Story) Morning Glory?', year: 1995, song: 'Wonderwall' },
    { artist: 'Spice Girls', album: 'Spice', year: 1996, song: 'Wannabe' },
    { artist: 'Backstreet Boys', album: 'Backstreet’s Back', year: 1997, song: 'Everybody (Backstreet’s Back)' },
    { artist: 'TLC', album: 'CrazySexyCool', year: 1994, song: 'Waterfalls' },
  ],
  Progrock: [
    { artist: 'Pink Floyd', album: 'The Dark Side of the Moon', year: 1973, song: 'Money' },
    { artist: 'Yes', album: 'Fragile', year: 1971, song: 'Roundabout' },
    { artist: 'Genesis', album: 'Selling England by the Pound', year: 1973, song: 'Firth of Fifth' },
    { artist: 'King Crimson', album: 'In the Court of the Crimson King', year: 1969, song: '21st Century Schizoid Man' },
    { artist: 'Rush', album: 'Moving Pictures', year: 1981, song: 'Tom Sawyer' },
  ],
  Country: [
    { artist: 'Johnny Cash', album: 'At Folsom Prison', year: 1968, song: 'Folsom Prison Blues' },
    { artist: 'Dolly Parton', album: 'Jolene', year: 1974, song: 'Jolene' },
    { artist: 'Willie Nelson', album: 'Red Headed Stranger', year: 1975, song: 'Blue Eyes Crying in the Rain' },
    { artist: 'Kenny Rogers', album: 'The Gambler', year: 1978, song: 'The Gambler' },
    { artist: 'Patsy Cline', album: 'Patsy Cline Showcase', year: 1961, song: 'Crazy' },
  ],
  'Flower power': [
    { artist: 'Scott McKenzie', album: 'The Voice of Scott McKenzie', year: 1967, song: 'San Francisco' },
    { artist: 'Jimi Hendrix', album: 'Are You Experienced', year: 1967, song: 'Purple Haze' },
    { artist: 'The Mamas & the Papas', album: 'If You Can Believe Your Eyes and Ears', year: 1966, song: 'California Dreamin’' },
    { artist: 'The Byrds', album: 'Mr. Tambourine Man', year: 1965, song: 'Mr. Tambourine Man' },
    { artist: 'Jefferson Airplane', album: 'Surrealistic Pillow', year: 1967, song: 'White Rabbit' },
  ],
};

function seedIfEmpty() {
  // 1. Temaer (idempotent)
  for (const t of SEED_THEMES) {
    if (!db.findOne('themes', { name: t.name })) {
      db.upsertEntity('themes', 'theme', generateId(), { ...t, createdAt: now() });
    }
  }

  // 2. Migrering: gamle stykker uten tema → «Klassisk»
  const pieces = db.listEntities('pieces');
  let migrated = 0;
  for (const p of pieces) {
    if (!p.theme) {
      db.upsertEntity('pieces', 'piece', p.id, { ...p, theme: 'Klassisk' });
      migrated++;
    }
  }
  if (migrated) console.log(`🔁 Migrerte ${migrated} stykke(r) til tema «Klassisk».`);

  // 3. Klassiske stykker kun ved helt tomt bibliotek
  let seeded = 0;
  if (pieces.length === 0) {
    for (const p of SEED_PIECES) {
      db.upsertEntity('pieces', 'piece', generateId(), { ...p, theme: 'Klassisk', spotifyUrl: '', createdAt: now() });
      seeded++;
    }
  }

  // 4. Pop-eksempler per tema når temaet er tomt
  for (const [themeName, list] of Object.entries(SEED_POP)) {
    if (db.listEntities('pieces', { filter: { theme: themeName } }).length === 0) {
      for (const p of list) {
        db.upsertEntity('pieces', 'piece', generateId(), {
          theme: themeName,
          composer: p.artist,
          epoch: p.album,
          year: p.year,
          work: p.song,
          movement: '',
          spotifyUrl: '',
          createdAt: now(),
        });
        seeded++;
      }
    }
  }
  if (seeded) console.log(`🎵 Seeder ${seeded} stykker i biblioteket.`);
  return { seeded, migrated };
}

module.exports = { seedIfEmpty, SEED_PIECES, SEED_POP, SEED_THEMES };
