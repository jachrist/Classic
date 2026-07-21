import { api } from './api.js';
import { $, el, escapeHtml, toast, initTheme, store, spotifyEmbedUrl, spotifySearchUrl } from './util.js';

initTheme();

let pieces = [];
let meta = null;

async function load() {
  try {
    meta = await api.meta();
    fillEpochs();
    const res = await api.listPieces();
    pieces = res.data || [];
    renderTable();
  } catch (err) { toast(err.message); }
}

function fillEpochs() {
  const sel = $('#pEpoch');
  sel.innerHTML = '';
  sel.append(el('option', { value: '' }, '— velg epoke —'));
  (meta.epochsFull || []).forEach((e) =>
    sel.append(el('option', { value: e.name }, `${e.name} (${e.from}–${e.to})`)));
}

function renderTable() {
  $('#count').textContent = pieces.length;
  const tbody = $('#rows');
  tbody.innerHTML = '';
  pieces.forEach((p) => {
    const hasSpotify = !!spotifyEmbedUrl(p.spotifyUrl);
    const tr = el('tr', {}, [
      el('td', {}, p.composer),
      el('td', {}, String(p.year)),
      el('td', {}, el('span', { class: 'pill' }, p.epoch)),
      el('td', {}, [el('div', {}, p.work), p.movement ? el('div', { class: 'muted', style: 'font-size:.8rem' }, p.movement) : null]),
      el('td', { style: 'text-align:center' }, hasSpotify ? '✅' : '—'),
      el('td', { style: 'white-space:nowrap' }, [
        el('button', { class: 'btn btn-ghost btn-sm', onclick: () => edit(p.id) }, '✏️'),
        el('button', { class: 'btn btn-danger btn-sm', onclick: () => del(p.id) }, '🗑'),
      ]),
    ]);
    tbody.append(tr);
  });
  if (!pieces.length) tbody.append(el('tr', {}, el('td', { colspan: '6', class: 'muted center' }, 'Tomt bibliotek')));
}

function formData() {
  return {
    composer: $('#pComposer').value.trim(),
    year: parseInt($('#pYear').value, 10),
    epoch: $('#pEpoch').value,
    work: $('#pWork').value.trim(),
    movement: $('#pMovement').value.trim(),
    spotifyUrl: $('#pSpotify').value.trim(),
  };
}

function resetForm() {
  $('#pId').value = '';
  ['pComposer', 'pYear', 'pWork', 'pMovement', 'pSpotify'].forEach((id) => ($('#' + id).value = ''));
  $('#pEpoch').value = '';
  $('#formTitle').textContent = 'Nytt stykke';
  $('#saveBtn').textContent = 'Legg til';
  $('#resetBtn').style.display = 'none';
  $('#spotifyHelp').textContent = '';
}

function edit(id) {
  const p = pieces.find((x) => x.id === id);
  if (!p) return;
  $('#pId').value = p.id;
  $('#pComposer').value = p.composer;
  $('#pYear').value = p.year;
  $('#pEpoch').value = p.epoch;
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
      help.innerHTML = `Ingen lenke. <a href="${spotifySearchUrl(d)}" target="_blank" rel="noopener">Søk på Spotify →</a> og lim inn track-lenken.`;
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
  if (!data.composer || !data.epoch || !data.work || Number.isNaN(data.year)) {
    return toast('Fyll ut komponist, årstall, epoke og verk');
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
