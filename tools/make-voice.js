#!/usr/bin/env node
'use strict';
/**
 * Pre-records Shaitaan Seth's ghostly, Indian-accented voice.
 *
 *   node tools/make-voice.js                 # render anything missing
 *   node tools/make-voice.js --force         # re-render everything
 *   node tools/make-voice.js --only intro_0  # one line (handy while tuning)
 *   node tools/make-voice.js --voice Rishi   # pick another en_IN voice (`say -v '?' | grep en_IN`)
 *
 * macOS only: `say` speaks the line, this script turns it into a ghost
 * (pure-JS DSP, no dependencies), then `afconvert` encodes AAC.
 * Output: public/audio/vo/<id>.m4a + manifest.json. Commit the results;
 * the server just serves them as static files, so hosting needs no macOS.
 *
 * The ghost chain:
 *   slowed + deepened delivery ─┬─ dry voice
 *                               ├─ sub-octave "demon" layer (delay-line pitch shifter)
 *                               ├─ breathy whisper (noise riding the voice's envelope)
 *                               └─ spectral chorus (wobbling short delay)
 *   → cave echo → haunted-hall reverb (Freeverb) → soft clip → normalise
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const LINES = require('../public/js/narration.js');
const Q = require('../data/questions.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const VOICE = opt('--voice', 'Aman');
const RATE = Number(opt('--rate', 158)); // words per minute, before the ghostly slow-down
const FORCE = args.includes('--force');
const ONLY = opt('--only', null);
const SR = 24000;
const OUT = path.join(__dirname, '..', 'public', 'audio', 'vo');

// ── jobs: every narration line + every unique question ─────────────────────
function speakable(text) {
  return text
    .replace(/…/g, '...')
    .replace(/[“”]/g, '"')
    .replace(/₹/g, 'rupees ')
    .replace(/\s+/g, ' ')
    .trim();
}

const jobs = [];
for (const [key, variants] of Object.entries(LINES)) {
  variants.forEach((line, i) => jobs.push({ id: `${key}_${i}`, text: line.vo }));
}
const seen = new Set();
for (const q of [...Q.main, ...Q.final]) {
  const id = Q.voiceId(q.q);
  if (seen.has(id)) continue;
  seen.add(id);
  jobs.push({ id, text: q.q });
}

// ── WAV I/O ────────────────────────────────────────────────────────────────
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.toString('ascii', 0, 4) !== 'RIFF') throw new Error(`${file} is not a WAV`);
  let p = 12;
  let fmt = null;
  let data = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4);
    const size = Math.min(b.readUInt32LE(p + 4), b.length - p - 8);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    else if (id === 'data') data = b.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data || fmt.bits !== 16) throw new Error(`${file}: expected 16-bit PCM`);
  const n = Math.floor(data.length / 2 / fmt.channels);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = data.readInt16LE(i * fmt.channels * 2) / 32768;
  return { samples, sr: fmt.sr };
}

function writeWav(file, samples, sr) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + samples.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, b);
}

// ── DSP building blocks ────────────────────────────────────────────────────
const lerp = (x, i) => {
  const i0 = Math.floor(i);
  if (i0 < 0 || i0 + 1 >= x.length) return 0;
  const f = i - i0;
  return x[i0] * (1 - f) + x[i0 + 1] * f;
};

/** Play back slower (factor < 1): lower pitch AND a more deliberate, ominous delivery. */
function resample(x, factor) {
  const y = new Float32Array(Math.floor(x.length / factor));
  for (let i = 0; i < y.length; i++) y[i] = lerp(x, i * factor);
  return y;
}

/** Delay-line pitch shifter: two cross-faded read heads drifting through a window. Keeps duration. */
function pitchShift(x, ratio, sr, winMs) {
  const W = Math.round((sr * winMs) / 1000);
  const rate = (1 - ratio) / W;
  const y = new Float32Array(x.length);
  let ph = 0;
  for (let n = 0; n < x.length; n++) {
    ph += rate;
    ph -= Math.floor(ph);
    const ph2 = (ph + 0.5) % 1;
    y[n] = Math.sin(Math.PI * ph) * lerp(x, n - ph * W) + Math.sin(Math.PI * ph2) * lerp(x, n - ph2 * W);
  }
  return y;
}

/** RBJ biquad; returns a stateful per-sample function. */
function biquad(type, f, q, sr) {
  const w = (2 * Math.PI * f) / sr;
  const c = Math.cos(w);
  const a = Math.sin(w) / (2 * q);
  let b0;
  let b1;
  let b2;
  if (type === 'lowpass') [b0, b1, b2] = [(1 - c) / 2, 1 - c, (1 - c) / 2];
  else if (type === 'highpass') [b0, b1, b2] = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
  else [b0, b1, b2] = [a, 0, -a]; // bandpass
  const a0 = 1 + a;
  const [B0, B1, B2, A1, A2] = [b0 / a0, b1 / a0, b2 / a0, (-2 * c) / a0, (1 - a) / a0];
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x) => {
    const y = B0 * x + B1 * x1 + B2 * x2 - A1 * y1 - A2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    return y;
  };
}
const run = (x, fn) => x.map((v) => fn(v));

/** Breath: band-limited noise that follows the voice's loudness. */
function whisper(x, sr) {
  const att = Math.exp(-1 / (sr * 0.005));
  const rel = Math.exp(-1 / (sr * 0.08));
  const bp = biquad('bandpass', 3600, 0.8, sr);
  const hp = biquad('highpass', 1400, 0.7, sr);
  const y = new Float32Array(x.length);
  let env = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    env = a > env ? att * env + (1 - att) * a : rel * env + (1 - rel) * a;
    y[i] = bp(hp(Math.random() * 2 - 1)) * env * 3;
  }
  return y;
}

/** Slowly wobbling short delay: the "not quite of this world" shimmer. */
function chorus(x, sr, baseMs = 12, depthMs = 5, hz = 0.23) {
  const y = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    const d = ((baseMs + depthMs * Math.sin((2 * Math.PI * hz * n) / sr)) * sr) / 1000;
    y[n] = lerp(x, n - d);
  }
  return y;
}

/** Cave echo with a darkening feedback loop. Returns dry + echoes. */
function echo(x, sr, ms, feedback) {
  const d = Math.round((sr * ms) / 1000);
  const lp = biquad('lowpass', 2200, 0.7, sr);
  const y = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) y[n] = x[n] + (n >= d ? lp(y[n - d]) * feedback : 0);
  return y;
}

/** Freeverb (Jezar's classic): 8 damped combs into 4 all-passes. */
function reverb(x, sr, room = 0.87, damp = 0.32, wet = 0.9) {
  const k = sr / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((d) => ({ buf: new Float32Array(Math.round(d * k)), i: 0, z: 0 }));
  const alls = [556, 441, 341, 225].map((d) => ({ buf: new Float32Array(Math.round(d * k)), i: 0 }));
  const y = new Float32Array(x.length);
  for (let n = 0; n < x.length; n++) {
    const input = x[n] * 0.015;
    let out = 0;
    for (const c of combs) {
      const o = c.buf[c.i];
      c.z = o * (1 - damp) + c.z * damp;
      c.buf[c.i] = input + c.z * room;
      c.i = (c.i + 1) % c.buf.length;
      out += o;
    }
    for (const a of alls) {
      const bo = a.buf[a.i];
      a.buf[a.i] = out + bo * 0.5;
      a.i = (a.i + 1) % a.buf.length;
      out = bo - out;
    }
    y[n] = x[n] + out * wet * 3;
  }
  return y;
}

function ghostify(raw, sr) {
  const slow = resample(raw, 0.9); // ≈ −1.8 semitones, 11% slower
  const x = new Float32Array(slow.length + Math.round(sr * 2.4)); // room for the tails
  x.set(slow);

  const lowpass = biquad('lowpass', 850, 0.7, sr);
  const demon = run(pitchShift(x, 0.52, sr, 70), lowpass);
  const breath = whisper(x, sr);
  const shimmer = chorus(x, sr);

  const mix = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) mix[i] = x[i] * 0.85 + shimmer[i] * 0.32 + demon[i] * 0.5 + breath[i] * 0.09;

  const rumbleCut = biquad('highpass', 75, 0.7, sr);
  const wet = reverb(echo(run(mix, rumbleCut), sr, 330, 0.28), sr);

  // soft clip → normalise → trim trailing silence → fades
  let peak = 1e-6;
  for (let i = 0; i < wet.length; i++) {
    wet[i] = Math.tanh(wet[i] * 1.3);
    peak = Math.max(peak, Math.abs(wet[i]));
  }
  let end = wet.length - 1;
  while (end > 0 && Math.abs(wet[end]) / peak < 0.003) end--;
  const y = wet.slice(0, Math.min(wet.length, end + Math.round(sr * 0.15)));
  const gain = 0.9 / peak;
  const fadeIn = Math.round(sr * 0.012);
  const fadeOut = Math.round(sr * 0.25);
  for (let i = 0; i < y.length; i++) {
    let g = gain;
    if (i < fadeIn) g *= i / fadeIn;
    if (i > y.length - fadeOut) g *= (y.length - i) / fadeOut;
    y[i] *= g;
  }
  return y;
}

// ── main ───────────────────────────────────────────────────────────────────
if (process.platform !== 'darwin') {
  console.error('make-voice needs macOS (`say` + `afconvert`). The generated files are committed, so you only need this to change lines.');
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mkm-vo-'));
const todo = jobs.filter((j) => !ONLY || j.id === ONLY);
let made = 0;
let totalSec = 0;
const t0 = Date.now();

for (const job of todo) {
  const out = path.join(OUT, `${job.id}.m4a`);
  if (!FORCE && !ONLY && fs.existsSync(out)) continue;
  const rawWav = path.join(tmp, `${job.id}.raw.wav`);
  const fxWav = path.join(tmp, `${job.id}.fx.wav`);
  execFileSync('say', ['-v', VOICE, '-r', String(RATE), '--file-format=WAVE', `--data-format=LEI16@${SR}`, '-o', rawWav, speakable(job.text)]);
  const { samples, sr } = readWav(rawWav);
  const y = ghostify(samples, sr);
  writeWav(fxWav, y, sr);
  execFileSync('afconvert', [fxWav, out, '-f', 'm4af', '-d', 'aac', '-b', '48000']);
  totalSec += y.length / sr;
  made += 1;
  process.stdout.write(`  ${job.id.padEnd(16)} ${(y.length / sr).toFixed(1)}s  ${job.text.slice(0, 60)}\n`);
}

fs.rmSync(tmp, { recursive: true, force: true });
const ids = jobs.map((j) => j.id).filter((id) => fs.existsSync(path.join(OUT, `${id}.m4a`)));
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ voice: VOICE, ids }, null, 0));
console.log(`\n👻 ${made} line(s) recorded (${totalSec.toFixed(0)}s of audio) in ${((Date.now() - t0) / 1000).toFixed(1)}s. Manifest lists ${ids.length}/${jobs.length}.`);
