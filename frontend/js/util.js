// Delte hjelpere: DOM, escaping, Spotify, tema.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

export function qs(name) {
  return new URLSearchParams(location.search).get(name);
}

export function toast(msg, type = 'err', host) {
  const box = host || document.querySelector('#msg') || document.body;
  const m = el('div', { class: `msg ${type} fade-in` }, msg);
  if (host) host.prepend(m);
  else {
    box.prepend(m);
  }
  setTimeout(() => m.remove(), 4200);
  return m;
}

/** Bygg Spotify-embed-URL fra en vanlig track/album/playlist-lenke, ellers null. */
export function spotifyEmbedUrl(url) {
  if (!url) return null;
  const m = String(url).match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist|episode)\/([A-Za-z0-9]+)/);
  if (m) return `https://open.spotify.com/embed/${m[1]}/${m[2]}`;
  const uri = String(url).match(/spotify:(track|album|playlist|episode):([A-Za-z0-9]+)/);
  if (uri) return `https://open.spotify.com/embed/${uri[1]}/${uri[2]}`;
  return null;
}

/** Søkelenke på Spotify for et stykke (fallback når URL mangler). */
export function spotifySearchUrl(piece) {
  const q = [piece.composer, piece.work, piece.movement].filter(Boolean).join(' ');
  return 'https://open.spotify.com/search/' + encodeURIComponent(q);
}

// Tema
export function initTheme() {
  const saved = localStorage.getItem('classic-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  const btn = document.querySelector('#themeBtn');
  if (btn) {
    const sync = () => {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      btn.textContent = light ? '🌙' : '☀️';
    };
    sync();
    btn.addEventListener('click', () => {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      const next = light ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('classic-theme', next);
      sync();
    });
  }
}

// Enkel localStorage-hjelp
export const store = {
  get: (k, def = null) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch { return def; }
  },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
  del: (k) => localStorage.removeItem(k),
};

/** Registrer service worker (PWA) uten å blokkere. */
export function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
}
