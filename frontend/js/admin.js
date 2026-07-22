import { api } from './api.js';
import { $, el, escapeHtml, toast, initTheme, spotifyEmbedUrl, spotifySearchUrl } from './util.js';

initTheme();

let pieces = [];
let themes = [];
let kinds = []; // [{kind, label}]
let epochsFull = [];
let filterThemeName = ''; // '' = alle

// Feltetiketter per type (speiler api/lib/kinds.js)
const LABELS = {
  classical: { composer: 'Komponist', field2: 'Epoke', work: 'Verk', useMovement: true },
  pop: { composer: 'Artist', field2: 'Album', work: 'Låt', useMovement: false },
};

function kindOfTheme(name) {
  const t = themes.find((x) => x.name === name);
  return t ? t.kind : 'classical';
}

async function load() {
  try {
    const meta = await api.meta(); // for epochsFull
    epochsFull = meta.epochsFull || [];
    const tRes = await api.listThemes();
    themes = tRes.data || [];
    kinds = tRes.kinds || [{ kind: 'classical', label: 'Klassisk' }, { kind: 'pop', label: 'Pop' }];
    fillKindSelect();
    fillEpochs();
    renderThemes();
    fillThemeSelects();
    const res = await api.listPieces();
    pieces = res.data || [];
    applyFormKind();
    renderTable();
  } catch (err) { toast(err.message); }
}

// ---------- Tema ----------
function fillKindSelect() {
  const sel = $('#tKind');
  sel.innerHTML = '';
  kinds.forEach((k) => sel.append(el('option', { value: k.kind }, k.label)));
}

function renderThemes() {
  const host = $('#themeList');
  host.innerHTML = '';
  if (!themes.length) { host.textContent = 'Ingen tema ennå.'; return; }
  const ul = el('div', {});
  themes.forEach((t) => {
    ul.append(el('div', { class: 'brow', style: 'grid-template-columns:1fr auto auto;gap:10px;margin-bottom:8px' }, [
      el('div', {}, [
        el('span', { class: 'blabel' }, t.name),
        el('span', { class: 'pill', style: 'margin-left:8px' }, t.kindLabel || t.kind),
      ]),
      el('span', { class: 'muted', style: 'font-size:.85rem;align-self:center' }, `${t.count} stykker`),
      el('button', { class: 'btn btn-danger btn-sm', onclick: () => delTheme(t) }, '🗑'),
    ]));
  });
  host.append(ul);
}

async function delTheme(t) {
  if (t.count > 0) return toast(`«${t.name}» har ${t.count} stykke(r) — flytt/slett dem først`);
  if (!confirm(`Slette temaet «${t.name}»?`)) return;
  try { await api.deleteTheme(t.id); toast('Tema slettet', 'ok'); await load(); }
  catch (err) { toast(err.message); }
}

$('#themeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#tName').value.trim();
  const kind = $('#tKind').value;
  if (!name) return toast('Skriv inn tema-navn');
  try {
    await api.createTheme(name, kind);
    toast('Tema lagt til', 'ok');
    $('#tName').value = '';
    await load();
  } catch (err) { toast(err.message); }
});

// ---------- Stykke-skjema ----------
function fillEpochs() {
  const sel = $('#pEpoch');
  sel.innerHTML = '';
  sel.append(el('option', { value: '' }, '— velg epoke —'));
  epochsFull.forEach((e) => sel.append(el('option', { value: e.name }, `${e.name} (${e.from}–${e.to})`)));
}

function fillThemeSelects() {
  // Skjema-velger
  const psel = $('#pTheme');
  const prev = psel.value;
  psel.innerHTML = '';
  themes.forEach((t) => psel.append(el('option', { value: t.name }, `${t.name} (${t.kindLabel || t.kind})`)));
  if (prev && themes.some((t) => t.name === prev)) psel.value = prev;

  // Filter-velger
  const fsel = $('#filterTheme');
  fsel.innerHTML = '';
  fsel.append(el('option', { value: '' }, 'Alle tema'));
  themes.forEach((t) => fsel.append(el('option', { value: t.name }, `${t.name} (${t.count})`)));
  fsel.value = filterThemeName;
}

/** Oppdater etiketter og synlige felt ut fra valgt tema sin type. */
function applyFormKind() {
  const kind = kindOfTheme($('#pTheme').value);
  const L = LABELS[kind] || LABELS.classical;
  $('#pComposerLabel').textContent = L.composer;
  $('#pComposer').placeholder = kind === 'pop' ? 'F.eks. Nirvana' : 'F.eks. Ludwig van Beethoven';
  $('#pWorkLabel').textContent = L.work;
  $('#pWork').placeholder = kind === 'pop' ? 'F.eks. Smells Like Teen Spirit' : 'Symfoni nr. 5 c-moll';
  // field2: epoke (klassisk) vs album (pop)
  $('#epochRow').style.display = kind === 'pop' ? 'none' : '';
  $('#albumRow').style.display = kind === 'pop' ? '' : 'none';
  // sats kun for klassisk
  $('#movementRow').style.display = L.useMovement ? '' : 'none';
}

$('#pTheme').addEventListener('change', applyFormKind);

function renderTable() {
  const shown = filterThemeName ? pieces.filter((p) => p.theme === filterThemeName) : pieces;
  $('#count').textContent = shown.length;
  // Kolonneoverskrifter: bruk etiketter fra filtrert type hvis satt
  const kind = filterThemeName ? kindOfTheme(filterThemeName) : 'classical';
  const L = LABELS[kind] || LABELS.classical;
  $('#thComposer').textContent = L.composer;
  $('#thEpoch').textContent = L.field2;
  $('#thWork').textContent = L.work;

  const tbody = $('#rows');
  tbody.innerHTML = '';
  shown.forEach((p) => {
    const hasSpotify = !!spotifyEmbedUrl(p.spotifyUrl);
    tbody.append(el('tr', {}, [
      el('td', {}, [p.composer, el('div', { class: 'muted', style: 'font-size:.75rem' }, p.theme)]),
      el('td', {}, String(p.year)),
      el('td', {}, el('span', { class: 'pill' }, p.epoch)),
      el('td', {}, [el('div', {}, p.work), p.movement ? el('div', { class: 'muted', style: 'font-size:.8rem' }, p.movement) : null]),
      el('td', { style: 'text-align:center' }, hasSpotify ? '✅' : '—'),
      el('td', { style: 'white-space:nowrap' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => edit(p.id) }, '✏️'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => del(p.id) }, '🗑'),
      ]),
    ]));
  });
  if (!shown.length) tbody.append(el('tr', {}, el('td', { colspan: '6', class: 'muted center' }, 'Ingen stykker her')));
}

$('#filterTheme').addEventListener('change', (e) => { filterThemeName = e.target.value; renderTable(); });

$('#resolveBtn').addEventListener('click', async () => {
  const scope = filterThemeName || 'alle tema';
  const missing = (filterThemeName ? pieces.filter((p) => p.theme === filterThemeName) : pieces).filter((p) => !p.spotifyUrl).length;
  if (!missing) return toast('Ingen manglende lenker her', 'ok');
  if (!confirm(`Slå opp Spotify-lenker for ${missing} stykke(r) i ${scope}? Dette kan ta litt tid.`)) return;
  const btn = $('#resolveBtn');
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = '⏳ Slår opp…';
  try {
    const r = await api.resolveSpotify(filterThemeName || undefined);
    toast(`Fant ${r.resolved} av ${r.total} lenker (metode: ${r.method}).`, r.resolved ? 'ok' : 'err');
    await load();
  } catch (err) {
    toast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = orig;
  }
});

function formData() {
  const kind = kindOfTheme($('#pTheme').value);
  const field2 = kind === 'pop' ? $('#pAlbum').value.trim() : $('#pEpoch').value;
  return {
    theme: $('#pTheme').value,
    composer: $('#pComposer').value.trim(),
    year: parseInt($('#pYear').value, 10),
    epoch: field2,
    work: $('#pWork').value.trim(),
    movement: LABELS[kind].useMovement ? $('#pMovement').value.trim() : '',
    spotifyUrl: $('#pSpotify').value.trim(),
  };
}

function resetForm() {
  $('#pId').value = '';
  ['pComposer', 'pYear', 'pWork', 'pMovement', 'pSpotify', 'pAlbum'].forEach((id) => ($('#' + id).value = ''));
  $('#pEpoch').value = '';
  $('#formTitle').textContent = 'Nytt stykke';
  $('#saveBtn').textContent = 'Legg til';
  $('#resetBtn').style.display = 'none';
  $('#spotifyHelp').textContent = '';
  applyFormKind();
}

function edit(id) {
  const p = pieces.find((x) => x.id === id);
  if (!p) return;
  $('#pId').value = p.id;
  $('#pTheme').value = p.theme || 'Klassisk';
  applyFormKind();
  const kind = kindOfTheme(p.theme);
  $('#pComposer').value = p.composer;
  $('#pYear').value = p.year;
  if (kind === 'pop') $('#pAlbum').value = p.epoch || '';
  else $('#pEpoch').value = p.epoch || '';
  $('#pWork').value = p.work;
  $('#pMovement').value = p.movement || '';
  $('#pSpotify').value = p.spotifyUrl || '';
  $('#formTitle').textContent = 'Rediger stykke';
  $('#saveBtn').textContent = 'Lagre endringer';
  $('#resetBtn').style.display = '';
  updateSpotifyHelp();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function del(id) {
  const p = pieces.find((x) => x.id === id);
  if (!confirm(`Slette «${p ? p.work : ''}»?`)) return;
  try { await api.deletePiece(id); toast('Slettet', 'ok'); await load(); }
  catch (err) { toast(err.message); }
}

function updateSpotifyHelp() {
  const url = $('#pSpotify').value.trim();
  const help = $('#spotifyHelp');
  if (!url) {
    const d = formData();
    if (d.composer || d.work) {
      help.innerHTML = `Ingen lenke. <a href="${spotifySearchUrl({ composer: d.composer, work: d.work })}" target="_blank" rel="noopener">Søk på Spotify →</a> og lim inn track-lenken.`;
    } else help.textContent = '';
  } else if (spotifyEmbedUrl(url)) {
    help.innerHTML = '✅ Gyldig Spotify-lenke — innebygd avspilling vil fungere.';
  } else {
    help.innerHTML = '⚠️ Dette ser ikke ut som en Spotify track/album-lenke.';
  }
}

$('#pSpotify').addEventListener('input', updateSpotifyHelp);
$('#pComposer').addEventListener('input', updateSpotifyHelp);
$('#pWork').addEventListener('input', updateSpotifyHelp);
$('#resetBtn').addEventListener('click', resetForm);

$('#pieceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = formData();
  if (!data.theme) return toast('Velg et tema');
  if (!data.composer || !data.epoch || !data.work || Number.isNaN(data.year)) {
    const kind = kindOfTheme(data.theme);
    return toast(`Fyll ut ${LABELS[kind].composer.toLowerCase()}, årstall, ${LABELS[kind].field2.toLowerCase()} og ${LABELS[kind].work.toLowerCase()}`);
  }
  const id = $('#pId').value;
  $('#saveBtn').disabled = true;
  try {
    if (id) { await api.updatePiece(id, data); toast('Lagret', 'ok'); }
    else { await api.createPiece(data); toast('Lagt til', 'ok'); }
    resetForm();
    await load();
  } catch (err) { toast(err.message); }
  finally { $('#saveBtn').disabled = false; }
});

load();
