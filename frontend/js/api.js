// Felles API-klient for Classic. Base-URL auto: localhost → :3001, ellers /api.
const BASE = (() => {
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '') return 'http://localhost:3001/api';
  return '/api';
})();

async function request(path, { method = 'GET', body, leaderToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (leaderToken) headers['x-leader-token'] = leaderToken;
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Nettverksfeil — får ikke kontakt med serveren');
  }
  let data = {};
  try { data = await res.json(); } catch (_) { /* tomt svar */ }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `Feil (${res.status})`);
  }
  return data;
}

export const api = {
  base: BASE,
  health: () => request('/health'),

  // Bibliotek
  meta: () => request('/pieces/meta'),
  listPieces: () => request('/pieces'),
  createPiece: (p) => request('/pieces', { method: 'POST', body: p }),
  updatePiece: (id, p) => request(`/pieces/${id}`, { method: 'PUT', body: p }),
  deletePiece: (id) => request(`/pieces/${id}`, { method: 'DELETE' }),

  // Spill
  createGame: (leaderName, durationSec) =>
    request('/games', { method: 'POST', body: { leaderName, durationSec } }),
  join: (code, name) => request(`/games/${code}/join`, { method: 'POST', body: { name } }),
  state: (code, playerId, leaderToken) => {
    const q = playerId ? `?playerId=${encodeURIComponent(playerId)}` : '';
    return request(`/games/${code}/state${q}`, { leaderToken });
  },
  startRound: (code, leaderToken, opts = {}) =>
    request(`/games/${code}/start-round`, { method: 'POST', leaderToken, body: opts }),
  guess: (code, guess) => request(`/games/${code}/guess`, { method: 'POST', body: guess }),
  reveal: (code, leaderToken) => request(`/games/${code}/reveal`, { method: 'POST', leaderToken }),
  finish: (code, leaderToken) => request(`/games/${code}/finish`, { method: 'POST', leaderToken }),
};
