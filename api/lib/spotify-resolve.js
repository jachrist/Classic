'use strict';

/**
 * Slår opp ekte Spotify-track-lenker for stykker automatisk.
 *
 * Kjører server-side (Azure har åpen internett-tilgang), så en admin-knapp kan
 * fylle inn lenker uten manuelt arbeid. To strategier:
 *   1. Spotify Web API (mest presist) — brukes hvis SPOTIFY_CLIENT_ID/SECRET er satt.
 *   2. Deezer-søk → Odesli/song.link (uten nøkler) — fallback som virker med én gang.
 *
 * Bruker global fetch (Node 18+).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null;
let tokenExpiry = 0;

async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID;
  const secret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  try {
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const j = await res.json();
    cachedToken = j.access_token || null;
    tokenExpiry = Date.now() + Math.max(0, (j.expires_in || 3600) - 60) * 1000;
    return cachedToken;
  } catch {
    return null;
  }
}

async function viaSpotifyApi(token, query) {
  const url = 'https://api.spotify.com/v1/search?type=track&limit=1&q=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) return null;
  const j = await res.json();
  const t = j.tracks && j.tracks.items && j.tracks.items[0];
  return t && t.external_urls ? t.external_urls.spotify : null;
}

async function viaDeezerOdesli(query) {
  // 1. Deezer-søk (uten nøkkel)
  const dz = await fetch('https://api.deezer.com/search?limit=1&q=' + encodeURIComponent(query));
  if (!dz.ok) return null;
  const dj = await dz.json();
  const track = dj.data && dj.data[0];
  if (!track || !track.link) return null;
  // 2. Odesli mapper Deezer → Spotify
  const od = await fetch('https://api.song.link/v1-alpha.1/links?url=' + encodeURIComponent(track.link));
  if (!od.ok) return null;
  const oj = await od.json();
  const sp = oj.linksByPlatform && oj.linksByPlatform.spotify;
  return sp && sp.url ? sp.url : null;
}

/**
 * Slå opp én lenke. `artist` = komponist/artist, `title` = verk/låt.
 * Returnerer en open.spotify.com/track-URL eller null.
 */
async function resolveOne(artist, title, token) {
  const query = `${artist || ''} ${title || ''}`.trim();
  if (!query) return null;
  try {
    if (token) {
      const viaApi = await viaSpotifyApi(token, query);
      if (viaApi) return viaApi;
    }
    return await viaDeezerOdesli(query);
  } catch {
    return null;
  }
}

/**
 * Fyll inn manglende spotifyUrl for en liste stykker.
 * @param pieces liste med { composer, work, spotifyUrl, ... }
 * @param opts { onlyMissing=true, delayMs=800, limit }
 * @param save (piece, url) => void  — kalles for hvert oppslag som lykkes
 */
async function resolveMany(pieces, { onlyMissing = true, delayMs = 800, limit = 100 } = {}, save) {
  const token = await spotifyToken();
  const method = token ? 'spotify-api' : 'deezer-odesli';
  const targets = pieces.filter((p) => (onlyMissing ? !p.spotifyUrl : true)).slice(0, limit);
  const results = { method, total: targets.length, resolved: 0, failed: 0, details: [] };
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const url = await resolveOne(p.composer, p.work, token);
    if (url) {
      results.resolved++;
      if (save) save(p, url);
    } else {
      results.failed++;
    }
    results.details.push({ id: p.id, composer: p.composer, work: p.work, url: url || null });
    if (i < targets.length - 1 && delayMs) await sleep(delayMs);
  }
  return results;
}

module.exports = { resolveOne, resolveMany, spotifyToken };
