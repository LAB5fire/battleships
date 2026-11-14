// Tiny synthesized sound effects (Web Audio, no files needed).
import { session } from './session.js';

let ctx = null;
let master = null;
let muted = session.muted;
let lastPlay = {};

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.55;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture.
window.addEventListener('pointerdown', () => { if (!muted) audio(); }, { once: true });

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  session.muted = v;
}

function noise(ac, seconds) {
  const buffer = ac.createBuffer(1, Math.max(1, Math.floor(ac.sampleRate * seconds)), ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ac.createBufferSource();
  src.buffer = buffer;
  return src;
}

function env(ac, gainNode, t, attack, decay, peak) {
  gainNode.gain.setValueAtTime(0.0001, t);
  gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(freq, { type = 'sine', dur = 0.18, peak = 0.3, to = null, delay = 0 } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
  env(ac, g, t, 0.01, dur, peak);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function burstNoise({ dur = 0.4, filter = 900, type = 'lowpass', peak = 0.6, sweepTo = null, delay = 0 } = {}) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + delay;
  const src = noise(ac, dur + 0.1);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(filter, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ac.createGain();
  env(ac, g, t, 0.005, dur, peak);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.1);
}

const SOUNDS = {
  click: () => tone(660, { type: 'triangle', dur: 0.05, peak: 0.12 }),
  coin: () => { tone(988, { type: 'square', dur: 0.08, peak: 0.08 }); tone(1319, { type: 'square', dur: 0.16, peak: 0.08, delay: 0.07 }); },
  splash: () => burstNoise({ dur: 0.35, filter: 2400, type: 'bandpass', peak: 0.35, sweepTo: 600 }),
  hit: () => { burstNoise({ dur: 0.5, filter: 1100, peak: 0.8, sweepTo: 120 }); tone(90, { dur: 0.3, peak: 0.5, to: 40 }); },
  big: () => { burstNoise({ dur: 1.4, filter: 700, peak: 1, sweepTo: 60 }); tone(60, { dur: 1, peak: 0.7, to: 25 }); },
  sunk: () => { burstNoise({ dur: 0.9, filter: 900, peak: 0.9, sweepTo: 80 }); tone(220, { type: 'sawtooth', dur: 0.8, peak: 0.12, to: 55, delay: 0.1 }); },
  block: () => { tone(1200, { type: 'triangle', dur: 0.25, peak: 0.2, to: 500 }); tone(1800, { type: 'sine', dur: 0.2, peak: 0.1, delay: 0.03 }); },
  ping: () => { tone(1400, { dur: 0.6, peak: 0.2 }); tone(1400, { dur: 0.5, peak: 0.06, delay: 0.35 }); },
  scan: () => tone(500, { type: 'sine', dur: 0.5, peak: 0.12, to: 1500 }),
  plane: () => burstNoise({ dur: 1.3, filter: 300, type: 'bandpass', peak: 0.35, sweepTo: 1600 }),
  torpedo: () => burstNoise({ dur: 0.9, filter: 400, type: 'lowpass', peak: 0.4, sweepTo: 900 }),
  zap: () => { tone(1800, { type: 'sawtooth', dur: 0.12, peak: 0.12, to: 300 }); tone(1500, { type: 'sawtooth', dur: 0.12, peak: 0.1, to: 200, delay: 0.1 }); },
  fire: () => burstNoise({ dur: 0.7, filter: 3000, type: 'highpass', peak: 0.2 }),
  repair: () => { tone(700, { type: 'triangle', dur: 0.08, peak: 0.15 }); tone(900, { type: 'triangle', dur: 0.08, peak: 0.15, delay: 0.1 }); tone(1100, { type: 'triangle', dur: 0.12, peak: 0.15, delay: 0.2 }); },
  turn: () => { tone(660, { type: 'triangle', dur: 0.12, peak: 0.2 }); tone(990, { type: 'triangle', dur: 0.2, peak: 0.2, delay: 0.12 }); },
  error: () => tone(180, { type: 'square', dur: 0.15, peak: 0.1 }),
  chat: () => tone(1046, { type: 'sine', dur: 0.12, peak: 0.12 }),
  win: () => [523, 659, 784, 1046].forEach((f, k) => tone(f, { type: 'triangle', dur: 0.3, peak: 0.2, delay: k * 0.13 })),
  lose: () => [392, 330, 262, 196].forEach((f, k) => tone(f, { type: 'triangle', dur: 0.35, peak: 0.18, delay: k * 0.16 })),
};

export function sfx(name) {
  if (muted || !SOUNDS[name]) return;
  const now = performance.now();
  if (lastPlay[name] && now - lastPlay[name] < 45) return; // avoid stacking in area blasts
  lastPlay[name] = now;
  try { SOUNDS[name](); } catch { /* audio is optional */ }
}
