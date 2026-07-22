'use strict';

/**
 * Slår opp ekte Spotify-track-lenker for stykker automatisk (server-side).
 *
 * Strategier, i prioritert rekkefølge:
 *   1. Spotify Web API — hvis SPOTIFY_CLIENT_ID/SECRET er satt (mest presist, robust).
 *   2. iTunes Search → Odesli/song.link (uten nøkler).
 *   3. Deezer-søk → Odesli/song.link (uten nøkler).
 *
 * Odesli/Deezer kan rate-limite eller blokkere sky-IP-er; derfor gir vi tydelig
 * diagnostikk og faller tilbake mellom strategiene. Bruker global fetch (Node 18+).
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null;
let tokenExpiry = 0;

function hasSpotifyCreds() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
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
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : (e.message || 'nettfeil') };
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

async function viaSpotifyApi(token, query) {
  const r = await fetchJson('https://api.spotify.com/v1/search?type=track&limit=1&q=' + encodeURIComponent(query), {
    headers: { Authorization: 'Bearer ' + token },
  });
  const t = r.body && r.body.tracks && r.body.tracks.items && r.body.tracks.items[0];
  return { url: t && t.external_urls ? t.external_urls.spotify : null, status: r.status, error: r.error };
}

async function odesliToSpotify(sourceUrl) {
  const r = await fetchJson('https://api.song.link/v1-alpha.1/links?url=' + encodeURIComponent(sourceUrl));
  const sp = r.body && r.body.linksByPlatform && r.body.linksByPlatform.spotify;
  return { url: sp && sp.url ? sp.url : null, status: r.status, error: r.error };
}

async function viaItunesOdesli(query) {
  const it = await fetchJson('https://itunes.apple.com/search?entity=song&limit=1&term=' + encodeURIComponent(query));
  const track = it.body && it.body.results && it.body.results[0];
  if (!track || !track.trackViewUrl) return { url: null, status: it.status, error: it.error, stage: 'itunes' };
  const od = await odesliToSpotify(track.trackViewUrl);
  return { url: od.url, status: od.status, error: od.error, stage: od.url ? 'ok' : 'odesli' };
}

async function viaDeezerOdesli(query) {
  const dz = await fetchJson('https://api.deezer.com/search?limit=1&q=' + encodeURIComponent(query));
  const track = dz.body && dz.body.data && dz.body.data[0];
  if (!track || !track.link) return { url: null, status: dz.status, error: dz.error, stage: 'deezer' };
  const od = await odesliToSpotify(track.link);
  return { url: od.url, status: od.status, error: od.error, stage: od.url ? 'ok' : 'odesli' };
}

/** Slå opp én lenke. Returnerer { url, method, stage, status, error }. */
async function resolveOne(artist, title, token) {
  const query = `${artist || ''} ${title || ''}`.trim();
  if (!query) return { url: null, method: 'none', stage: 'tomt-søk' };
  try {
    if (token) {
      const s = await viaSpotifyApi(token, query);
      if (s.url) return { url: s.url, method: 'spotify-api', stage: 'ok' };
      // Fall videre hvis Spotify ikke fant noe
    }
    const dz = await viaDeezerOdesli(query);
    if (dz.url) return { url: dz.url, method: 'deezer-odesli', stage: 'ok' };
    const it = await viaItunesOdesli(query);
    if (it.url) return { url: it.url, method: 'itunes-odesli', stage: 'ok' };
    return { url: null, method: token ? 'spotify-api' : 'deezer-odesli', stage: dz.stage || it.stage, status: dz.status || it.status, error: dz.error || it.error };
  } catch (e) {
    return { url: null, method: 'error', stage: 'exception', error: e.message };
  }
}

/**
 * Fyll inn manglende spotifyUrl. save(piece, url) kalles per treff.
 * Returnerer { method, total, resolved, failed, diagnostics, details }.
 */
async function resolveMany(pieces, { onlyMissing = true, delayMs = 1200, limit = 100 } = {}, save) {
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
  const stageCount = {};
  for (let i = 0; i < targets.length; i++) {
    const p = targets[i];
    const r = await resolveOne(p.composer, p.work, token);
    if (r.url) {
      results.resolved++;
      if (save) save(p, r.url);
    } else {
      results.failed++;
      const key = `${r.stage || '?'}${r.status ? ' ' + r.status : ''}${r.error ? ' ' + r.error : ''}`;
      stageCount[key] = (stageCount[key] || 0) + 1;
    }
    results.details.push({ composer: p.composer, work: p.work, url: r.url || null, stage: r.stage, status: r.status, error: r.error });
    if (i < targets.length - 1 && delayMs) await sleep(delayMs);
  }
  // Kort oppsummering av hvorfor ting feilet (mest vanlige årsak først)
  results.diagnostics = Object.entries(stageCount).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n}× ${k}`);
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

module.exports = { resolveOne, resolveMany, spotifyToken, netCheck, hasSpotifyCreds };
