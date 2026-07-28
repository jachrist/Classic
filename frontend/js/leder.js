import { api } from './api.js';
import { $, el, escapeHtml, toast, initTheme, registerSW, store, spotifyEmbedUrl, spotifySearchUrl } from './util.js';
import { warningSound, endSound, unlockAudio } from './sound.js';

initTheme();
registerSW();

const view = $('#view');
let leader = store.get('classic-leader'); // { code, leaderToken }
let pollTimer = null;
let lastPhase = null;
let lastPieceKey = null;
let busy = false;
let curTheme = null; // gjeldende tema (for temavelgeren)

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

// --- Tema-hjelpere ---
async function fetchThemes() {
  try { return (await api.listThemes()).data || []; } catch { return []; }
}
function buildThemeSelect(id, themes, selected) {
  const sel = el('select', { id });
  const withPieces = themes.filter((t) => t.count > 0);
  const byKind = {};
  (withPieces.length ? withPieces : themes).forEach((t) => (byKind[t.kind] = byKind[t.kind] || []).push(t));
  const groupLabels = { classical: 'Klassisk', pop: 'Pop' };
  for (const [kind, list] of Object.entries(byKind)) {
    if (!list.length) continue;
    const group = el('optgroup', { label: groupLabels[kind] || kind });
    list.forEach((t) => group.append(el('option', { value: t.name, ...(t.name === selected ? { selected: 'selected' } : {}) }, `${t.name} (${t.count})`)));
    sel.append(group);
  }
  return sel;
}

// --- Bytt tema (fortsett med samme deltakere) ---
async function renderThemePicker() {
  stopTicker();
  const themes = await fetchThemes();
  view.innerHTML = '';
  const sel = buildThemeSelect('switchTheme', themes, curTheme);
  view.append(el('div', { class: 'card' }, [
    el('h2', {}, 'Bytt tema'),
    el('p', { class: 'muted' }, 'Fortsett med de samme deltakerne og poengene deres — men med et nytt tema.'),
    el('label', { for: 'switchTheme' }, 'Velg tema'),
    sel,
    el('div', { style: 'height:14px' }),
    el('div', { class: 'btn-row' }, [
      el('button', { class: 'btn btn-primary', onclick: () => doChangeTheme(sel.value) }, '✔ Bytt til dette temaet'),
      el('button', { class: 'btn btn-ghost', onclick: () => { lastPhase = null; poll(); } }, 'Avbryt'),
    ]),
  ]));
}
async function doChangeTheme(theme) {
  if (!theme) return toast('Velg et tema');
  if (busy) return; busy = true;
  try { await api.changeTheme(leader.code, leader.leaderToken, theme); lastPhase = null; await poll(); toast('Byttet tema — poengene er beholdt!', 'ok'); }
  catch (err) { toast(err.message); }
  finally { busy = false; }
}

// --- Opprett spill ---
async function renderCreate() {
  view.innerHTML = '';

  // Hent tema for nedtrekksliste (gruppert på klassisk/pop)
  const themes = await fetchThemes();
  const themeSelect = buildThemeSelect('ltheme', themes);

  const form = el('form', { class: 'card' }, [
    el('h2', {}, 'Start et nytt spill'),
    el('p', { class: 'sub' }, 'Du blir spill-leder. Deltakerne blir med via romkoden du får.'),
    el('label', { for: 'lname' }, 'Ditt navn'),
    el('input', { id: 'lname', type: 'text', maxlength: '24', placeholder: 'F.eks. Ola', autocomplete: 'off' }),
    el('label', { for: 'ltheme' }, 'Tema'),
    themeSelect,
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
    const theme = $('#ltheme').value;
    if (!name) return toast('Skriv inn navnet ditt');
    e.submitter.disabled = true;
    try {
      const res = await api.createGame(name, dur, theme);
      leader = { code: res.code, leaderToken: res.leaderToken };
      store.set('classic-leader', leader);
      start();
    } catch (err) { toast(err.message); e.submitter.disabled = false; }
  });
  view.append(form);
  if (!themes.length) view.append(el('p', { class: 'center muted', style: 'font-size:.85rem' }, 'Ingen tema ennå — opprett i Admin.'));

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
  curTheme = s.game.theme;
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
    el('div', { class: 'center', style: 'margin-bottom:6px' },
      el('span', { class: 'pill accent' }, `🎼 ${s.game.theme || 'Klassisk'}`)),
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

/** Rendrer poengberegning per felt (svar + poeng) for én deltaker inn i `host`. */
function breakdownRows(host, bd, labels) {
  if (!bd) return;
  const rows = [
    [labels.composer || 'Komponist', bd.composer],
    [labels.epoch || 'Epoke', bd.epoch],
    [labels.year || 'Årstall', bd.year],
    [labels.work || 'Verk', bd.work],
    [labels.movement || 'Sats', bd.movement],
  ];
  rows.forEach(([label, b]) => {
    if (!b) return;
    const cls = b.points >= b.max ? 'hit' : b.points > 0 ? 'partial' : 'miss';
    let detail;
    if ('diff' in b) {
      detail = b.diff == null ? 'ikke svart' : `gjettet ${b.guess} — bom ${b.diff} år`;
    } else if ('similarity' in b) {
      detail = `gjettet «${b.guess || '—'}»`;
    } else {
      detail = (b.hit ? '✓ ' : '') + `gjettet «${b.guess || '—'}»`;
    }
    host.append(el('div', { class: `brow ${cls}` }, [
      el('div', {}, [el('div', { class: 'blabel' }, label), el('div', { class: 'bguess' }, detail)]),
      el('div', { class: 'bpts' }, `${b.points}/${b.max}`),
    ]));
  });
}

function fullRender(s) {
  view.innerHTML = '';
  stopTicker();
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
    view.append(el('button', { class: 'btn btn-primary', onclick: renderThemePicker }, '🎚️ Bytt tema og fortsett'));
    view.append(el('button', { class: 'btn btn-ghost', style: 'margin-top:8px', onclick: newGame }, 'Nytt spill (nullstill)'));
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
  } else if (round.status === 'pending') {
    // Runden er klargjort — lederen cuer musikken, deretter startes tiden
    controls.append(el('div', { class: 'center' }, el('span', { class: 'pill accent' }, `Runde ${round.roundNumber} — klar`)));
    controls.append(el('p', { class: 'center muted' }, '🔊 Start musikken på Spotify, og trykk så «Start tiden».'));
    controls.append(el('button', { class: 'btn btn-primary', id: 'beginBtn', onclick: beginRound },
      `▶ Start tiden (${round.durationSec} sek)`));
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

  // Start lokal nedtelling (og lydsignaler) for aktiv runde
  if (round && round.status === 'active') startTicker(round);

  // Spotify + fasit når det er en runde med piece
  if (round && round.piece) {
    view.append(spotifyCard(round.piece));
    view.append(answerCard(round.piece));
  }

  // Resultater etter avsløring — svar + poengberegning per deltaker
  if (round && round.status === 'revealed' && round.results) {
    const labels = s.game.labels || {};
    const card = el('div', { class: 'card' }, [
      el('h2', {}, 'Rundepoeng og svar'),
      el('p', { class: 'muted', style: 'font-size:.82rem;margin-top:0' }, 'Trykk på en deltaker for å se svaret og hvordan poengene ble beregnet.'),
    ]);
    if (!round.results.length) card.append(el('p', { class: 'muted' }, 'Ingen svar denne runden'));
    round.results.forEach((r, i) => {
      const details = el('div', { class: 'breakdown', style: 'display:none;margin:8px 0 4px' });
      breakdownRows(details, r.breakdown, labels);
      const head = el('div', {
        class: 'brow',
        style: 'grid-template-columns:auto 1fr auto;gap:10px;align-items:center;cursor:pointer',
      }, [
        el('span', { class: 'rank' }, i === 0 && r.total > 0 ? '🏆' : String(i + 1)),
        el('span', { class: 'pname' }, [r.name, ' ', el('span', { class: 'muted', style: 'font-size:.8rem' }, '▾')]),
        el('span', { class: 'pscore' }, `+${r.total}`),
      ]);
      head.addEventListener('click', () => {
        details.style.display = details.style.display === 'none' ? '' : 'none';
      });
      card.append(el('div', { style: 'margin-bottom:8px' }, [head, details]));
    });
    view.append(card);
  }

  view.append(playersCard(s));

  // Bytt tema (fortsett) eller avslutt
  view.append(el('div', { class: 'btn-row', style: 'margin-top:6px' }, [
    el('button', { class: 'btn btn-ghost', onclick: renderThemePicker }, '🎚️ Bytt tema'),
    el('button', { class: 'btn btn-ghost btn-danger', onclick: finishGame }, 'Avslutt spillet'),
  ]));
}

function liveUpdate(s) {
  const round = s.round;
  const plist = $('#plist');
  if (plist) renderPlayers(plist, s);
  // Timeren drives av den lokale telleren (startTicker); her oppdaterer vi kun antall svar
  if (round && round.status === 'active') {
    const gc = $('#guessCount'); if (gc) gc.textContent = `${round.guessCount} svar inne`;
  }
}

// --- Handlinger ---
async function startRound(e) {
  if (busy) return; busy = true;
  unlockAudio(); // lås opp lyd på lederens enhet (krever brukergest på iOS)
  const btn = e && e.target; if (btn) btn.disabled = true;
  try { await api.startRound(leader.code, leader.leaderToken, {}); lastPhase = null; await poll(); }
  catch (err) { toast(err.message); if (btn) btn.disabled = false; }
  finally { busy = false; }
}
async function beginRound(e) {
  if (busy) return; busy = true;
  unlockAudio();
  const btn = e && e.target; if (btn) btn.disabled = true;
  try { await api.beginRound(leader.code, leader.leaderToken); lastPhase = null; await poll(); }
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
  stopTicker();
  renderCreate();
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Kopiert!', 'ok'); }
  catch { toast('Kunne ikke kopiere — merk teksten manuelt'); }
}

// --- Kjør ---
if (leader && leader.code && leader.leaderToken) start();
else renderCreate();
