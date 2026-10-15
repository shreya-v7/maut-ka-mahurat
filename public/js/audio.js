/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MKM Audio Engine — everything is synthesised with the Web Audio API, so the
 *  game has a full soundtrack with zero asset files:
 *    • music:  tanpura drone + tabla theka + eerie Raag Bhairav bells
 *    • sfx:    "dhan dhan DHAAAN" stinger, slaps, ghungroo, glass shatter…
 *    • voice:  the host (Shaitaan Seth) speaks via the Web Speech API
 *
 *  Want real recordings? Drop files in /public/audio and fill AUDIO_FILES.
 *  Any key left null falls back to synthesis / text-to-speech.
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function (global) {
  'use strict';

  /** HTML5 Audio placeholders. Example: music_lobby: '/audio/lobby-loop.mp3' */
  const AUDIO_FILES = {
    music_lobby: null,
    music_tension: null,
    music_chase: null,
    sfx_stinger: null,
    sfx_death: null,
    sfx_win: null,
  };
  // Host voice-over lives in /audio/vo/<id>.m4a, pre-recorded by tools/make-voice.js
  // (ghost-processed Indian-English voice). manifest.json lists what exists;
  // anything missing falls back to the browser's text-to-speech.
  const VO_BASE = '/audio/vo/';

  const SA = 138.59; // tonic (C#3), where a tanpura is often tuned
  // Raag Bhairav: komal Re & komal Dha give that haunted-temple-at-dawn feel.
  const BHAIRAV = [1, 16 / 15, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 15 / 8, 2];

  /** Music moods: tempo, tabla theka (one bol per eighth note), layers. */
  const MOODS = {
    lobby: {
      bpm: 84,
      theka: ['dha', 'ge', 'na', 'ti', 'na', 'ka', 'dhin', 'na'], // keherwa
      tabla: 0.45,
      tanpuraEvery: 2,
      drone: 0.32,
      bells: 0.5,
      bellVol: 0.16,
    },
    tension: {
      bpm: 96,
      theka: ['ge', '-', '-', 'ti', 'ge', '-', 'na', '-'],
      tabla: 0.4,
      tanpuraEvery: 4,
      drone: 0.28,
      bells: 0.18,
      bellVol: 0.12,
      heartbeat: true,
    },
    chase: {
      bpm: 138,
      theka: ['dha', 'ti', 'ta', 'dha', 'ge', 'na', 'dha', 'ti', 'dha', 'ti', 'ta', 'dha', 'ti', 'ta', 'dhin', 'na'],
      tabla: 0.5,
      tanpuraEvery: 4,
      drone: 0.26,
      bells: 0.3,
      bellVol: 0.12,
    },
  };

  function pickVoice() {
    if (!('speechSynthesis' in global)) return null;
    const voices = global.speechSynthesis.getVoices();
    return (
      voices.find((v) => /en[-_]IN/i.test(v.lang)) ||
      voices.find((v) => /en[-_]GB/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null
    );
  }

  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.voiceEnabled = true;
      this.music = null;
      this.musicMood = null;
      this.pendingMood = null;
      this.fileMusic = null;
      this.voice = null;
      this.voIds = new Set();
      this.voCache = new Map(); // id → Promise<AudioBuffer>
      this.voSource = null;
      this.voToken = 0;
      fetch(`${VO_BASE}manifest.json`)
        .then((r) => (r.ok ? r.json() : { ids: [] }))
        .then((m) => (this.voIds = new Set(m.ids || [])))
        .catch(() => {});
      if ('speechSynthesis' in global) {
        const load = () => (this.voice = pickVoice());
        load();
        global.speechSynthesis.addEventListener?.('voiceschanged', load);
      }
    }

    /** Must be called from a user gesture (browser autoplay rules). */
    unlock() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return false;
        const ctx = (this.ctx = new AC());
        this.master = ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        const comp = ctx.createDynamicsCompressor();
        this.master.connect(comp).connect(ctx.destination);
        this.musicBus = ctx.createGain();
        this.musicBus.gain.value = 0.32;
        this.musicBus.connect(this.master);
        this.sfxBus = ctx.createGain();
        this.sfxBus.gain.value = 0.8;
        this.sfxBus.connect(this.master);
        this.reverb = ctx.createConvolver();
        this.reverb.buffer = this.impulse(2.8, 2.6);
        const wet = ctx.createGain();
        wet.gain.value = 0.35;
        this.reverb.connect(wet).connect(this.master);
        this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const ch = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      if (this.pendingMood) {
        const mood = this.pendingMood;
        this.pendingMood = null;
        this.playMusic(mood);
      }
      return true;
    }

    get ready() {
      return !!this.ctx && this.ctx.state === 'running';
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
      if (this.fileMusic) this.fileMusic.muted = muted;
      if (muted) this.stopVoice();
    }

    // ── synthesis primitives ──────────────────────────────────────────────
    impulse(seconds, decay) {
      const rate = this.ctx.sampleRate;
      const buf = this.ctx.createBuffer(2, rate * seconds, rate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
      }
      return buf;
    }

    envelope(param, t, { a = 0.005, peak = 0.3, dur = 0.3 }) {
      param.setValueAtTime(0.0001, t);
      param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a);
      param.exponentialRampToValueAtTime(0.0001, t + a + dur);
    }

    osc({ type = 'sine', f, f2, t, dur = 0.3, gain = 0.3, a = 0.005, out, wet = 0, detune = 0, filter }) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
      o.detune.value = detune;
      let node = o;
      if (filter) {
        const fl = ctx.createBiquadFilter();
        fl.type = filter.type || 'lowpass';
        fl.frequency.setValueAtTime(filter.f, t);
        if (filter.f2) fl.frequency.exponentialRampToValueAtTime(filter.f2, t + a + dur);
        fl.Q.value = filter.q || 0.7;
        o.connect(fl);
        node = fl;
      }
      const g = ctx.createGain();
      this.envelope(g.gain, t, { a, peak: gain, dur });
      node.connect(g).connect(out || this.sfxBus);
      if (wet) {
        const s = ctx.createGain();
        s.gain.value = wet;
        g.connect(s).connect(this.reverb);
      }
      o.start(t);
      o.stop(t + a + dur + 0.05);
    }

    noise({ t, dur = 0.1, gain = 0.3, type = 'bandpass', f = 1000, f2, q = 1, out, wet = 0, a = 0.002 }) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const fl = ctx.createBiquadFilter();
      fl.type = type;
      fl.frequency.setValueAtTime(f, t);
      if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
      fl.Q.value = q;
      const g = ctx.createGain();
      this.envelope(g.gain, t, { a, peak: gain, dur });
      src.connect(fl).connect(g).connect(out || this.sfxBus);
      if (wet) {
        const s = ctx.createGain();
        s.gain.value = wet;
        g.connect(s).connect(this.reverb);
      }
      src.start(t, Math.random() * 0.5);
      src.stop(t + a + dur + 0.05);
    }

    // ── instruments ───────────────────────────────────────────────────────
    /** Tabla bols. Bayan (left, bass) = ge; dayan (right, treble) = na/tin/ti. */
    tabla(bol, t, v = 0.5, out = this.musicBus) {
      const ge = () => {
        this.osc({ f: 120, f2: 58, t, dur: 0.42, gain: 0.9 * v, a: 0.004, out });
        this.noise({ t, dur: 0.03, gain: 0.25 * v, type: 'lowpass', f: 220, out });
      };
      const na = () => {
        this.osc({ type: 'triangle', f: 560, t, dur: 0.22, gain: 0.35 * v, out });
        this.osc({ f: 1120, t, dur: 0.1, gain: 0.12 * v, out });
        this.noise({ t, dur: 0.02, gain: 0.25 * v, f: 3200, q: 2, out });
      };
      const tin = () => {
        this.osc({ f: 560, t, dur: 0.6, gain: 0.3 * v, out, wet: 0.2 });
        this.osc({ f: 1680, t, dur: 0.25, gain: 0.07 * v, out });
      };
      const ti = () => {
        this.noise({ t, dur: 0.04, gain: 0.3 * v, f: 2200, q: 1.2, out });
        this.osc({ f: 420, t, dur: 0.05, gain: 0.15 * v, out });
      };
      switch (bol) {
        case 'dha': ge(); na(); break;
        case 'dhin': ge(); tin(); break;
        case 'ge': ge(); break;
        case 'na': case 'ta': na(); break;
        case 'tin': tin(); break;
        case 'ti': case 'ka': ti(); break;
        default: break; // '-' = rest
      }
    }

    /** Tanpura string: buzzy detuned saws through a closing low-pass (jawari). */
    pluck(f, t, dur, v) {
      const out = this.musicBus;
      this.osc({ type: 'sawtooth', f, t, dur, gain: 0.16 * v, a: 0.01, out, wet: 0.3, filter: { f: 2400, f2: 420 } });
      this.osc({ type: 'sawtooth', f: f * 1.003, t, dur, gain: 0.1 * v, a: 0.01, out, filter: { f: 1800, f2: 380 } });
      this.osc({ f: f * 2, t, dur: dur * 0.6, gain: 0.05 * v, out });
    }

    /** Santoor-ish bell with inharmonic partials, drenched in reverb. */
    bell(f, t, v = 0.3, dur = 1.6, out = this.sfxBus) {
      this.osc({ f, t, dur, gain: 0.3 * v, a: 0.003, out, wet: 0.6 });
      this.osc({ f: f * 2.76, t, dur: dur * 0.5, gain: 0.12 * v, out, wet: 0.6 });
      this.osc({ f: f * 5.4, t, dur: dur * 0.25, gain: 0.06 * v, out, wet: 0.6 });
    }

    timpani(t, v = 1) {
      this.osc({ f: 95, f2: 48, t, dur: 1.1, gain: 0.7 * v, a: 0.006, wet: 0.4 });
      this.noise({ t, dur: 0.12, gain: 0.3 * v, type: 'lowpass', f: 400 });
    }

    /** Shehnai-like reed: saw + vibrato through a nasal band-pass. */
    shehnai(f, t, dur, v = 0.25) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5.6;
      const depth = ctx.createGain();
      depth.gain.value = f * 0.012;
      lfo.connect(depth).connect(o.frequency);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 1.3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v, t + 0.05);
      g.gain.setValueAtTime(v, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(bp).connect(g).connect(this.sfxBus);
      const s = ctx.createGain();
      s.gain.value = 0.4;
      g.connect(s).connect(this.reverb);
      o.start(t);
      lfo.start(t);
      o.stop(t + dur + 0.05);
      lfo.stop(t + dur + 0.05);
    }

    /** The TV-serial "dhan… dhan… DHAAAN": three brass stabs + timpani. */
    dhanDhanDhaan(t) {
      const minor = (root) => [root, root * 1.189, root * 1.498, root * 2];
      const hits = [
        [0, 146.83, 0.32, 0.11],
        [0.4, 146.83, 0.32, 0.11],
        [0.8, 110, 1.9, 0.15],
      ];
      hits.forEach(([dt, root, dur, vol], i) => {
        for (const f of minor(root)) {
          this.osc({ type: 'sawtooth', f, t: t + dt, dur, gain: vol, a: 0.008, wet: 0.5, filter: { f: 3200, f2: i === 2 ? 300 : 700 } });
        }
        this.timpani(t + dt, i === 2 ? 1 : 0.7);
      });
    }

    // ── sound effects ─────────────────────────────────────────────────────
    sfx(name) {
      if (this.muted) return;
      const file = AUDIO_FILES[`sfx_${name}`];
      if (file) {
        this.playFile(file);
        return;
      }
      if (!this.ready) return;
      const t = this.ctx.currentTime + 0.01;
      switch (name) {
        case 'tick':
          this.osc({ f: 1500, t, dur: 0.04, gain: 0.18 });
          break;
        case 'tock':
          this.osc({ type: 'square', f: 880, t, dur: 0.07, gain: 0.12, filter: { f: 1800 } });
          this.tabla('ge', t, 0.6, this.sfxBus);
          break;
        case 'join': // ghungroo shake + a bell
          for (let i = 0; i < 6; i++) this.noise({ t: t + i * 0.035, dur: 0.05, gain: 0.12, type: 'highpass', f: 6500 });
          this.bell(SA * 6, t + 0.05, 0.5, 1.2);
          break;
        case 'lock':
          this.tabla('na', t, 0.8, this.sfxBus);
          break;
        case 'correct':
          this.bell(SA * 4, t, 0.8, 1.4);
          this.bell(SA * 6, t + 0.12, 0.7, 1.6);
          break;
        case 'wrong':
          this.osc({ type: 'sawtooth', f: 98, t, dur: 0.5, gain: 0.18, filter: { f: 900 } });
          this.osc({ type: 'sawtooth', f: 104, t, dur: 0.5, gain: 0.18, filter: { f: 900 } });
          break;
        case 'stinger':
          this.dhanDhanDhaan(t);
          break;
        case 'death':
          this.timpani(t, 1);
          this.osc({ f: 160, f2: 28, t, dur: 1.3, gain: 0.5, wet: 0.5 });
          this.noise({ t, dur: 1.4, gain: 0.25, type: 'lowpass', f: 320, f2: 80, wet: 0.4 });
          break;
        case 'shatter':
          for (let i = 0; i < 12; i++) {
            this.noise({ t: t + Math.random() * 0.35, dur: 0.03 + Math.random() * 0.1, gain: 0.22, f: 3000 + Math.random() * 6000, q: 8 });
          }
          this.osc({ f: 2600, t, dur: 0.4, gain: 0.08, wet: 0.6 });
          break;
        case 'whoosh':
          this.noise({ t, dur: 0.5, gain: 0.25, f: 300, f2: 2800, q: 1.5 });
          break;
        case 'slap': // THAPPAD!
          this.noise({ t, dur: 0.07, gain: 0.8, type: 'highpass', f: 1200 });
          this.osc({ f: 190, f2: 90, t, dur: 0.09, gain: 0.5 });
          break;
        case 'maa': // you slapped Maa. Shame.
          this.osc({ type: 'triangle', f: 330, f2: 150, t, dur: 0.7, gain: 0.3 });
          this.osc({ type: 'sawtooth', f: 98, t: t + 0.05, dur: 0.5, gain: 0.12, filter: { f: 700 } });
          break;
        case 'possess':
          this.osc({ f: 220, f2: 880, t, dur: 1, gain: 0.2, wet: 0.9 });
          this.osc({ f: 226, f2: 900, t, dur: 1, gain: 0.2, wet: 0.9 });
          this.noise({ t, dur: 1, gain: 0.15, f: 600, f2: 3000, q: 6, wet: 0.7 });
          break;
        case 'revive':
          [1, 5 / 4, 3 / 2, 2].forEach((r, i) => this.bell(SA * 4 * r, t + i * 0.09, 0.6, 1.4));
          break;
        case 'step':
          this.tabla('ti', t, 0.9, this.sfxBus);
          break;
        case 'action': // clapperboard
          this.noise({ t, dur: 0.05, gain: 0.9, type: 'highpass', f: 1800 });
          this.tabla('dha', t + 0.02, 0.9, this.sfxBus);
          break;
        case 'win': {
          // shehnai fanfare in Raag Yaman, with a tabla roll
          const yaman = [1, 9 / 8, 5 / 4, 45 / 32, 3 / 2, 2];
          yaman.forEach((r, i) => this.shehnai(SA * 2 * r, t + i * 0.16, 0.22, 0.2));
          this.shehnai(SA * 4, t + yaman.length * 0.16, 1.6, 0.22);
          for (let i = 0; i < 10; i++) this.tabla(i % 2 ? 'na' : 'dha', t + i * 0.08, 0.6, this.sfxBus);
          break;
        }
        default:
          break;
      }
    }

    // ── background music ──────────────────────────────────────────────────
    playMusic(mood) {
      if (this.musicMood === mood && (this.music || this.fileMusic)) return;
      this.stopMusic();
      if (!mood) return;
      const file = AUDIO_FILES[`music_${mood}`];
      if (file) {
        this.musicMood = mood;
        this.fileMusic = this.playFile(file, { loop: true, volume: 0.45 });
        return;
      }
      if (!this.ctx) {
        this.pendingMood = mood; // starts once unlock() is called
        return;
      }
      this.musicMood = mood;
      const cfg = MOODS[mood];
      this.music = { cfg, step: 0, next: this.ctx.currentTime + 0.12 };
      this.music.timer = setInterval(() => this.scheduleMusic(), 40);
    }

    stopMusic() {
      if (this.music) clearInterval(this.music.timer);
      this.music = null;
      this.musicMood = null;
      this.pendingMood = null;
      if (this.fileMusic) {
        this.fileMusic.pause();
        this.fileMusic = null;
      }
    }

    /** Look-ahead scheduler: queue notes ~150ms ahead so timing stays tight. */
    scheduleMusic() {
      const m = this.music;
      if (!m || !this.ready) return;
      const stepDur = 60 / m.cfg.bpm / 2;
      const horizon = this.ctx.currentTime + 0.15;
      if (m.next < this.ctx.currentTime - 0.5) m.next = this.ctx.currentTime + 0.05; // tab was asleep
      while (m.next < horizon) {
        this.musicStep(m.cfg, m.step, m.next);
        m.next += stepDur;
        m.step += 1;
      }
    }

    musicStep(cfg, step, t) {
      this.tabla(cfg.theka[step % cfg.theka.length], t, cfg.tabla);
      if (step % cfg.tanpuraEvery === 0) {
        const strings = [0.75, 1, 1, 0.5]; // Pa, Sa, Sa, low Sa
        this.pluck(SA * strings[(step / cfg.tanpuraEvery) % 4], t, 1.8, cfg.drone);
      }
      if (step % 4 === 2 && Math.random() < cfg.bells) {
        const r = BHAIRAV[Math.floor(Math.random() * BHAIRAV.length)];
        this.bell(SA * 4 * r, t, cfg.bellVol, 2.2, this.musicBus);
      }
      if (cfg.heartbeat && step % 8 === 0) {
        this.tabla('ge', t, 0.7);
        this.tabla('ge', t + 0.2, 0.45);
      }
    }

    // ── files & voice ─────────────────────────────────────────────────────
    playFile(url, { loop = false, volume = 0.9, onend } = {}) {
      try {
        const el = new Audio(url);
        el.loop = loop;
        el.volume = volume;
        el.muted = this.muted;
        if (onend) el.addEventListener('ended', onend, { once: true });
        el.play().catch(() => onend && onend());
        return el;
      } catch {
        if (onend) onend();
        return null;
      }
    }

    duck(on) {
      if (this.musicBus) this.musicBus.gain.setTargetAtTime(on ? 0.1 : 0.32, this.ctx.currentTime, 0.15);
    }

    /** Fetch + decode a recorded line once; later calls reuse the buffer. */
    loadVoice(id) {
      if (!this.ctx || !this.voIds.has(id)) return null;
      if (!this.voCache.has(id)) {
        const p = fetch(`${VO_BASE}${id}.m4a`)
          .then((r) => r.arrayBuffer())
          .then((ab) => new Promise((res, rej) => this.ctx.decodeAudioData(ab, res, rej)));
        p.catch(() => this.voCache.delete(id));
        this.voCache.set(id, p);
      }
      return this.voCache.get(id);
    }

    /** Warm the cache (e.g. every narration line right after unlock). */
    preloadVoices(ids) {
      ids.forEach((id) => this.loadVoice(id));
    }

    /**
     * The host speaks: the pre-recorded ghost voice when `id` has a file,
     * otherwise browser text-to-speech (Indian-English voice, low pitch).
     */
    say(text, { id, rate = 0.97, pitch = 0.62, onend } = {}) {
      this.stopVoice();
      const token = ++this.voToken;
      if (id && this.voIds.has(id) && !this.muted && this.voiceEnabled) {
        const pending = this.loadVoice(id);
        if (pending) {
          pending
            .then((buf) => {
              if (token !== this.voToken || !this.ready) return; // superseded or muted meanwhile
              const src = this.ctx.createBufferSource();
              src.buffer = buf;
              src.connect(this.master);
              src.onended = () => {
                if (this.voSource === src) this.voSource = null;
                this.duck(false);
                if (onend) onend();
              };
              this.voSource = src;
              this.duck(true);
              src.start();
            })
            .catch(() => onend && onend());
          return;
        }
      }
      if (!this.voiceEnabled || this.muted || !('speechSynthesis' in global)) {
        if (onend) setTimeout(onend, 0);
        return;
      }
      try {
        const synth = global.speechSynthesis;
        synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        const v = this.voice || pickVoice();
        if (v) {
          u.voice = v;
          u.lang = v.lang;
        } else u.lang = 'en-IN';
        u.rate = rate;
        u.pitch = pitch;
        u.onstart = () => this.duck(true);
        u.onend = u.onerror = () => {
          this.duck(false);
          if (onend) onend();
        };
        synth.speak(u);
      } catch {
        if (onend) onend();
      }
    }

    stopVoice() {
      if (this.voSource) {
        try {
          this.voSource.onended = null;
          this.voSource.stop();
        } catch {
          /* already stopped */
        }
        this.voSource = null;
      }
      try {
        global.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
      this.duck(false);
    }
  }

  global.MKMAudio = { AudioEngine, AUDIO_FILES };
})(window);
