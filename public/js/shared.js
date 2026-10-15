/**
 * MKM shared client helpers (host + controller).
 * Exposes window.MKM = { h, PhaseClock, local, session, avatarEl, shatter, drips, fmt… }
 */
(function (global) {
  'use strict';

  // ── DOM builder ─────────────────────────────────────────────────────────
  /**
   * h('div', { class: 'x', style: { '--pc': '#f00' }, onclick: fn }, 'text', child, [more])
   * Strings always become text nodes, so player names can never inject HTML.
   */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          for (const [sk, sv] of Object.entries(v)) {
            if (sk.startsWith('--')) el.style.setProperty(sk, sv);
            else el.style[sk] = sv;
          }
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, children);
    return el;
  }

  function append(el, children) {
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  // ── countdowns that survive reconnects ──────────────────────────────────
  /**
   * The server sends `remainingMs`; we turn it into a local deadline so clock
   * skew between devices never matters. Re-syncs only when the phase changes
   * or the server cut the phase short (drift > 250ms).
   */
  class PhaseClock {
    constructor() {
      this.deadline = null;
      this.duration = 0;
      this.key = null;
    }
    sync(state) {
      if (state.remainingMs == null) {
        this.deadline = null;
        this.duration = 0;
      } else {
        const d = performance.now() + state.remainingMs;
        if (this.key !== state.phaseKey || this.deadline == null || Math.abs(d - this.deadline) > 250) this.deadline = d;
        this.duration = state.durationMs || state.remainingMs;
      }
      this.key = state.phaseKey;
    }
    remaining() {
      return this.deadline == null ? null : Math.max(0, this.deadline - performance.now());
    }
    fraction() {
      const r = this.remaining();
      return r == null || !this.duration ? 0 : Math.min(1, r / this.duration);
    }
    seconds() {
      const r = this.remaining();
      return r == null ? null : Math.ceil(r / 1000);
    }
  }

  // ── storage that never throws (private mode, blocked cookies…) ──────────
  function makeStore(kind) {
    const area = () => {
      try {
        return global[kind];
      } catch {
        return null;
      }
    };
    return {
      get(k) {
        try {
          return JSON.parse(area().getItem(k));
        } catch {
          return null;
        }
      },
      set(k, v) {
        try {
          area().setItem(k, JSON.stringify(v));
        } catch {
          /* ignore */
        }
      },
      del(k) {
        try {
          area().removeItem(k);
        } catch {
          /* ignore */
        }
      },
    };
  }

  // ── formatting ──────────────────────────────────────────────────────────
  const fmtScore = (n) => Number(n || 0).toLocaleString('en-IN'); // 1,00,000 style
  const fmtMs = (ms) => (ms == null ? 'DNF' : `${(ms / 1000).toFixed(2)}s`);
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const pickOne = (list) => list[Math.floor(Math.random() * list.length)];
  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

  // ── avatar badge (hand-drawn SVG portrait from MKM.art) ─────────────────
  function avatarEl(p, { name = true, cls = '' } = {}) {
    return h(
      'div',
      {
        class: `avatar ${p.alive === false ? 'avatar--ghost' : ''} ${cls}`.trim(),
        style: { '--pc': p.avatar.color },
        dataset: { id: p.id },
      },
      h('div', { class: 'avatar__face' }, global.MKM.art.el(global.MKM.art.portrait(p.avatar.id))),
      name ? h('div', { class: 'avatar__name' }, p.name) : null
    );
  }

  /** An icon node (shorthand for MKM.art.icon). */
  const ic = (name, cls) => global.MKM.art.icon(name, cls);

  /** Small inline sprite (Shaitaan / Maa) for rule text. */
  const miniSprite = (id) => h('span', { class: 'mini-sprite', 'aria-hidden': 'true' }, global.MKM.art.el(global.MKM.art.sprite(id)));

  // ── cinema layer builders ───────────────────────────────────────────────
  const BAT = '<svg viewBox="0 0 64 28" fill="currentColor"><path d="M32 10c2-4 4-6 5-6l-1 5c6-4 14-6 28-2-8 1-11 5-12 9-3-3-7-3-9 0-2-2-5-2-7 1-1-1-2-2-4-2s-3 1-4 2c-2-3-5-3-7-1-2-3-6-3-9 0-1-4-4-8-12-9 14-4 22-2 28 2l-1-5c1 0 3 2 5 6z"/></svg>';

  /** Moonlit sky + haunted haveli skyline + fog + bats. */
  function skyScene() {
    const bat = (n) => h('div', { class: `bat bat--${n}`, 'aria-hidden': 'true' }, global.MKM.art.el(BAT));
    return h(
      'div',
      { class: 'sky', 'aria-hidden': 'true' },
      h('div', { class: 'moon' }),
      h('div', { class: 'cloud cloud--1' }),
      h('div', { class: 'cloud cloud--2' }),
      h('div', { class: 'cloud cloud--3' }),
      bat(1),
      bat(2),
      bat(3),
      h('div', { class: 'skyline-wrap' }, global.MKM.art.el(global.MKM.art.skyline())),
      h('div', { class: 'fog' }),
      h('div', { class: 'fog fog--2' })
    );
  }

  function curtains() {
    return h('div', { class: 'curtains', 'aria-hidden': 'true' }, h('div', { class: 'curtain curtain--l' }), h('div', { class: 'curtain curtain--r' }), h('div', { class: 'valance' }));
  }

  function projector() {
    return h('div', { class: 'projector', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('b'), h('b'));
  }

  /** Old-school film leader: sweeping wedge, crosshair, big number. */
  function leader() {
    const num = h('span', { class: 'leader__num' });
    const el = h('div', { class: 'leader', 'aria-hidden': 'true' }, h('div', { class: 'leader__sweep' }), h('div', { class: 'leader__ring' }), h('div', { class: 'leader__ring' }), num);
    return {
      el,
      show(text, word = false) {
        num.className = word ? 'leader__word' : 'leader__num';
        num.textContent = text;
      },
    };
  }

  /** Flash a film burn at a random spot (scene transitions). */
  function burn(el) {
    if (!el) return;
    el.style.setProperty('--x', `${Math.round(rand(15, 85))}%`);
    el.style.setProperty('--y', `${Math.round(rand(20, 70))}%`);
    replay(el, 'is-on');
  }

  /** Clapperboard header: SCENE | TAKE | DIRECTOR. */
  function clapper(scene, take, credit, { clap = false } = {}) {
    const col = (label, value) => h('div', null, h('small', null, label), h('b', null, value));
    return h(
      'div',
      { class: `clapper${clap ? ' is-clapping' : ''}` },
      h('div', { class: 'clapper__arm' }),
      h('div', { class: 'clapper__board' }, col('SCENE', scene), col('TAKE', take), col('DIRECTOR', credit))
    );
  }

  // ── fade-and-shatter ────────────────────────────────────────────────────
  /** Jittered grid → triangles (percent coordinates) for clip-path shards. */
  function shardPolygons(cols, rows) {
    const pts = [];
    for (let r = 0; r <= rows; r++) {
      pts.push([]);
      for (let c = 0; c <= cols; c++) {
        const edge = r === 0 || c === 0 || r === rows || c === cols;
        const jx = edge ? 0 : rand(-0.3, 0.3) * (100 / cols);
        const jy = edge ? 0 : rand(-0.3, 0.3) * (100 / rows);
        pts[r].push([(c * 100) / cols + jx, (r * 100) / rows + jy]);
      }
    }
    const polys = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const a = pts[r][c];
        const b = pts[r][c + 1];
        const d = pts[r + 1][c + 1];
        const e = pts[r + 1][c];
        if (Math.random() > 0.5) polys.push([a, b, d], [a, d, e]);
        else polys.push([a, b, e], [b, d, e]);
      }
    }
    return polys;
  }

  /**
   * Shatter an element into flying shards (the death effect).
   * The element must be position:relative. Its children are hidden while the
   * shards (clipped clones of the element) fly apart, then `onDone` runs —
   * typically to swap in the ghost state with `.avatar--ghost-enter`.
   */
  function shatter(el, { duration = 1100, cols = 4, rows = 4, onDone } = {}) {
    if (!el || el.classList.contains('is-shattering')) return;
    const rect = el.getBoundingClientRect();
    const proto = el.cloneNode(true);
    proto.classList.remove('avatar--dying', 'avatar--ghost', 'avatar--ghost-enter', 'avatar--revive', 'is-shattering', 'pop-in', 'rise-in');
    proto.querySelectorAll('.shatter-layer').forEach((n) => n.remove());
    proto.removeAttribute('id');

    const layer = h('div', { class: 'shatter-layer' });
    for (const poly of shardPolygons(cols, rows)) {
      const cx = (poly[0][0] + poly[1][0] + poly[2][0]) / 3;
      const cy = (poly[0][1] + poly[1][1] + poly[2][1]) / 3;
      const shard = proto.cloneNode(true);
      shard.classList.add('shard');
      shard.style.clipPath = `polygon(${poly.map(([x, y]) => `${x}% ${y}%`).join(',')})`;
      shard.style.setProperty('--dx', `${((cx - 50) / 50) * rect.width * rand(0.7, 1.5)}px`);
      shard.style.setProperty('--dy', `${((cy - 50) / 50) * rect.height * 0.9 + rand(30, 110)}px`);
      shard.style.setProperty('--rot', `${rand(-140, 140)}deg`);
      shard.style.setProperty('--delay', `${Math.round(rand(0, 140))}ms`);
      shard.style.setProperty('--dur', `${duration}ms`);
      layer.appendChild(shard);
    }
    el.classList.add('is-shattering');
    el.appendChild(layer);
    setTimeout(() => {
      layer.remove();
      el.classList.remove('is-shattering');
      if (onDone) onDone();
    }, duration + 180);
  }

  /** Full death sequence for an avatar-like element: flash → shatter → ghost fade-in. */
  function killAvatar(el, { onShatter, onGhost } = {}) {
    if (!el) return;
    el.classList.remove('avatar--ghost', 'avatar--ghost-enter', 'avatar--revive');
    el.classList.add('avatar--dying');
    setTimeout(() => {
      el.classList.remove('avatar--dying');
      if (onShatter) onShatter();
      shatter(el, {
        onDone: () => {
          el.classList.add('avatar--ghost', 'avatar--ghost-enter');
          if (onGhost) onGhost();
        },
      });
    }, 650);
  }

  function reviveAvatar(el) {
    if (!el) return;
    el.classList.remove('avatar--ghost', 'avatar--ghost-enter', 'avatar--dying');
    el.classList.add('avatar--revive');
    setTimeout(() => el.classList.remove('avatar--revive'), 1300);
  }

  /** Blood drips hanging under a heading. */
  function drips(container, count = 9) {
    const wrap = h('div', { class: 'drips', 'aria-hidden': 'true' });
    for (let i = 0; i < count; i++) {
      wrap.appendChild(
        h('i', {
          style: {
            left: `${rand(3, 95)}%`,
            '--w': `${rand(5, 11).toFixed(1)}px`,
            '--h': `${rand(18, 72).toFixed(0)}px`,
            '--d': `${rand(0.1, 1.4).toFixed(2)}s`,
            '--t': `${rand(1.6, 3.6).toFixed(2)}s`,
          },
        })
      );
    }
    container.appendChild(wrap);
    return wrap;
  }

  /** Re-trigger a CSS animation class on an element. */
  function replay(el, cls) {
    if (!el) return;
    el.classList.remove(cls);
    void el.offsetWidth; // force reflow so the animation restarts
    el.classList.add(cls);
  }

  function diyaEl() {
    return h('div', { class: 'diya', 'aria-hidden': 'true' }, h('div', { class: 'diya__flame' }), h('div', { class: 'diya__bowl' }));
  }

  global.MKM = Object.assign(global.MKM || {}, {
    h,
    append,
    ic,
    miniSprite,
    skyScene,
    curtains,
    projector,
    leader,
    burn,
    clapper,
    PhaseClock,
    local: makeStore('localStorage'),
    session: makeStore('sessionStorage'),
    fmtScore,
    fmtMs,
    rand,
    pickOne,
    fill,
    avatarEl,
    shatter,
    killAvatar,
    reviveAvatar,
    drips,
    replay,
    diyaEl,
  });
})(window);
