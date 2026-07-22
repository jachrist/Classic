import { api } from './api.js';
import { $, el, qs, escapeHtml, toast, initTheme, registerSW, store } from './util.js';
import { warningSound, endSound } from './sound.js';

initTheme();
registerSW();

// Lokal sekund-teller (presis nedtelling + lydsignaler)
let ticker = null;
let tickWarned = false;
let tickEnded = false;
function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }
function startTicker(round) {
  stopTicker();
  tickWarned = false;
  tickEnded = false;
  const endsAtMs = new Date(round.endsAt).getTime();
  const dur = round.durationSec || 60;
  const step = () => {
    const rem = Math.max(0, Math.ceil((endsAtMs - Date.now()) / 1000));
    const num = $('#timerNum'); if (num) num.textContent = String(rem);
    const bar = $('#timerBar');
    if (bar) {
      bar.firstChild.style.width = Math.max(0, Math.min(100, (rem / dur) * 100)) + '%';
      bar.classList.toggle('low', rem <= 10);
    }
    if (rem <= 10 && rem > 0 && !tickWarned) { tickWarned = true; warningSound(); }
    if (rem <= 0 && !tickEnded) { tickEnded = true; endSound(); stopTicker(); }
  };
  step();
  ticker = setInterval(step, 250);
}

const view = $('#view');
const code = (qs('code') || (store.get('classic-player') || {}).code || '').toUpperCase();
let session = store.get('classic-player');
let meta = null;
let loadedTheme = null;
let labels = { composer: 'Komponist', epoch: 'Epoke', year: 'Årstall', work: 'Verk', movement: 'Sats' };
let useMovement = true;
let lastRoundId = null;
let lastStatus = null;
let localGuess = {}; // uinnsendte feltverdier for aktiv runde
let submittedThisRound = false;
let pollTimer = null;

if (code) $('#roomPill').textContent = 'Rom ' + code;

// --- Oppstart: sørg for at vi har en spiller-økt for dette rommet ---
async function ensureSession() {
  if (session && session.code === code && session.playerId) return true;
  // Ingen økt — vis join-skjema
  renderJoin();
  return false;
}

function renderJoin() {
  view.innerHTML = '';
  const form = el('form', { class: 'card' }, [
    el('h2', {}, 'Bli med i spillet'),
    el('label', { for: 'jname' }, 'Kallenavn'),
    el('input', { id: 'jname', type: 'text', maxlength: '24', placeholder: 'F.eks. Kari', autocomplete: 'off' }),
    el('div', { style: 'height:12px' }),
    el('button', { class: 'btn btn-primary', type: 'submit' }, code ? `Bli med i rom ${code}` : 'Bli med'),
  ]);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#jname').value.trim();
    if (!name || !code) return toast('Skriv inn kallenavn');
    try {
      const res = await api.join(code, name);
      session = { code, playerId: res.playerId, name };
      store.set('classic-player', session);
      start();
    } catch (err) { toast(err.message); }
  });
  view.append(form);
}

// --- Poll-løkke ---
async function poll() {
  try {
    const s = await api.state(code, session.playerId);
    // Feltnavn/typer fra spillets tema
    if (s.game && s.game.labels) labels = s.game.labels;
    if (s.game) useMovement = !!s.game.useMovement;
    // Hent meta (nedtrekksvalg) for temaet ved behov
    if (s.game && s.game.theme && loadedTheme !== s.game.theme) {
      try { meta = await api.meta(s.game.theme); loadedTheme = s.game.theme; } catch { /* beholder gammel */ }
    }
    render(s);
  } catch (err) {
    // Spillet kan være borte (server restartet) — la brukeren gå tilbake
    if (/Fant ikke spillet/.test(err.message)) {
      clearInterval(pollTimer);
      view.innerHTML = '';
      view.append(el('div', { class: 'card center' }, [
        el('h2', {}, 'Spillet finnes ikke lenger'),
        el('p', { class: 'muted' }, 'Rommet er avsluttet eller ikke tilgjengelig.'),
        el('a', { class: 'btn btn-primary', href: '/' }, 'Til forsiden'),
      ]));
    }
  }
}

function start() {
  clearInterval(pollTimer);
  poll();
  pollTimer = setInterval(poll, 2000);
}

// --- Rendring etter tilstand ---
function render(s) {
  const status = s.game.status;
  const round = s.round;

  // Ny runde? Nullstill lokale gjetninger
  if (round && round.id !== lastRoundId) {
    lastRoundId = round.id;
    localGuess = {};
    submittedThisRound = !!(round.yourGuess && round.yourGuess.submitted);
  }

  // Bare full re-render ved fase-endring; ellers oppdater kun de dynamiske delene
  const phase = `${status}:${round ? round.status : 'none'}:${round ? round.id : ''}`;
  if (phase !== lastStatus) {
    lastStatus = phase;
    stopTicker();
    if (status === 'finished') return renderFinished(s);
    if (!round) return renderLobby(s);
    if (round.status === 'pending') return renderPending(s);
    if (round.status === 'active') return renderActive(s);
    if (round.status === 'revealed') return renderReveal(s);
  } else {
    // Lett oppdatering (spillerliste, gjettetall) — timeren drives av startTicker
    if (round && round.status === 'active') updateActive(s);
    if (round && round.status === 'revealed') updateLeaderboardOnly(s);
    if (!round || round.status === 'pending') updateLobby(s);
  }
}

function playersList(s, highlightDelta = false) {
  const meId = s.you ? s.you.id : null;
  const ul = el('ul', { class: 'players' });
  s.players.forEach((p, i) => {
    ul.append(el('li', { class: p.id === meId ? 'me' : '' }, [
      el('span', { class: 'rank' }, i === 0 && p.totalScore > 0 ? '🏆' : String(i + 1)),
      el('span', { class: 'pname' }, p.name + (p.id === meId ? ' (deg)' : '')),
      el('span', { class: 'pscore' }, String(p.totalScore)),
    ]));
  });
  if (!s.players.length) ul.append(el('li', {}, el('span', { class: 'muted' }, 'Ingen deltakere ennå')));
  return ul;
}

function renderLobby(s) {
  view.innerHTML = '';
  view.append(el('div', { class: 'card center fade-in' }, [
    el('div', { class: 'logo', style: 'width:52px;height:52px;font-size:30px;margin:0 auto 10px' }, '🎼'),
    el('h2', {}, 'Klar til å spille!'),
    el('p', { class: 'muted', id: 'lobbyHint' }, `Venter på at ${escapeHtml(s.game.leaderName)} starter første runde…`),
  ]));
  const pc = el('div', { class: 'card' }, [el('h2', {}, `Deltakere (${s.players.length})`), el('div', { id: 'plist' }, playersList(s))]);
  view.append(pc);
}
function updateLobby(s) {
  const plist = $('#plist');
  if (plist) { plist.innerHTML = ''; plist.append(playersList(s)); }
  const hint = $('#lobbyHint');
  const parent = plist && plist.previousElementSibling;
  if (parent) parent.textContent = `Deltakere (${s.players.length})`;
}

// Runden er klargjort — vent på at lederen starter tiden
function renderPending(s) {
  view.innerHTML = '';
  view.append(el('div', { class: 'card center fade-in' }, [
    el('div', { class: 'logo', style: 'width:52px;height:52px;font-size:30px;margin:0 auto 10px' }, '🎵'),
    el('h2', {}, 'Gjør deg klar!'),
    el('p', { class: 'muted' }, `Runde ${s.round.roundNumber} starter straks — lytt etter musikken.`),
  ]));
  view.append(el('div', { class: 'card' }, [el('h2', {}, `Deltakere (${s.players.length})`), el('div', { id: 'plist' }, playersList(s))]));
}

function field2Options(selected) {
  const opts = [el('option', { value: '' }, `— velg ${labels.epoch.toLowerCase()} —`)];
  ((meta && (meta.field2Options || meta.epochs)) || []).forEach((e) =>
    opts.push(el('option', { value: e, ...(e === selected ? { selected: 'selected' } : {}) }, e))
  );
  return opts;
}
function field1Options(selected) {
  const opts = [el('option', { value: '' }, `— velg ${labels.composer.toLowerCase()} —`)];
  ((meta && (meta.field1Options || meta.composers)) || []).forEach((c) =>
    opts.push(el('option', { value: c, ...(c === selected ? { selected: 'selected' } : {}) }, c))
  );
  return opts;
}

function renderActive(s) {
  const r = s.round;
  const yr = meta ? meta.yearRange : { min: 1600, max: 2025 };
  const startYear = localGuess.year || Math.round((yr.min + yr.max) / 2);
  view.innerHTML = '';

  // Timer
  const timerCard = el('div', { class: 'card' }, [
    el('div', { class: 'center' }, el('span', { class: 'pill accent' }, `Runde ${r.roundNumber}`)),
    el('div', { class: 'timer-ring' }, [
      el('div', { class: 'timer-num', id: 'timerNum' }, String(r.timeLeft)),
      el('div', { class: 'muted', style: 'font-size:.85rem' }, 'sekunder igjen'),
      el('div', { class: 'timer-bar', id: 'timerBar' }, el('span', { style: 'width:100%' })),
    ]),
    el('p', { class: 'center muted', style: 'margin:0;font-size:.9rem' }, '🔊 Lytt til utdraget og fyll ut det du kan'),
  ]);
  view.append(timerCard);

  // Skjema — feltnavn/typer avhenger av temaet (klassisk vs pop)
  const workPlaceholder = useMovement ? 'F.eks. Symfoni nr. 5' : 'F.eks. Wonderwall';
  const formChildren = [
    el('label', { for: 'gComposer' }, labels.composer),
    el('select', { id: 'gComposer' }, field1Options(localGuess.composer)),
    el('label', { for: 'gEpoch' }, labels.epoch),
    el('select', { id: 'gEpoch' }, field2Options(localGuess.epoch)),
    el('label', { for: 'gYear' }, [`${labels.year}: `, el('b', { id: 'yearOut' }, String(startYear))]),
    el('input', { id: 'gYear', type: 'range', min: String(yr.min), max: String(yr.max), step: '1', value: String(startYear) }),
    el('div', { class: 'muted', style: 'display:flex;justify-content:space-between;font-size:.8rem' }, [
      el('span', {}, String(yr.min)), el('span', {}, String(yr.max)),
    ]),
    el('label', { for: 'gWork' }, [labels.work + ' ', el('span', { class: 'hint' }, '(fritekst)')]),
    el('input', { id: 'gWork', type: 'text', maxlength: '80', placeholder: workPlaceholder, value: localGuess.work || '' }),
  ];
  if (useMovement) {
    formChildren.push(
      el('label', { for: 'gMovement' }, [labels.movement + ' ', el('span', { class: 'hint' }, '(fritekst, valgfritt)')]),
      el('input', { id: 'gMovement', type: 'text', maxlength: '80', placeholder: 'F.eks. 1. sats / Allegro', value: localGuess.movement || '' })
    );
  }
  formChildren.push(
    el('div', { style: 'height:14px' }),
    el('button', { class: 'btn btn-primary', type: 'submit', id: 'submitBtn' }, submittedThisRound ? '✓ Lagret — oppdater svar' : 'Lagre svaret mitt'),
    el('p', { class: 'center muted', style: 'font-size:.82rem;margin-bottom:0' }, 'Du kan endre svaret helt til tiden er ute.')
  );
  const form = el('form', { class: 'card', id: 'guessForm' }, formChildren);
  view.append(form);

  // Ledertavle (liten)
  view.append(el('div', { class: 'card' }, [el('h2', {}, 'Stilling'), el('div', { id: 'plist' }, playersList(s))]));

  // Bind
  const yearInput = $('#gYear');
  yearInput.addEventListener('input', () => { $('#yearOut').textContent = yearInput.value; localGuess.year = +yearInput.value; });
  ['gComposer', 'gEpoch', 'gWork', 'gMovement'].forEach((id) => {
    const node = $('#' + id); // #gMovement finnes ikke i pop-modus
    if (node) node.addEventListener('input', captureLocal);
  });
  form.addEventListener('submit', submitGuess);
  captureLocal();

  // Start lokal nedtelling + lydsignaler
  startTicker(r);
}

function captureLocal() {
  localGuess = {
    composer: $('#gComposer') ? $('#gComposer').value : localGuess.composer,
    epoch: $('#gEpoch') ? $('#gEpoch').value : localGuess.epoch,
    year: $('#gYear') ? +$('#gYear').value : localGuess.year,
    work: $('#gWork') ? $('#gWork').value : localGuess.work,
    movement: $('#gMovement') ? $('#gMovement').value : localGuess.movement,
  };
}

async function submitGuess(e) {
  e.preventDefault();
  captureLocal();
  const btn = $('#submitBtn');
  btn.disabled = true;
  try {
    await api.guess(code, { playerId: session.playerId, ...localGuess });
    submittedThisRound = true;
    btn.textContent = '✓ Lagret — oppdater svar';
    toast('Svaret er lagret!', 'ok');
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
  }
}

function updateActive(s) {
  // Timeren drives av den lokale telleren (startTicker); her oppdaterer vi kun stillingen
  const plist = $('#plist');
  if (plist) { plist.innerHTML = ''; plist.append(playersList(s)); }
}

function breakdownRows(bd) {
  if (!bd) return el('div');
  const rows = [
    [labels.composer, bd.composer], [labels.epoch, bd.epoch], [labels.year, bd.year],
    [labels.work, bd.work], [labels.movement, bd.movement],
  ];
  const wrap = el('div', { class: 'breakdown' });
  rows.forEach(([label, b]) => {
    if (!b) return;
    const cls = b.points >= b.max ? 'hit' : b.points > 0 ? 'partial' : 'miss';
    const detail = 'diff' in b && b.diff != null ? `bom ${b.diff} år`
      : 'similarity' in b ? `ditt: «${escapeHtml(b.guess || '—')}»`
      : `ditt: «${escapeHtml(b.guess || '—')}»`;
    wrap.append(el('div', { class: `brow ${cls}` }, [
      el('div', {}, [el('div', { class: 'blabel' }, label), el('div', { class: 'bguess' }, detail)]),
      el('div', { class: 'bpts' }, `${b.points}/${b.max}`),
    ]));
  });
  return wrap;
}

function answerCard(piece) {
  return el('div', { class: 'card answer-card fade-in' }, [
    el('div', { class: 'center' }, el('span', { class: 'pill accent' }, 'Fasit')),
    el('div', { class: 'composer' }, piece.composer),
    el('div', { class: 'work' }, piece.work),
    el('div', { class: 'meta' }, `${piece.epoch} · ${piece.year}${piece.movement ? ' · ' + piece.movement : ''}`),
  ]);
}

function renderReveal(s) {
  const r = s.round;
  view.innerHTML = '';
  if (r.piece) view.append(answerCard(r.piece));

  const mine = r.yourResult;
  if (mine) {
    view.append(el('div', { class: 'card fade-in' }, [
      el('div', { class: 'big-score' }, [
        el('div', { html: `<span class="n">+${mine.total}</span> <span class="of">/ 100 poeng</span>` }),
      ]),
      breakdownRows(mine.breakdown),
    ]));
  } else {
    view.append(el('div', { class: 'card center' }, el('p', { class: 'muted' }, 'Du rakk ikke å svare på denne runden.')));
  }

  view.append(el('div', { class: 'card' }, [el('h2', {}, 'Stilling'), el('div', { id: 'plist' }, playersList(s))]));
  view.append(el('p', { class: 'center muted', id: 'waitHint' }, 'Venter på neste runde…'));
}
function updateLeaderboardOnly(s) {
  const plist = $('#plist');
  if (plist) { plist.innerHTML = ''; plist.append(playersList(s)); }
}

function renderFinished(s) {
  clearInterval(pollTimer);
  view.innerHTML = '';
  const winner = s.players[0];
  view.append(el('div', { class: 'card center fade-in' }, [
    el('div', { style: 'font-size:44px' }, '🏆'),
    el('h2', {}, 'Spillet er ferdig!'),
    winner ? el('p', { class: 'lead' }, `Vinner: ${escapeHtml(winner.name)} med ${winner.totalScore} poeng`) : null,
  ]));
  view.append(el('div', { class: 'card' }, [el('h2', {}, 'Sluttstilling'), playersList(s)]));
  view.append(el('a', { class: 'btn btn-ghost', href: '/' }, 'Til forsiden'));
}

// --- Kjør ---
(async function init() {
  if (!code) { location.href = '/'; return; }
  // meta hentes per tema i poll() når spillets tema er kjent
  if (await ensureSession()) start();
})();
