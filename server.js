'use strict';
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *   MAUT KA MAHURAT  (मौत का मुहूर्त)  —  "The Auspicious Hour of Death"
 *   A Bollywood trivia murder party.   server.js = the authoritative brain.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  The fiction
 *  ───────────
 *  Shaitaan Seth, a long-dead film producer, haunts the abandoned Kaali Haveli
 *  Studios. Tonight he is shooting his final picture, and the guests are the
 *  cast. Answer his filmy trivia correctly and you live. Answer wrong and you
 *  are dragged into "The Climax Scene" (the killing floor), where the slowest
 *  slapper becomes a Bhoot (ghost). Bhoots keep playing and, in the final
 *  "Climax Chase", they can steal a living player's body.
 *
 *  Architecture
 *  ────────────
 *  • Express serves /public (host theatre screen + phone controller).
 *  • Socket.io carries every message. The server is the single source of
 *    truth: clients send INTENTS (join, answer, minigame result) and receive
 *    full SNAPSHOTS of what they should show (`host:state`, `player:state`).
 *  • Snapshots (never deltas) make reconnection trivial: a phone that drops
 *    out and comes back gets the current snapshot and simply re-renders.
 *  • Every snapshot carries `phaseKey` (bumps on each phase change) and
 *    `remainingMs`, so clients can tell "new scene" from "same scene, update"
 *    and run their own countdowns without clock-sync issues.
 *
 *  Phase machine (one per room)
 *  ────────────────────────────
 *
 *   LOBBY → INTRO → QUESTION → REVEAL ──(anyone living got it wrong?)──┐
 *                      ▲          │ no                                 ▼
 *                      │          │                    KF_INTRO → MINIGAME → KF_RESULT
 *                      │          ▼                                         │
 *                      └──── more rounds & someone alive? ◄─────────────────┘
 *                                 │ no
 *                                 ▼
 *              FINAL_INTRO → FINAL_QUESTION ⇄ FINAL_REVEAL → GAME_OVER → (LOBBY)
 */

const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const QUESTIONS = require('./data/questions');

// ─────────────────────────────────────────────────────────────────── config ──
const portArg = process.argv.indexOf('--port');
const PORT = Number(portArg > 0 ? process.argv[portArg + 1] : process.env.PORT) || 3000;
/** Multiplies every phase timer. TIME_SCALE=0.05 makes bot simulations fly. */
const TIME_SCALE = Number(process.env.TIME_SCALE) > 0 ? Number(process.env.TIME_SCALE) : 1;
const MIN_PLAYERS = Number(process.env.MIN_PLAYERS) || 2;
const MAX_PLAYERS = 8;
/** Set when running behind a tunnel / deployed host so the QR code points there. */
// Render sets RENDER_EXTERNAL_URL automatically, so the QR code points at the live site.
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '') || null;

/** Phase lengths in ms (before TIME_SCALE). */
const DURATION = {
  INTRO: 15500, // film leader + Shaitaan Seth's opening monologue
  QUESTION: 15000,
  REVEAL: 7000,
  KF_INTRO: 7000,
  MG_COUNTDOWN: 3500, // "Lights… Camera… THAPPAD!"
  MG_PLAY: 24000, // hard cap for the slap game itself
  KF_RESULT: 8000,
  FINAL_INTRO: 12500,
  FINAL_QUESTION: 8000,
  FINAL_REVEAL: 5000,
};

const RULES = {
  POINTS_CORRECT: 1000,
  SPEED_BONUS: 500, // scaled by how much time was left when you answered
  ROUND_OPTIONS: [4, 6, 8],
  DEFAULT_ROUNDS: 6,

  // ── Thappad Reflex (the Climax Scene mini-game) ──
  MG_TARGETS: 5, // Shaitaans to slap
  MG_DECOYS: 2, // Maa appearances you must NOT slap
  MG_PAR_MS: 2900, // a lone doomed player must beat this total
  MG_MIN_REACTION_MS: 110, // anything faster is physically implausible → clamped
  MG_MISS_MS: 2000, // an un-slapped Shaitaan costs this much

  // ── Climax Chase (final round) ──
  TRACK_LENGTH: 12, // reaching space 12 = escaping through the studio gate
  LIVING_START: 3,
  LEADER_BONUS: 1, // top-scoring living player starts one step ahead
  GHOST_START: 0,
  LIVING_STEP: 1,
  GHOST_STEP: 2, // bhoots are fast…
  KNOCKBACK: 2, // …and whoever gets possessed is flung back
  MAX_FINAL_QUESTIONS: 14,
};

const LIFETIME = {
  LOBBY_DROP_MS: 30_000, // a phone that leaves the lobby and doesn't return is removed
  HOST_GONE_MS: 10 * 60_000, // the room dies if the host screen is gone this long
  IDLE_ROOM_MS: 3 * 60 * 60_000,
  SWEEP_MS: 5_000,
};

/** Bollywood stock characters, assigned at random on join. */
const AVATARS = [
  { id: 'hero', emoji: '😎', role: 'Hero No. 1', color: '#f4c95d' },
  { id: 'item', emoji: '💃', role: 'Item Number', color: '#ff4f9a' },
  { id: 'villain', emoji: '🦹', role: 'Khalnayak', color: '#e01e37' },
  { id: 'disco', emoji: '🕺', role: 'Disco Dancer', color: '#a463f2' },
  { id: 'inspector', emoji: '👮', role: 'Inspector Saab', color: '#4ea8ff' },
  { id: 'comic', emoji: '🤡', role: 'Comic Relief', color: '#2ed3b7' },
  { id: 'daku', emoji: '🧔', role: 'The Daku', color: '#d9822b' },
  { id: 'dulhan', emoji: '👰', role: 'Runaway Dulhan', color: '#ff7a7a' },
  { id: 'baap', emoji: '🤵', role: 'Rich Baap', color: '#c9d1d9' },
  { id: 'tantrik', emoji: '🧙', role: 'Tantrik Baba', color: '#7bd389' },
];

// ────────────────────────────────────────────────────────────────── helpers ──
const scaled = (ms) => Math.max(40, Math.round(ms * TIME_SCALE));
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const randInt = (min, max) => crypto.randomInt(min, max + 1); // inclusive
const newToken = () => crypto.randomBytes(16).toString('hex');

/** Fisher–Yates with a CSPRNG (keeps question order unguessable). */
function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Trim, collapse whitespace, strip control chars, cap length. */
function cleanName(raw) {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
}

/** Consonants only → codes never spell real (or rude) words. */
const CODE_LETTERS = 'BCDFGHJKLMNPQRSTVWXZ';
function makeRoomCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_LETTERS[crypto.randomInt(CODE_LETTERS.length)];
    if (!rooms.has(code)) return code;
  }
}

/** First non-internal IPv4, so phones on the same Wi-Fi can reach us. */
function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) {
      if ((i.family === 'IPv4' || i.family === 4) && !i.internal) return i.address;
    }
  }
  return 'localhost';
}

/** Turn an authored question into a playable one with shuffled options. */
function prepareQuestion(raw) {
  const options = shuffle([raw.a, ...raw.wrong]);
  return { category: raw.cat, text: raw.q, options, answerIndex: options.indexOf(raw.a), vo: QUESTIONS.voiceId(raw.q) };
}

const byScoreDesc = (a, b) => b.score - a.score;

// ═════════════════════════════════════════════════════════════════════ Room ══
/** @type {Map<string, Room>} */
const rooms = new Map();

class Room {
  constructor(io, code) {
    this.io = io;
    this.code = code;
    this.hostToken = newToken();
    this.hostSocketId = null;
    this.hostConnected = false;
    this.hostLeftAt = null;
    this.joinUrl = ''; // shown on screen (no query string)
    this.joinLink = ''; // encoded in the QR (includes ?room=CODE)
    this.qr = null;
    this.lastActivity = Date.now();

    /** @type {Map<string, object>} insertion order = join order */
    this.players = new Map();
    this.settings = { rounds: RULES.DEFAULT_ROUNDS };

    this.phase = 'LOBBY';
    this.phaseKey = 0;
    this.phaseEndsAt = null;
    this.phaseDuration = 0;
    this.timer = null;

    this.decks = { main: shuffle(QUESTIONS.main), final: shuffle(QUESTIONS.final) };
    this.resetGameState();
  }

  resetGameState() {
    this.round = 0;
    this.question = null;
    this.questionOpenedAt = 0;
    this.questionDuration = 0;
    this.answers = new Map(); // playerId → { choice, at }
    this.reveal = null;
    this.doomed = []; // ids sent to the Climax Scene this round
    this.minigame = null;
    this.kfResult = null;
    this.final = null;
    this.gameOver = null;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  // ── roster helpers ──────────────────────────────────────────────────────
  get playerList() {
    return [...this.players.values()];
  }
  get living() {
    return this.playerList.filter((p) => p.alive);
  }
  get ghosts() {
    return this.playerList.filter((p) => !p.alive);
  }
  connectedCount() {
    return this.playerList.filter((p) => p.connected).length;
  }

  drawQuestion(kind) {
    if (!this.decks[kind].length) this.decks[kind] = shuffle(QUESTIONS[kind]);
    return prepareQuestion(this.decks[kind].pop());
  }

  // ── connection management ───────────────────────────────────────────────
  async computeJoinInfo(socket) {
    let base = PUBLIC_URL;
    if (!base) {
      const proto = socket.handshake.headers['x-forwarded-proto'] || 'http';
      let host = socket.handshake.headers.host || `localhost:${PORT}`;
      // A host screen opened at localhost is useless to phones → swap in the LAN IP.
      host = host.replace(/^(localhost|127\.0\.0\.1|\[::1\])(?=:|$)/, lanAddress());
      base = `${proto}://${host}`;
    }
    this.joinUrl = base.replace(/^https?:\/\//, '');
    this.joinLink = `${base}/?room=${this.code}`;
    try {
      this.qr = await QRCode.toDataURL(this.joinLink, {
        margin: 1,
        width: 320,
        color: { dark: '#14061f', light: '#f7e7c4' },
      });
    } catch (err) {
      console.warn('QR generation failed:', err.message);
      this.qr = null;
    }
  }

  /** Bind (or re-bind) the host screen. Any older host tab is told to stand down. */
  attachHost(socket) {
    if (this.hostSocketId && this.hostSocketId !== socket.id) {
      const old = this.io.sockets.sockets.get(this.hostSocketId);
      if (old) {
        old.data.roomCode = null;
        old.emit('room:closed', { reason: 'This room was opened on another screen.', replaced: true });
      }
    }
    this.hostSocketId = socket.id;
    this.hostConnected = true;
    this.hostLeftAt = null;
    Object.assign(socket.data, { role: 'host', roomCode: this.code, playerId: null });
    this.touch();
  }

  addPlayer(name, socket) {
    if (this.phase !== 'LOBBY') return { error: 'The film is already rolling! Wait for the next show.' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'Housefull! This room already has 8 stars.' };
    if (this.playerList.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { error: 'That stage name is taken. Pick another!' };
    }
    const used = new Set(this.playerList.map((p) => p.avatar.id));
    const free = AVATARS.filter((a) => !used.has(a.id));
    const player = {
      id: 'p_' + newToken().slice(0, 10),
      token: newToken(), // secret used to reclaim this seat after a disconnect
      name,
      avatar: free[crypto.randomInt(free.length)],
      socketId: null,
      connected: false,
      disconnectedAt: null,
      alive: true,
      score: 0,
      position: 0,
      isVIP: false,
    };
    this.players.set(player.id, player);
    this.attachPlayer(player, socket);
    this.ensureVip();
    return { player };
  }

  /** Bind a socket to a player seat (fresh join OR reconnect). */
  attachPlayer(player, socket) {
    if (player.socketId && player.socketId !== socket.id) {
      // Same player opened a second tab/device: the newest one wins.
      const old = this.io.sockets.sockets.get(player.socketId);
      if (old) {
        old.data.roomCode = null;
        old.emit('room:closed', { reason: 'You opened this controller somewhere else.', replaced: true });
      }
    }
    player.socketId = socket.id;
    player.connected = true;
    player.disconnectedAt = null;
    Object.assign(socket.data, { role: 'player', roomCode: this.code, playerId: player.id });
    this.touch();
  }

  /** Called on socket disconnect. Seats are kept so the player can reclaim them. */
  detachSocket(socket) {
    if (socket.data.role === 'host' && this.hostSocketId === socket.id) {
      this.hostSocketId = null;
      this.hostConnected = false;
      this.hostLeftAt = Date.now();
      console.log(`[${this.code}] host disconnected (game keeps running)`);
    }
    if (socket.data.role === 'player') {
      const p = this.players.get(socket.data.playerId);
      if (p && p.socketId === socket.id) {
        p.socketId = null;
        p.connected = false;
        p.disconnectedAt = Date.now();
        console.log(`[${this.code}] ${p.name} disconnected`);
        this.ensureVip();
        this.checkEarlyFinish(); // everyone *still connected* may have answered
      }
    }
    this.broadcast();
  }

  removePlayer(id, reason = 'You were removed from the room.') {
    const p = this.players.get(id);
    if (!p) return;
    if (p.socketId) {
      const s = this.io.sockets.sockets.get(p.socketId);
      if (s) {
        s.data.roomCode = null;
        s.emit('room:closed', { reason });
      }
    }
    this.players.delete(id);
    this.ensureVip();
    this.broadcast();
  }

  /** The VIP (first connected player) can start the game from their phone. */
  ensureVip() {
    const list = this.playerList;
    const current = list.find((p) => p.isVIP);
    if (current && current.connected) return;
    const next = list.find((p) => p.connected);
    if (!next) return; // nobody connected: leave the badge where it is
    list.forEach((p) => (p.isVIP = p === next));
  }

  // ── phase engine ────────────────────────────────────────────────────────
  setPhase(phase, durationMs = null) {
    this.clearTimer();
    this.phase = phase;
    this.phaseKey += 1;
    this.phaseDuration = durationMs || 0;
    this.phaseEndsAt = durationMs ? Date.now() + durationMs : null;
    if (durationMs) this.timer = setTimeout(() => this.onPhaseEnd(), durationMs);
    this.touch();
    console.log(`[${this.code}] → ${phase}${durationMs ? ` (${durationMs}ms)` : ''}`);
    this.broadcast();
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Cut the current phase short (everyone answered, etc.) after a small beat. */
  hurry(ms) {
    if (!this.phaseEndsAt) return;
    if (this.phaseEndsAt - Date.now() <= ms) return;
    this.clearTimer();
    this.phaseEndsAt = Date.now() + ms;
    this.timer = setTimeout(() => this.onPhaseEnd(), ms);
    this.broadcast();
  }

  /** Host "skip" button (also handy while testing). */
  skip() {
    if (!this.phaseEndsAt) return;
    this.clearTimer();
    this.onPhaseEnd();
  }

  onPhaseEnd() {
    this.timer = null;
    try {
      switch (this.phase) {
        case 'INTRO':
          return this.startQuestion();
        case 'QUESTION':
          return this.revealQuestion();
        case 'REVEAL':
          return this.doomed.length ? this.setPhase('KF_INTRO', scaled(DURATION.KF_INTRO)) : this.nextRound();
        case 'KF_INTRO':
          return this.startMinigame();
        case 'MINIGAME':
          return this.judgeMinigame();
        case 'KF_RESULT':
          return this.nextRound();
        case 'FINAL_INTRO':
          return this.startFinalQuestion();
        case 'FINAL_QUESTION':
          return this.revealFinal();
        case 'FINAL_REVEAL':
          return this.afterFinalReveal();
        default:
          return undefined;
      }
    } catch (err) {
      // Never leave a room wedged: log it and jump to the end screen.
      console.error(`[${this.code}] phase ${this.phase} crashed:`, err);
      this.endGame(null, 'error');
    }
  }

  checkEarlyFinish() {
    if (this.phase === 'QUESTION' || this.phase === 'FINAL_QUESTION') {
      const waiting = this.playerList.some((p) => p.connected && !this.answers.has(p.id));
      if (!waiting && this.answers.size > 0) this.hurry(scaled(900));
    } else if (this.phase === 'MINIGAME' && this.minigame) {
      const waiting = this.doomed.some((id) => {
        const p = this.players.get(id);
        return p && p.connected && !this.minigame.results.has(id);
      });
      if (!waiting && this.minigame.results.size > 0) this.hurry(scaled(1500));
    }
  }

  // ── game flow ───────────────────────────────────────────────────────────
  setRounds(rounds) {
    if (this.phase !== 'LOBBY') return;
    const n = Number(rounds);
    if (RULES.ROUND_OPTIONS.includes(n)) this.settings.rounds = n;
    this.broadcast();
  }

  startGame() {
    if (this.phase !== 'LOBBY') return { error: 'The film is already rolling.' };
    if (this.connectedCount() < MIN_PLAYERS) return { error: `Need at least ${MIN_PLAYERS} players to roll camera.` };
    // Anyone who wandered off from the lobby doesn't get a part.
    for (const p of this.playerList) if (!p.connected) this.players.delete(p.id);
    this.ensureVip();
    this.resetGameState();
    for (const p of this.players.values()) Object.assign(p, { alive: true, score: 0, position: 0 });
    this.setPhase('INTRO', scaled(DURATION.INTRO));
    return { ok: true };
  }

  startQuestion() {
    this.round += 1;
    this.question = this.drawQuestion('main');
    this.answers = new Map();
    this.reveal = null;
    this.doomed = [];
    this.minigame = null;
    this.kfResult = null;
    this.questionOpenedAt = Date.now();
    this.questionDuration = scaled(DURATION.QUESTION);
    this.setPhase('QUESTION', this.questionDuration);
  }

  submitAnswer(player, choice) {
    if (this.phase !== 'QUESTION' && this.phase !== 'FINAL_QUESTION') return { error: 'Not taking answers right now.' };
    if (this.answers.has(player.id)) return { error: 'Answer already locked.' };
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.question.options.length) {
      return { error: 'Invalid choice.' };
    }
    this.answers.set(player.id, { choice, at: Date.now() });
    this.broadcast();
    this.checkEarlyFinish();
    return { ok: true };
  }

  revealQuestion() {
    const q = this.question;
    const picks = {};
    const deltas = {};
    const doomed = [];
    for (const p of this.playerList) {
      const a = this.answers.get(p.id);
      if (a) picks[p.id] = a.choice;
      const correct = !!a && a.choice === q.answerIndex;
      if (correct) {
        const timeLeft = clamp(1 - (a.at - this.questionOpenedAt) / this.questionDuration, 0, 1);
        const pts = RULES.POINTS_CORRECT + Math.round((RULES.SPEED_BONUS * timeLeft) / 10) * 10;
        p.score += pts;
        deltas[p.id] = pts;
      } else if (p.alive) {
        doomed.push(p.id); // wrong OR no answer → the Climax Scene (bhoots are already dead)
      }
    }
    this.doomed = doomed;
    this.reveal = { correctIndex: q.answerIndex, picks, deltas };
    this.setPhase('REVEAL', scaled(DURATION.REVEAL));
  }

  nextRound() {
    if (this.round < this.settings.rounds && this.living.length > 0) return this.startQuestion();
    return this.startFinal(); // out of rounds, or everyone is already a bhoot
  }

  // ── The Climax Scene: "Thappad Reflex" ──────────────────────────────────
  /**
   * Every doomed player gets the SAME sequence (fairness). Each step says
   * which grid cell lights up, after how long, and whether it's a Shaitaan
   * (slap him!) or Maa (never slap Maa). Phones time themselves locally so
   * network latency can't decide who dies; the server sanity-checks results.
   */
  startMinigame() {
    const kinds = shuffle([
      ...Array(RULES.MG_TARGETS).fill('villain'),
      ...Array(RULES.MG_DECOYS).fill('maa'),
    ]);
    if (kinds[0] === 'maa') {
      const i = kinds.indexOf('villain'); // never open with the decoy
      [kinds[0], kinds[i]] = [kinds[i], kinds[0]];
    }
    let lastCell = -1;
    const seq = kinds.map((kind) => {
      let cell;
      do cell = crypto.randomInt(9);
      while (cell === lastCell);
      lastCell = cell;
      return { kind, cell, delay: randInt(450, 1400) };
    });
    this.minigame = {
      seq,
      results: new Map(), // playerId → { total, reactions, penalties }
      progress: new Map(), // playerId → slaps landed (for the host's live view)
      playStartsAt: Date.now() + scaled(DURATION.MG_COUNTDOWN),
    };
    this.setPhase('MINIGAME', scaled(DURATION.MG_COUNTDOWN + DURATION.MG_PLAY));
  }

  minigameProgress(player, hits) {
    const mg = this.minigame;
    if (this.phase !== 'MINIGAME' || !mg || !this.doomed.includes(player.id) || mg.results.has(player.id)) return;
    mg.progress.set(player.id, clamp(Math.floor(Number(hits) || 0), 0, RULES.MG_TARGETS));
    this.broadcastHost(); // only the theatre screen cares about live progress
  }

  minigameResult(player, payload) {
    const mg = this.minigame;
    if (this.phase !== 'MINIGAME' || !mg || !this.doomed.includes(player.id)) {
      return { error: 'You are not in the Climax Scene.' };
    }
    if (mg.results.has(player.id)) return { error: 'Already submitted.' };
    const times = Array.isArray(payload.times) ? payload.times : [];
    if (times.length !== RULES.MG_TARGETS) return { error: 'Incomplete run.' };
    // Clamp every reaction into a plausible window; impossible values can't win.
    const reactions = times.map((t) => {
      const n = Number(t);
      return Number.isFinite(n) ? clamp(Math.round(n), RULES.MG_MIN_REACTION_MS, RULES.MG_MISS_MS) : RULES.MG_MISS_MS;
    });
    const penalties = clamp(Math.round(Number(payload.penalties) || 0), 0, 20000);
    const total = reactions.reduce((s, x) => s + x, 0) + penalties;
    mg.results.set(player.id, { total, reactions, penalties });
    mg.progress.set(player.id, RULES.MG_TARGETS);
    this.broadcast();
    this.checkEarlyFinish();
    return { ok: true, total };
  }

  judgeMinigame() {
    const mg = this.minigame;
    const rows = this.doomed.map((id) => ({ id, total: mg.results.get(id)?.total ?? null }));
    const deaths = rows.filter((r) => r.total === null).map((r) => r.id); // no-shows die
    const finishers = rows.filter((r) => r.total !== null).sort((a, b) => b.total - a.total); // slowest first
    const single = this.doomed.length === 1;
    if (single) {
      // Alone in the scene: beat Shaitaan Seth's par time or die.
      if (finishers.length && finishers[0].total > RULES.MG_PAR_MS) deaths.push(finishers[0].id);
    } else {
      // A crowd: the slowest dies (two die if four or more are in the scene).
      const quota = this.doomed.length >= 4 ? 2 : 1;
      for (const r of finishers) {
        if (deaths.length >= quota) break;
        deaths.push(r.id);
      }
    }
    for (const id of deaths) {
      const p = this.players.get(id);
      if (p) p.alive = false;
    }
    rows.sort((a, b) => (a.total ?? Infinity) - (b.total ?? Infinity)); // fastest first for display
    this.kfResult = { rows, deaths, par: RULES.MG_PAR_MS, single };
    this.setPhase('KF_RESULT', scaled(DURATION.KF_RESULT));
  }

  // ── The Climax Chase (final round) ──────────────────────────────────────
  startFinal() {
    const list = this.playerList;
    let revivedId = null;
    if (!list.some((p) => p.alive) && list.length) {
      // "Picture abhi baaki hai!" Everyone died → the top scorer gets one more take.
      const best = [...list].sort(byScoreDesc)[0];
      best.alive = true;
      revivedId = best.id;
    }
    const living = list.filter((p) => p.alive).sort(byScoreDesc);
    const ghosts = list.filter((p) => !p.alive).sort(byScoreDesc);
    living.forEach((p, i) => (p.position = RULES.LIVING_START + (i === 0 && living.length > 1 ? RULES.LEADER_BONUS : 0)));
    ghosts.forEach((p, i) => (p.position = RULES.GHOST_START + (i === 0 && ghosts.length > 1 ? 1 : 0)));
    this.final = {
      qNumber: 0,
      maxQuestions: RULES.MAX_FINAL_QUESTIONS,
      trackLength: RULES.TRACK_LENGTH,
      revivedId,
      lastReveal: null,
    };
    this.question = null;
    this.answers = new Map();
    this.setPhase('FINAL_INTRO', scaled(DURATION.FINAL_INTRO));
  }

  startFinalQuestion() {
    this.final.qNumber += 1;
    this.final.lastReveal = null;
    this.question = this.drawQuestion('final');
    this.answers = new Map();
    this.questionOpenedAt = Date.now();
    this.questionDuration = scaled(DURATION.FINAL_QUESTION);
    this.setPhase('FINAL_QUESTION', this.questionDuration);
  }

  /**
   * Resolution order matters:
   *  1. Everyone who answered correctly moves (living +1, bhoots +2).
   *     Bhoots can't leave the studio, so they stop one space short of the gate.
   *  2. Living players who reach the gate ESCAPE and are immune.
   *  3. Each bhoot (furthest first) that MOVED this turn and landed on or
   *     overtook a living player POSSESSES the furthest such player: the bhoot
   *     is reborn, the victim becomes a bhoot and is flung back. Bhoots that
   *     are already ahead of you (or stuck at the gate) can't strike, so
   *     nobody can "camp" the exit. One swap per player per question.
   */
  revealFinal() {
    const q = this.question;
    const L = this.final.trackLength;
    const picks = {};
    const moves = {};
    const events = [];

    for (const p of this.playerList) {
      const a = this.answers.get(p.id);
      if (a) picks[p.id] = a.choice;
      const correct = !!a && a.choice === q.answerIndex;
      const from = p.position;
      if (correct) {
        p.position = p.alive ? Math.min(L, from + RULES.LIVING_STEP) : Math.min(L - 1, from + RULES.GHOST_STEP);
      }
      moves[p.id] = { from, stepTo: p.position, to: p.position, correct, wasAlive: p.alive };
    }

    const escaped = this.living.filter((p) => p.position >= L);

    const swapped = new Set();
    const hunters = this.ghosts.sort((a, b) => b.position - a.position || b.score - a.score);
    for (const g of hunters) {
      const gm = moves[g.id];
      if (gm.stepTo <= gm.from) continue; // a bhoot only strikes while on the move
      const prey = this.living
        .filter((v) => !swapped.has(v.id) && v.position < L && gm.from < v.position && v.position <= g.position)
        .sort((a, b) => b.position - a.position || b.score - a.score)[0];
      if (!prey) continue;
      g.alive = true;
      prey.alive = false;
      prey.position = Math.max(0, prey.position - RULES.KNOCKBACK);
      swapped.add(g.id);
      swapped.add(prey.id);
      moves[prey.id].to = prey.position;
      moves[prey.id].possessed = true;
      moves[g.id].revived = true;
      events.push({ type: 'possess', ghostId: g.id, victimId: prey.id });
    }

    let winnerId = null;
    if (escaped.length) {
      winnerId = escaped.sort(byScoreDesc)[0].id;
      events.push({ type: 'escape', playerId: winnerId });
    }
    this.final.lastReveal = { correctIndex: q.answerIndex, picks, moves, events, winnerId };
    this.setPhase('FINAL_REVEAL', scaled(DURATION.FINAL_REVEAL));
  }

  afterFinalReveal() {
    const F = this.final;
    if (F.lastReveal?.winnerId) return this.endGame(F.lastReveal.winnerId, 'escaped');
    if (F.qNumber >= F.maxQuestions) {
      // Shooting overran: the living player closest to the gate takes the credit.
      const leader = this.living.sort((a, b) => b.position - a.position || b.score - a.score)[0];
      return this.endGame(leader?.id ?? null, 'time');
    }
    return this.startFinalQuestion();
  }

  endGame(winnerId, reason) {
    const standings = this.playerList
      .map((p) => ({ id: p.id, name: p.name, avatar: p.avatar, alive: p.alive, score: p.score, position: p.position }))
      .sort(
        (a, b) =>
          (b.id === winnerId) - (a.id === winnerId) || b.alive - a.alive || b.position - a.position || b.score - a.score
      );
    this.gameOver = { winnerId, reason, standings };
    this.setPhase('GAME_OVER');
  }

  backToLobby() {
    this.resetGameState();
    for (const p of this.playerList) Object.assign(p, { alive: true, score: 0, position: 0 });
    this.setPhase('LOBBY');
  }

  // ── snapshots ───────────────────────────────────────────────────────────
  remainingMs() {
    return this.phaseEndsAt ? Math.max(0, this.phaseEndsAt - Date.now()) : null;
  }

  baseView() {
    return {
      code: this.code,
      phase: this.phase,
      phaseKey: this.phaseKey,
      remainingMs: this.remainingMs(),
      durationMs: this.phaseDuration,
      round: this.round,
      totalRounds: this.settings.rounds,
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      rules: {
        trackLength: RULES.TRACK_LENGTH,
        livingStep: RULES.LIVING_STEP,
        ghostStep: RULES.GHOST_STEP,
        knockback: RULES.KNOCKBACK,
        mgTargets: RULES.MG_TARGETS,
        mgPar: RULES.MG_PAR_MS,
      },
    };
  }

  publicQuestion() {
    const q = this.question;
    return q ? { category: q.category, text: q.text, options: q.options, vo: q.vo } : null;
  }

  publicPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      alive: p.alive,
      score: p.score,
      position: p.position,
      connected: p.connected,
      isVIP: p.isVIP,
      answered: this.answers.has(p.id),
    };
  }

  finalView() {
    const F = this.final;
    if (!F) return null;
    return {
      qNumber: F.qNumber,
      maxQuestions: F.maxQuestions,
      trackLength: F.trackLength,
      revivedId: F.revivedId,
      lastReveal: this.phase === 'FINAL_REVEAL' ? F.lastReveal : null,
    };
  }

  /** Everything the theatre screen needs. */
  hostView() {
    const v = {
      ...this.baseView(),
      role: 'host',
      joinUrl: this.joinUrl,
      joinLink: this.joinLink,
      settings: this.settings,
      roundOptions: RULES.ROUND_OPTIONS,
      players: this.playerList.map((p) => this.publicPlayer(p)),
    };
    const P = this.phase;
    if (P === 'LOBBY') v.qr = this.qr;
    if (['QUESTION', 'REVEAL', 'FINAL_QUESTION', 'FINAL_REVEAL'].includes(P)) v.question = this.publicQuestion();
    if (P === 'REVEAL') v.reveal = this.reveal;
    if (['REVEAL', 'KF_INTRO', 'MINIGAME'].includes(P)) v.doomed = this.doomed;
    if (P === 'MINIGAME' && this.minigame) {
      v.minigame = {
        playStartsInMs: this.minigame.playStartsAt - Date.now(),
        targets: RULES.MG_TARGETS,
        progress: Object.fromEntries(this.minigame.progress),
        finished: [...this.minigame.results.keys()],
      };
    }
    if (P === 'KF_RESULT') v.kfResult = this.kfResult;
    if (P.startsWith('FINAL')) v.final = this.finalView();
    if (P === 'GAME_OVER') v.gameOver = this.gameOver;
    return v;
  }

  /** Everything ONE phone needs: only its own secrets, nothing that spoils answers. */
  playerView(p) {
    const v = {
      ...this.baseView(),
      role: 'player',
      you: { id: p.id, name: p.name, avatar: p.avatar, alive: p.alive, score: p.score, position: p.position, isVIP: p.isVIP },
      playerCount: this.players.size,
    };
    const ans = this.answers.get(p.id);
    const nameOf = (id) => this.players.get(id)?.name ?? '???';
    switch (this.phase) {
      case 'LOBBY': {
        const vip = this.playerList.find((x) => x.isVIP);
        v.vipName = vip ? vip.name : null;
        v.canStart = p.isVIP && this.connectedCount() >= MIN_PLAYERS;
        break;
      }
      case 'QUESTION':
      case 'FINAL_QUESTION':
        v.question = this.publicQuestion();
        v.answered = ans ? ans.choice : null;
        break;
      case 'REVEAL': {
        const r = this.reveal;
        v.result = {
          choice: ans ? ans.choice : null,
          correct: !!ans && ans.choice === r.correctIndex,
          correctText: this.question.options[r.correctIndex],
          delta: r.deltas[p.id] || 0,
          doomed: this.doomed.includes(p.id),
        };
        break;
      }
      case 'KF_INTRO':
        v.doomed = this.doomed.includes(p.id);
        v.doomedCount = this.doomed.length;
        break;
      case 'MINIGAME': {
        const mg = this.minigame;
        v.doomed = this.doomed.includes(p.id);
        if (v.doomed) {
          v.minigame = {
            seq: mg.seq,
            playStartsInMs: mg.playStartsAt - Date.now(), // negative = already running
            submitted: mg.results.has(p.id),
            missMs: RULES.MG_MISS_MS,
          };
        }
        break;
      }
      case 'KF_RESULT': {
        const k = this.kfResult;
        const row = k.rows.find((r) => r.id === p.id);
        v.kf = {
          wasDoomed: !!row,
          died: k.deaths.includes(p.id),
          total: row ? row.total : null,
          par: k.par,
          single: k.single,
          victims: k.deaths.map(nameOf),
        };
        break;
      }
      case 'FINAL_REVEAL': {
        const lr = this.final.lastReveal;
        v.move = lr.moves[p.id] || null;
        v.correctText = this.question.options[lr.correctIndex];
        v.events = lr.events
          .filter((e) => e.ghostId === p.id || e.victimId === p.id || e.playerId === p.id)
          .map((e) => ({ ...e, ghostName: e.ghostId && nameOf(e.ghostId), victimName: e.victimId && nameOf(e.victimId) }));
        v.winnerName = lr.winnerId ? nameOf(lr.winnerId) : null;
        break;
      }
      case 'GAME_OVER': {
        const g = this.gameOver;
        const w = g.winnerId && this.players.get(g.winnerId);
        v.gameOver = {
          winner: w ? { id: w.id, name: w.name, avatar: w.avatar } : null,
          isWinner: g.winnerId === p.id,
          rank: g.standings.findIndex((s) => s.id === p.id) + 1,
          reason: g.reason,
        };
        break;
      }
      default:
        break;
    }
    if (this.phase.startsWith('FINAL')) v.final = this.finalView();
    return v;
  }

  broadcastHost() {
    if (this.hostSocketId) this.io.to(this.hostSocketId).emit('host:state', this.hostView());
  }

  broadcast() {
    this.broadcastHost();
    for (const p of this.players.values()) {
      if (p.connected && p.socketId) this.io.to(p.socketId).emit('player:state', this.playerView(p));
    }
  }

  destroy(reason) {
    this.clearTimer();
    const notify = (sid) => {
      const s = sid && this.io.sockets.sockets.get(sid);
      if (s) {
        s.data.roomCode = null;
        s.emit('room:closed', { reason });
      }
    };
    notify(this.hostSocketId);
    for (const p of this.players.values()) notify(p.socketId);
    rooms.delete(this.code);
    console.log(`[${this.code}] room closed: ${reason}`);
  }
}

// ══════════════════════════════════════════════════════════════ HTTP + IO ══
const app = express();
app.disable('x-powered-by');
const PUBLIC_DIR = path.join(__dirname, 'public');
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'player.html')));
app.get('/host', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'host.html')));
app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.use(express.static(PUBLIC_DIR));

const server = http.createServer(app);
const io = new Server(server, {
  // Faster detection of phones that went to sleep.
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

/** Wrap a socket handler: normalises (payload, ack) and never lets one bad message crash the server. */
function handle(socket, event, fn) {
  socket.on(event, async (payload, ack) => {
    if (typeof payload === 'function') [payload, ack] = [{}, payload];
    const reply = typeof ack === 'function' ? ack : () => {};
    try {
      await fn(payload && typeof payload === 'object' ? payload : {}, reply);
    } catch (err) {
      console.error(`[socket ${event}]`, err);
      reply({ ok: false, error: 'Server hiccup. Try again.' });
    }
  });
}

const toReply = (res) => (res && res.error ? { ok: false, error: res.error } : { ok: true, ...res });

io.on('connection', (socket) => {
  socket.data = { role: null, roomCode: null, playerId: null };

  const currentRoom = () => rooms.get(socket.data.roomCode);
  const hostRoom = () => {
    const room = currentRoom();
    return room && socket.data.role === 'host' && room.hostSocketId === socket.id ? room : null;
  };
  const playerCtx = () => {
    const room = currentRoom();
    const p = room && socket.data.role === 'player' && room.players.get(socket.data.playerId);
    return p && p.socketId === socket.id ? { room, p } : null;
  };

  // ── host ──────────────────────────────────────────────────────────────
  handle(socket, 'host:create', async (_payload, reply) => {
    const old = hostRoom();
    if (old) {
      old.hostSocketId = null; // don't tell *this* screen its old room closed
      old.destroy('The host started a new room.');
    }
    const room = new Room(io, makeRoomCode());
    rooms.set(room.code, room);
    room.attachHost(socket);
    await room.computeJoinInfo(socket);
    console.log(`[${room.code}] room created → ${room.joinLink}`);
    reply({ ok: true, code: room.code, hostToken: room.hostToken });
    room.broadcast();
  });

  handle(socket, 'host:rejoin', async (payload, reply) => {
    const room = rooms.get(String(payload.code || '').toUpperCase());
    if (!room || payload.hostToken !== room.hostToken) return reply({ ok: false, error: 'Room not found.' });
    room.attachHost(socket);
    if (!room.qr) await room.computeJoinInfo(socket);
    reply({ ok: true, code: room.code });
    return room.broadcast();
  });

  handle(socket, 'host:settings', (payload) => hostRoom()?.setRounds(payload.rounds));
  handle(socket, 'host:start', (_p, reply) => {
    const room = hostRoom();
    reply(room ? toReply(room.startGame()) : { ok: false, error: 'No room.' });
  });
  handle(socket, 'host:skip', () => hostRoom()?.skip());
  handle(socket, 'host:lobby', () => {
    const room = hostRoom();
    if (room && room.phase === 'GAME_OVER') room.backToLobby();
  });
  handle(socket, 'host:kick', (payload) => {
    const room = hostRoom();
    if (room && room.phase === 'LOBBY') room.removePlayer(String(payload.playerId), 'The host removed you from the cast.');
  });
  handle(socket, 'host:close', () => hostRoom()?.destroy('The host closed the room.'));

  // ── players ───────────────────────────────────────────────────────────
  handle(socket, 'player:join', (payload, reply) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const name = cleanName(payload.name);
    if (!/^[A-Z]{4}$/.test(code)) return reply({ ok: false, error: 'Room codes are 4 letters.' });
    if (!name) return reply({ ok: false, error: 'Every star needs a name!' });
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: `No room "${code}". Check the big screen.` });

    const prev = playerCtx(); // this phone already holds a lobby seat: free it quietly first
    if (prev && prev.room.phase === 'LOBBY') {
      prev.p.socketId = null;
      prev.room.removePlayer(prev.p.id);
    }

    const res = room.addPlayer(name, socket);
    if (res.error) return reply({ ok: false, error: res.error });
    console.log(`[${room.code}] ${name} joined as ${res.player.avatar.role}`);
    reply({ ok: true, code: room.code, playerId: res.player.id, token: res.player.token });
    return room.broadcast();
  });

  handle(socket, 'player:rejoin', (payload, reply) => {
    const room = rooms.get(String(payload.code || '').toUpperCase());
    const p = room?.players.get(String(payload.playerId));
    if (!p || p.token !== payload.token) return reply({ ok: false, error: 'That seat is gone.' });
    room.attachPlayer(p, socket);
    room.ensureVip();
    console.log(`[${room.code}] ${p.name} reconnected`);
    reply({ ok: true, code: room.code });
    return room.broadcast();
  });

  handle(socket, 'player:start', (_p, reply) => {
    const ctx = playerCtx();
    if (!ctx) return reply({ ok: false, error: 'Not in a room.' });
    if (!ctx.p.isVIP) return reply({ ok: false, error: 'Only the VIP can start.' });
    return reply(toReply(ctx.room.startGame()));
  });

  handle(socket, 'player:answer', (payload, reply) => {
    const ctx = playerCtx();
    if (!ctx) return reply({ ok: false, error: 'Not in a room.' });
    return reply(toReply(ctx.room.submitAnswer(ctx.p, payload.choice)));
  });

  handle(socket, 'mg:progress', (payload) => {
    const ctx = playerCtx();
    if (ctx) ctx.room.minigameProgress(ctx.p, payload.hits);
  });

  handle(socket, 'mg:result', (payload, reply) => {
    const ctx = playerCtx();
    if (!ctx) return reply({ ok: false, error: 'Not in a room.' });
    return reply(toReply(ctx.room.minigameResult(ctx.p, payload)));
  });

  handle(socket, 'player:leave', (_p, reply) => {
    const ctx = playerCtx();
    if (ctx) {
      if (ctx.room.phase === 'LOBBY') ctx.room.removePlayer(ctx.p.id, 'You left the room.');
      else ctx.room.detachSocket(socket); // mid-game: keep the seat, just go dark
    }
    socket.data = { role: null, roomCode: null, playerId: null };
    reply({ ok: true });
  });

  socket.on('disconnect', () => currentRoom()?.detachSocket(socket));
});

// ── housekeeping: drop stale lobby seats, close abandoned rooms ──────────────
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (!room.hostConnected && room.hostLeftAt && now - room.hostLeftAt > LIFETIME.HOST_GONE_MS) {
      room.destroy('The host left the theatre.');
      continue;
    }
    if (now - room.lastActivity > LIFETIME.IDLE_ROOM_MS) {
      room.destroy('The room closed after sitting idle.');
      continue;
    }
    if (room.phase === 'LOBBY') {
      const stale = room.playerList.filter(
        (p) => !p.connected && p.disconnectedAt && now - p.disconnectedAt > LIFETIME.LOBBY_DROP_MS
      );
      stale.forEach((p) => room.players.delete(p.id));
      if (stale.length) {
        room.ensureVip();
        room.broadcast();
      }
    }
  }
}, LIFETIME.SWEEP_MS).unref();

server.listen(PORT, () => {
  const lan = lanAddress();
  console.log('\n  🎬  MAUT KA MAHURAT is rolling!');
  console.log(`      Host screen  →  http://localhost:${PORT}/host`);
  console.log(`      Phones join  →  http://${lan}:${PORT}`);
  if (TIME_SCALE !== 1) console.log(`      ⏩ TIME_SCALE=${TIME_SCALE}`);
  console.log('');
});

module.exports = { app, server, io, rooms, RULES, DURATION };
