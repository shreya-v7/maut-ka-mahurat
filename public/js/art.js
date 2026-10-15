/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MKM.art: every illustration in the game, as hand-built SVG.
 *  No image files and no emoji: retro Bollywood-poster portraits (sunburst,
 *  halftone, thick ink lines), mini-game sprites, an icon set and scenery.
 *
 *  MKM.art.portrait(id)   → SVG string for a character (hero, villain, …, 'seth')
 *  MKM.art.sprite(id)     → 'shaitaan' | 'maa' (transparent, for the slap game)
 *  MKM.art.image(id)      → cached <img> of a portrait/sprite, for <canvas>
 *  MKM.art.icon(name)     → <span class="ic"> with an inline SVG icon
 *  MKM.art.skyline()      → the haunted haveli silhouette (wide SVG)
 *  MKM.art.el(markup)     → DOM node from trusted SVG markup
 * ═══════════════════════════════════════════════════════════════════════════
 */
(function (global) {
  'use strict';

  const O = '#1a0828'; // ink outline
  const GOLD = '#f4c95d';
  let uid = 0;

  /** Mirror an element across the face's vertical centre line (x = 50). */
  const sym = (s) => `${s}<g transform="matrix(-1 0 0 1 100 0)">${s}</g>`;

  function shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const f = (c) => Math.max(0, Math.min(255, Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt)));
    const r = f(n >> 16);
    const g = f((n >> 8) & 255);
    const b = f(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  function star(cx, cy, r1, r2, points = 5, rot = -90) {
    const pts = [];
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 ? r2 : r1;
      const a = ((rot + (i * 180) / points) * Math.PI) / 180;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(' ');
  }

  // ── shared face parts (viewBox 0 0 100 100, face centred on x = 50) ─────
  const P = {
    head: (skin, d = 'M50 23 C66 23 74 35 74 49 C74 65 63 77 50 77 C37 77 26 65 26 49 C26 35 34 23 50 23 Z') =>
      `<path d="${d}" fill="${skin}" stroke="${O}" stroke-width="1.8"/>` +
      // soft cheek shadow for a painted-poster feel
      `<path d="M30 58 C33 70 42 76 50 76 C58 76 67 70 70 58 C64 68 57 72 50 72 C43 72 36 68 30 58 Z" fill="rgba(80,20,10,.16)"/>`,
    ears: (skin) => sym(`<ellipse cx="26.5" cy="51" rx="4" ry="6" fill="${skin}" stroke="${O}" stroke-width="1.5"/>`),
    neck: (skin) =>
      `<path d="M42 66 L42 81 Q50 86 58 81 L58 66 Z" fill="${skin}" stroke="${O}" stroke-width="1.5"/>` +
      `<path d="M42 72 Q50 77 58 72" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="3"/>`,
    eyes: ({ pupil = O, look = 0, white = '#fff' } = {}) =>
      sym(
        `<ellipse cx="41" cy="49" rx="4.3" ry="3.1" fill="${white}" stroke="${O}" stroke-width="1.2"/>` +
          `<circle cx="${41.4 + look}" cy="49.3" r="2" fill="${pupil}"/><circle cx="${42.1 + look}" cy="48.6" r=".65" fill="#fff"/>`
      ),
    lashes: () => sym(`<path d="M36.3 48 Q41 44.2 46.2 47.6 L48.6 46.1" fill="none" stroke="${O}" stroke-width="1.9" stroke-linecap="round"/>`),
    brows: (d = 'M35.5 43 Q41 40 46.5 42.5', w = 2.2, c = O) =>
      sym(`<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round"/>`),
    nose: () => `<path d="M50.5 50 Q48 57 51 58.2 Q52.6 58.6 53.4 57.6" fill="none" stroke="${O}" stroke-width="1.3" stroke-linecap="round"/>`,
    blush: (c = 'rgba(255,90,120,.35)') => sym(`<ellipse cx="35.5" cy="58" rx="4" ry="2.3" fill="${c}"/>`),
    smile: () => `<path d="M43 64 Q50 69.5 57 64" fill="none" stroke="${O}" stroke-width="1.8" stroke-linecap="round"/>`,
    smirk: () => `<path d="M44 65.2 Q51 67.2 57.6 62" fill="none" stroke="${O}" stroke-width="1.9" stroke-linecap="round"/>`,
    grin: () =>
      `<path d="M41.5 62.5 Q50 73 58.5 62.5 Z" fill="#6d0f1f" stroke="${O}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<path d="M43.2 63.2 L56.8 63.2 L55.8 65.6 Q50 66.8 44.2 65.6 Z" fill="#fff"/>`,
    lips: (c = '#d1144a') =>
      `<path d="M44 64.3 Q47 62 50 63.2 Q53 62 56 64.3 Q50 69 44 64.3 Z" fill="${c}" stroke="${O}" stroke-width="1"/>`,
    shoulders: (fill) => `<path d="M8 104 C10 86 26 79 50 79 C74 79 90 86 92 104 Z" fill="${fill}" stroke="${O}" stroke-width="1.8"/>`,
  };

  /** Poster frame: sunburst + halftone inside a ringed circle. */
  function frame(color, inner, defs = '', { burst = true } = {}) {
    const id = `mk${++uid}`;
    const rays = burst
      ? Array.from({ length: 12 }, (_, i) => {
          const a0 = (i * 30 * Math.PI) / 180;
          const a1 = ((i * 30 + 14) * Math.PI) / 180;
          return `<path d="M50 50 L${(50 + 90 * Math.cos(a0)).toFixed(1)} ${(50 + 90 * Math.sin(a0)).toFixed(1)} L${(50 + 90 * Math.cos(a1)).toFixed(1)} ${(50 + 90 * Math.sin(a1)).toFixed(1)} Z"/>`;
        }).join('')
      : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" class="art">` +
      `<defs>` +
      `<radialGradient id="${id}g" cx="50%" cy="38%" r="70%"><stop offset="0" stop-color="${shade(color, 0.35)}"/><stop offset=".6" stop-color="${color}"/><stop offset="1" stop-color="${shade(color, -0.55)}"/></radialGradient>` +
      `<pattern id="${id}d" width="3.4" height="3.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="1.7" cy="1.7" r=".6" fill="rgba(0,0,0,.2)"/></pattern>` +
      `<clipPath id="${id}c"><circle cx="50" cy="50" r="47"/></clipPath>` +
      defs.replace(/\$ID/g, id) +
      `</defs>` +
      `<g clip-path="url(#${id}c)">` +
      `<rect width="100" height="100" fill="url(#${id}g)"/>` +
      `<g fill="rgba(255,255,255,.14)">${rays}</g>` +
      `<rect width="100" height="100" fill="url(#${id}d)"/>` +
      inner.replace(/\$ID/g, id) +
      `</g>` +
      `<circle cx="50" cy="50" r="47" fill="none" stroke="${O}" stroke-width="3.2"/>` +
      `<circle cx="50" cy="50" r="44.4" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="1"/>` +
      `</svg>`
    );
  }

  // ── the cast ────────────────────────────────────────────────────────────
  const CAST = {
    // Hero No. 1: pompadour, aviators, leather jacket, red scarf, smirk
    hero: () => {
      const skin = '#c68642';
      return frame(
        '#f4c95d',
        P.shoulders('#3d2617') +
          sym(`<path d="M30 83 L42 80 L50 102 Z" fill="#5a3a22" stroke="${O}" stroke-width="1.3"/>`) +
          `<path d="M42 80 L50 93 L58 80 Z" fill="#f2efe6" stroke="${O}" stroke-width="1.2"/>` +
          `<path d="M43 80 Q50 87 57 80 L55 89 Q50 91 45 89 Z" fill="#d62839" stroke="${O}" stroke-width="1.2"/>` +
          P.neck(skin) +
          P.ears(skin) +
          P.head(skin) +
          `<path d="M31 60 C34 72 43 77 50 77 C57 77 66 72 69 60 C64 68 56 71 50 71 C44 71 36 68 31 60 Z" fill="rgba(30,15,5,.25)"/>` +
          P.brows('M35 41.5 Q41 38.5 47 41', 2.4) +
          P.nose() +
          sym(
            `<path d="M34.5 45.5 Q34.5 43.8 36.5 43.8 L46.3 43.8 Q48.2 43.8 47.8 46 Q46.8 53.5 41.2 53.5 Q35.3 53.5 34.5 47.4 Z" fill="url(#$IDlens)" stroke="#e0a526" stroke-width="1.5"/>` +
              `<path d="M36.6 46.2 L40.2 46.2" stroke="rgba(255,255,255,.75)" stroke-width="1.2" stroke-linecap="round"/>` +
              `<path d="M34.6 45 L27 47.2" stroke="#e0a526" stroke-width="1.3"/>`
          ) +
          `<path d="M47.6 45.3 Q50 43.6 52.4 45.3" fill="none" stroke="#e0a526" stroke-width="1.5"/>` +
          P.smirk() +
          `<path d="M26.5 46 C23 30 33 15 50 15.5 C66 15 79 26 74 46 C72 37 66 31 58 30 C60 25 55 22 48 24 C40 23 31 31 26.5 46 Z" fill="#170d12" stroke="${O}" stroke-width="1.8"/>` +
          `<path d="M40 21 Q52 16.5 63 23" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-linecap="round"/>` +
          sym(`<path d="M27 46 L30.4 46 L30.8 55 L27.6 53 Z" fill="#170d12"/>`),
        `<linearGradient id="$IDlens" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a0b3a"/><stop offset=".6" stop-color="#7a1f5c"/><stop offset="1" stop-color="#ff9f1c"/></linearGradient>`
      );
    },

    // Item Number: flowing hair, bindi, winged kajal, jhumkas, nath, red lips
    item: () => {
      const skin = '#e6b07a';
      return frame(
        '#ff4f9a',
        `<path d="M23 50 C17 24 36 11 51 12 C69 13 84 27 78 52 C81 68 86 86 78 104 L22 104 C14 86 19 68 23 50 Z" fill="#1d0f1c" stroke="${O}" stroke-width="1.8"/>` +
          P.shoulders('#ff4f9a') +
          `<path d="M14 104 C24 88 40 82 66 80 L76 104 Z" fill="rgba(255,209,102,.5)" stroke="${GOLD}" stroke-width="1.4"/>` +
          [22, 30, 38, 62, 70, 78].map((x) => `<circle cx="${x}" cy="${96 - (x % 3)}" r=".9" fill="${GOLD}"/>`).join('') +
          P.neck(skin) +
          `<path d="M40 80 Q50 89 60 80" fill="none" stroke="${GOLD}" stroke-width="2.2"/><circle cx="50" cy="86.5" r="2.2" fill="#e3173a" stroke="${GOLD}" stroke-width="1"/>` +
          P.ears(skin) +
          P.head(skin) +
          P.eyes() +
          P.lashes() +
          P.brows('M35.6 41 Q40.6 37.2 46.2 39.8', 1.5) +
          P.nose() +
          P.blush() +
          P.lips() +
          `<path d="M45 66.6 Q50 68.6 55 66.6" fill="none" stroke="${O}" stroke-width=".8" opacity=".5"/>` +
          `<circle cx="50" cy="41" r="1.8" fill="#e3173a" stroke="${GOLD}" stroke-width=".6"/>` +
          `<circle cx="54.2" cy="56.6" r="2.6" fill="none" stroke="${GOLD}" stroke-width="1"/>` +
          `<path d="M55.6 58 Q64 60 71 53" fill="none" stroke="${GOLD}" stroke-width=".7" stroke-dasharray="1 1"/>` +
          `<path d="M26 47 C25 30 37 20 50 21 C63 20 75 30 74 47 C71 37 64 30 52 27 Q50 30 48 27 C37 30 29 37 26 47 Z" fill="#1d0f1c" stroke="${O}" stroke-width="1.6"/>` +
          `<path d="M73 44 C79 54 77 64 71 71" fill="none" stroke="#1d0f1c" stroke-width="4" stroke-linecap="round"/>` +
          sym(
            `<circle cx="26.2" cy="57.4" r="1.6" fill="${GOLD}" stroke="${O}" stroke-width=".6"/>` +
              `<path d="M22.6 62 Q26.2 57.8 29.8 62 L29 64 L23.4 64 Z" fill="${GOLD}" stroke="${O}" stroke-width=".8"/>` +
              `<circle cx="23.6" cy="65.6" r=".9" fill="${GOLD}"/><circle cx="26.2" cy="66.2" r=".9" fill="${GOLD}"/><circle cx="28.8" cy="65.6" r=".9" fill="${GOLD}"/>`
          )
      );
    },

    // Khalnayak: widow's peak, eyepatch, scar, handlebar moustache, gold tooth
    villain: () => {
      const skin = '#a9714b';
      return frame(
        '#e01e37',
        P.shoulders('#141018') +
          sym(`<path d="M22 90 L34 70 L42 82 Z" fill="#9e0019" stroke="${O}" stroke-width="1.4"/>`) +
          `<path d="M44 80 L50 98 L56 80 Z" fill="#f2efe6" stroke="${O}" stroke-width="1.1"/><path d="M48.5 81 L51.5 81 L50.8 95 L49.2 95 Z" fill="#141018"/>` +
          P.neck(skin) +
          P.ears(skin) +
          P.head(skin, 'M50 22 C66 22 74 34 74 49 C74 66 62 79 50 79 C38 79 26 66 26 49 C26 34 34 22 50 22 Z') +
          sym(`<path d="M35 41.5 L46.5 45.4" stroke="${O}" stroke-width="3.3" stroke-linecap="round"/>`) +
          `<path d="M36.6 49 Q41 46.4 45.6 49 Q41 51.6 36.6 49 Z" fill="#fff" stroke="${O}" stroke-width="1.1"/><circle cx="41.3" cy="49" r="1.7" fill="#c1121f"/><circle cx="41.8" cy="48.5" r=".5" fill="#fff"/>` +
          `<path d="M27 39.5 L53 45.6 M64.8 50.6 L74 54.4" stroke="#0b0b0b" stroke-width="1.6"/>` +
          `<ellipse cx="59" cy="49" rx="5.8" ry="4.6" fill="#0b0b0b" stroke="${O}" stroke-width="1"/>` +
          `<path d="M33.5 51 L39.5 61.6" stroke="#7a1020" stroke-width="1.4" stroke-linecap="round"/>` +
          `<path d="M34.8 54 L37.7 52.6 M36.3 57 L39.1 55.6 M37.8 59.6 L40.3 58.4" stroke="#7a1020" stroke-width="1"/>` +
          `<path d="M50.5 49 Q47 57 50.5 58.6 Q52.6 59 53.6 57.4" fill="none" stroke="${O}" stroke-width="1.3" stroke-linecap="round"/>` +
          sym(
            `<path d="M50 59.6 C45 56.6 39 57.6 36 61.6 C34.5 63.6 32.6 63 33 61 C30.8 65 35.5 66.6 38.5 63.7 C42 61.1 46 61.7 50 62.1 Z" fill="#0f0a12" stroke="${O}" stroke-width=".8"/>`
          ) +
          `<path d="M42.5 65.6 Q50 71.8 57.5 65.6 Q50 68 42.5 65.6 Z" fill="#fff" stroke="${O}" stroke-width="1.1"/>` +
          `<rect x="51.4" y="66.3" width="2.4" height="2.3" fill="${GOLD}" stroke="${O}" stroke-width=".4"/>` +
          `<path d="M26.5 45 C26 27 38 19.5 50 19.5 C62 19.5 74 27 73.5 45 C70 35 63 31 57 31.5 L50 37.6 L43 31.5 C37 31 30 35 26.5 45 Z" fill="#0f0a12" stroke="${O}" stroke-width="1.6"/>` +
          `<path d="M33 30 Q40 25 47 27 M53 27 Q60 25 67 30" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.4" stroke-linecap="round"/>`
      );
    },

    // Disco Dancer: giant afro, star shades, wide collar, gold medallion
    disco: () => {
      const skin = '#b5764a';
      const curls = [
        [20, 30], [28, 16], [40, 9], [54, 7], [67, 11], [78, 20], [85, 33], [16, 44], [84, 46], [33, 24], [62, 19], [48, 15],
      ]
        .map(([x, y]) => `<path d="M${x - 3} ${y} a3 3 0 0 1 6 0" fill="none" stroke="#3d2412" stroke-width="1.2"/>`)
        .join('');
      return frame(
        '#a463f2',
        `<path d="M50 3 C75 2 93 18 89 42 C93 54 84 62 77 56 L23 56 C16 62 7 54 11 42 C7 18 25 4 50 3 Z" fill="#24130a" stroke="${O}" stroke-width="1.8"/>` +
          curls +
          P.shoulders('#f7e7c4') +
          `<path d="M40 79 L50 92 L60 79" fill="${skin}" stroke="${O}" stroke-width="1.2"/>` +
          sym(`<path d="M50 80 L34 77 L20 98 L40 88 Z" fill="#a463f2" stroke="${O}" stroke-width="1.3"/>`) +
          `<path d="M42 80 Q50 92 58 80" fill="none" stroke="${GOLD}" stroke-width="1.6"/><circle cx="50" cy="92.5" r="3.6" fill="${GOLD}" stroke="${O}" stroke-width="1"/><polygon points="${star(50, 92.6, 2.4, 1, 5)}" fill="#b5121b"/>` +
          P.neck(skin) +
          P.ears(skin) +
          P.head(skin) +
          sym(`<path d="M26.5 44 L31 44 L31.6 60 Q28.6 58 26.8 54 Z" fill="#24130a"/>`) +
          `<path d="M27 44 C28 30 38 25 50 26 C62 25 72 30 73 44 C66 37 58 35 50 36 C42 35 34 37 27 44 Z" fill="#24130a" stroke="${O}" stroke-width="1.2"/>` +
          P.brows('M35.5 40.5 Q41 37.5 46.5 40', 2) +
          P.nose() +
          P.grin() +
          sym(
            `<polygon points="${star(41, 48.6, 8, 3.8)}" fill="#ff4f9a" stroke="${GOLD}" stroke-width="1.4" stroke-linejoin="round"/>` +
              `<circle cx="38.6" cy="46.6" r="1" fill="#fff" opacity=".8"/>`
          ) +
          `<path d="M48.6 47.6 Q50 46.4 51.4 47.6" fill="none" stroke="${GOLD}" stroke-width="1.4"/>` +
          [
            [14, 66, 4],
            [86, 64, 3.4],
            [80, 82, 2.6],
          ]
            .map(([x, y, r]) => `<polygon points="${star(x, y, r, r * 0.28, 4, 0)}" fill="#fff" opacity=".9"/>`)
            .join('')
      );
    },

    // Inspector Saab: khaki peaked cap with badge, bushy moustache, stern brows
    inspector: () => {
      const skin = '#8d5524';
      return frame(
        '#4ea8ff',
        P.shoulders('#b59a62') +
          sym(`<rect x="18" y="84" width="16" height="5" rx="1.5" fill="#8a7444" stroke="${O}" stroke-width="1"/>`) +
          `<path d="M44 80 L50 92 L56 80" fill="#9e8550" stroke="${O}" stroke-width="1.1"/>` +
          `<path d="M60 84 Q66 92 64 100" fill="none" stroke="#c1121f" stroke-width="1.6"/>` +
          `<rect x="62" y="92" width="10" height="3.4" rx=".6" fill="#1b2a52"/>` +
          P.neck(skin) +
          P.ears(skin) +
          P.head(skin) +
          P.brows('M35.5 44 L46.5 44.6', 2.9) +
          P.eyes() +
          P.nose() +
          `<path d="M37.5 59.6 Q44 55.6 50 57.6 Q56 55.6 62.5 59.6 Q61 63.9 56 62.3 Q50 60.9 44 62.3 Q39 63.9 37.5 59.6 Z" fill="#160d07" stroke="${O}" stroke-width=".8"/>` +
          `<path d="M45.5 66.2 L54.5 66.2" stroke="${O}" stroke-width="1.8" stroke-linecap="round"/>` +
          `<path d="M23 37 C23 19 77 19 77 37 Z" fill="#c2a76b" stroke="${O}" stroke-width="1.8"/>` +
          `<rect x="24" y="35.4" width="52" height="6.6" fill="#3b2a12" stroke="${O}" stroke-width="1.4"/>` +
          `<path d="M27 42 Q50 51.5 73 42 Q50 46.6 27 42 Z" fill="#120c06" stroke="${O}" stroke-width="1.2"/>` +
          `<circle cx="50" cy="28.6" r="4.4" fill="${GOLD}" stroke="${O}" stroke-width="1"/><polygon points="${star(50, 28.8, 2.8, 1.2)}" fill="#b5121b"/>`
      );
    },

    // Comic Relief: bowl cut, round specs, buck-tooth grin, polka bow tie
    comic: () => {
      const skin = '#e6b07a';
      return frame(
        '#2ed3b7',
        P.shoulders('#ffd166') +
          `<path d="M20 90 L80 90 M16 97 L84 97 M34 82 L30 104 M50 79 L50 104 M66 82 L70 104" stroke="rgba(193,18,31,.45)" stroke-width="1.6"/>` +
          P.neck(skin) +
          `<path d="M41 81 L50 85 L59 81 L59 89 L50 85 L41 89 Z" fill="#e01e37" stroke="${O}" stroke-width="1.2" stroke-linejoin="round"/>` +
          `<circle cx="44" cy="84" r=".8" fill="#fff"/><circle cx="56" cy="86" r=".8" fill="#fff"/><circle cx="45" cy="87" r=".7" fill="#fff"/>` +
          sym(`<ellipse cx="25.6" cy="51" rx="5.2" ry="7.2" fill="${skin}" stroke="${O}" stroke-width="1.5"/>`) +
          P.head(skin, 'M50 24 C67 24 75 36 75 50 C75 66 64 77 50 77 C36 77 25 66 25 50 C25 36 33 24 50 24 Z') +
          P.blush('rgba(255,80,110,.45)') +
          P.brows('M35.5 39.5 Q41 35.5 46.5 38.5', 2.2) +
          sym(
            `<circle cx="41" cy="49" r="6.6" fill="rgba(255,255,255,.3)" stroke="${O}" stroke-width="2"/>` +
              `<ellipse cx="41" cy="49" rx="3.6" ry="3" fill="#fff" stroke="${O}" stroke-width=".9"/><circle cx="42.4" cy="49.4" r="1.7" fill="${O}"/>`
          ) +
          `<path d="M47.6 48.4 Q50 46.8 52.4 48.4" fill="none" stroke="${O}" stroke-width="1.8"/>` +
          P.nose() +
          `<path d="M39.5 61 Q50 77 60.5 61 Z" fill="#6d0f1f" stroke="${O}" stroke-width="1.5" stroke-linejoin="round"/>` +
          `<path d="M44 69 Q50 66 56 69 Q50 74 44 69 Z" fill="#e85d75"/>` +
          `<rect x="46" y="61.2" width="3.8" height="4.6" rx=".7" fill="#fff" stroke="${O}" stroke-width=".6"/><rect x="50.2" y="61.2" width="3.8" height="4.6" rx=".7" fill="#fff" stroke="${O}" stroke-width=".6"/>` +
          `<path d="M26 46 C24 24 76 24 74 46 L70 41.5 L66 46 L62 41 L58 46 L54 41 L50 46 L46 41 L42 46 L38 41 L34 46 L30 41.5 Z" fill="#3a2410" stroke="${O}" stroke-width="1.6" stroke-linejoin="round"/>`
      );
    },

    // The Daku: maroon safa with a tail, red tilak, wild beard, bullet bandolier
    daku: () => {
      const skin = '#a9714b';
      return frame(
        '#d9822b',
        `<path d="M72 42 C84 48 88 64 82 86 L76 84 C80 66 78 54 70 48 Z" fill="#7a0f1e" stroke="${O}" stroke-width="1.4"/>` +
          P.shoulders('#3a2a1a') +
          `<path d="M20 87 L68 105 L77 105 L25 82 Z" fill="#5c3b1a" stroke="${O}" stroke-width="1.2"/>` +
          [0, 1, 2, 3, 4, 5].map((i) => `<rect x="${27 + i * 8}" y="${84 + i * 3}" width="2.6" height="5.4" rx="1" fill="${GOLD}" stroke="${O}" stroke-width=".5" transform="rotate(20 ${28 + i * 8} ${86 + i * 3})"/>`).join('') +
          P.neck(skin) +
          P.ears(skin) +
          P.head(skin) +
          `<path d="M29 56 C30 76 42 86 50 86 C58 86 70 76 71 56 C66 66 58 68 50 66.6 C42 68 34 66 29 56 Z" fill="#140b06" stroke="${O}" stroke-width="1.2"/>` +
          `<path d="M38 72 L39 80 M46 74 L46 83 M54 74 L54 83 M62 72 L61 80" stroke="rgba(255,255,255,.12)" stroke-width="1"/>` +
          sym(`<path d="M35 42.6 L46.6 45.2" stroke="${O}" stroke-width="3" stroke-linecap="round"/>`) +
          P.eyes({ white: '#fff3e0' }) +
          P.nose() +
          sym(
            `<path d="M50 59 C44 55 36 56 32 60 C29 63 26 61 27 58.5 C24 63 29 67.2 33.6 64 C39 60.6 45 61.6 50 62.4 Z" fill="#140b06" stroke="${O}" stroke-width=".8"/>`
          ) +
          `<path d="M46 65.6 Q50 67.2 54 65.6" fill="none" stroke="#6d0f1f" stroke-width="1.6" stroke-linecap="round"/>` +
          `<path d="M23.5 46 C21 26 37 15 51 16 C67 17 80 28 76.5 46 C70 38.6 60 36.6 50 38.6 C40 36.6 30 38.6 23.5 46 Z" fill="#9e0019" stroke="${O}" stroke-width="1.8"/>` +
          `<path d="M28 38.5 C40 30 60 29 72 36 M31 31 C42 24 60 23 70 29" fill="none" stroke="rgba(0,0,0,.32)" stroke-width="1.6"/>` +
          `<path d="M50 39.4 L50 45.2" stroke="#e3173a" stroke-width="2.3" stroke-linecap="round"/><circle cx="50" cy="41" r=".8" fill="#ffd166"/>`
      );
    },

    // Runaway Dulhan: red ghunghat with gold border, maang tikka, big nath
    dulhan: () => {
      const skin = '#d9a066';
      return frame(
        '#c1121f',
        `<path d="M17 104 C12 72 15 31 50 11 C85 31 88 72 83 104 Z" fill="#b5121b" stroke="${O}" stroke-width="1.8"/>` +
          `<path d="M21.5 104 C17.5 74 20.5 36 50 17 C79.5 36 82.5 74 78.5 104" fill="none" stroke="${GOLD}" stroke-width="2.6" stroke-dasharray=".1 3.3" stroke-linecap="round"/>` +
          P.shoulders('#9e0019') +
          `<path d="M28 104 C30 92 38 86 50 86 C62 86 70 92 72 104" fill="none" stroke="${GOLD}" stroke-width="2"/>` +
          P.neck(skin) +
          `<path d="M40 80 Q50 90 60 80 L58 84 Q50 93 42 84 Z" fill="${GOLD}" stroke="${O}" stroke-width=".9"/>` +
          P.head(skin) +
          `<path d="M27 47 C27 31 38 24 50 24 C62 24 73 31 73 47 C69 37 60 31 50 31 C40 31 31 37 27 47 Z" fill="#1d0f1c"/>` +
          `<path d="M50 25 L50 31.4" stroke="#e3173a" stroke-width="1.7"/>` +
          P.eyes() +
          P.lashes() +
          P.brows('M36 42.6 Q41 39.6 46 41.6', 1.4) +
          sym(`<circle cx="37.6" cy="40.6" r=".7" fill="#fff"/><circle cx="40" cy="39.4" r=".6" fill="#fff"/>`) +
          P.nose() +
          P.blush() +
          P.lips('#c1121f') +
          `<circle cx="55" cy="57.2" r="3.7" fill="none" stroke="${GOLD}" stroke-width="1.1"/><circle cx="56.6" cy="60.4" r=".9" fill="#e3173a"/>` +
          `<path d="M57.6 55 Q66 50 73 46" fill="none" stroke="${GOLD}" stroke-width=".7" stroke-dasharray="1 1"/>` +
          `<path d="M24 46 C22 26 38 15.6 50 15.2 C62 15.6 78 26 76 46 C70 33 60 27 50 27 C40 27 30 33 24 46 Z" fill="#c1121f" stroke="${O}" stroke-width="1.4"/>` +
          `<path d="M26.4 43 C28 32 38 28.4 50 28.4 C62 28.4 72 32 73.6 43" fill="none" stroke="${GOLD}" stroke-width="1.6" stroke-dasharray=".1 2.4" stroke-linecap="round"/>` +
          `<path d="M50 28 L50 34.6" stroke="${GOLD}" stroke-width=".8"/><circle cx="50" cy="36.8" r="2.7" fill="${GOLD}" stroke="${O}" stroke-width=".6"/><circle cx="50" cy="36.8" r="1.1" fill="#e3173a"/>`
      );
    },

    // Rich Baap: receding silver hair, thick specs, white moustache, cigar, suit
    baap: () => {
      const skin = '#d9a066';
      return frame(
        '#c9d1d9',
        P.shoulders('#1f2a44') +
          `<path d="M42 79 L50 96 L58 79 Z" fill="#f7f4ec" stroke="${O}" stroke-width="1.1"/>` +
          sym(`<path d="M50 98 L41 79 L32 81 Z" fill="#2c3a5c" stroke="${O}" stroke-width="1.2"/>`) +
          `<path d="M48 80 L52 80 L53.5 84 L50 97 L46.5 84 Z" fill="#c1121f" stroke="${O}" stroke-width="1"/>` +
          `<path d="M36 82 Q50 94 64 82" fill="none" stroke="${GOLD}" stroke-width="1.4" stroke-dasharray="1.6 .8"/>` +
          P.neck(skin) +
          P.ears(skin) +
          P.head(skin, 'M50 22 C67 22 75 35 75 50 C75 67 63 78 50 78 C37 78 25 67 25 50 C25 35 33 22 50 22 Z') +
          `<path d="M38 72 Q50 79 62 72" fill="none" stroke="rgba(80,20,10,.3)" stroke-width="1.2"/>` +
          `<ellipse cx="43" cy="28" rx="6" ry="2.2" fill="rgba(255,255,255,.4)"/>` +
          sym(`<path d="M26 50 C23.6 38 28 30 35 27.6 C33 34 32 40 32.6 47 Z" fill="#d6d6d6" stroke="${O}" stroke-width="1.2"/>`) +
          `<path d="M41 24.6 Q50 21.6 59 24.6" fill="none" stroke="#d6d6d6" stroke-width="1.8" stroke-linecap="round"/>` +
          P.brows('M35 42 Q41 39 47 41.6', 3, '#bdbdbd') +
          P.eyes() +
          sym(`<rect x="33.6" y="44.4" width="13" height="9.4" rx="2" fill="rgba(255,255,255,.18)" stroke="#111" stroke-width="2.2"/>`) +
          `<path d="M46.6 47.6 L53.4 47.6" stroke="#111" stroke-width="2"/>` +
          P.nose() +
          `<path d="M39 60 Q50 55 61 60 Q57 63.6 50 61.6 Q43 63.6 39 60 Z" fill="#f2f2f2" stroke="${O}" stroke-width=".9"/>` +
          `<path d="M44.5 65.6 Q50 67.6 55 65.6" fill="none" stroke="${O}" stroke-width="1.6" stroke-linecap="round"/>` +
          `<g transform="rotate(-12 56 65.6)"><rect x="55" y="64" width="16" height="3.6" rx="1.2" fill="#6b3f1d" stroke="${O}" stroke-width=".9"/><rect x="65" y="64" width="2" height="3.6" fill="${GOLD}"/></g>` +
          `<circle cx="72.4" cy="61.8" r="1.4" fill="#ff6a1a"/>` +
          `<path d="M73 59.6 C71 54 76 52 73 46 C71 42 75 40 73 35" fill="none" stroke="rgba(255,255,255,.6)" stroke-width="1.6" stroke-linecap="round"/>`
      );
    },

    // Tantrik Baba: jata bun, ash tripundra, glowing green eyes, long grey beard
    tantrik: () => {
      const skin = '#b5764a';
      const beads = Array.from({ length: 11 }, (_, i) => {
        const t = i / 10;
        const x = 32 + 36 * t;
        const y = 80 + 14 * Math.sin(Math.PI * t);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.9" fill="#6b3a1a" stroke="${O}" stroke-width=".6"/>`;
      }).join('');
      return frame(
        '#7bd389',
        `<path d="M24 50 C18 70 20 90 26 104 L74 104 C80 90 82 70 76 50 Z" fill="#3a2614" stroke="${O}" stroke-width="1.4"/>` +
          `<path d="M28 62 L27 98 M34 66 L33 104 M66 66 L67 104 M72 62 L73 98" stroke="rgba(0,0,0,.35)" stroke-width="2.2" stroke-linecap="round"/>` +
          P.shoulders('#ff8c1a') +
          `<path d="M18 104 C24 88 40 82 62 80 L54 104 Z" fill="#e06d06" stroke="${O}" stroke-width="1.2"/>` +
          P.neck(skin) +
          P.ears(skin) +
          P.head(skin) +
          `<path d="M30 56 C30 82 42 98 50 100 C58 98 70 82 70 56 C64 64 56 66 50 64 C44 66 36 64 30 56 Z" fill="#d9d9d9" stroke="${O}" stroke-width="1.2"/>` +
          `<path d="M40 70 L42 90 M46 70 L47 96 M54 70 L53 96 M60 70 L58 90" stroke="rgba(0,0,0,.18)" stroke-width="1.1"/>` +
          beads +
          sym(`<ellipse cx="41" cy="49" rx="6.6" ry="5" fill="rgba(123,211,137,.4)"/>`) +
          sym(`<ellipse cx="41" cy="49" rx="4.3" ry="3" fill="#e6ffe0" stroke="${O}" stroke-width="1.2"/><circle cx="41.4" cy="49.2" r="1.7" fill="#1fbf5f"/>`) +
          P.brows('M35 43.4 Q41 40.6 47 42.6', 3, '#cfcfcf') +
          P.nose() +
          `<path d="M38 60 Q50 55.6 62 60 Q58 64 50 62 Q42 64 38 60 Z" fill="#cfcfcf" stroke="${O}" stroke-width=".8"/>` +
          `<path d="M27 44 C28 30 38 24 50 24 C62 24 72 30 73 44 C66 34 58 31 50 31 C42 31 34 34 27 44 Z" fill="#3a2614"/>` +
          `<path d="M36 27 C30 8 70 8 64 27 Z" fill="#3a2614" stroke="${O}" stroke-width="1.6"/>` +
          `<path d="M40 22 Q50 14 60 22 M42 17 Q50 11 58 17" fill="none" stroke="rgba(0,0,0,.4)" stroke-width="1.4"/>` +
          `<path d="M39 35 Q50 33.4 61 35 M38.5 38 Q50 36.4 61.5 38 M39 41 Q50 39.4 61 41" fill="none" stroke="#f7f3e8" stroke-width="1.4" stroke-linecap="round"/>` +
          `<circle cx="50" cy="38" r="1.6" fill="#e3173a"/>`
      );
    },

    // Shaitaan Seth, the ghost producer and host: horns, round shades, red eyes, paan grin
    seth: () => {
      const skin = '#9fb5a8';
      return frame(
        '#7a0018',
        sym(`<path d="M31 31 C21 23 18 10 24 3 C26 14 31 20 39 25 Z" fill="#f2e6c9" stroke="${O}" stroke-width="1.5"/>`) +
          P.shoulders('#140a1a') +
          sym(`<path d="M50 100 L38 79 L28 82 Z" fill="#3b1150" stroke="${O}" stroke-width="1.2"/>`) +
          `<path d="M40 80 Q50 95 60 80" fill="none" stroke="${GOLD}" stroke-width="2"/><path d="M36 82 Q50 100 64 82" fill="none" stroke="${GOLD}" stroke-width="1.4"/>` +
          P.neck(skin) +
          sym(`<path d="M27.6 46 L18 36 L28.6 58 Z" fill="${skin}" stroke="${O}" stroke-width="1.4"/>`) +
          P.head(skin) +
          `<path d="M26.5 45 C26 27 38 19.5 50 19.5 C62 19.5 74 27 73.5 45 C70 35 63 31 57 31.5 L50 38 L43 31.5 C37 31 30 35 26.5 45 Z" fill="#0d0710" stroke="${O}" stroke-width="1.6"/>` +
          `<path d="M60 21.4 Q68 26 71 36" fill="none" stroke="#b9b9b9" stroke-width="2"/>` +
          sym(`<path d="M35 42 L46.5 45" stroke="${O}" stroke-width="3" stroke-linecap="round"/>`) +
          sym(`<circle cx="41" cy="49.4" r="6.2" fill="#120612" stroke="${GOLD}" stroke-width="1.4"/><circle cx="41" cy="49.8" r="2.6" fill="rgba(255,42,42,.35)"/><circle cx="41" cy="49.8" r="1.3" fill="#ff2a2a"/>`) +
          `<path d="M47.2 48.6 Q50 47 52.8 48.6" fill="none" stroke="${GOLD}" stroke-width="1.4"/>` +
          P.nose() +
          `<path d="M41 63 Q50 72.6 59 63 Q50 66.4 41 63 Z" fill="#b5121b" stroke="${O}" stroke-width="1.2"/>` +
          `<path d="M42.6 63.6 L57.4 63.6 L56.6 65.2 Q50 66.6 43.4 65.2 Z" fill="#f0d6c0"/><rect x="47.6" y="63.6" width="2.4" height="1.9" fill="${GOLD}"/>` +
          `<path d="M44 60 Q50 58.4 56 60" fill="none" stroke="#0d0710" stroke-width="1.4" stroke-linecap="round"/>` +
          `<path d="M47 70.4 Q50 76.6 53 70.4 Z" fill="#0d0710"/>` +
          `<g transform="rotate(-10 58 66)"><rect x="57" y="64.6" width="14" height="3.2" rx="1.1" fill="#4a2a12" stroke="${O}" stroke-width=".8"/></g>` +
          `<circle cx="71.4" cy="62.6" r="1.3" fill="#ff6a1a"/>` +
          `<path d="M72 60 C69 54 75 52 72 46 C70 42 74 40 72 35" fill="none" stroke="rgba(166,227,233,.6)" stroke-width="1.6" stroke-linecap="round"/>`
      );
    },
  };

  // ── mini-game sprites (transparent background) ───────────────────────────
  const SPRITES = {
    shaitaan: () =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<defs><radialGradient id="sg" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#ff5a5f"/><stop offset=".7" stop-color="#c1121f"/><stop offset="1" stop-color="#6d0010"/></radialGradient></defs>` +
      sym(`<path d="M30 30 C18 22 14 8 20 0 C24 12 30 18 40 24 Z" fill="#f2e6c9" stroke="${O}" stroke-width="2"/><path d="M24 12 L28 14 M22 7 L26 8" stroke="rgba(0,0,0,.35)" stroke-width="1.4"/>`) +
      sym(`<path d="M24 44 L8 34 L22 62 Z" fill="#c1121f" stroke="${O}" stroke-width="2"/>`) +
      `<path d="M50 20 C70 20 78 34 78 50 C78 70 64 86 50 86 C36 86 22 70 22 50 C22 34 30 20 50 20 Z" fill="url(#sg)" stroke="${O}" stroke-width="2.4"/>` +
      `<path d="M38 80 Q50 98 62 80 L56 86 Q50 92 44 86 Z" fill="#14060c" stroke="${O}" stroke-width="1.6"/>` +
      sym(`<path d="M30 38 L46 46" stroke="${O}" stroke-width="4.2" stroke-linecap="round"/>`) +
      sym(`<path d="M32 50 Q39 44.6 46 50 Q39 55.4 32 50 Z" fill="#ffd60a" stroke="${O}" stroke-width="1.6"/><ellipse cx="39.4" cy="50" rx="1.2" ry="3.6" fill="${O}"/>`) +
      `<path d="M50 53 Q47 60 50.6 61.4 Q53 61.8 54 60" fill="none" stroke="${O}" stroke-width="1.8" stroke-linecap="round"/>` +
      sym(`<path d="M50 63 C43 59 34 60 30 66 C28 69 25 67 26 64 C22 70 30 72.6 34 68.6 C39 64.6 45 65.6 50 66.4 Z" fill="#14060c" stroke="${O}" stroke-width="1"/>`) +
      `<path d="M38 70 Q50 83 62 70 Z" fill="#2a0410" stroke="${O}" stroke-width="2" stroke-linejoin="round"/>` +
      sym(`<path d="M41 70.6 L44 77 L46 70.8 Z" fill="#fff" stroke="${O}" stroke-width=".8"/>`) +
      `<path d="M30 30 Q40 24 50 26" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2.4" stroke-linecap="round"/>` +
      `</svg>`,

    maa: () =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
      `<path d="M12 100 C8 66 14 24 50 12 C86 24 92 66 88 100 Z" fill="#f7f4ec" stroke="${O}" stroke-width="2.2"/>` +
      `<path d="M17 100 C13 68 19 30 50 18 C81 30 87 68 83 100" fill="none" stroke="#2f6fd0" stroke-width="3"/>` +
      `<path d="M50 30 C66 30 74 42 74 56 C74 72 63 84 50 84 C37 84 26 72 26 56 C26 42 34 30 50 30 Z" fill="#d9a066" stroke="${O}" stroke-width="2"/>` +
      `<path d="M28 52 C28 38 38 32 50 32 C62 32 72 38 72 52 C68 42 60 38 50 38 C40 38 32 42 28 52 Z" fill="#e8e8e8" stroke="${O}" stroke-width="1"/>` +
      `<path d="M50 32.4 L50 38" stroke="#e3173a" stroke-width="1.8"/>` +
      `<path d="M22 50 C20 30 36 20 50 20 C64 20 80 30 78 50 C72 36 62 31 50 31 C38 31 28 36 22 50 Z" fill="#f7f4ec" stroke="${O}" stroke-width="1.6"/>` +
      `<path d="M25 47 C26 34 38 25 50 25 C62 25 74 34 75 47" fill="none" stroke="#2f6fd0" stroke-width="2"/>` +
      `<circle cx="50" cy="45" r="2.2" fill="#e3173a"/>` +
      sym(`<circle cx="41" cy="55" r="6" fill="rgba(255,255,255,.25)" stroke="${GOLD}" stroke-width="1.6"/><path d="M37.6 55.6 Q41 52.6 44.4 55.6" fill="none" stroke="${O}" stroke-width="1.8" stroke-linecap="round"/>`) +
      `<path d="M47 54 L53 54" stroke="${GOLD}" stroke-width="1.6"/>` +
      `<path d="M50.6 58 Q48.6 64 51 65 Q52.4 65.4 53 64.4" fill="none" stroke="${O}" stroke-width="1.4" stroke-linecap="round"/>` +
      sym(`<ellipse cx="35" cy="65" rx="4" ry="2.4" fill="rgba(255,90,120,.4)"/><path d="M31 61 Q33 63 32 66" fill="none" stroke="rgba(80,20,10,.35)" stroke-width="1"/>`) +
      `<path d="M43 70 Q50 76 57 70" fill="none" stroke="${O}" stroke-width="2" stroke-linecap="round"/>` +
      `</svg>`,
  };

  // ── icons (24×24 line art, currentColor) ─────────────────────────────────
  const ICONS = {
    clapper: '<rect x="3" y="9.5" width="18" height="11.5" rx="1.6"/><path d="M3.4 9.2 19.8 4.6l1 3.6L4.4 12.8"/><path d="M8 7.9l2.6 3.4M13.2 6.5l2.6 3.4"/>',
    knife: '<path d="M15 3.5l5.5 5.5-9.6 9.6-3.6-1.9z"/><path d="M7.3 16.7 3.5 20.5M5.3 14.7l4 4"/>',
    ghost: '<path d="M5 21V11a7 7 0 0 1 14 0v10l-2.3-1.8L14.3 21 12 19.2 9.7 21l-2.4-1.8z"/><circle cx="9.5" cy="11" r="1.1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="11" r="1.1" fill="currentColor" stroke="none"/>',
    run: '<circle cx="15" cy="4.2" r="2"/><path d="M7 21l3.2-5.5 3.3 2.7V23"/><path d="M5.5 11.5 9 8h5l2.6 3.8 3 .9"/><path d="M10.2 15.5 12 8"/>',
    gate: '<path d="M5 21V9a7 7 0 0 1 14 0v12"/><path d="M3 21h18M12 3.2V21"/><circle cx="10" cy="14" r=".9" fill="currentColor" stroke="none"/><circle cx="14" cy="14" r=".9" fill="currentColor" stroke="none"/>',
    crown: '<path d="M3 8l4.2 4.2L12 5l4.8 7.2L21 8l-2 11H5z"/><path d="M5.4 16h13.2"/>',
    reel: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="6.8" r="2"/><circle cx="17.2" cy="12" r="2"/><circle cx="12" cy="17.2" r="2"/><circle cx="6.8" cy="12" r="2"/>',
    slap: '<path d="M7 11.5V5.6a1.5 1.5 0 0 1 3 0V10M10 9.6V4.2a1.5 1.5 0 0 1 3 0v5.6M13 9.6V5.2a1.5 1.5 0 0 1 3 0v6M16 10.8V8a1.5 1.5 0 0 1 3 0v6a7 7 0 0 1-7 7h-.8a6.2 6.2 0 0 1-4.8-2.3L3.3 15.2a1.6 1.6 0 0 1 2.4-2.1L7 14.6"/>',
    coffin: '<path d="M9 2.5h6l3 6-2.2 13H8.2L6 8.5z"/><path d="M12 7v7.4M9.4 9.6h5.2"/>',
    trophy: '<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/><path d="M12 14v4M8 21h8M9 18h6"/>',
    skull: '<path d="M12 3a8 8 0 0 0-5 14.2V20.5h10v-3.3A8 8 0 0 0 12 3z"/><circle cx="9" cy="11.2" r="1.8" fill="currentColor" stroke="none"/><circle cx="15" cy="11.2" r="1.8" fill="currentColor" stroke="none"/><path d="M10 20.5v-2.2M14 20.5v-2.2M12 14.5l-.8 1.6h1.6z"/>',
    popcorn: '<path d="M6 9.5l2 11.5h8l2-11.5z"/><path d="M6 9.5a2.4 2.4 0 0 1 2-4 3 3 0 0 1 4-2.2 3 3 0 0 1 4 2.2 2.4 2.4 0 0 1 2 4"/><path d="M10 9.5l.5 11.5M14 9.5l-.5 11.5"/>',
    check: '<path d="M4 12.5l5 5L20 6.5"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/>',
    offline: '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M16.8 11a10 10 0 0 1 2.2 1.9M8.5 16.4a5 5 0 0 1 7 0"/><circle cx="12" cy="20" r="1" fill="currentColor" stroke="none"/><path d="M3 3l18 18"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.8l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    fire: '<path d="M12 22a7 7 0 0 0 7-7c0-4-3-6-4-9-1 2-2 3-3 3 0-2-1-4-2-6-2 3-5 6-5 12a7 7 0 0 0 7 7z"/>',
    stopwatch: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.6 2.4M10 2.5h4M12 2.5V6M18.4 6.4l1.4-1.4"/>',
    film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7.5 3v18M16.5 3v18M3 7.5h4.5M3 12h4.5M3 16.5h4.5M16.5 7.5H21M16.5 12H21M16.5 16.5H21"/>',
    noslap: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
    sound: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
    mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    seat: '<path d="M6 10V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v4"/><path d="M4 10h16v5H4zM6 15v5M18 15v5"/>',
    sparkle: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8"/>',
    namaste: '<path d="M12 21V9.5L9.6 4.8a1.4 1.4 0 0 0-2.5 1.1L8 12.5l-3.6 5.4L7 21M12 21V9.5l2.4-4.7a1.4 1.4 0 0 1 2.5 1.1L16 12.5l3.6 5.4L17 21"/>',
  };

  function icon(name, cls = '') {
    const span = document.createElement('span');
    span.className = `ic ic--${name}${cls ? ` ${cls}` : ''}`;
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
    return span;
  }

  // ── scenery: the haunted haveli skyline ──────────────────────────────────
  function skyline() {
    const ink = '#07030b';
    const win = (x, y, w, h, lit, delay) =>
      `<path class="${lit ? 'win win--lit' : 'win'}" style="animation-delay:${delay}s" d="M${x} ${y + h} v${-(h - w / 2)} a${w / 2} ${w / 2} 0 0 1 ${w} 0 v${h - w / 2} z"/>`;
    const dome = (cx, y, w, h) =>
      `<path d="M${cx - w / 2} ${y} C${cx - w / 2} ${y - h * 0.55} ${cx - w * 0.12} ${y - h * 0.72} ${cx} ${y - h} C${cx + w * 0.12} ${y - h * 0.72} ${cx + w / 2} ${y - h * 0.55} ${cx + w / 2} ${y} Z"/><path d="M${cx} ${y - h} v${-h * 0.28}" stroke="${ink}" stroke-width="4"/>`;
    const chhatri = (cx, y, w) =>
      `<rect x="${cx - w / 2}" y="${y - w * 0.15}" width="${w}" height="${w * 0.15}"/>` +
      `<rect x="${cx - w * 0.42}" y="${y}" width="${w * 0.1}" height="${w * 0.55}"/><rect x="${cx + w * 0.32}" y="${y}" width="${w * 0.1}" height="${w * 0.55}"/>` +
      dome(cx, y - w * 0.15, w * 0.8, w * 0.7);
    let wins = '';
    let k = 0;
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < 13; i++) {
        const x = 488 + i * 50;
        const y = 196 + row * 46;
        if (row === 2 && (i === 6 || i === 5 || i === 7)) continue; // the main gate
        const lit = (i * 7 + row * 3) % 5 < 2;
        wins += win(x, y, 22, 32, lit, ((k++ * 0.37) % 4).toFixed(2));
      }
    }
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 340" preserveAspectRatio="xMidYMax slice" class="skyline">` +
      `<defs><linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1150"/><stop offset="1" stop-color="${ink}"/></linearGradient></defs>` +
      `<g fill="${ink}">` +
      // banyan trees
      `<path d="M0 340 V250 C20 200 70 190 110 210 C150 170 230 180 250 230 C290 220 330 250 320 290 L320 340 Z"/>` +
      `<path d="M1600 340 V240 C1580 196 1520 186 1480 206 C1440 168 1360 182 1346 230 C1306 222 1270 252 1282 292 L1282 340 Z"/>` +
      // side wings
      `<rect x="330" y="232" width="140" height="108"/><rect x="1130" y="232" width="140" height="108"/>` +
      chhatri(400, 232, 70) +
      chhatri(1200, 232, 70) +
      // minarets
      `<rect x="452" y="150" width="22" height="190"/><rect x="1126" y="150" width="22" height="190"/>` +
      dome(463, 150, 34, 40) +
      dome(1137, 150, 34, 40) +
      // main haveli
      `<rect x="474" y="176" width="652" height="164"/>` +
      `<rect x="464" y="170" width="672" height="10"/>` +
      chhatri(560, 170, 80) +
      chhatri(1040, 170, 80) +
      `<rect x="690" y="120" width="220" height="56"/>` +
      dome(800, 120, 190, 150) +
      chhatri(712, 120, 44) +
      chhatri(888, 120, 44) +
      `</g>` +
      `<g fill="#1a0a24" class="wins">${wins}</g>` +
      // the gate
      `<path d="M752 340 V300 a48 48 0 0 1 96 0 V340 Z" fill="#2a0410"/>` +
      `<path d="M752 340 V300 a48 48 0 0 1 96 0 V340" fill="none" stroke="#b5121b" stroke-width="3" opacity=".7"/>` +
      // rim light along the roofline
      `<path d="M474 176 H1126" stroke="url(#rim)" stroke-width="2" opacity=".8"/>` +
      `</svg>`
    );
  }

  // ── public API ───────────────────────────────────────────────────────────
  const imgCache = new Map();

  function portrait(id) {
    return (CAST[id] || CAST.hero)();
  }
  function sprite(id) {
    return SPRITES[id]();
  }
  /** Cached <img> for canvas drawing. Check `img.complete` before drawing. */
  function image(id) {
    if (!imgCache.has(id)) {
      const img = new Image();
      img.decoding = 'async';
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SPRITES[id] ? sprite(id) : portrait(id))}`;
      imgCache.set(id, img);
    }
    return imgCache.get(id);
  }
  function el(markup) {
    const t = document.createElement('template');
    t.innerHTML = markup.trim();
    return t.content.firstChild;
  }

  global.MKM = global.MKM || {};
  global.MKM.art = { portrait, sprite, image, icon, skyline, el, CAST_IDS: Object.keys(CAST) };
})(window);
