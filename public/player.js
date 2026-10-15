/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  player.js: the phone controller.
 *
 *  The server decides what this phone shows. Each `player:state` snapshot
 *  carries the phase plus only this player's private data; we re-render
 *  per phase and patch in place for same-phase updates.
 *
 *  Robustness:
 *   • Session (room, playerId, secret token) lives in localStorage, so a
 *     refresh, a locked screen or a dropped Wi-Fi just reclaims the seat.
 *   • "Intents" (answers, mini-game results) are remembered until the server
 *     acknowledges them and re-sent after a reconnect, so nothing gets lost
 *     in a tunnel. The server ignores duplicates.
 *   • The Thappad Reflex times itself locally, so lag can't kill you.
 * ═══════════════════════════════════════════════════════════════════════════
 */
(() => {
  'use strict';

  const { h, PhaseClock, local, avatarEl, killAvatar, reviveAvatar, fmtScore, fmtMs, rand, pickOne } = window.MKM;
  const { ic, miniSprite, skyScene, burn } = window.MKM;
  const art = window.MKM.art;

  /** Big illustration for a screen: an icon name, 'shaitaan' / 'maa', or a DOM node. */
  function heroArt(what, tone = '') {
    let node = what;
    if (what === 'shaitaan' || what === 'maa') node = art.el(art.sprite(what));
    else if (typeof what === 'string') node = ic(what);
    return h('div', { class: `hero-art${tone ? ` hero-art--${tone}` : ''} pop-in` }, node);
  }

  const app = document.getElementById('app');
  const burnEl = document.getElementById('burn');
  const sky = skyScene();
  document.getElementById('skyMount').replaceWith(sky);
  art.image('shaitaan');
  art.image('maa'); // decode the slap-game sprites before they're needed
  const hud = document.getElementById('hud');
  const connBanner = document.getElementById('connBanner');

  const audio = new window.MKMAudio.AudioEngine();
  audio.voiceEnabled = false; // the host screen does the talking
  const clock = new PhaseClock();
  const socket = io({ reconnectionDelayMax: 3000 });

  const S = {
    state: null,
    phaseKey: null,
    view: null,
    session: local.get('mkm.player'), // { code, playerId, token }
    joined: false,
    replaced: false,
    resync: false,
    intents: [], // [{ event, payload, phaseKey, ackd }]
    ghostShown: null, // whether the ghost theme is currently applied
    wakeLock: null,
  };

  window.__mkm = { S, socket }; // handy in devtools while prototyping

  const vibrate = (pattern) => {
    try {
      navigator.vibrate && navigator.vibrate(pattern);
    } catch {
      /* not supported */
    }
  };

  // ══════════════════════════════════════════════════════════ connection ══
  let connTimer = null;
  socket.on('connect', () => {
    clearTimeout(connTimer);
    connBanner.hidden = true;
    setConnDot(true);
    if (S.replaced) return;
    if (S.session) rejoin();
    else if (!S.state) showJoin();
  });

  socket.on('disconnect', () => {
    S.joined = false;
    setConnDot(false);
    connTimer = setTimeout(() => (connBanner.hidden = false), 1200); // ignore blips
  });

  socket.on('player:state', onState);

  socket.on('room:closed', ({ reason, replaced }) => {
    if (replaced) {
      S.replaced = true;
      return showMessage('offline', 'Opened elsewhere', reason);
    }
    clearSession();
    return showJoin(reason);
  });

  function rejoin() {
    socket.emit('player:rejoin', S.session, (res) => {
      if (res && res.ok) {
        S.joined = true;
        S.resync = true; // re-send anything the server never acknowledged
      } else {
        clearSession();
        showJoin('Your seat in that room is gone. Join again!');
      }
    });
  }

  function clearSession() {
    S.session = null;
    S.joined = false;
    S.intents = [];
    local.del('mkm.player');
  }

  function setConnDot(on) {
    const dot = hud.querySelector('.conn-dot');
    if (dot) dot.classList.toggle('is-off', !on);
  }

  /** Send an intent the server must not miss (answers, mini-game results). */
  function sendIntent(event, payload, onFail) {
    const intent = { event, payload, phaseKey: S.state && S.state.phaseKey, ackd: false, onFail };
    S.intents.push(intent);
    emitIntent(intent);
  }

  function emitIntent(intent) {
    if (!socket.connected || !S.joined) return; // retried after the next rejoin
    socket.emit(intent.event, intent.payload, (res) => {
      if (!res) return;
      if (res.ok || /already/i.test(res.error || '')) intent.ackd = true;
      else {
        intent.ackd = true; // a real refusal: don't retry, tell the UI
        if (intent.onFail) intent.onFail(res.error);
      }
    });
  }

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible') {
        S.wakeLock = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* low battery mode etc. */
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.session) requestWakeLock();
  });

  // ═══════════════════════════════════════════════════════ state routing ══
  function onState(state) {
    const prev = S.state;
    const phaseChanged = !prev || state.phaseKey !== S.phaseKey || state.code !== prev.code;
    S.state = state;
    clock.sync(state);

    S.intents = S.intents.filter((i) => i.phaseKey === state.phaseKey);
    if (S.resync) {
      S.resync = false;
      S.intents.filter((i) => !i.ackd).forEach(emitIntent);
    }

    if (phaseChanged) {
      S.phaseKey = state.phaseKey;
      enter(state, prev);
    } else if (S.view && S.view.update) {
      S.view.update(state, prev);
    }
    renderHud(state);
  }

  function enter(state, prev) {
    if (S.view && S.view.destroy) S.view.destroy();
    const build = SCREENS[state.phase] || SCREENS.WATCH;
    S.view = build(state, prev) || {};
    app.replaceChildren(S.view.el || h('div'));
    if (prev) burn(burnEl);
    sky.classList.toggle('is-dim', state.phase !== 'LOBBY');
    // apply the ghost theme now, unless this screen choreographs the moment itself
    if (!S.view.ownsGhostTheme) applyGhostTheme(!state.you.alive);
  }

  function applyGhostTheme(ghost) {
    S.ghostShown = ghost;
    document.body.classList.toggle('is-ghost', ghost);
  }

  function renderHud(state) {
    const y = state.you;
    // mirror the *displayed* life state so the HUD never spoils a death animation
    const shownAlive = S.ghostShown === null ? y.alive : !S.ghostShown;
    hud.hidden = false;
    hud.replaceChildren(
      avatarEl({ ...y, alive: shownAlive }, { name: false }),
      h('div', { class: 'hud__who' }, h('span', { class: 'hud__name' }, y.name), h('span', { class: 'hud__role' }, y.avatar.role)),
      h(
        'div',
        { class: 'hud__right' },
        h('span', { class: 'hud__score' }, `${fmtScore(y.score)} pts`),
        h(
          'span',
          { class: 'hud__status' },
          h('span', { class: `conn-dot${socket.connected ? '' : ' is-off'}` }),
          shownAlive ? 'Zinda' : [ic('ghost'), ' Bhoot'],
          `  ·  ${state.code}`
        )
      )
    );
  }

  const screen = (cls, ...children) => h('div', { class: `screen ${cls || ''}`.trim() }, ...children);

  /** Thin countdown bar driven by the synced clock. */
  function timeBar() {
    const fillEl = h('i');
    const el = h('div', { class: 'timebar' }, fillEl);
    let raf = 0;
    const tick = () => {
      el.style.setProperty('--p', clock.fraction().toFixed(4));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return { el, destroy: () => cancelAnimationFrame(raf) };
  }

  // ═════════════════════════════════════════════════════════ join screen ══
  function showJoin(note) {
    if (S.view && S.view.destroy) S.view.destroy();
    S.view = null;
    S.state = null;
    S.phaseKey = null;
    hud.hidden = true;
    applyGhostTheme(false);

    const params = new URLSearchParams(location.search);
    const codeIn = h('input', {
      class: 'field field--code',
      id: 'code',
      maxlength: '4',
      autocapitalize: 'characters',
      autocomplete: 'off',
      autocorrect: 'off',
      spellcheck: 'false',
      placeholder: 'ABCD',
      value: (params.get('room') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4),
    });
    const nameIn = h('input', {
      class: 'field',
      id: 'name',
      maxlength: '14',
      autocomplete: 'nickname',
      placeholder: 'Your stage name',
      value: local.get('mkm.name') || '',
    });
    const err = h('p', { class: 'join-error', role: 'alert' }, note || '');
    const btn = h('button', { class: 'btn btn--blood btn--wide', type: 'submit' }, ic('clapper'), ' Join the Cast');
    codeIn.addEventListener('input', () => {
      codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    });

    const join = () => {
      audio.unlock();
      requestWakeLock();
      const code = codeIn.value.trim().toUpperCase();
      const name = nameIn.value.trim();
      if (code.length !== 4) {
        err.textContent = 'Room codes are 4 letters. Check the big screen.';
        return;
      }
      if (!name) {
        err.textContent = 'Every star needs a name!';
        return;
      }
      btn.disabled = true;
      err.textContent = '';
      local.set('mkm.name', name);
      socket.emit('player:join', { code, name }, (res) => {
        btn.disabled = false;
        if (!res || !res.ok) {
          err.textContent = (res && res.error) || 'Could not join.';
          return;
        }
        S.session = { code: res.code, playerId: res.playerId, token: res.token };
        S.joined = true;
        local.set('mkm.player', S.session);
        if (params.has('room')) history.replaceState(null, '', location.pathname);
        audio.sfx('join');
        vibrate(30);
      });
    };

    const el = screen(
      'screen--top',
      h('div', { class: 'join-seth' }, art.el(art.portrait('seth'))),
      h('h1', { class: 'title join-logo gold-text flicker' }, 'Maut Ka Mahurat'),
      h('div', { class: 'join-logo-hi hindi' }, 'मौत का मुहूर्त'),
      h('p', { class: 'muted' }, 'A Bollywood Trivia Murder Party'),
      h(
        'form',
        {
          class: 'join-form',
          onsubmit: (e) => {
            e.preventDefault();
            join();
          },
        },
        h('label', { for: 'code' }, 'Room code'),
        codeIn,
        h('label', { for: 'name' }, 'Your name'),
        nameIn,
        btn,
        err
      ),
      h('p', { class: 'muted', style: { fontSize: '14px' } }, 'Your phone is your controller. Keep this tab open while you play.')
    );
    app.replaceChildren(el);
    (codeIn.value ? nameIn : codeIn).focus();
  }

  function showMessage(emoji, title, body) {
    if (S.view && S.view.destroy) S.view.destroy();
    S.view = null;
    app.replaceChildren(
      screen(
        '',
        heroArt(emoji),
        h('h2', { class: 'title gold-text' }, title),
        h('p', { class: 'subtitle' }, body || ''),
        h('button', { class: 'btn btn--quiet', onclick: () => location.reload() }, 'Use this phone instead')
      )
    );
  }

  // ═════════════════════════════════════════════════════════════ screens ══
  const SCREENS = {
    WATCH(state) {
      return {
        el: screen(
          '',
          heroArt('eye'),
          h('h2', { class: 'title gold-text' }, 'Eyes on the big screen'),
          h('p', { class: 'subtitle' }, state.you.alive ? 'Shaitaan Seth is setting up the next shot…' : 'Even bhoots love a good picture.')
        ),
      };
    },

    LOBBY(state) {
      const startBtn = h(
        'button',
        {
          class: 'btn btn--wide',
          onclick: () => {
            startBtn.disabled = true;
            socket.emit('player:start', {}, (res) => {
              if (res && !res.ok) {
                startBtn.disabled = false;
                hint.textContent = res.error;
              }
            });
          },
        },
        ic('clapper'),
        " Everybody's in!"
      );
      const count = h('p', { class: 'muted' });
      const hint = h('p', { class: 'muted', style: { fontSize: '14px' } });
      const vipBox = h('div', { style: { width: '100%', display: 'grid', gap: '8px' } });
      const el = screen(
        '',
        h('div', { class: 'you-big pop-in' }, avatarEl(state.you)),
        h('h2', { class: 'title gold-text' }, `You're in, ${state.you.name}!`),
        h('p', { class: 'subtitle role-line' }, 'Tonight you play ', h('b', null, state.you.avatar.role)),
        count,
        vipBox,
        h(
          'button',
          {
            class: 'link-btn',
            onclick: () => {
              socket.emit('player:leave', {}, () => {});
              clearSession();
              showJoin();
            },
          },
          'Leave room'
        )
      );
      const update = (st) => {
        count.textContent = `${st.playerCount} star${st.playerCount === 1 ? '' : 's'} in the room · ${st.totalRounds} scenes`;
        if (st.you.isVIP) {
          vipBox.replaceChildren(h('div', { class: 'chip' }, ic('crown'), ' You are the VIP'), startBtn, hint);
          startBtn.disabled = !st.canStart;
          hint.textContent = st.canStart ? 'Start when everyone has joined.' : `Waiting for at least ${st.minPlayers} players…`;
        } else {
          vipBox.replaceChildren(h('p', { class: 'muted' }, `Waiting for ${st.vipName || 'the VIP'} (VIP) or the host to roll camera…`));
        }
      };
      update(state);
      return { el, update };
    },

    INTRO(state) {
      return {
        el: screen(
          '',
          heroArt('clapper'),
          h('h2', { class: 'title gold-text' }, 'The film begins'),
          h('p', { class: 'subtitle' }, `${state.totalRounds} scenes of filmy trivia. Wrong answers face the Climax Scene. Watch the big screen!`)
        ),
      };
    },

    QUESTION: (state) => questionScreen(state, false),
    FINAL_QUESTION: (state) => questionScreen(state, true),

    REVEAL(state) {
      const r = state.result;
      const y = state.you;
      let emoji;
      let title;
      let body;
      let tone;
      if (r.correct) {
        [emoji, title, tone] = ['check', 'Sahi jawab!', 'good'];
        body = y.alive ? 'You live… for now.' : 'Not bad, for a bhoot.';
        audio.sfx('correct');
        vibrate(40);
      } else if (r.doomed) {
        [emoji, title, tone] = [r.choice == null ? 'stopwatch' : 'knife', r.choice == null ? 'Time up!' : 'Galat jawab!', 'bad'];
        body = 'Report to the Climax Scene!';
        audio.sfx('wrong');
        vibrate([80, 60, 80]);
      } else {
        [emoji, title, tone] = ['ghost', r.choice == null ? 'Too slow, bhoot' : 'Even bhoots get it wrong', 'bad'];
        body = "Good thing you're already dead.";
      }
      const el = screen(
        `flash-${tone}`,
        heroArt(emoji, tone === 'good' ? '' : emoji === 'ghost' ? 'ghost' : 'blood'),
        h('h2', { class: `title ${tone === 'good' ? 'gold-text' : 'blood-text'}` }, title),
        r.delta ? h('div', { class: 'points pop-in', style: { '--d': '200ms' } }, `+${fmtScore(r.delta)}`) : null,
        r.correct ? null : h('p', { class: 'muted' }, 'Correct answer: ', h('b', { style: { color: 'var(--gold)' } }, r.correctText)),
        h('p', { class: 'subtitle' }, body)
      );
      return { el };
    },

    KF_INTRO(state) {
      if (!state.doomed) return safeScreen(state);
      const single = state.doomedCount === 1;
      vibrate([60, 40, 60, 40, 200]);
      return {
        el: screen(
          'flash-bad',
          heroArt('shaitaan'),
          h('h2', { class: 'title blood-text flicker' }, 'The Climax Scene'),
          h('p', { class: 'subtitle' }, 'Get ready for ', h('b', { style: { color: 'var(--gold)' } }, 'Thappad Reflex')),
          h(
            'ul',
            { class: 'rule-list' },
            h('li', null, miniSprite('shaitaan'), ' When the Shaitaan pops up, TAP him as fast as you can'),
            h('li', null, miniSprite('maa'), ' Never slap Maa! (+0.6s of shame)'),
            h('li', null, ic('noslap'), ' Tapping empty squares costs +0.25s'),
            h(
              'li',
              null,
              ic('stopwatch'),
              single ? ` Beat Shaitaan Seth's ${fmtMs(state.rules.mgPar)} or die` : state.doomedCount >= 4 ? ' The two slowest die' : ' The slowest slapper dies'
            )
          )
        ),
      };
    },

    MINIGAME(state) {
      if (!state.doomed) return safeScreen(state);
      return thappadScreen(state);
    },

    KF_RESULT(state) {
      const k = state.kf;
      if (!k.wasDoomed) {
        return {
          el: screen(
            '',
            heroArt(k.victims.length ? 'coffin' : 'popcorn', k.victims.length ? 'blood' : ''),
            h('h2', { class: 'title gold-text' }, k.victims.length ? 'Cut!' : 'Nobody died'),
            h('p', { class: 'subtitle' }, k.victims.length ? `${k.victims.join(' & ')} ${k.victims.length > 1 ? 'are' : 'is'} now a bhoot.` : 'Watch the big screen.')
          ),
        };
      }
      if (!k.died) {
        audio.sfx('correct');
        vibrate(40);
        return {
          el: screen(
            'flash-good',
            heroArt('sparkle'),
            h('h2', { class: 'title gold-text' }, 'Bach gaye!'),
            h('p', { class: 'subtitle' }, `Your time: ${fmtMs(k.total)}`),
            h('p', { class: 'muted' }, 'You survived the climax.')
          ),
        };
      }
      // The big death moment: the avatar shatters, the phone turns spectral.
      const avatarWrap = h('div', { class: 'death-avatar' }, avatarEl({ ...state.you, alive: true }));
      const title = h('h2', { class: 'title blood-text' }, 'Kahani khatam…');
      const body = h('p', { class: 'subtitle' }, k.total == null ? "You didn't finish the scene." : `Your time: ${fmtMs(k.total)}`);
      const el = screen('', avatarWrap, title, body);
      const t1 = setTimeout(() => {
        vibrate([200, 80, 400]);
        audio.sfx('death');
        killAvatar(avatarWrap.firstChild, {
          onShatter: () => audio.sfx('shatter'),
          onGhost: () => {
            applyGhostTheme(true);
            renderHud(S.state);
            title.replaceChildren('You are now a Bhoot ', ic('ghost'));
            title.className = 'title gold-text';
            body.textContent = 'Keep answering. In the Climax Chase you can steal a living body!';
          },
        });
      }, 900);
      return { el, ownsGhostTheme: true, destroy: () => clearTimeout(t1) };
    },

    FINAL_INTRO(state) {
      const y = state.you;
      const L = state.rules.trackLength;
      const items = y.alive
        ? [
            ['run', ` +${state.rules.livingStep} step for every correct answer`],
            ['gate', ` Reach space ${L} (the Studio Gate) to escape and WIN`],
            ['ghost', ` Bhoots move ${state.rules.ghostStep} at a time. If one lands on or passes you, it steals your body!`],
          ]
        : [
            ['ghost', ` +${state.rules.ghostStep} steps for every correct answer`],
            ['fire', ' Land on or overtake a living star to steal their body and come back to life'],
            ['gate', ` Bhoots can't escape. Get a body first, then run for space ${L}!`],
          ];
      return {
        el: screen(
          '',
          heroArt(y.alive ? 'run' : 'ghost', y.alive ? '' : 'ghost'),
          h('h2', { class: `title ${y.alive ? 'gold-text' : 'gold-text'} flicker` }, y.alive ? 'Run!' : 'Hunt!'),
          h('p', { class: 'subtitle' }, `Climax Chase · you start on space ${y.position}`),
          h('ul', { class: 'rule-list' }, items.map(([icon, t]) => h('li', null, ic(icon), t)))
        ),
      };
    },

    FINAL_REVEAL(state) {
      const pos = state.you.position;
      const m = state.move || { from: pos, stepTo: pos, to: pos, correct: false };
      const possessedMe = state.events.find((e) => e.type === 'possess' && e.victimId === state.you.id);
      const iPossessed = state.events.find((e) => e.type === 'possess' && e.ghostId === state.you.id);
      const escaped = state.events.find((e) => e.type === 'escape' && e.playerId === state.you.id);
      const steps = m.stepTo - m.from;
      let emoji = m.correct ? 'run' : 'stopwatch';
      let title = m.correct ? (steps > 0 ? `+${steps} → space ${m.stepTo}` : 'Correct!') : 'No move';
      let body = m.correct ? 'Keep going!' : `Correct answer: ${state.correctText}`;
      let cls = m.correct ? 'gold-text' : 'blood-text';
      let tone = m.correct ? 'good' : 'bad';
      if (escaped) {
        [emoji, title, body, cls, tone] = ['gate', 'You escaped!', 'Through the studio gate!', 'gold-text', 'good'];
      } else if (iPossessed) {
        [emoji, title, body, cls, tone] = ['fire', 'You possessed them!', `You stole ${iPossessed.victimName}'s body. You're ALIVE again!`, 'gold-text', 'good'];
      } else if (possessedMe) {
        [emoji, title, body, cls, tone] = ['ghost', 'Possessed!', `${possessedMe.ghostName}'s bhoot stole your body. Flung back to space ${m.to}.`, 'blood-text', 'bad'];
      }
      if (m.correct) vibrate(30);
      const el = screen(
        `flash-${tone}`,
        heroArt(emoji, emoji === 'ghost' ? 'ghost' : tone === 'good' ? '' : 'blood'),
        h('h2', { class: `title ${cls}` }, title),
        h('p', { class: 'subtitle' }, body),
        h('p', { class: 'muted' }, `Space ${m.to} of ${state.rules.trackLength}`)
      );
      // possession swaps land at ~1.75s on the big screen; mirror that here
      const t1 = setTimeout(() => {
        if (iPossessed || escaped) {
          audio.sfx(escaped ? 'win' : 'revive');
          vibrate([40, 40, 120]);
        }
        if (possessedMe) {
          audio.sfx('possess');
          vibrate([200, 80, 300]);
        }
        applyGhostTheme(!state.you.alive);
        renderHud(S.state);
        if (iPossessed) reviveAvatar(hud.querySelector('.avatar'));
      }, 1750);
      return { el, ownsGhostTheme: true, destroy: () => clearTimeout(t1) };
    },

    GAME_OVER(state) {
      const g = state.gameOver;
      if (g.isWinner) {
        audio.sfx('win');
        vibrate([60, 60, 60, 60, 300]);
        petals();
      }
      return {
        el: screen(
          g.isWinner ? 'flash-good' : '',
          heroArt(g.isWinner ? 'trophy' : g.winner ? art.el(art.portrait(g.winner.avatar.id)) : 'shaitaan'),
          h('h2', { class: 'title gold-text' }, g.isWinner ? 'Hero of the film!' : 'The End'),
          h(
            'p',
            { class: 'subtitle' },
            g.isWinner
              ? g.reason === 'escaped'
                ? 'You escaped Kaali Haveli!'
                : 'Closest to the gate when the reels ran out.'
              : g.winner
                ? `${g.winner.name} ${g.reason === 'escaped' ? 'escaped' : 'takes the credit'}. You finished #${g.rank}.`
                : 'Nobody escaped. Shaitaan Seth wins.'
          ),
          h('p', { class: 'muted' }, 'Waiting for the host to start a new show…')
        ),
      };
    },
  };

  function safeScreen(state) {
    const alive = state.you.alive;
    return {
      el: screen(
        '',
        heroArt(alive ? 'popcorn' : 'ghost', alive ? '' : 'ghost'),
        h('h2', { class: 'title gold-text' }, alive ? 'Safe… for now' : 'Already dead'),
        h('p', { class: 'subtitle' }, alive ? 'Watch the climax on the big screen.' : 'Enjoy the show from the afterlife.')
      ),
    };
  }

  // ── trivia buttons ──────────────────────────────────────────────────────
  function questionScreen(state, isFinal) {
    const q = state.question;
    const bar = timeBar();
    const status = h('p', { class: 'answer-status' });
    let locked = state.answered != null;
    const buttons = q.options.map((text, i) =>
      h(
        'button',
        { class: 'answer', dataset: { i }, onclick: () => pick(i) },
        h('span', { class: 'answer__letter' }, 'ABCD'[i]),
        h('span', { class: 'answer__text' }, text)
      )
    );
    const paint = (choice) => {
      buttons.forEach((b, i) => {
        b.classList.toggle('is-picked', i === choice);
        b.classList.toggle('is-dim', choice != null && i !== choice);
        b.disabled = choice != null;
      });
      status.replaceChildren(...(choice != null ? [ic('lock'), ' Locked in! Look at the big screen.'] : []));
    };
    function pick(i) {
      if (locked) return;
      locked = true;
      paint(i);
      audio.sfx('lock');
      vibrate(25);
      sendIntent('player:answer', { choice: i }, (error) => {
        locked = false;
        paint(null);
        status.textContent = error;
      });
    }
    const y = state.you;
    const meta = isFinal
      ? [
          h('span', { class: 'chip' }, `Chase ${state.final.qNumber}/${state.final.maxQuestions}`),
          h('span', { class: y.alive ? 'chip' : 'chip chip--ghost' }, y.alive ? `Space ${y.position}/${state.rules.trackLength} · +${state.rules.livingStep}` : [ic('ghost'), ` Space ${y.position} · +${state.rules.ghostStep}`]),
        ]
      : [h('span', { class: 'chip' }, `Scene ${state.round}/${state.totalRounds}`), h('span', { class: 'chip chip--blood' }, q.category)];
    const el = screen(
      'screen--top',
      bar.el,
      h('div', { class: 'q-meta' }, meta),
      h('p', { class: 'q-text' }, q.text),
      h('div', { class: `answers${q.options.length === 2 ? ' answers--2' : ''}` }, buttons),
      status
    );
    if (locked) paint(state.answered);
    return {
      el,
      update(st) {
        if (st.answered != null && !locked) {
          locked = true;
          paint(st.answered);
        }
      },
      destroy: bar.destroy,
    };
  }

  // ═══════════════════════════════════════════════ THAPPAD REFLEX (game) ══
  function thappadScreen(state) {
    const mg = state.minigame;
    const already = S.intents.find((i) => i.event === 'mg:result');
    if (mg.submitted || already) return waitingScreen(already ? already.payload : null);

    const canvas = h('canvas', { class: 'mg-canvas' });
    const slapsEl = h('span', null, ic('slap'), ` 0/${state.rules.mgTargets}`);
    const penEl = h('span', { class: 'pen' }, '');
    const el = screen('screen--top', h('div', { class: 'mg-wrap' }, h('div', { class: 'mg-hud' }, slapsEl, penEl), canvas), h('p', { class: 'muted' }, 'Slap ', miniSprite('shaitaan'), '  ·  Spare ', miniSprite('maa')));

    const game = new ThappadGame(canvas, {
      seq: mg.seq,
      startAt: performance.now() + mg.playStartsInMs,
      missMs: mg.missMs,
      onHud: (hits, pen) => {
        slapsEl.replaceChildren(ic('slap'), ` ${hits}/${state.rules.mgTargets}`);
        penEl.textContent = pen ? `+${(pen / 1000).toFixed(2)}s` : '';
      },
      onProgress: (hits) => socket.connected && S.joined && socket.emit('mg:progress', { hits }),
      onDone: (result) => {
        sendIntent('mg:result', result);
        setTimeout(() => {
          if (S.view === view) {
            S.view.destroy();
            S.view = waitingScreen(result);
            app.replaceChildren(S.view.el);
          }
        }, 1100);
      },
    });
    game.start();
    window.__mkm.game = game;
    const view = { el, destroy: () => game.stop() };
    return view;
  }

  function waitingScreen(result) {
    const total = result ? result.times.reduce((s, x) => s + x, 0) + result.penalties : null;
    return {
      el: screen(
        '',
        heroArt('clapper'),
        h('h2', { class: 'title gold-text' }, 'CUT!'),
        total != null ? h('p', { class: 'subtitle' }, `Your time: ${fmtMs(total)}`) : null,
        h('p', { class: 'muted' }, 'Waiting for the other doomed stars…')
      ),
    };
  }

  /**
   * Canvas reaction game. Same sequence for every doomed phone (from the server).
   *   wait  → a random pause (tapping now = +250ms "jaldi mat karo")
   *   show  → a Shaitaan (tap his tile! time = reaction) or Maa (DON'T)
   * Reports per-Shaitaan reaction times + penalties when the sequence ends.
   */
  class ThappadGame {
    constructor(canvas, opts) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      Object.assign(this, opts);
      this.phase = 'countdown';
      this.idx = 0;
      this.times = [];
      this.penalties = 0;
      this.nextAt = 0;
      this.shownAt = 0;
      this.lastSlapAt = 0;
      this.effects = [];
      this.raf = 0;
      this.lastCount = null;
      this.MAA_MS = 900;
      this.PEN_EARLY = 250;
      this.PEN_MAA = 600;
      this.loop = this.loop.bind(this);
      this.onTap = this.onTap.bind(this);
    }
    start() {
      this.c.addEventListener('pointerdown', this.onTap);
      this.raf = requestAnimationFrame(this.loop);
    }
    stop() {
      cancelAnimationFrame(this.raf);
      this.c.removeEventListener('pointerdown', this.onTap);
    }
    get item() {
      return this.seq[this.idx];
    }
    advance(now) {
      this.idx += 1;
      if (this.idx >= this.seq.length) {
        this.phase = 'done';
        this.effects.push({ text: 'CUT!', x: 0.5, y: 0.5, t0: now, dur: 1400, size: 0.2, color: '#f4c95d' });
        this.onDone({ times: this.times.map(Math.round), penalties: Math.round(this.penalties) });
      } else {
        this.phase = 'wait';
        this.nextAt = now + this.item.delay;
      }
    }
    penalize(ms, text, cell, now) {
      this.penalties += ms;
      this.onHud(this.times.length, this.penalties);
      const [cx, cy] = cell == null ? [0.5, 0.5] : this.cellCenter(cell);
      this.effects.push({ text, x: cx, y: cy, t0: now, dur: 900, size: 0.07, color: '#ff6b81' });
      MKM.replay(this.c, 'shake');
    }
    update(now) {
      if (this.phase === 'countdown') {
        if (now >= this.startAt) {
          this.phase = 'wait';
          this.nextAt = now + this.item.delay;
          audio.sfx('action');
          vibrate(50);
        } else {
          const n = Math.ceil((this.startAt - now) / 1000);
          if (n !== this.lastCount && n <= 3) {
            this.lastCount = n;
            audio.sfx('tick');
          }
        }
      } else if (this.phase === 'wait' && now >= this.nextAt) {
        this.phase = 'show';
        this.shownAt = now;
        if (this.item.kind === 'maa') vibrate(15);
      } else if (this.phase === 'show') {
        const age = now - this.shownAt;
        if (this.item.kind === 'villain' && age >= this.missMs) {
          this.times.push(this.missMs);
          this.effects.push({ text: 'Bhaag gaya!', ...this.fxAt(this.item.cell), t0: now, dur: 900, size: 0.07, color: '#ff6b81' });
          this.onHud(this.times.length, this.penalties);
          this.advance(now);
        } else if (this.item.kind === 'maa' && age >= this.MAA_MS) {
          this.effects.push({ text: 'Pranaam!', ...this.fxAt(this.item.cell), t0: now, dur: 700, size: 0.06, color: '#f4c95d' });
          this.advance(now);
        }
      }
    }
    onTap(e) {
      e.preventDefault();
      const now = performance.now();
      this.update(now); // rAF can lag (throttled/low-power phones): judge taps on current state
      const rect = this.c.getBoundingClientRect();
      const cell = this.cellAt((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      if (this.phase === 'countdown' || this.phase === 'done') return;
      if (now - this.lastSlapAt < 140) return; // forgive a double-tap right after a slap
      if (this.phase === 'wait') {
        this.penalize(this.PEN_EARLY, 'Jaldi mat karo! +0.25s', cell, now);
        audio.sfx('tick');
        return;
      }
      const it = this.item;
      if (cell !== it.cell) {
        this.penalize(this.PEN_EARLY, 'Miss! +0.25s', cell, now);
        return;
      }
      if (it.kind === 'villain') {
        const rt = now - this.shownAt;
        this.times.push(rt);
        this.lastSlapAt = now;
        const [x, y] = this.cellCenter(cell);
        this.effects.push({ text: 'THAPPAD!', x, y: y - 0.06, t0: now, dur: 800, size: 0.09, color: '#ffd166', burst: true });
        this.effects.push({ text: `${Math.round(rt)}ms`, x, y: y + 0.08, t0: now, dur: 900, size: 0.05, color: '#f7e7c4' });
        audio.sfx('slap');
        vibrate(30);
        this.onHud(this.times.length, this.penalties);
        this.onProgress(this.times.length);
        this.advance(now);
      } else {
        this.lastSlapAt = now;
        audio.sfx('maa');
        vibrate([60, 40, 60]);
        this.penalize(this.PEN_MAA, 'Maa ko thappad?! +0.6s', cell, now);
        this.advance(now);
      }
    }
    // geometry in normalized [0..1] canvas space: 3×3 grid with gaps
    cellRect(cell) {
      const pad = 0.04;
      const gap = 0.03;
      const size = (1 - pad * 2 - gap * 2) / 3;
      const col = cell % 3;
      const row = Math.floor(cell / 3);
      return [pad + col * (size + gap), pad + row * (size + gap), size];
    }
    cellCenter(cell) {
      const [x, y, s] = this.cellRect(cell);
      return [x + s / 2, y + s / 2];
    }
    fxAt(cell) {
      const [x, y] = this.cellCenter(cell);
      return { x, y };
    }
    cellAt(nx, ny) {
      for (let i = 0; i < 9; i++) {
        const [x, y, s] = this.cellRect(i);
        if (nx >= x && nx <= x + s && ny >= y && ny <= y + s) return i;
      }
      return null;
    }
    loop(now) {
      this.update(now);
      this.draw(now);
      this.raf = requestAnimationFrame(this.loop);
    }
    /** Geometry is normalised (0..1); `u()` converts to CSS pixels for drawing. */
    draw(now) {
      const dpr = window.devicePixelRatio || 1;
      const W = this.c.clientWidth;
      if (!W) return;
      if (this.c.width !== Math.round(W * dpr)) {
        this.c.width = Math.round(W * dpr);
        this.c.height = Math.round(W * dpr);
      }
      const u = (v) => v * W;
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, W);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const showing = this.phase === 'show' ? this.item : null;

      for (let i = 0; i < 9; i++) {
        const [x, y, s] = this.cellRect(i).map(u);
        const lit = showing && showing.cell === i;
        const g = ctx.createLinearGradient(0, y, 0, y + s);
        if (lit && showing.kind === 'villain') {
          g.addColorStop(0, '#7a0a1e');
          g.addColorStop(1, '#2a0410');
        } else if (lit) {
          g.addColorStop(0, '#5a3a12');
          g.addColorStop(1, '#2a1a06');
        } else {
          g.addColorStop(0, '#2a0f3b');
          g.addColorStop(1, '#14061e');
        }
        ctx.fillStyle = g;
        roundRect(ctx, x, y, s, s, u(0.03));
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, u(0.006));
        ctx.strokeStyle = lit ? (showing.kind === 'villain' ? '#e3173a' : '#f4c95d') : 'rgba(244,201,93,0.18)';
        ctx.stroke();
        if (!lit) {
          // an unlit diya in every tile
          ctx.fillStyle = 'rgba(164,71,27,0.55)';
          ctx.beginPath();
          ctx.ellipse(x + s / 2, y + s * 0.7, s * 0.14, s * 0.05, 0, 0, Math.PI);
          ctx.fill();
        }
      }

      if (showing) {
        const [cx, cy] = this.cellCenter(showing.cell).map(u);
        const s = u(this.cellRect(showing.cell)[2]);
        const age = now - this.shownAt;
        const pop = Math.min(1, age / 120);
        const scale = 0.6 + 0.4 * pop + (pop >= 1 ? 0.03 * Math.sin(now / 60) : 0);
        const img = art.image(showing.kind === 'villain' ? 'shaitaan' : 'maa');
        const size = s * 0.86 * scale;
        ctx.save();
        ctx.shadowColor = showing.kind === 'villain' ? '#e3173a' : '#f4c95d';
        ctx.shadowBlur = 24;
        if (img.complete && img.naturalWidth) ctx.drawImage(img, cx - size / 2, cy - size / 2 - s * 0.03, size, size);
        ctx.restore();
        if (showing.kind === 'maa') {
          ctx.font = `800 ${Math.round(s * 0.14)}px Mukta, sans-serif`;
          ctx.fillStyle = '#f4c95d';
          ctx.fillText('MAA', cx, cy + s * 0.4);
        }
      }

      // effects: floating text + slap bursts
      this.effects = this.effects.filter((fx) => now - fx.t0 < fx.dur);
      for (const fx of this.effects) {
        const t = (now - fx.t0) / fx.dur;
        const fxX = u(fx.x);
        const fxY = u(fx.y);
        if (fx.burst) {
          ctx.strokeStyle = `rgba(255,209,102,${1 - t})`;
          ctx.lineWidth = Math.max(2, u(0.01));
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            const r0 = u(0.05 + t * 0.06);
            const r1 = r0 + u(0.05);
            const by = fxY + u(0.06);
            ctx.beginPath();
            ctx.moveTo(fxX + Math.cos(a) * r0, by + Math.sin(a) * r0);
            ctx.lineTo(fxX + Math.cos(a) * r1, by + Math.sin(a) * r1);
            ctx.stroke();
          }
        }
        ctx.save();
        ctx.globalAlpha = 1 - t * t;
        const size = Math.round(u(fx.size));
        ctx.font = `800 ${size}px Mukta, sans-serif`;
        ctx.lineWidth = Math.max(2, size * 0.18);
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#1a0828';
        const yy = fxY - u(t * 0.05);
        ctx.strokeText(fx.text, fxX, yy);
        ctx.fillStyle = fx.color;
        ctx.fillText(fx.text, fxX, yy);
        ctx.restore();
      }

      // countdown overlay: Get ready… 3 · 2 · 1
      if (this.phase === 'countdown') {
        const n = Math.ceil((this.startAt - now) / 1000);
        ctx.fillStyle = 'rgba(10,5,16,0.6)';
        ctx.fillRect(0, 0, W, W);
        ctx.font = `400 ${Math.round(u(n > 3 ? 0.1 : 0.32))}px "Rozha One", serif`;
        ctx.fillStyle = '#f4c95d';
        ctx.fillText(n > 3 ? 'Get ready…' : String(n), W / 2, W / 2);
      }
    }
  }

  function roundRect(ctx, x, y, w, hgt, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + hgt, r);
    ctx.arcTo(x + w, y + hgt, x, y + hgt, r);
    ctx.arcTo(x, y + hgt, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ═════════════════════════════════════════════════════════════ flourish ══
  function petals() {
    const colors = ['#ff9f1c', '#ffb703', '#fb8500', '#f4c95d', '#e3173a'];
    for (let i = 0; i < 60; i++) {
      const p = h('i', {
        class: 'petal',
        style: {
          left: `${rand(0, 100)}vw`,
          background: pickOne(colors),
          '--t': `${rand(2.8, 5.5).toFixed(2)}s`,
          '--d': `${rand(0, 1.8).toFixed(2)}s`,
          '--x': `${rand(-30, 30).toFixed(0)}vw`,
          '--r': `${rand(360, 1080).toFixed(0)}deg`,
        },
      });
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 8000);
    }
  }

  // Phones go to sleep; the first tap anywhere re-arms audio + the wake lock.
  document.addEventListener('pointerdown', () => {
    if (!audio.ready) audio.unlock();
  });
})();
