/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  host.js: the theatre screen (TV / laptop).
 *
 *  Pure renderer: it never decides game outcomes. The server pushes a
 *  `host:state` snapshot on every change; we diff `phaseKey` to decide
 *  between "build a new scene" (enterPhase) and "update this scene" (update).
 *
 *  Sections:  setup · narrator · connection · state routing · cast strip ·
 *             scenes (one builder per phase) · canvases (FX, mini-game, chase)
 * ═══════════════════════════════════════════════════════════════════════════
 */
(() => {
  'use strict';

  const { h, PhaseClock, session, local, avatarEl, killAvatar, reviveAvatar, drips, replay, diyaEl, fmtScore, fmtMs, fill, rand, pickOne } = window.MKM;
  const { ic, miniSprite, skyScene, curtains, projector, leader, burn, clapper } = window.MKM;
  const art = window.MKM.art;

  // ══════════════════════════════════════════════════════════════ setup ══
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const castEl = $('cast');
  const subtitles = $('subtitles');
  const topbar = $('topbar');
  const toastEl = $('toast');

  const audio = new window.MKMAudio.AudioEngine();
  const clock = new PhaseClock();
  const DEV = new URLSearchParams(location.search).has('dev');

  const S = {
    state: null,
    code: null,
    phaseKey: null,
    view: null,
    cast: new Map(), // playerId → { card, avatar, scoreEl, alive, score }
    emptySlots: [],
    track: null, // ChaseTrack, alive across the FINAL_* phases
    toastKind: null,
  };

  const MUSIC_FOR = {
    LOBBY: 'lobby',
    INTRO: 'lobby',
    QUESTION: 'tension',
    REVEAL: 'tension',
    KF_INTRO: 'tension',
    MINIGAME: 'tension',
    KF_RESULT: 'tension',
    FINAL_INTRO: 'chase',
    FINAL_QUESTION: 'chase',
    FINAL_REVEAL: 'chase',
    GAME_OVER: 'lobby',
  };

  // ═══════════════════════════════════════════════════════════ narrator ══
  /** Shaitaan Seth's script lives in /js/narration.js (shared with the voice generator). */
  const LINES = window.MKM_LINES;

  /**
   * Subtitle with player names + the pre-recorded ghost voice for the same
   * line (`<key>_<variant>.m4a`); falls back to text-to-speech if missing.
   */
  function narrate(key, vars = {}) {
    const variants = LINES[key];
    const i = Math.floor(Math.random() * variants.length);
    const line = variants[i];
    showSubtitle(fill(line.sub, vars));
    audio.say(fill(line.vo, vars), { id: `${key}_${i}` });
  }

  function showSubtitle(text) {
    subtitles.replaceChildren(
      h(
        'div',
        { class: 'line' },
        h('span', { class: 'speaker' }, h('span', { class: 'speaker__face' }, art.el(art.portrait('seth'))), 'Shaitaan Seth'),
        h('span', null, text)
      )
    );
  }

  /** "Riya", "Riya and Kabir", "Riya, Kabir and Meera" */
  function listNames(names) {
    if (names.length <= 1) return names[0] || '';
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }

  // ══════════════════════════════════════════════════════════ connection ══
  const socket = io({ reconnectionDelayMax: 3000 });

  socket.on('connect', () => {
    hideToast('offline');
    const saved = session.get('mkm.host');
    if (saved && saved.code && saved.hostToken) {
      socket.emit('host:rejoin', saved, (res) => {
        if (res && res.ok) {
          if (!audio.ready) showToast('Click anywhere to turn the sound on', 'sound');
        } else {
          session.del('mkm.host');
          showTitle('That room has closed. Start a new one!');
        }
      });
    } else if (!S.state) {
      showTitle();
    }
  });

  socket.on('disconnect', () => showToast('Lost the studio. Reconnecting…', 'offline'));
  socket.on('host:state', onState);
  socket.on('room:closed', ({ reason }) => {
    session.del('mkm.host');
    showTitle(reason);
  });

  function createRoom(btn, noteEl) {
    unlockAudio();
    curtainCall(1500);
    if (btn) btn.disabled = true;
    socket.emit('host:create', {}, (res) => {
      if (!res || !res.ok) {
        if (btn) btn.disabled = false;
        if (noteEl) noteEl.textContent = (res && res.error) || 'Could not create a room.';
        return;
      }
      session.set('mkm.host', { code: res.code, hostToken: res.hostToken });
    });
  }

  function unlockAudio() {
    audio.unlock();
    hideToast('sound');
    if (!S.voicesPreloaded) {
      S.voicesPreloaded = true;
      audio.preloadVoices(Object.keys(LINES).flatMap((k) => LINES[k].map((_, i) => `${k}_${i}`)));
    }
  }

  // ── cinema helpers ──────────────────────────────────────────────────────
  const CINEMA_PHASES = new Set(['INTRO', 'KF_INTRO', 'MINIGAME', 'KF_RESULT', 'FINAL_INTRO', 'GAME_OVER']);
  const CURTAIN_PHASES = new Set(['INTRO', 'FINAL_INTRO', 'GAME_OVER']);

  /** Close the curtains, swap the set behind them, open again. */
  function curtainCall(holdMs = 1100) {
    S.curtains.classList.remove('is-open');
    audio.sfx('whoosh');
    clearTimeout(S.curtainTimer);
    S.curtainTimer = setTimeout(() => S.curtains.classList.add('is-open'), holdMs);
  }

  // ═══════════════════════════════════════════════════════ state routing ══
  function onState(state) {
    const prev = S.state;
    const roomChanged = state.code !== S.code;
    const phaseChanged = roomChanged || state.phaseKey !== S.phaseKey;
    S.state = state;
    S.code = state.code;
    clock.sync(state);
    renderTopbar(state);
    renderCast(state, roomChanged ? null : prev);
    if (phaseChanged) {
      S.phaseKey = state.phaseKey;
      enterPhase(state, roomChanged ? null : prev);
    } else if (S.view && S.view.update) {
      S.view.update(state, prev);
    }
  }

  function enterPhase(state, prev) {
    if (S.view && S.view.destroy) S.view.destroy();
    if (!state.phase.startsWith('FINAL') && S.track) {
      S.track.destroy();
      S.track = null;
    }
    const build = SCENES[state.phase];
    S.view = build ? build(state, prev) : { el: h('div') };
    stage.replaceChildren(S.view.el);
    audio.playMusic(MUSIC_FOR[state.phase]);
    document.body.classList.toggle('cinema', CINEMA_PHASES.has(state.phase));
    S.sky.classList.toggle('is-dim', !['LOBBY', 'GAME_OVER'].includes(state.phase));
    if (prev) {
      burn(S.burnEl);
      if (CURTAIN_PHASES.has(state.phase)) curtainCall();
    } else {
      S.curtains.classList.add('is-open');
    }
  }

  function renderTopbar(state) {
    topbar.hidden = false;
    $('roomPill').hidden = state.phase === 'LOBBY'; // the lobby shows it huge already
    $('roomCode').textContent = state.code;
    $('joinUrl').textContent = state.joinUrl;
  }

  const byId = (state, id) => state.players.find((p) => p.id === id);
  const scene = (...children) => h('div', { class: 'scene' }, ...children);

  /** setTimeout bookkeeping so a scene can cancel its choreography on exit. */
  function timeline() {
    const ids = [];
    return {
      later(ms, fn) {
        ids.push(setTimeout(fn, ms));
      },
      clear() {
        ids.forEach(clearTimeout);
      },
    };
  }

  // ══════════════════════════════════════════════════════════ cast strip ══
  /** How long the cast strip should wait before showing deaths/score changes,
   *  so they land in sync with the stage choreography. */
  function castDelay(state) {
    if (state.phase === 'REVEAL') return 1300;
    if (state.phase === 'KF_RESULT') return kfJudgeDelay(state);
    if (state.phase === 'FINAL_REVEAL') return 1750;
    return 0;
  }

  function makeCastCard(p) {
    const avatar = avatarEl(p);
    const scoreEl = h('div', { class: 'cast-card__score' }, fmtScore(p.score));
    const card = h(
      'div',
      { class: 'cast-card', dataset: { id: p.id } },
      h(
        'div',
        { class: 'cast-card__badges' },
        h('span', { class: 'b-vip', title: 'VIP: can start the game' }, ic('crown')),
        h('span', { class: 'b-off', title: 'Reconnecting…' }, ic('offline')),
        h('span', { class: 'b-ans', title: 'Locked in' }, ic('check'))
      ),
      avatar,
      h('div', { class: 'cast-card__role' }, p.avatar.role),
      scoreEl
    );
    card.addEventListener('click', () => {
      if (S.state && S.state.phase === 'LOBBY' && window.confirm(`Remove ${p.name} from the cast?`)) {
        socket.emit('host:kick', { playerId: p.id });
      }
    });
    return { card, avatar, scoreEl, alive: undefined, score: undefined };
  }

  function setGhost(c, ghost) {
    c.avatar.classList.toggle('avatar--ghost', ghost);
    c.card.classList.toggle('is-ghost', ghost);
  }

  function renderCast(state, prev) {
    const phase = state.phase;
    const delay = prev ? castDelay(state) : 0;
    const ids = new Set(state.players.map((p) => p.id));
    for (const [id, c] of S.cast) {
      if (!ids.has(id)) {
        c.card.remove();
        S.cast.delete(id);
      }
    }

    state.players.forEach((p, i) => {
      let c = S.cast.get(p.id);
      if (!c) {
        c = makeCastCard(p);
        S.cast.set(p.id, c);
        c.card.classList.add('pop-in');
        if (prev) audio.sfx('join');
      }
      if (castEl.children[i] !== c.card) castEl.insertBefore(c.card, castEl.children[i] || null);

      const cls = c.card.classList;
      cls.toggle('is-offline', !p.connected);
      cls.toggle('is-vip', p.isVIP && phase === 'LOBBY');
      cls.toggle('is-answered', p.answered && (phase === 'QUESTION' || phase === 'FINAL_QUESTION'));
      cls.toggle('is-doomed', (state.doomed || []).includes(p.id) && ['REVEAL', 'KF_INTRO', 'MINIGAME'].includes(phase));
      cls.toggle('is-kickable', phase === 'LOBBY');

      // life ↔ death transitions get the full shatter / revive treatment
      if (c.alive === undefined) {
        c.alive = p.alive;
        setGhost(c, !p.alive);
      } else if (c.alive !== p.alive) {
        c.alive = p.alive;
        const nowAlive = p.alive;
        setTimeout(() => {
          if (nowAlive) {
            setGhost(c, false);
            reviveAvatar(c.avatar);
          } else {
            killAvatar(c.avatar, { onGhost: () => c.card.classList.add('is-ghost') });
          }
        }, delay);
      }

      if (c.score === undefined) {
        c.score = p.score;
      } else if (c.score !== p.score) {
        const diff = p.score - c.score;
        c.score = p.score;
        setTimeout(() => {
          c.scoreEl.textContent = fmtScore(p.score);
          if (diff > 0) {
            const pop = h('div', { class: 'score-pop' }, `+${fmtScore(diff)}`);
            c.card.appendChild(pop);
            setTimeout(() => pop.remove(), 1900);
          }
        }, diff > 0 ? delay : 0);
      }
    });

    // empty seats while casting
    const empties = phase === 'LOBBY' ? Math.max(0, state.maxPlayers - state.players.length) : 0;
    while (S.emptySlots.length > empties) S.emptySlots.pop().remove();
    while (S.emptySlots.length < empties) {
      S.emptySlots.push(h('div', { class: 'cast-card cast-card--empty' }, h('div', { class: 'ghost-seat' }, ic('seat')), 'Waiting for a star…'));
    }
    S.emptySlots.forEach((e) => castEl.appendChild(e));
  }

  function resetCast() {
    castEl.replaceChildren();
    S.cast.clear();
    S.emptySlots = [];
  }

  // ═══════════════════════════════════════════════════════ UI components ══
  /** Conic-gradient countdown ring driven by the synced PhaseClock. */
  function timerRing({ small = false } = {}) {
    const num = h('span');
    const el = h('div', { class: `timer-ring${small ? ' timer-ring--small' : ''}` }, num);
    let raf = 0;
    let last = null;
    const tick = () => {
      el.style.setProperty('--p', clock.fraction().toFixed(4));
      const s = clock.seconds();
      if (s !== last) {
        last = s;
        num.textContent = s == null ? '' : String(s);
        const urgent = s != null && s > 0 && s <= 5;
        el.classList.toggle('is-urgent', urgent);
        if (urgent) audio.sfx(s <= 3 ? 'tock' : 'tick');
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return { el, destroy: () => cancelAnimationFrame(raf) };
  }

  function optionEl(text, i, { animate = true } = {}) {
    return h(
      'div',
      { class: `option ticket${animate ? ' rise-in' : ''}`, dataset: { i }, style: { '--d': `${150 + i * 90}ms` } },
      h('span', { class: 'ticket__stub' }, h('span', { class: 'option__letter' }, 'ABCD'[i])),
      h('span', { class: 'option__text' }, text),
      h('div', { class: 'option__pickers' }),
      h('span', { class: 'ticket__admit' }, 'Admit one · Kaali Haveli')
    );
  }

  function markOptions(optionEls, state, correctIndex, picks) {
    for (const [pid, choice] of Object.entries(picks || {})) {
      const p = byId(state, pid);
      if (p && optionEls[choice]) optionEls[choice].querySelector('.option__pickers').appendChild(avatarEl(p, { name: false }));
    }
    optionEls.forEach((el, i) => el.classList.add(i === correctIndex ? 'is-correct' : 'is-wrong'));
    optionEls[correctIndex].appendChild(h('span', { class: 'stamp', style: { '--d': '450ms' } }, 'सही जवाब!'));
  }

  function answeredCounter() {
    const el = h('div', { class: 'answered-count' });
    let lastN = 0;
    return {
      el,
      update(st) {
        const n = st.players.filter((p) => p.answered).length;
        if (n > lastN) audio.sfx('lock');
        lastN = n;
        el.textContent = `${n} of ${st.players.length} locked in`;
      },
    };
  }

  // ═══════════════════════════════════════════════════════════════ scenes ══
  function showTitle(note) {
    if (S.view && S.view.destroy) S.view.destroy();
    if (S.track) S.track.destroy();
    Object.assign(S, { state: null, code: null, phaseKey: null, track: null });
    topbar.hidden = true;
    resetCast();
    subtitles.replaceChildren();
    audio.stopVoice();

    const noteEl = h('p', { class: 'hint closed-note' }, note || '');
    const btn = h('button', { class: 'btn btn--blood btn--huge', onclick: () => createRoom(btn, noteEl) }, ic('clapper'), ' Create Room');
    const logoWrap = h('div', { class: 'logo-wrap' }, h('h1', { class: 'logo display gold-text flicker' }, 'Maut Ka Mahurat'));
    drips(logoWrap, 12);
    const el = h(
      'div',
      { class: 'scene' },
      h('div', { class: 'title-seth pop-in' }, art.el(art.portrait('seth'))),
      h('div', { class: 'presents' }, 'Kaali Haveli Studios presents'),
      logoWrap,
      h('div', { class: 'logo-hi hindi' }, 'मौत का मुहूर्त'),
      h('p', { class: 'tagline' }, 'A Bollywood Trivia Murder Party'),
      btn,
      noteEl,
      h('p', { class: 'hint' }, 'Put this screen on a TV or laptop. 2–8 players join on their phones.')
    );
    S.view = { el };
    stage.replaceChildren(el);
    audio.playMusic('lobby');
    document.body.classList.remove('cinema');
    if (S.sky) S.sky.classList.remove('is-dim');
    if (S.curtains) S.curtains.classList.add('is-open');
  }

  const SCENES = {
    // ── casting call ──────────────────────────────────────────────────────
    LOBBY(state) {
      const startBtn = h(
        'button',
        {
          class: 'btn btn--huge',
          onclick: () => {
            unlockAudio();
            socket.emit('host:start', {}, (res) => res && !res.ok && showToast(res.error, 'error', 2500));
          },
        },
        ic('reel'),
        ' Roll Camera!'
      );
      const seg = h(
        'div',
        { class: 'segmented', role: 'group', 'aria-label': 'Number of scenes' },
        state.roundOptions.map((n) => h('button', { dataset: { n }, onclick: () => socket.emit('host:settings', { rounds: n }) }, `${n} scenes`))
      );
      const count = h('div', { class: 'cast-count' });
      const help = h('p', { class: 'hint' });
      const el = scene(
        h(
          'div',
          { class: 'lobby-grid' },
          h(
            'section',
            { class: 'lobby-join' },
            h('div', { class: 'lobby-step' }, 'On your phone, open'),
            h('div', { class: 'join-url' }, state.joinUrl),
            h('div', { class: 'lobby-step' }, 'and enter the room code'),
            h('div', { class: 'big-code flicker' }, [...state.code].map((ch) => h('span', null, ch)))
          ),
          state.qr ? h('section', { class: 'lobby-qr' }, h('img', { src: state.qr, alt: 'QR code to join this room' }), h('div', null, '…or scan to join')) : null,
          h(
            'section',
            { class: 'lobby-side' },
            h('h2', { class: 'display gold-text' }, 'Casting Call'),
            count,
            seg,
            startBtn,
            help
          )
        )
      );
      const update = (st) => {
        const ready = st.players.filter((p) => p.connected).length;
        count.textContent = `${st.players.length} / ${st.maxPlayers} stars signed`;
        startBtn.disabled = ready < st.minPlayers;
        help.textContent =
          ready < st.minPlayers ? `Need ${st.minPlayers - ready} more to roll camera` : 'The VIP (crown) can also start from their phone';
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.n) === st.settings.rounds));
      };
      update(state);
      narrate('lobby');
      return { el, update };
    },

    // ── opening credits ───────────────────────────────────────────────────
    INTRO(state) {
      const names = state.players.map((p) => p.name);
      const introducing = names.length > 1 ? names[names.length - 1] : null;
      const starring = introducing ? names.slice(0, -1).join(' · ') : names[0];
      const rules = [
        ['clapper', 'Answer filmy trivia', 'Tap A, B, C or D on your phone within 15 seconds. Faster answers earn more.'],
        ['knife', 'Wrong? Climax Scene', 'Wrong answers face a deadly mini-game. The slowest becomes a bhoot.'],
        ['ghost', 'Dead? Still in the film', 'Bhoots keep playing, and in the Climax Chase they can steal a body.'],
      ];
      const tl = timeline();
      const lead = leader();
      const leaderWrap = h('div', { class: 'stage-overlay' }, lead.el);
      const el = scene(
        h('div', { class: 'presents fade-in' }, 'Kaali Haveli Studios presents'),
        h('h1', { class: 'logo display gold-text flicker', style: { fontSize: '7.5vh' } }, 'Maut Ka Mahurat'),
        h(
          'div',
          { class: 'credits rise-in', style: { '--d': '600ms' } },
          h('div', { class: 'credits__label' }, 'Starring'),
          h('div', { class: 'credits__names' }, starring),
          introducing ? [h('div', { class: 'credits__label' }, 'and introducing'), h('div', { class: 'credits__names' }, introducing)] : null
        ),
        h(
          'div',
          { class: 'rule-cards' },
          rules.map(([icon, title, body], i) =>
            h(
              'div',
              { class: 'rule-card rise-in', style: { '--d': `${1400 + i * 350}ms` } },
              h('div', { class: 'rule-card__icon' }, ic(icon)),
              h('h3', null, title),
              h('p', null, body)
            )
          )
        )
      );
      // the film leader counts down over the opening, then the credits roll
      el.classList.add('is-leadering');
      el.appendChild(leaderWrap);
      ['3', '2', '1'].forEach((n, i) =>
        tl.later(i * 900, () => {
          lead.show(n);
          audio.sfx('tick');
        })
      );
      tl.later(2700, () => {
        leaderWrap.classList.add('is-gone');
        el.classList.remove('is-leadering');
        audio.sfx('stinger');
      });
      tl.later(400, () => narrate('intro'));
      return { el, destroy: tl.clear };
    },

    // ── trivia ────────────────────────────────────────────────────────────
    QUESTION(state) {
      const q = state.question;
      const ring = timerRing();
      const counter = answeredCounter();
      const el = scene(
        h(
          'div',
          { class: 'q-head' },
          clapper(`${state.round}/${state.totalRounds}`, '1', 'Shaitaan Seth', { clap: true }),
          h('span', { class: 'chip chip--blood' }, q.category)
        ),
        h('div', { class: 'q-main' }, ring.el, h('h2', { class: 'q-text display' }, q.text)),
        h('div', { class: 'options' }, q.options.map((t, i) => optionEl(t, i))),
        counter.el
      );
      counter.update(state);
      setTimeout(() => audio.sfx('action'), 780); // the clapper snaps shut
      subtitles.replaceChildren();
      audio.say(q.text, { id: q.vo });
      return { el, update: (st) => counter.update(st), destroy: ring.destroy };
    },

    REVEAL(state) {
      const q = state.question;
      const r = state.reveal;
      const tl = timeline();
      const optionEls = q.options.map((t, i) => optionEl(t, i, { animate: false }));
      const verdict = h('div', { class: 'verdict' });
      const el = h(
        'div',
        { class: 'scene scene--static' },
        h('div', { class: 'q-head' }, clapper(`${state.round}/${state.totalRounds}`, '1', 'Shaitaan Seth'), h('span', { class: 'chip chip--blood' }, q.category)),
        h('div', { class: 'q-main' }, h('h2', { class: 'q-text display' }, q.text)),
        h('div', { class: 'options' }, optionEls),
        verdict
      );
      tl.later(250, () => {
        markOptions(optionEls, state, r.correctIndex, r.picks);
        optionEls[r.correctIndex].classList.add('dhan-zoom');
        audio.sfx('stinger');
      });
      tl.later(2100, () => {
        const doomedNames = state.doomed.map((id) => byId(state, id)?.name).filter(Boolean);
        if (doomedNames.length) {
          verdict.replaceChildren('Galat jawab! ', h('span', { class: 'names' }, listNames(doomedNames)), ' → to the Climax Scene ', ic('knife'));
          audio.sfx('wrong');
          narrate('someWrong', { names: listNames(doomedNames) });
        } else {
          verdict.textContent = 'Sab bach gaye! Everyone survives… for now.';
          audio.sfx('correct');
          narrate('allRight');
        }
        replay(verdict, 'pop-in');
      });
      return { el, destroy: tl.clear };
    },

    // ── the killing floor ─────────────────────────────────────────────────
    KF_INTRO(state) {
      const tl = timeline();
      const doomed = state.doomed.map((id) => byId(state, id)).filter(Boolean);
      const single = doomed.length === 1;
      const titleWrap = h('div', { class: 'kf-title-wrap' }, h('h1', { class: 'kf-title display blood-text flicker' }, 'The Climax Scene'));
      drips(titleWrap, 14);
      const row = h(
        'div',
        { class: 'doomed-row' },
        doomed.map((p, i) => {
          const a = avatarEl(p, { cls: 'pop-in' });
          a.style.setProperty('--d', `${400 + i * 150}ms`);
          return a;
        })
      );
      const deathRule = single
        ? `Beat Shaitaan Seth's ${fmtMs(state.rules.mgPar)} or die`
        : doomed.length >= 4
          ? 'The two slowest slappers die'
          : 'The slowest slapper dies';
      const el = scene(
        h('div', { class: 'presents' }, "Tonight's stunt"),
        titleWrap,
        h('div', { class: 'kf-sub' }, h('b', null, 'Thappad Reflex'), '  ', h('span', { class: 'hindi' }, 'थप्पड़')),
        row,
        h(
          'div',
          { class: 'kf-rules' },
          h('div', { class: 'kf-rule' }, miniSprite('shaitaan'), ' Slap the Shaitaan the instant he appears'),
          h('div', { class: 'kf-rule' }, miniSprite('maa'), ' Never slap Maa! (+0.6s of shame)'),
          h('div', { class: 'kf-rule' }, ic('stopwatch'), ' ', deathRule)
        )
      );
      audio.sfx('whoosh');
      tl.later(1100, () => {
        replay(row, 'dhan-zoom');
        audio.sfx('stinger');
      });
      narrate(single ? 'kfIntroSingle' : 'kfIntro', { name: doomed[0] && doomed[0].name, par: (state.rules.mgPar / 1000).toFixed(1) });
      return { el, destroy: tl.clear };
    },

    MINIGAME(state) {
      const tl = timeline();
      const ring = timerRing({ small: true });
      const canvas = h('canvas', { class: 'mg-canvas' });
      const countdown = h('div', { class: 'mg-countdown' });
      const el = scene(
        h('div', { class: 'mg-head' }, h('h2', { class: 'display blood-text' }, 'Thappad Reflex'), ring.el),
        h('div', { class: 'mg-board' }, canvas, countdown),
        h('p', { class: 'hint' }, 'Doomed stars: play on your phone! Everyone else: enjoy the climax ', ic('popcorn'))
      );
      const startIn = state.minigame.playStartsInMs;
      const lead = leader();
      [
        ['3', 3000, false, 'tick'],
        ['2', 2000, false, 'tick'],
        ['1', 1000, false, 'tick'],
        ['THAPPAD!', 0, true, 'action'],
      ].forEach(([text, before, word, sfx]) => {
        const at = startIn - before;
        if (at < -300) return;
        tl.later(Math.max(0, at), () => {
          if (!lead.el.isConnected) countdown.replaceChildren(lead.el);
          lead.show(text, word);
          audio.sfx(sfx);
        });
      });
      tl.later(Math.max(0, startIn) + 800, () => countdown.replaceChildren());
      if (startIn > 2500) narrate('mgStart');

      const board = new MgBoard(canvas, () => S.state);
      board.start();
      return {
        el,
        update(st, prev) {
          // a thappad sound on the big screen for every slap that lands on a phone
          const before = (prev && prev.minigame && prev.minigame.progress) || {};
          const now = (st.minigame && st.minigame.progress) || {};
          if (Object.keys(now).some((id) => (now[id] || 0) > (before[id] || 0))) audio.sfx('slap');
        },
        destroy() {
          tl.clear();
          ring.destroy();
          board.stop();
        },
      };
    },

    KF_RESULT(state) {
      const tl = timeline();
      const k = state.kfResult;
      const maxT = Math.max(k.par, ...k.rows.map((r) => r.total || 0), 1);
      const rows = k.rows.map((r, i) => {
        const p = byId(state, r.id);
        const dies = k.deaths.includes(r.id);
        // show the condemned alive until the verdict lands
        const avatar = avatarEl({ ...p, alive: dies ? true : p.alive }, { name: false });
        const bar = h('i');
        const row = h(
          'div',
          { class: 'result-row rise-in', style: { '--d': `${i * 350}ms` } },
          h('div', { class: 'result-row__rank' }, `#${i + 1}`),
          avatar,
          h('div', { class: 'result-row__name' }, p.name),
          h('div', { class: 'result-row__bar' }, bar),
          h('div', { class: 'result-row__time' }, fmtMs(r.total)),
          h('div', { class: 'result-row__verdict' }, dies ? [ic('skull'), ' Kahani khatam'] : 'Bach gaya!')
        );
        return { row, avatar, bar, dies, pct: r.total == null ? 100 : (r.total / maxT) * 100 };
      });
      const banner = h('div', { class: 'verdict' });
      const el = scene(
        h('h2', { class: 'display gold-text', style: { fontSize: '8vh', margin: 0 } }, 'CUT!'),
        k.single ? h('div', { class: 'par-line' }, `Shaitaan Seth's time: ${fmtMs(k.par)}`) : null,
        h('div', { class: 'results' }, rows.map((r) => r.row)),
        banner
      );
      tl.later(350, () => rows.forEach((r) => r.bar.style.setProperty('--w', `${r.pct}%`)));
      tl.later(kfJudgeDelay(state), () => {
        const victims = [];
        rows.forEach((r, i) => {
          r.row.classList.add('is-judged', r.dies ? 'is-dead' : 'is-safe');
          if (r.dies) {
            victims.push(byId(state, k.rows[i].id).name);
            killAvatar(r.avatar, { onShatter: () => audio.sfx('shatter') });
          }
        });
        if (victims.length) {
          audio.sfx('death');
          banner.replaceChildren(h('span', { class: 'blood-text' }, listNames(victims)), victims.length > 1 ? ' are now bhoots ' : ' is now a bhoot ', ic('ghost'));
          narrate('death', { names: listNames(victims) });
        } else {
          audio.sfx('correct');
          banner.textContent = 'Everyone survives the climax!';
          narrate('survive');
        }
        replay(banner, 'pop-in');
      });
      return { el, destroy: tl.clear };
    },

    // ── the climax chase ──────────────────────────────────────────────────
    FINAL_INTRO(state) {
      const track = ensureTrack(state);
      track.snap(state);
      const revived = state.final.revivedId && byId(state, state.final.revivedId);
      const wrap = h('div', { class: 'track-wrap' }, track.canvas);
      const L = state.rules.trackLength;
      const el = scene(
        h('h1', { class: 'chase-title display gold-text flicker' }, 'Climax Chase'),
        h('div', { class: 'hindi', style: { fontSize: '4.4vh', marginTop: '-2vh' } }, 'भागो!'),
        revived ? h('div', { class: 'chip' }, `Picture abhi baaki hai! ${revived.name} gets one more take`) : null,
        h(
          'div',
          { class: 'chase-rules' },
          h(
            'div',
            { class: 'chase-rule chase-rule--living rise-in', style: { '--d': '500ms' } },
            h('h3', null, ic('run'), ' Zinda (the living)'),
            `+${state.rules.livingStep} step per correct answer. Reach the Studio Gate (space ${L}) to escape and WIN.`
          ),
          h(
            'div',
            { class: 'chase-rule chase-rule--ghost rise-in', style: { '--d': '900ms' } },
            h('h3', null, ic('ghost'), ' Bhoot (the dead)'),
            `+${state.rules.ghostStep} steps per correct answer. Land on or overtake a living star to steal their body! They become a bhoot and get flung back ${state.rules.knockback}.`
          )
        ),
        wrap
      );
      audio.sfx('stinger');
      narrate(revived ? 'finalRevive' : 'finalIntro', { name: revived && revived.name });
      return { el };
    },

    FINAL_QUESTION(state) {
      const track = ensureTrack(state);
      track.snap(state);
      const q = state.question;
      const ring = timerRing({ small: true });
      const counter = answeredCounter();
      const el = scene(
        h(
          'div',
          { class: 'q-head' },
          h('span', { class: 'chip' }, `Chase ${state.final.qNumber} / ${state.final.maxQuestions}`),
          h('span', { class: 'chip chip--blood' }, q.category)
        ),
        h('div', { class: 'track-wrap' }, track.canvas),
        h(
          'div',
          { class: 'chase-q' },
          ring.el,
          h('h2', { class: 'q-text display' }, q.text),
          h('div', { class: 'options options--two' }, q.options.map((t, i) => optionEl(t, i)))
        ),
        counter.el
      );
      counter.update(state);
      audio.sfx('whoosh');
      subtitles.replaceChildren();
      audio.say(q.text, { id: q.vo, rate: 1.08 });
      return { el, update: (st) => counter.update(st), destroy: ring.destroy };
    },

    FINAL_REVEAL(state) {
      const tl = timeline();
      const track = ensureTrack(state);
      const q = state.question;
      const lr = state.final.lastReveal;
      const optionEls = q.options.map((t, i) => optionEl(t, i, { animate: false }));
      const banner = h('div', { class: 'chase-banner' });
      const el = h(
        'div',
        { class: 'scene scene--static' },
        h(
          'div',
          { class: 'q-head' },
          h('span', { class: 'chip' }, `Chase ${state.final.qNumber} / ${state.final.maxQuestions}`),
          h('span', { class: 'chip chip--blood' }, q.category)
        ),
        h('div', { class: 'track-wrap' }, track.canvas),
        h('div', { class: 'chase-q' }, h('h2', { class: 'q-text display' }, q.text), h('div', { class: 'options options--two' }, optionEls)),
        banner
      );
      markOptions(optionEls, state, lr.correctIndex, lr.picks);
      track.animateReveal(state);

      const anyMoved = Object.values(lr.moves).some((m) => m.stepTo !== m.from);
      tl.later(650, () => anyMoved && audio.sfx('step'));
      tl.later(1000, () => anyMoved && audio.sfx('step'));
      const name = (id) => (byId(state, id) || {}).name;
      const possessions = lr.events.filter((e) => e.type === 'possess');
      const escape = lr.events.find((e) => e.type === 'escape');
      if (possessions.length) {
        tl.later(1750, () => {
          audio.sfx('possess');
          banner.replaceChildren(
            ...possessions.flatMap((e, i) => [
              i ? ' · ' : '',
              h('span', { class: 'blood-text' }, ic('ghost'), ` ${name(e.ghostId)} possessed ${name(e.victimId)}!`),
            ])
          );
          replay(banner, 'pop-in');
          narrate('possess', { ghost: name(possessions[0].ghostId), victim: name(possessions[0].victimId) });
        });
      }
      if (escape) {
        tl.later(possessions.length ? 3000 : 1500, () => {
          audio.sfx('win');
          banner.replaceChildren(h('span', { class: 'gold-text' }, ic('gate'), ` ${name(escape.playerId)} ESCAPES!`));
          replay(banner, 'pop-in');
          narrate('escape', { name: name(escape.playerId) });
        });
      }
      if (!possessions.length && !escape) {
        const movers = Object.values(lr.moves).filter((m) => m.correct).length;
        banner.textContent = movers ? '' : 'Nobody moves. Shaitaan Seth yawns.';
      }
      return { el, destroy: tl.clear };
    },

    // ── the end ───────────────────────────────────────────────────────────
    GAME_OVER(state) {
      const g = state.gameOver;
      const w = g.standings.find((s) => s.id === g.winnerId);
      const el = scene(
        h('h1', { class: 'the-end display gold-text flicker' }, 'The End'),
        h('div', { class: 'the-end-sub' }, '…ya phir? (or is it?)'),
        w
          ? h(
              'div',
              { class: 'winner pop-in', style: { '--d': '400ms' } },
              avatarEl({ ...w, alive: true }),
              h(
                'div',
                { class: 'winner__text' },
                h('div', { class: 'winner__name' }, w.name),
                h('div', { class: 'winner__title' }, ic('trophy'), g.reason === 'escaped' ? ' Escaped Kaali Haveli · Hero of the film' : ' Closest to the gate · Hero by default')
              )
            )
          : h('div', { class: 'verdict' }, 'Nobody escaped. Shaitaan Seth wins. Again.'),
        h(
          'ol',
          { class: 'standings' },
          g.standings.map((s, i) =>
            h(
              'li',
              { class: 'rise-in', style: { '--d': `${700 + i * 120}ms` } },
              h('span', { class: 'rank' }, `#${i + 1}`),
              avatarEl(s),
              h('span', null, `${fmtScore(s.score)} pts`)
            )
          )
        ),
        h(
          'div',
          { class: 'end-actions' },
          h('button', { class: 'btn', onclick: () => socket.emit('host:lobby') }, ic('clapper'), ' Same cast, new show'),
          h('button', { class: 'btn btn--quiet', onclick: () => createRoom() }, 'New room')
        )
      );
      fx.petals(170);
      audio.sfx('win');
      if (w) narrate(g.reason === 'escaped' ? 'winner' : 'timeUp', { name: w.name });
      else narrate('nobody');
      return { el };
    },
  };

  /** When (ms into KF_RESULT) the verdict lands. Shared by the stage and the cast strip. */
  function kfJudgeDelay(state) {
    return 500 + state.kfResult.rows.length * 350 + 700;
  }

  function ensureTrack(state) {
    if (!S.track) S.track = new ChaseTrack();
    S.track.sync(state);
    S.track.start();
    return S.track;
  }

  // ════════════════════════════════════════════════════════════ canvases ══
  /** Rounded rectangle path (ctx.roundRect isn't everywhere yet). */
  function rr(ctx, x, y, w, hgt, r) {
    const rad = Math.min(r, w / 2, hgt / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + hgt, rad);
    ctx.arcTo(x + w, y + hgt, x, y + hgt, rad);
    ctx.arcTo(x, y + hgt, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /** Size a canvas to its CSS box at device-pixel resolution. Returns [w, h] in CSS px. */
  function fitCanvas(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (!w || !hgt) return null;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hgt * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    return [w, hgt];
  }

  const ICON_D = {
    slap: 'M7 11.5V5.6a1.5 1.5 0 0 1 3 0V10M10 9.6V4.2a1.5 1.5 0 0 1 3 0v5.6M13 9.6V5.2a1.5 1.5 0 0 1 3 0v6M16 10.8V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-.8a6.2 6.2 0 0 1-4.8-2.3L3.3 15.2a1.6 1.6 0 0 1 2.4-2.1L7 14.6',
    gate: 'M5 21V9a7 7 0 0 1 14 0v12M3 21h18M12 3.2V21',
  };
  const GHOST_FILTER = 'grayscale(1) sepia(0.4) hue-rotate(140deg) saturate(1.8) brightness(1.15)';

  /** Stroke one of the 24×24 line icons onto a canvas, centred on (x, y). */
  function drawIcon(ctx, key, x, y, size, color, lineWidth = 2) {
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(new Path2D(ICON_D[key]));
    ctx.restore();
  }

  /** Draw a character's illustrated portrait (cached SVG image) as a disc. */
  function drawPortrait(ctx, id, x, y, r, ghost = false) {
    const img = art.image(id);
    ctx.save();
    if (img.complete && img.naturalWidth) {
      if (ghost) ctx.filter = GHOST_FILTER;
      ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#3b1150';
      ctx.fill();
    }
    ctx.restore();
  }

  /** Ambient embers drifting up from the diyas + marigold petal showers. */
  class AmbientFX {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.embers = [];
      this.petalList = [];
      this.last = performance.now();
      this.resize();
      window.addEventListener('resize', () => this.resize());
      for (let i = 0; i < 46; i++) this.embers.push(this.ember(true));
      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    }
    resize() {
      const dpr = window.devicePixelRatio || 1;
      this.W = window.innerWidth;
      this.H = window.innerHeight;
      this.c.width = this.W * dpr;
      this.c.height = this.H * dpr;
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    ember(anywhere) {
      return {
        x: rand(0, this.W),
        y: anywhere ? rand(0, this.H) : this.H + 10,
        vy: rand(14, 42),
        vx: rand(-8, 8),
        r: rand(0.8, 2.4),
        life: rand(0, 6.28),
        hue: rand(18, 44),
      };
    }
    petals(n) {
      const colors = ['#ff9f1c', '#ffb703', '#fb8500', '#f4c95d', '#e3173a'];
      for (let i = 0; i < n; i++) {
        this.petalList.push({
          x: rand(0, this.W),
          y: rand(-this.H * 0.7, -20),
          vy: rand(70, 150),
          vx: rand(-30, 30),
          rot: rand(0, 6.28),
          vr: rand(-3, 3),
          flutter: rand(1, 3),
          s: rand(6, 13),
          color: pickOne(colors),
        });
      }
    }
    loop(now) {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      const { ctx, W, H } = this;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < this.embers.length; i++) {
        const e = this.embers[i];
        e.y -= e.vy * dt;
        e.x += e.vx * dt + Math.sin(now / 900 + e.life) * 0.2;
        e.life += dt;
        if (e.y < -10) this.embers[i] = this.ember(false);
        const a = 0.25 + 0.3 * Math.abs(Math.sin(e.life * 2.2));
        ctx.fillStyle = `hsla(${e.hue}, 100%, 60%, ${a})`;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      this.petalList = this.petalList.filter((p) => p.y < H + 30);
      for (const p of this.petalList) {
        p.y += p.vy * dt;
        p.x += p.vx * dt + Math.sin(now / 500 + p.rot) * 0.6;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(Math.cos(now / 300 * p.flutter + p.rot), 1);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      requestAnimationFrame(this.loop);
    }
  }

  /** Live view of the Thappad Reflex: one row per doomed player, slap slots fill as phones report hits. */
  class MgBoard {
    constructor(canvas, getState) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.getState = getState;
      this.seen = {}; // id → { hits, at } for slot pop animations
      this.raf = 0;
      this.loop = this.loop.bind(this);
    }
    start() {
      this.raf = requestAnimationFrame(this.loop);
    }
    stop() {
      cancelAnimationFrame(this.raf);
    }
    loop(now) {
      this.draw(now);
      this.raf = requestAnimationFrame(this.loop);
    }
    draw(now) {
      const st = this.getState();
      if (!st || st.phase !== 'MINIGAME' || !st.minigame) return;
      const size = fitCanvas(this.canvas, this.ctx);
      if (!size) return;
      const [W, H] = size;
      const ctx = this.ctx;
      const doomed = st.doomed.map((id) => byId(st, id)).filter(Boolean);
      const T = st.minigame.targets;
      const n = Math.max(1, doomed.length);
      const rowH = Math.min(H / n, H * 0.34);
      const top = (H - rowH * n) / 2;

      doomed.forEach((p, i) => {
        const cy = top + rowH * (i + 0.5);
        const hits = st.minigame.progress[p.id] || 0;
        const done = st.minigame.finished.includes(p.id);
        const seen = this.seen[p.id] || (this.seen[p.id] = { hits: 0, at: 0 });
        if (hits > seen.hits) Object.assign(seen, { hits, at: now });

        // spotlight band
        const g = ctx.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, 'rgba(227,23,58,0.22)');
        g.addColorStop(1, 'rgba(227,23,58,0.02)');
        ctx.fillStyle = g;
        rr(ctx, 0, cy - rowH * 0.42, W, rowH * 0.84, 14);
        ctx.fill();

        // avatar + name
        const ar = rowH * 0.3;
        const ax = ar + 18;
        drawPortrait(ctx, p.avatar.id, ax, cy, ar);
        ctx.beginPath();
        ctx.arc(ax, cy, ar + 1.5, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = p.avatar.color;
        ctx.stroke();
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${Math.round(Math.min(rowH * 0.24, 30))}px Mukta, sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillStyle = '#f7e7c4';
        ctx.fillText(p.name, ax + ar + 16, cy);

        // slap slots
        const x0 = W * 0.36;
        const x1 = W * 0.84;
        const step = (x1 - x0) / T;
        const sr = Math.min(step * 0.36, rowH * 0.28);
        for (let k = 0; k < T; k++) {
          const sx = x0 + step * (k + 0.5);
          const filled = hits > k;
          const fresh = filled && k === hits - 1 && now - seen.at < 450;
          const scale = fresh ? 1 + 0.5 * (1 - (now - seen.at) / 450) : 1;
          ctx.beginPath();
          ctx.arc(sx, cy, sr * scale, 0, Math.PI * 2);
          if (filled) {
            ctx.fillStyle = '#e3173a';
            ctx.fill();
            drawIcon(ctx, 'slap', sx, cy, sr * 1.25 * scale, '#fff3d6', 2.2);
          } else {
            ctx.setLineDash([5, 5]);
            ctx.lineWidth = 2;
            ctx.strokeStyle = 'rgba(247,231,196,0.35)';
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        // status
        ctx.textAlign = 'right';
        ctx.font = `800 ${Math.round(Math.min(rowH * 0.22, 28))}px Mukta, sans-serif`;
        if (done) {
          ctx.fillStyle = '#f4c95d';
          ctx.fillText('CUT! ✓', W - 16, cy);
        } else {
          ctx.fillStyle = `rgba(247,231,196,${0.4 + 0.4 * Math.abs(Math.sin(now / 300))})`;
          ctx.fillText(p.connected ? 'slapping…' : 'offline…', W - 16, cy);
        }
      });
    }
  }

  /**
   * The Climax Chase board: a film strip with one lane per player and one
   * frame per space. Tokens hop forward with easing; possessions draw a
   * lightning bolt and swap ghost/living styles mid-animation.
   */
  class ChaseTrack {
    constructor() {
      this.canvas = h('canvas', { class: 'track-canvas' });
      this.ctx = this.canvas.getContext('2d');
      this.disp = new Map(); // id → { pos, alive, tween, screen }
      this.effects = [];
      this.timers = [];
      this.players = [];
      this.L = 12;
      this.ghostStep = 2;
      this.raf = 0;
      this.loop = this.loop.bind(this);
    }
    start() {
      if (!this.raf) this.raf = requestAnimationFrame(this.loop);
    }
    destroy() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.clearTimers();
      this.canvas.remove();
    }
    clearTimers() {
      this.timers.forEach(clearTimeout);
      this.timers = [];
    }
    later(ms, fn) {
      this.timers.push(setTimeout(fn, ms));
    }
    sync(state) {
      this.players = state.players;
      this.L = state.rules.trackLength;
      this.ghostStep = state.rules.ghostStep;
      for (const p of state.players) if (!this.disp.has(p.id)) this.disp.set(p.id, { pos: p.position, alive: p.alive, tween: null });
    }
    snap(state) {
      this.sync(state);
      this.clearTimers();
      for (const p of state.players) Object.assign(this.disp.get(p.id), { pos: p.position, alive: p.alive, tween: null });
    }
    tweenTo(d, to, dur) {
      d.tween = { from: d.pos, to, t0: performance.now(), dur };
    }
    animateReveal(state) {
      this.sync(state);
      this.clearTimers();
      const lr = state.final.lastReveal;
      for (const p of state.players) {
        const m = lr.moves[p.id];
        const d = this.disp.get(p.id);
        if (!m) continue;
        Object.assign(d, { pos: m.from, alive: m.wasAlive, tween: null });
        if (m.stepTo !== m.from) this.later(650, () => this.tweenTo(d, m.stepTo, 650));
      }
      for (const e of lr.events) {
        if (e.type === 'possess') {
          this.later(1750, () => {
            const g = this.disp.get(e.ghostId);
            const v = this.disp.get(e.victimId);
            g.alive = true;
            v.alive = false;
            this.effects.push({ type: 'possess', from: e.ghostId, to: e.victimId, t0: performance.now(), dur: 1300 });
            this.tweenTo(v, lr.moves[e.victimId].to, 650);
          });
        } else if (e.type === 'escape') {
          this.later(1400, () => this.effects.push({ type: 'escape', id: e.playerId, t0: performance.now(), dur: 2200 }));
        }
      }
      // whatever happens, end on the server's truth
      this.later(3300, () => {
        for (const p of state.players) {
          const d = this.disp.get(p.id);
          if (!d.tween) Object.assign(d, { pos: p.position, alive: p.alive });
        }
      });
    }
    loop(now) {
      this.draw(now);
      this.raf = requestAnimationFrame(this.loop);
    }
    draw(now) {
      const size = fitCanvas(this.canvas, this.ctx);
      if (!size) return;
      const [W, H] = size;
      const ctx = this.ctx;
      const L = this.L;
      const cols = L + 1;
      const labelW = Math.min(W * 0.15, 190);
      const x0 = labelW;
      const x1 = W - 6;
      const colW = (x1 - x0) / cols;
      const headH = Math.max(20, H * 0.11);
      const holeBand = Math.max(8, H * 0.05);
      const top = headH + holeBand;
      const bottom = H - holeBand;
      const n = Math.max(1, this.players.length);
      const laneH = (bottom - top) / n;

      // film strip base + sprocket holes
      ctx.fillStyle = '#0c0412';
      rr(ctx, x0 - 4, headH, x1 - x0 + 8, H - headH, 10);
      ctx.fill();
      ctx.fillStyle = 'rgba(247,231,196,0.16)';
      const holeW = Math.max(5, colW * 0.2);
      for (let x = x0 + colW * 0.15; x < x1 - holeW; x += colW / 2) {
        rr(ctx, x, headH + holeBand * 0.25, holeW, holeBand * 0.5, 2);
        ctx.fill();
        rr(ctx, x, bottom + holeBand * 0.25, holeW, holeBand * 0.5, 2);
        ctx.fill();
      }

      // frames (spaces) + header numbers
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let i = 0; i < cols; i++) {
        const fx = x0 + i * colW;
        const gate = i === L;
        if (gate) {
          const g = ctx.createLinearGradient(fx, 0, fx + colW, 0);
          g.addColorStop(0, 'rgba(244,201,93,0.18)');
          g.addColorStop(1, `rgba(244,201,93,${0.4 + 0.15 * Math.sin(now / 400)})`);
          ctx.fillStyle = g;
        } else {
          ctx.fillStyle = i % 2 ? 'rgba(59,17,80,0.6)' : 'rgba(40,12,56,0.6)';
        }
        rr(ctx, fx + 2, top, colW - 4, bottom - top, 6);
        ctx.fill();
        if (gate) {
          drawIcon(ctx, 'gate', fx + colW / 2, headH / 2, headH * 0.78, '#f4c95d', 2.2);
        } else {
          ctx.font = `800 ${Math.round(headH * 0.5)}px Mukta, sans-serif`;
          ctx.fillStyle = 'rgba(247,231,196,0.5)';
          ctx.fillText(String(i), fx + colW / 2, headH / 2);
        }
      }

      // which living players are within a bhoot's reach next turn?
      const inReach = new Set();
      for (const p of this.players) {
        const d = this.disp.get(p.id);
        if (!d || !d.alive) continue;
        for (const q of this.players) {
          const g = this.disp.get(q.id);
          if (g && !g.alive && g.pos < d.pos && d.pos <= g.pos + this.ghostStep && g.pos + 1 < L) inReach.add(p.id);
        }
      }

      // lanes + tokens
      this.players.forEach((p, i) => {
        const d = this.disp.get(p.id);
        if (!d) return;
        const cy = top + laneH * (i + 0.5);
        if (i) {
          ctx.strokeStyle = 'rgba(255,255,255,0.05)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x0, top + laneH * i);
          ctx.lineTo(x1, top + laneH * i);
          ctx.stroke();
        }
        // label
        ctx.textAlign = 'right';
        ctx.font = `800 ${Math.round(Math.min(22, laneH * 0.4))}px Mukta, sans-serif`;
        ctx.fillStyle = d.alive ? '#f7e7c4' : '#a6e3e9';
        const label = p.name.length > 11 ? `${p.name.slice(0, 10)}…` : p.name;
        ctx.fillText(label, x0 - 12, cy);

        // position (with hop easing)
        let pos = d.pos;
        let hop = 0;
        if (d.tween) {
          const t = Math.min(1, (now - d.tween.t0) / d.tween.dur);
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          pos = d.tween.from + (d.tween.to - d.tween.from) * e;
          const steps = Math.max(1, Math.round(Math.abs(d.tween.to - d.tween.from)));
          hop = Math.abs(Math.sin(e * Math.PI * steps)) * laneH * 0.22;
          if (t >= 1) {
            d.pos = d.tween.to;
            d.tween = null;
          }
        }
        const cx = x0 + colW * (pos + 0.5);
        const r = Math.max(6, Math.min(laneH * 0.4, colW * 0.42));
        let y = cy - hop;
        if (!d.alive) y += Math.sin(now / 420 + i) * laneH * 0.06;

        ctx.save();
        if (inReach.has(p.id)) {
          ctx.beginPath();
          ctx.arc(cx, y, r * (1.25 + 0.12 * Math.sin(now / 160)), 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(227,23,58,0.7)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        if (!d.alive) ctx.globalAlpha = 0.78;
        drawPortrait(ctx, p.avatar.id, cx, y, r, !d.alive);
        ctx.beginPath();
        ctx.arc(cx, y, r + 1, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, r * 0.12);
        ctx.strokeStyle = d.alive ? '#f4c95d' : '#a6e3e9';
        if (!d.alive) {
          ctx.shadowColor = '#a6e3e9';
          ctx.shadowBlur = 16;
        }
        ctx.stroke();
        ctx.restore();
        d.screen = { x: cx, y, r };
      });

      // effects: possession lightning, escape bursts
      this.effects = this.effects.filter((fx) => now - fx.t0 < fx.dur);
      for (const fx of this.effects) {
        const t = (now - fx.t0) / fx.dur;
        if (fx.type === 'possess') {
          const a = this.disp.get(fx.from)?.screen;
          const b = this.disp.get(fx.to)?.screen;
          if (!a || !b) continue;
          ctx.save();
          ctx.strokeStyle = `rgba(166,227,233,${1 - t})`;
          ctx.shadowColor = '#e3173a';
          ctx.shadowBlur = 18;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          const segs = 7;
          for (let s = 1; s < segs; s++) {
            const k = s / segs;
            ctx.lineTo(a.x + (b.x - a.x) * k + rand(-12, 12), a.y + (b.y - a.y) * k + rand(-12, 12));
          }
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r * (1 + t * 2.4), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(227,23,58,${1 - t})`;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.font = `800 ${Math.round(Math.max(14, b.r * 0.8))}px Mukta, sans-serif`;
          ctx.textAlign = 'center';
          ctx.fillStyle = `rgba(227,23,58,${1 - t})`;
          ctx.fillText('POSSESSED!', b.x, b.y - b.r * 1.6 - t * 20);
          ctx.restore();
        } else if (fx.type === 'escape') {
          const s = this.disp.get(fx.id)?.screen;
          if (!s) continue;
          for (let k = 0; k < 3; k++) {
            const tt = Math.max(0, t - k * 0.15);
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * (1 + tt * 4), 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(244,201,93,${Math.max(0, 1 - tt)})`;
            ctx.lineWidth = 4;
            ctx.stroke();
          }
        }
      }
    }
  }

  // ═════════════════════════════════════════════════════ chrome & input ══
  function showToast(text, kind, autoHideMs) {
    S.toastKind = kind;
    toastEl.textContent = text;
    toastEl.hidden = false;
    if (autoHideMs) setTimeout(() => hideToast(kind), autoHideMs);
  }
  function hideToast(kind) {
    if (!kind || S.toastKind === kind) {
      toastEl.hidden = true;
      S.toastKind = null;
    }
  }

  function setMuted(m) {
    audio.setMuted(m);
    $('muteBtn').replaceChildren(ic(m ? 'mute' : 'sound'));
    local.set('mkm.muted', m);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  }

  $('muteBtn').addEventListener('click', () => setMuted(!audio.muted));
  $('fsBtn').addEventListener('click', toggleFullscreen);
  toastEl.addEventListener('click', () => S.toastKind === 'sound' && unlockAudio());
  document.addEventListener('pointerdown', () => !audio.ready && unlockAudio());
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'm' || e.key === 'M') setMuted(!audio.muted);
    if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    if (DEV && (e.key === 's' || e.key === 'S')) socket.emit('host:skip');
  });

  // boot
  S.sky = skyScene();
  $('skyMount').replaceWith(S.sky);
  S.curtains = curtains();
  $('curtainMount').replaceWith(S.curtains);
  $('projectorMount').replaceWith(projector());
  S.burnEl = $('burn');
  $('fsBtn').replaceChildren(ic('expand'));
  const fx = new AmbientFX($('fx'));
  const diyaRow = $('diyaRow');
  for (let i = 0; i < 11; i++) diyaRow.appendChild(diyaEl());
  setMuted(!!local.get('mkm.muted'));
})();
