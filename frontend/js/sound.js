// Lydsignaler via Web Audio (ingen lydfiler). Fungerer offline.
// iOS/Safari krever en brukerinteraksjon før lyd kan spilles — vi «låser opp»
// AudioContext ved første tap/klikk/tast.

let ctx = null;

function getCtx() {
  if (!ctx) {
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; }
  }
  return ctx;
}

export function unlockAudio() {
  const c = getCtx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}

// Lås opp ved første interaksjon (én gang holder på iOS)
['pointerdown', 'touchstart', 'keydown', 'click'].forEach((ev) =>
  window.addEventListener(ev, unlockAudio, { passive: true })
);

/** Spill én tone. start/dur i sekunder, relativt til «nå». */
function tone(freq, start, dur, type = 'sine', gain = 0.2) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(g);
  g.connect(c.destination);
  const t0 = c.currentTime + start;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Varsel ~10 sek igjen: to raske, lyse pip. */
export function warningSound() {
  unlockAudio();
  tone(880, 0, 0.14, 'square', 0.14);
  tone(880, 0.22, 0.14, 'square', 0.14);
}

/** Slutt: fallende «gong» (to toner ned). */
export function endSound() {
  unlockAudio();
  tone(600, 0, 0.22, 'sine', 0.22);
  tone(392, 0.24, 0.5, 'sine', 0.22);
}
