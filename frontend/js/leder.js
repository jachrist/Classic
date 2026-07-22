import { api } from './api.js';
import { $, el, escapeHtml, toast, initTheme, registerSW, store, spotifyEmbedUrl, spotifySearchUrl } from './util.js';

initTheme();
registerSW();

const view = $('#view');
let leader = store.get('classic-leader'); // { code, leaderToken }
let pollTimer = null;
let lastPhase = null;
let lastPieceKey = null;
let busy = false;

// --- Opprett spill ---
function renderCreate() {
  view.innerHTML = '';
  const form = el('form', { class: 'card' }, [
    el('h2', {}, 'Start et nytt spill'),
    el('p', { class: 'sub' }, 'Du blir spill-leder. Deltakerne blir med via romkoden du får.'),
    el('label', { for: 'lname' }, 'Ditt navn'),
    el('input', { id: 'lname', type: 'text', maxlength: '24', placeholder: 'F.eks. Ola', autocomplete: 'off' }),
    el('label', { for: 'ldur' }, ['Tid per runde: ', el('b', { id: 'durOut' }, '60'), ' sek']),
    el('input', { id: 'ldur', type: 'range', min: '20', max: '180', step: '5', value: '60' }),
    el('div', { style: 'height:14px' }),
    el('button', { class: 'btn btn-primary', type: 'submit' }, 'Opprett spill 🎬'),
  ]);
  form.querySelector('#ldur').addEventListener('input', (e) => ($('#durOut').textContent = e.target.value));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#lname').value.trim();
    const dur = +$('#ldur').value;
    if (!name) return toast('Skriv inn navnet ditt');
    e.submitter.disabled = true;
    try {
      const res = await api.createGame(name, dur);
      leader = { code: res.code, leaderToken: res.leaderToken };
      store.set('classic-leader', leader);
      start();
    } catch (err) { toast(err.message); e.submitter.disabled = false; }
  });
  view.append(form);

  // Gjenoppta forrige økt
  const prev = store.get('classic-leader');
  if (prev && prev.code) {
    view.append(el('p', { class: 'center', style: 'margin-top:16px' },
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { leader = prev; start(); } },
        `↻ Gjenoppta rom ${prev.code}`)));
  }
}

// --- Poll ---
async function poll() {
  try {
    const s = await api.state(leader.code, null, leader.leaderToken);
    render(s);
  } catch (err) {
    if (/Fant ikke spillet/.test(err.message)) {
      clearInterval(pollTimer);
      store.del('classic-leader');
      toast('Spillet finnes ikke lenger — start et nytt.');
      renderCreate();
    }
  }
}
function start() {
  clearInterval(pollTimer);
  lastPhase = null; lastPieceKey = null;
  poll();
  pollTimer = setInterval(poll, 2000);
}

// --- Rendring ---
function joinUrl() {
  return `${location.origin}/?code=${leader.code}`;
}

function render(s) {
  const round = s.round;
  const phase = `${s.game.status}:${round ? round.status : 'none'}:${round ? round.id : ''}`;
  if (phase !== lastPhase) {
    lastPhase = phase;
    fullRender(s);
  } else {
    liveUpdate(s);
  }
}

function headerCard(s) {
  const url = joinUrl();
  return el('div', { class: 'card center' }, [
    el('div', { class: 'muted', style: 'font-size:.85rem' }, 'Romkode — del med deltakerne'),
    el('div', { class: 'roomcode' }, leader.code),
    el('div', { class: 'btn-row', style: 'justify-content:center' }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => copy(leader.code) }, '📋 Kopier kode'),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => copy(url) }, '🔗 Kopier lenke'),
    ]),
    el('div', { class: 'muted', style: 'font-size:.8rem;margin-top:8px;word-break:break-all' }, url),
  ]);
}

function playersCard(s) {
  const ul = el('ul', { class: 'players', id: 'plist' });
  renderPlayers(ul, s);
  return el('div', { class: 'card' }, [el('h2', {}, `Deltakere (${s.players.length})`), ul]);
}
function renderPlayers(ul, s) {
  ul.innerHTML = '';
  s.players.forEach((p, i) => ul.append(el('li', {}, [
    el('span', { class: 'rank' }, i === 0 && p.totalScore > 0 ? '🏆' : String(i + 1)),
    el('span', { class: 'pname' }, p.name),
    el('span', { class: 'pscore' }, String(p.totalScore)),
  ])));
  if (!s.players.length) ul.append(el('li', {}, el('span', { class: 'muted' }, 'Ingen deltakere ennå — del romkoden')));
}

function spotifyCard(piece) {
  const embed = spotifyEmbedUrl(piece.spotifyUrl);
  if (embed) {
    return el('div', { class: 'card' }, [
      el('h2', {}, '🎧 Avspilling'),
      el('div', { class: 'spotify-embed' },
        el('iframe', { src: embed, height: '152', allow: 'encrypted-media; autoplay', loading: 'lazy' })),
      el('p', { class: 'muted', style: 'font-size:.82rem;margin:6px 0 10px' }, 'Innebygd spiller gir ~30 sek utdrag. For full lengde: åpne i Spotify-appen (premium):'),
      el('a', { class: 'btn btn-ghost', href: piece.spotifyUrl, target: '_blank', rel: 'noopener' }, '▶ Åpne i Spotify-appen (full lengde)'),
    ]);
  }
  return el('div', { class: 'card' }, [
    el('h2', {}, '🎧 Avspilling'),
    el('p', { class: 'muted' }, 'Ingen Spotify-lenke lagret for dette stykket. Åpne søk og spill derfra, eller lim inn en lenke i Admin.'),
    el('a', { class: 'btn btn-primary', href: spotifySearchUrl(piece), target: '_blank', rel: 'noopener' }, '🔎 Åpne i Spotify'),
  ]);
}

function answerCard(piece) {
  return el('div', { class: 'card answer-card' }, [
    el('div', { class: 'center' }, el('span', { class: 'pill accent' }, 'Fasit (kun du ser dette)')),
    el('div', { class: 'composer' }, piece.composer),
    el('div', { class: 'work' }, piece.work),
    el('div', { class: 'meta' }, `${piece.epoch} · ${piece.year}${piece.movement ? ' · ' + piece.movement : ''}`),
  ]);
}

function fullRender(s) {
  view.innerHTML = '';
  const status = s.game.status;
  const round = s.round;

  if (status === 'finished') {
    const winner = s.players[0];
    view.append(el('div', { class: 'card center' }, [
      el('div', { style: 'font-size:44px' }, '🏆'),
      el('h2', {}, 'Spillet er ferdig!'),
      winner ? el('p', { class: 'lead' }, `Vinner: ${escapeHtml(winner.name)} (${winner.totalScore} p)`) : null,
    ]));
    view.append(playersCard(s));
    view.append(el('button', { class: 'btn btn-primary', onclick: newGame }, 'Nytt spill'));
    return;
  }

  view.append(headerCard(s));

  // Kontrollpanel
  const controls = el('div', { class: 'card', id: 'controls' });
  if (!round || round.status === 'revealed') {
    // Lobby eller mellom runder
    if (round && round.status === 'revealed') {
      controls.append(el('h2', {}, `Runde ${round.roundNumber} ferdig`));
      controls.append(el('p', { class: 'muted' }, 'Se fasit og resultater under. Klar for neste?'));
    } else {
      controls.append(el('h2', {}, 'Klar til start'));
      controls.append(el('p', { class: 'muted' }, `${s.players.length} deltaker(e) med. Start når dere er klare.`));
    }
    controls.append(el('button', { class: 'btn btn-primary', id: 'startBtn', onclick: startRound },
      round ? '▶ Neste runde (tilfeldig)' : '▶ Start runde (tilfeldig)'));
  } else if (round.status === 'active') {
    controls.append(el('div', { class: 'center' }, el('span', { class: 'pill accent' }, `Runde ${round.roundNumber} — spilles nå`)));
    controls.append(el('div', { class: 'timer-ring' }, [
      el('div', { class: 'timer-num', id: 'timerNum' }, String(round.timeLeft)),
      el('div', { class: 'muted', style: 'font-size:.85rem' }, 'sekunder igjen'),
      el('div', { class: 'timer-bar', id: 'timerBar' }, el('span', { style: 'width:100%' })),
    ]));
    controls.append(el('div', { class: 'muted center', id: 'guessCount' }, `${round.guessCount} svar inne`));
    controls.append(el('div', { style: 'height:10px' }));
    controls.append(el('button', { class: 'btn btn-danger', onclick: reveal }, '⏹ Avslutt runden nå'));
  }
  view.append(controls);

  // Spotify + fasit når det er en runde med piece
  if (round && round.piece) {
    view.append(spotifyCard(round.piece));
    view.append(answerCard(round.piece));
  }

  // Resultater etter avsløring
  if (round && round.status === 'revealed' && round.results) {
    const list = el('ul', { class: 'players' });
    round.results.forEach((r, i) => list.append(el('li', {}, [
      el('span', { class: 'rank' }, String(i + 1)),
      el('span', { class: 'pname' }, r.name),
      el('span', { class: 'pscore' }, `+${r.total}`),
    ])));
    if (!round.results.length) list.append(el('li', {}, el('span', { class: 'muted' }, 'Ingen svar denne runden')));
    view.append(el('div', { class: 'card' }, [el('h2', {}, 'Rundepoeng'), list]));
  }

  view.append(playersCard(s));

  // Avslutt spill
  view.append(el('button', { class: 'btn btn-ghost', style: 'margin-top:6px', onclick: finishGame }, 'Avslutt hele spillet'));
}

function liveUpdate(s) {
  const round = s.round;
  const plist = $('#plist');
  if (plist) renderPlayers(plist, s);
  if (round && round.status === 'active') {
    const num = $('#timerNum'); if (num) num.textContent = String(round.timeLeft);
    const bar = $('#timerBar');
    if (bar) {
      const pct = Math.max(0, Math.min(100, (round.timeLeft / round.durationSec) * 100));
      bar.firstChild.style.width = pct + '%';
      bar.classList.toggle('low', round.timeLeft <= 10);
    }
    const gc = $('#guessCount'); if (gc) gc.textContent = `${round.guessCount} svar inne`;
  }
}

// --- Handlinger ---
async function startRound(e) {
  if (busy) return; busy = true;
  const btn = e && e.target; if (btn) btn.disabled = true;
  try { await api.startRound(leader.code, leader.leaderToken, {}); lastPhase = null; await poll(); }
  catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  finally { busy = false; }
}
async function reveal() {
  if (busy) return; busy = true;
  try { await api.reveal(leader.code, leader.leaderToken); lastPhase = null; await poll(); }
  catch (err) { toast(err.message); }
  finally { busy = false; }
}
async function finishGame() {
  if (!confirm('Avslutte hele spillet for alle?')) return;
  try { await api.finish(leader.code, leader.leaderToken); lastPhase = null; await poll(); }
  catch (err) { toast(err.message); }
}
function newGame() {
  store.del('classic-leader');
  leader = null;
  clearInterval(pollTimer);
  renderCreate();
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert!', 'ok'); }
  catch { toast('Kunne ikke kopiere — merk teksten manuelt'); }
}

// --- Kjør ---
if (leader && leader.code && leader.leaderToken) start();
else renderCreate();
