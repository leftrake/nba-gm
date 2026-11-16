// Game sounds, made on the spot with the Web Audio API — no audio files to
// ship or load. Off unless the viewer's sound setting is on (livePrefs.js).
//
// Browsers only let an AudioContext start after the user has interacted with
// the page, so it's created lazily: on the click that turns sound on
// (primeSound), or on the first sound after that. Anything unavailable —
// no Web Audio, a context that won't start — fails silently: sound is a
// garnish, never something the game waits on.

let ctx = null;
let noiseBuffer = null;

function audio() {
  if (!ctx) {
    const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

// Two seconds of white noise, made once and reused by every noisy sound.
function noise(c) {
  if (!noiseBuffer) {
    noiseBuffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = noiseBuffer.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  return src;
}

// A gain node shaped attack → hold → release. Exponential ramps can't reach
// zero, hence the floor.
function envelope(c, peak, attack, hold, release) {
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return { g, end: t + attack + hold + release + 0.05 };
}

const SOUNDS = {
  // The net: a brush of high noise, in and out.
  swish(c) {
    const src = noise(c);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6500; bp.Q.value = 0.7;
    const { g, end } = envelope(c, 0.22, 0.012, 0.03, 0.22);
    src.connect(hp).connect(bp).connect(g).connect(c.destination);
    src.start(); src.stop(end);
  },
  // Iron: a few inharmonic partials, struck and left to ring.
  rim(c) {
    for (const [f, peak] of [[540, 0.16], [1380, 0.09], [2210, 0.05]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const { g, end } = envelope(c, peak, 0.004, 0, 0.32);
      o.connect(g).connect(c.destination);
      o.start(); o.stop(end);
    }
  },
  // A block: a low thud, falling.
  block(c) {
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(55, c.currentTime + 0.14);
    const { g, end } = envelope(c, 0.35, 0.005, 0.02, 0.16);
    o.connect(g).connect(c.destination);
    o.start(); o.stop(end);
  },
  // The horn at the end of a period: two square waves a hair apart, softened.
  buzzer(c) {
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
    const { g, end } = envelope(c, 0.09, 0.02, 0.75, 0.12);
    lp.connect(g).connect(c.destination);
    for (const f of [196, 197.5]) {
      const o = c.createOscillator(); o.type = 'square'; o.frequency.value = f;
      o.connect(lp); o.start(); o.stop(end);
    }
  },
  // The crowd coming up out of its seats: a slow swell of mid-band noise.
  crowd(c) {
    const src = noise(c);
    src.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
    const { g, end } = envelope(c, 0.1, 0.35, 0.7, 1.1);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(); src.stop(end);
  },
};

// Start (or wake) audio from inside a click, so the browser lets it play.
export function primeSound() {
  return !!audio();
}

export function playSound(name) {
  const c = SOUNDS[name] && audio();
  if (!c) return false;
  try { SOUNDS[name](c); return true; } catch { return false; }
}
