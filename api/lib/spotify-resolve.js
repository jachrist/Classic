'use strict';

/**
 * Slår opp ekte Spotify-track-lenker for stykker automatisk (server-side).
 *
 * Strategier, i prioritert rekkefølge (per søk):
 *   1. Spotify Web API — hvis SPOTIFY_CLIENT_ID/SECRET er satt (mest presist).
 *   2. Deezer-søk → Odesli/song.link (uten nøkler).
 *   3. iTunes Search → Odesli/song.link (uten nøkler).
 *
 * For hvert stykke prøves to søkevarianter: først et RENSET søk (uten parenteser
 * og «feat.»), så råteksten som fallback — det gir flere automatiske treff.
 * Bruker global fetch (Node 18+).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null;
let tokenExpiry = 0;

function hasSpotifyCreds() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

/** Rens en tittel for søk: fjern (parenteser), [klammer] og «feat./ft.»-tillegg. */
function cleanTitle(title) {
  return String(title == null ? '' : title)
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s[-–]\s.*$/, ' ') // « - remaster», « – live» o.l.
    .replace(/\s*\b(feat|ft|featuring)\b\.?\s.*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchJson(url, opts, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    let body = null;
    try { body = await res.json(); } catch { /* ikke JSON */ }
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'tidsavbrudd' : (e.message || 'nettfeil') };
  } finally {
    clearTimeout(t);
  }
}

async function spotifyToken() {
  if (!hasSpotifyCreds()) return null;
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;
  const r = await fetchJson('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
  });
  if (!r.ok || !r.body || !r.body.access_token) return null;
  cachedToken = r.body.access_token;
  tokenExpiry = Date.now() + Math.max(0, (r.body.expires_in || 3600) - 60) * 1000;
  return cachedToken;
}

// Hver strategi returnerer { url, requestError?, note? }.
// url satt = treff. requestError = et nettverkskall feilet (ikke «ingen treff»).

async function viaSpotifyApi(token, query) {
  const r = await fetchJson('https://api.spotify.com/v1/search?type=track&limit=1&q=' + encodeURIComponent(query), {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!r.ok) return { url: null, requestError: true, note: `spotify ${r.status || r.error}` };
  const t = r.body && r.body.tracks && r.body.tracks.items && r.body.tracks.items[0];
  return t && t.external_urls ? { url: t.external_urls.spotify } : { url: null, note: 'ingen treff' };
}

async function odesliToSpotify(sourceUrl) {
  const r = await fetchJson('https://api.song.link/v1-alpha.1/links?url=' + encodeURIComponent(sourceUrl));
  const sp = r.body && r.body.linksByPlatform && r.body.linksByPlatform.spotify;
  return { url: sp && sp.url ? sp.url : null, ok: r.ok, status: r.status, error: r.error };
}

async function viaDeezerOdesli(query) {
  const dz = await fetchJson('https://api.deezer.com/search?limit=1&q=' + encodeURIComponent(query));
  if (!dz.ok) return { url: null, requestError: true, note: `deezer ${dz.status || dz.error}` };
  const track = dz.body && dz.body.data && dz.body.data[0];
  if (!track || !track.link) return { url: null, note: 'ingen treff' };
  const od = await odesliToSpotify(track.link);
  if (od.url) return { url: od.url };
  if (!od.ok || od.error) return { url: null, requestError: true, note: `odesli ${od.status || od.error}` };
  return { url: null, note: 'ingen treff' };
}

async function viaItunesOdesli(query) {
  const it = await fetchJson('https://itunes.apple.com/search?entity=song&limit=1&term=' + encodeURIComponent(query));
  if (!it.ok) return { url: null, requestError: true, note: `itunes ${it.status || it.error}` };
  const track = it.body && it.body.results && it.body.results[0];
  if (!track || !track.trackViewUrl) return { url: null, note: 'ingen treff' };
  const od = await odesliToSpotify(track.trackViewUrl);
  if (od.url) return { url: od.url };
  if (!od.ok || od.error) return { url: null, requestError: true, note: `odesli ${od.status || od.error}` };
  return { url: null, note: 'ingen treff' };
}

/**
 * Slå opp én lenke. `artist` = komponist/artist, `title` = verk/låt.
 * Prøver renset søk først, så råtekst. Returnerer { url, method, reason }.
 */
async function resolveOne(artist, title, token) {
  const raw = `${artist || ''} ${title || ''}`.trim();
  const cleaned = `${artist || ''} ${cleanTitle(title)}`.trim();
  const queries = [...new Set([cleaned, raw].filter(Boolean))];
  if (!queries.length) return { url: null, method: 'none', reason: 'tomt søk' };

  let reason = 'ingen treff'; // overstyres kun av faktiske nettverksfeil
  for (const q of queries) {
    try {
      if (token) {
        const s = await viaSpotifyApi(token, q);
        if (s.url) return { url: s.url, method: 'spotify-api' };
        if (s.requestError) reason = s.note;
      }
      const dz = await viaDeezerOdesli(q);
      if (dz.url) return { url: dz.url, method: 'deezer-odesli' };
      if (dz.requestError) reason = dz.note;
      const it = await viaItunesOdesli(q);
      if (it.url) return { url: it.url, method: 'itunes-odesli' };
      if (it.requestError) reason = it.note;
    } catch (e) {
      reason = 'feil: ' + (e.message || 'ukjent');
    }
  }
  return { url: null, method: token ? 'spotify-api' : 'deezer-odesli', reason };
}

/**
 * Fyll inn manglende spotifyUrl. save(piece, url) kalles per treff.
 * Returnerer { method, total, resolved, failed, diagnostics, details }.
 */
async function resolveMany(pieces, { onlyMissing = true, delayMs = 800, limit = 100 } = {}, save) {
  const token = await spotifyToken();
  const targets = pieces.filter((p) => (onlyMissing ? !p.spotifyUrl : true)).slice(0, limit);
  const results = {
    method: token ? 'spotify-api' : 'deezer/itunes-odesli',
    hasSpotifyCreds: hasSpotifyCreds(),
    spotifyTokenOk: !!token,
    total: targets.length,
    resolved: 0,
    failed: 0,
    details: [],
  };
  const reasonCount = {};
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const r = await resolveOne(p.composer, p.work, token);
    if (r.url) {
      results.resolved++;
      if (save) save(p, r.url);
    } else {
      results.failed++;
      const key = r.reason || 'ingen treff';
      reasonCount[key] = (reasonCount[key] || 0) + 1;
    }
    results.details.push({ composer: p.composer, work: p.work, url: r.url || null, reason: r.reason });
    if (i < targets.length - 1 && delayMs) await sleep(delayMs);
  }
  results.diagnostics = Object.entries(reasonCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`);
  return results;
}

/** Server-side nettsjekk: hva kan Azure faktisk nå? */
async function netCheck() {
  const deezer = await fetchJson('https://api.deezer.com/search?limit=1&q=abba');
  const odesli = await fetchJson('https://api.song.link/v1-alpha.1/links?url=' + encodeURIComponent('https://open.spotify.com/track/4u7EnebtmKWzUH433cf5Qv'));
  const itunes = await fetchJson('https://itunes.apple.com/search?entity=song&limit=1&term=abba');
  const token = await spotifyToken();
  return {
    node: process.version,
    fetch: typeof fetch,
    spotifyCreds: hasSpotifyCreds(),
    spotifyTokenOk: !!token,
    deezer: { status: deezer.status, ok: deezer.ok, error: deezer.error, gotResult: !!(deezer.body && deezer.body.data && deezer.body.data.length) },
    odesli: { status: odesli.status, ok: odesli.ok, error: odesli.error, gotSpotify: !!(odesli.body && odesli.body.linksByPlatform && odesli.body.linksByPlatform.spotify) },
    itunes: { status: itunes.status, ok: itunes.ok, error: itunes.error, gotResult: !!(itunes.body && itunes.body.results && itunes.body.results.length) },
  };
}

module.exports = { resolveOne, resolveMany, spotifyToken, netCheck, hasSpotifyCreds, cleanTitle };
