#!/usr/bin/env node
'use strict';
/**
 * Bot players for Maut Ka Mahurat — handy when you don't have 4 friends handy.
 *
 *   node tools/bots.js ABCD 3            add 3 bots to the room ABCD (you host on the big screen)
 *   node tools/bots.js --simulate 4      headless full game: fake host + 4 bots, exits when the film ends
 *
 * Options
 *   --url http://localhost:3000          server to connect to
 *   --chaos                              bots randomly drop their connection and reconnect
 *
 * Tip: run the server with TIME_SCALE=0.05 for a ~20 second simulated game.
 */
const { io } = require('socket.io-client');

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const URL = opt('--url', 'http://localhost:3000');
const CHAOS = flag('--chaos');
const SIMULATE = flag('--simulate');
const positional = args.filter((a, i) => !a.startsWith('--') && !(args[i - 1] || '').match(/^--(url|simulate)$/));

const BOT_NAMES = ['Bot Basanti', 'Bot Veeru', 'Bot Simran', 'Bot Raj', 'Bot Gabbar', 'Bot Geet', 'Bot Munna', 'Bot Circuit'];
const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const pick = (n) => Math.floor(Math.random() * n);

function makeBot(code, name) {
  const s = io(URL, { transports: ['websocket'], forceNew: true, reconnectionDelay: 300 });
  const bot = { name, s, session: null, handled: new Set() };
  const log = (...m) => console.log(`  🤖 ${name}:`, ...m);

  s.on('connect', () => {
    bot.handled.clear(); // anything we "sent" while offline was dropped: act again
    if (bot.session) {
      s.emit('player:rejoin', bot.session, (r) => log(r.ok ? 'reconnected ✓' : `rejoin failed: ${r.error}`));
    } else {
      s.emit('player:join', { code, name }, (r) => {
        if (!r.ok) return log('join failed:', r.error);
        bot.session = { code: r.code, playerId: r.playerId, token: r.token };
        return log('joined');
      });
    }
  });

  s.on('room:closed', ({ reason }) => {
    log('room closed:', reason);
    s.close();
  });

  s.on('player:state', (st) => {
    const key = `${st.phase}:${st.phaseKey}`;
    if (bot.handled.has(key)) return;

    if ((st.phase === 'QUESTION' || st.phase === 'FINAL_QUESTION') && st.answered == null && st.question) {
      bot.handled.add(key);
      const wait = (st.remainingMs || 1000) * rand(0.1, 0.6);
      setTimeout(() => s.emit('player:answer', { choice: pick(st.question.options.length) }), wait);
    }

    if (st.phase === 'MINIGAME' && st.doomed && st.minigame && !st.minigame.submitted) {
      bot.handled.add(key);
      const start = Math.max(0, st.minigame.playStartsInMs);
      const times = Array.from({ length: st.rules.mgTargets }, () => Math.round(rand(330, 820)));
      const penalties = Math.random() < 0.3 ? 600 : 0;
      const finishIn = start + Math.max(0, (st.remainingMs - start) * rand(0.15, 0.5));
      times.forEach((_, i) => setTimeout(() => s.emit('mg:progress', { hits: i + 1 }), start + ((finishIn - start) * (i + 1)) / (times.length + 1)));
      setTimeout(() => s.emit('mg:result', { times, penalties }, (r) => r.ok && log(`slapped in ${r.total}ms`)), finishIn);
    }
  });

  if (CHAOS) {
    const glitch = () => {
      if (s.connected && Math.random() < 0.35) {
        log('📵 dropping connection…');
        s.io.engine.close(); // simulate a flaky phone; socket.io reconnects on its own
      }
      bot.chaos = setTimeout(glitch, rand(2500, 7000));
    };
    bot.chaos = setTimeout(glitch, rand(2000, 5000));
  }
  return bot;
}

// ── mode 1: add bots to a real room ─────────────────────────────────────────
if (!SIMULATE) {
  const [code, countRaw] = positional;
  if (!code || !/^[a-z]{4}$/i.test(code)) {
    console.log('Usage: node tools/bots.js ROOMCODE [count]   |   node tools/bots.js --simulate 4');
    process.exit(1);
  }
  const count = Math.min(7, Number(countRaw) || 3);
  console.log(`Sending ${count} bots to room ${code.toUpperCase()} at ${URL}`);
  for (let i = 0; i < count; i++) makeBot(code.toUpperCase(), BOT_NAMES[i]);
  return;
}

// ── mode 2: headless simulation (fake host + bots) ──────────────────────────
const count = Math.min(8, Math.max(2, Number(opt('--simulate', 4)) || 4));
const host = io(URL, { transports: ['websocket'], forceNew: true });
let started = false;
let lastPhase = '';
const bots = [];
const fail = (msg) => {
  console.error(`\n❌ ${msg}`);
  process.exit(1);
};
const watchdog = setTimeout(() => fail('Simulation timed out (is the server running with a small TIME_SCALE?)'), 10 * 60_000);

host.on('connect_error', () => fail(`Could not reach ${URL}. Start the server first.`));
host.on('connect', () => {
  host.emit('host:create', {}, (r) => {
    if (!r.ok) fail(r.error);
    console.log(`🎬 Room ${r.code} created. Sending ${count} bots…`);
    for (let i = 0; i < count; i++) bots.push(makeBot(r.code, BOT_NAMES[i]));
  });
});

host.on('host:state', (st) => {
  // Invariants that must hold in every snapshot.
  for (const p of st.players) {
    if (p.position < 0 || p.position > st.rules.trackLength) fail(`${p.name} is off the track at ${p.position}`);
  }
  if (st.phase === 'LOBBY' && !started && st.players.filter((p) => p.connected).length === count) {
    started = true;
    host.emit('host:start', {}, (r) => !r.ok && fail(r.error));
  }
  const tag = `${st.phase}#${st.phaseKey}`;
  if (tag === lastPhase) return;
  lastPhase = tag;

  const name = (id) => st.players.find((p) => p.id === id)?.name ?? id;
  const roster = st.players.map((p) => `${p.alive ? '🙂' : '👻'}${p.name.replace('Bot ', '')}${st.phase.startsWith('FINAL') ? `@${p.position}` : ''}`).join(' ');
  let extra = '';
  if (st.phase === 'QUESTION') extra = `Q${st.round}: ${st.question.text}`;
  if (st.phase === 'REVEAL') extra = `answer: ${st.question.options[st.reveal.correctIndex]} | doomed: ${st.doomed.map(name).join(', ') || 'none'}`;
  if (st.phase === 'KF_RESULT') extra = st.kfResult.rows.map((r) => `${name(r.id)} ${r.total ?? 'DNF'}ms`).join(', ') + ` → dead: ${st.kfResult.deaths.map(name).join(', ') || 'none'}`;
  if (st.phase === 'FINAL_REVEAL') extra = st.final.lastReveal.events.map((e) => (e.type === 'possess' ? `${name(e.ghostId)} possessed ${name(e.victimId)}` : `${name(e.playerId)} ESCAPED`)).join('; ');
  console.log(`  ${st.phase.padEnd(14)} ${roster}  ${extra}`);

  if (st.phase === 'GAME_OVER') {
    clearTimeout(watchdog);
    const g = st.gameOver;
    console.log(`\n🏆 Winner: ${g.winnerId ? name(g.winnerId) : 'nobody'} (${g.reason})`);
    g.standings.forEach((s, i) => console.log(`   ${i + 1}. ${s.alive ? '🙂' : '👻'} ${s.name.padEnd(12)} ${String(s.score).padStart(6)} pts  space ${s.position}`));
    if (g.reason === 'error') fail('Game ended because of a server error.');
    bots.forEach((b) => b.s.close());
    host.close();
    console.log('\n✅ Simulation finished cleanly.');
    process.exit(0);
  }
});
