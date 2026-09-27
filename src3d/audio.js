// Procedural sound effects via WebAudio (no audio files).
let ctx = null, master = null, noiseBuf = null;
let volume = 0.6;

function init() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = volume;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setVolume(v) { volume = v; if (master) master.gain.value = v; }
export function unlock() { init(); if (ctx.state === 'suspended') ctx.resume(); }

function out(gain = 1, pan = 0) {
  const g = ctx.createGain(); g.gain.value = gain;
  if (pan && ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(master); }
  else g.connect(master);
  return g;
}

function noise(dest, t, dur, f0, f1, q = 0.8, type = 'bandpass', vol = 1) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest);
  s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function tone(dest, t, dur, f0, f1, type = 'sine', vol = 1) {
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
}

const GUNS = [
  (d, t) => { noise(d, t, 0.18, 3000, 300, 0.7, 'lowpass', 1.1); tone(d, t, 0.12, 180, 50, 'triangle', 0.9); noise(d, t, 0.04, 6000, 3000, 1, 'highpass', 0.6); },
  (d, t) => { noise(d, t, 0.1, 4000, 500, 0.6, 'lowpass', 0.9); tone(d, t, 0.07, 220, 70, 'square', 0.25); },
  (d, t) => { noise(d, t, 0.45, 2000, 120, 0.5, 'lowpass', 1.6); tone(d, t, 0.25, 110, 35, 'sine', 1.2); noise(d, t + 0.35, 0.06, 1800, 1200, 4, 'bandpass', 0.5); noise(d, t + 0.45, 0.05, 1400, 1000, 4, 'bandpass', 0.5); },
  (d, t) => { noise(d, t, 0.6, 5000, 150, 0.6, 'lowpass', 1.5); tone(d, t, 0.3, 140, 40, 'triangle', 1.2); noise(d, t, 0.9, 900, 200, 0.4, 'lowpass', 0.4); }
];

export const sfx = {
  gun(i, dist = 0, pan = 0) {
    if (!ctx) return;
    const g = Math.max(0.08, 1 / (1 + dist * 0.08));
    GUNS[i](out(0.55 * g, pan), ctx.currentTime);
  },
  hit(head) { if (!ctx) return; const d = out(0.35); tone(d, ctx.currentTime, 0.08, head ? 1900 : 1300, head ? 2400 : 1100, 'square', 0.35); if (head) tone(d, ctx.currentTime + 0.05, 0.12, 2600, 2600, 'sine', 0.4); },
  hurt() { if (!ctx) return; const d = out(0.5); noise(d, ctx.currentTime, 0.15, 900, 200, 1, 'lowpass', 0.8); tone(d, ctx.currentTime, 0.12, 160, 90, 'sawtooth', 0.25); },
  kill() { if (!ctx) return; const d = out(0.45), t = ctx.currentTime; tone(d, t, 0.12, 880, 880, 'triangle', 0.5); tone(d, t + 0.1, 0.25, 1320, 1320, 'triangle', 0.5); },
  death() { if (!ctx) return; const d = out(0.5), t = ctx.currentTime; tone(d, t, 0.6, 300, 60, 'sawtooth', 0.35); noise(d, t, 0.5, 600, 100, 1, 'lowpass', 0.6); },
  reload() { if (!ctx) return; const d = out(0.4), t = ctx.currentTime; noise(d, t, 0.05, 2500, 2000, 6, 'bandpass', 0.7); noise(d, t + 0.25, 0.05, 1800, 1500, 6, 'bandpass', 0.7); },
  reloaded() { if (!ctx) return; const d = out(0.4); noise(d, ctx.currentTime, 0.06, 3200, 2500, 5, 'bandpass', 0.8); },
  empty() { if (!ctx) return; noise(out(0.3), ctx.currentTime, 0.03, 4000, 3000, 8, 'bandpass', 0.6); },
  jump() { if (!ctx) return; noise(out(0.15), ctx.currentTime, 0.12, 700, 300, 1, 'lowpass', 0.6); },
  land() { if (!ctx) return; noise(out(0.25), ctx.currentTime, 0.12, 500, 80, 1, 'lowpass', 1); },
  step() { if (!ctx) return; noise(out(0.08), ctx.currentTime, 0.05, 900 + Math.random() * 400, 200, 1, 'lowpass', 0.7); },
  ability(kind) {
    if (!ctx) return;
    const d = out(0.45), t = ctx.currentTime;
    if (kind === 'dash') { noise(d, t, 0.3, 400, 3000, 1.5, 'bandpass', 1); }
    else if (kind === 'blink') { tone(d, t, 0.25, 300, 2400, 'sine', 0.6); noise(d, t, 0.2, 6000, 1500, 2, 'bandpass', 0.5); }
    else if (kind === 'shield') { tone(d, t, 0.5, 120, 480, 'sawtooth', 0.25); tone(d, t, 0.6, 240, 960, 'sine', 0.35); }
    else { for (let i = 0; i < 4; i++) tone(d, t + i * 0.05, 0.08, 800 + i * 300, 1600 + i * 300, 'square', 0.18); }
  },
  pickup() { if (!ctx) return; const d = out(0.4), t = ctx.currentTime; tone(d, t, 0.15, 520, 780, 'sine', 0.6); tone(d, t + 0.1, 0.2, 780, 1170, 'sine', 0.6); },
  click() { if (!ctx) return; tone(out(0.2), ctx.currentTime, 0.05, 1200, 900, 'square', 0.3); },
  hover() { if (!ctx) return; tone(out(0.08), ctx.currentTime, 0.03, 1800, 1800, 'sine', 0.3); },
  win() { if (!ctx) return; const d = out(0.45), t = ctx.currentTime; [523, 659, 784, 1046].forEach((f, i) => tone(d, t + i * 0.12, 0.35, f, f, 'triangle', 0.5)); },
  lose() { if (!ctx) return; const d = out(0.45), t = ctx.currentTime; [392, 330, 262].forEach((f, i) => tone(d, t + i * 0.18, 0.4, f, f * 0.98, 'triangle', 0.5)); }
};
