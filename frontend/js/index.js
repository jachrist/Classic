import { api } from './api.js';
import { $, qs, toast, initTheme, registerSW, store } from './util.js';

initTheme();
registerSW();

// Forhåndsutfyll romkode fra ?code=
const preCode = qs('code');
if (preCode) $('#code').value = preCode.toUpperCase();

$('#code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('#joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('#code').value.trim().toUpperCase();
  const name = $('#name').value.trim();
  if (!code || !name) return;
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const res = await api.join(code, name);
    store.set('classic-player', { code, playerId: res.playerId, name });
    location.href = `/spill.html?code=${code}`;
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

$('#leaderCard').addEventListener('click', () => {
  location.href = '/leder.html';
});
