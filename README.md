# 🎬 Maut Ka Mahurat (मौत का मुहूर्त)

**A Bollywood trivia murder party.** Shaitaan Seth, a long-dead film producer, haunts the abandoned
Kaali Haveli Studios and is shooting his final picture, with you as the cast. Answer his filmy
trivia right and you live. Answer wrong and you're dragged into **The Climax Scene**, where the
slowest slapper becomes a **bhoot**. Bhoots keep playing, and in the **Climax Chase** they can
steal a living player's body.

One screen (TV or laptop) is the theatre. 2 to 8 players use their phones as controllers,
from anywhere once it's hosted online.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/shreya-v7/maut-ka-mahurat)

**Play online:** deploy with the button above (free, no credit card), open `https://<your-app>.onrender.com/host`
on the TV, and players anywhere open the same site on their phones. Free Render apps sleep after
about 15 idle minutes, so the first visit after a break takes up to a minute to wake.

**Play on your Wi-Fi:**

```bash
npm install
npm start
```

- **Host screen:** <http://localhost:3000/host> (put it on the TV and click **Create Room**)
- **Phones:** scan the QR code, or open the LAN address shown on screen and type the 4-letter code.
  Phones must be on the same Wi-Fi as the host machine.

---

## How a game plays

| Phase | Big screen | Phones |
|---|---|---|
| **Casting Call** (lobby) | Room code, QR, join URL, cast slots, 4/6/8 scene picker | Join with code + name; you're cast as a stock role (Hero No. 1, Khalnayak, Item Number…). First player is VIP 👑 and can start |
| **Opening credits** | "Starring … and introducing …" + rules | "Look at the big screen" |
| **Trivia** (×4/6/8) | Question, 15s ring timer, who's locked in | A / B / C / D buttons. Correct = 1,000 + up to 500 speed bonus |
| **Reveal** | "dhan… dhan… DHAAN" triple zoom on the right answer, avatars under their picks | ✅ / ❌, points |
| **The Climax Scene** (killing floor) | Doomed players under a spotlight, then a live slap board | **Thappad Reflex** (below) |
| **Verdict** | Times ranked; the slowest **flash, shatter and return as a bhoot** | Your death (or survival) animation |
| **Climax Chase** (final) | Film-strip race track with 12 frames to the 🚪 Studio Gate | Rapid-fire "this or that", 8 seconds each |
| **The End** | Winner, standings, marigold petal shower, *Same cast, new show* | Your rank |

### Thappad Reflex (the mini-game)

A 3×3 grid on the phone. After a random pause, a tile lights up:

- 😈 **Shaitaan**: slap (tap) him as fast as you can. Your reaction time is recorded.
- 👵 **Maa**: *never slap Maa.* +0.6s of shame.
- Tapping an empty or wrong tile: +0.25s.

Everyone in the scene gets the **same sequence** (5 Shaitaans, 2 Maas), and the **phone times itself
locally**, so network lag can't decide who dies. The server clamps every reaction to a plausible
110–2000 ms window.

- 2 or 3 doomed: the slowest dies. 4 or more doomed: the two slowest die.
- Alone in the scene: beat Shaitaan Seth's par of **2.90s** or die.
- Didn't finish (left, phone died): you die.

### Climax Chase rules

- **Zinda (living):** +1 space per correct answer. Reach space 12 to escape and **win**.
- **Bhoot (dead):** +2 spaces per correct answer, but can't leave the studio.
- A bhoot that **lands on or overtakes** a living player *while moving* **possesses** them: the
  bhoot comes back to life, and the victim becomes a bhoot and is flung back 2 spaces.
  A bhoot already ahead of you can't strike, so nobody can camp the gate.
- Living players within a bhoot's reach glow red on the track.
- Everyone dead before the chase? *"Picture abhi baaki hai!"* The top scorer gets one more take.
- No escape after 14 questions: the living player closest to the gate wins.

---

## Architecture blueprint

```
 ┌──────────────── Phone (player.html) ───────────────┐
 │  intents ──► player:join / rejoin / answer / mg:*  │
 │  ◄── player:state  (personal snapshot)             │
 └────────────────────────┬───────────────────────────┘
                          │ Socket.io
 ┌────────────────────────▼───────────────────────────┐
 │ server.js                                          │
 │   rooms: Map<code, Room>                           │
 │   Room = phase machine + timers + scoring + views  │
 │     hostView()       → everything for the TV       │
 │     playerView(p)    → only p's private data       │
 └────────────────────────┬───────────────────────────┘
                          │ Socket.io
 ┌────────────────────────▼───────────────────────────┐
 │  TV (host.html) ◄── host:state (full snapshot)     │
 │  host:create / rejoin / start / settings / kick    │
 └────────────────────────────────────────────────────┘
```

**The server is the only source of truth.** Clients send *intents* and receive *full snapshots*,
never deltas. Every snapshot carries:

- `phaseKey`: bumps on every phase change. Clients rebuild the scene when it changes and patch
  in place otherwise.
- `remainingMs` / `durationMs`: clients turn these into a local deadline (`MKM.PhaseClock`), so
  device clock skew never matters.

### Phase machine (one per room)

```
LOBBY → INTRO → QUESTION → REVEAL ──(a living player got it wrong?)──┐
                   ▲          │ no                                   ▼
                   │          │                       KF_INTRO → MINIGAME → KF_RESULT
                   │          ▼                                           │
                   └─── more rounds & someone alive? ◄────────────────────┘
                              │ no
                              ▼
           FINAL_INTRO → FINAL_QUESTION ⇄ FINAL_REVEAL → GAME_OVER → (LOBBY)
```

Phases end on their timer, or early when every *connected* player has answered or submitted.

### Socket events

| Direction | Event | Payload |
|---|---|---|
| host → server | `host:create` | → ack `{ code, hostToken }` |
| | `host:rejoin` | `{ code, hostToken }` |
| | `host:settings` | `{ rounds: 4 \| 6 \| 8 }` |
| | `host:start` / `host:lobby` / `host:close` | |
| | `host:kick` | `{ playerId }` (lobby only) |
| | `host:skip` | dev only (`/host?dev=1`, press **S**) |
| phone → server | `player:join` | `{ code, name }` → ack `{ playerId, token }` |
| | `player:rejoin` | `{ code, playerId, token }` |
| | `player:start` | VIP only |
| | `player:answer` | `{ choice }` |
| | `mg:progress` | `{ hits }` (live slap count for the TV) |
| | `mg:result` | `{ times: [ms × 5], penalties }` |
| | `player:leave` | |
| server → host | `host:state` | full room snapshot |
| server → phone | `player:state` | personal snapshot |
| server → any | `room:closed` | `{ reason, replaced? }` |

### Disconnects and robustness

- **Phones:** the session `{ code, playerId, token }` lives in `localStorage`. A refresh, locked
  screen or dropped Wi-Fi reclaims the seat automatically. The secret `token` stops anyone else
  from taking it over.
- **Lost messages:** answers and mini-game results are *intents* that stay queued until the server
  acknowledges them, and are re-sent after a reconnect. Duplicates are ignored.
- **Host screen:** the session is in `sessionStorage`; reloading the TV rejoins the same room
  mid-game. The game keeps running while the TV is away, and the room closes after 10 minutes
  without a host.
- **Lobby:** a phone that leaves and doesn't return within 30s loses its seat. If the VIP leaves,
  the badge passes to the next connected player.
- **Mid-game:** a disconnected player's seat is kept. Missing an answer counts as wrong, and
  missing the Climax Scene is a DNF.
- **Second tab:** opening the same controller elsewhere hands control to the newest tab.
- **Safety:** a crash inside a phase handler ends the game on the result screen instead of
  wedging the room, and bad payloads never crash the server. Player names are always rendered
  as text, never as HTML.

---

## Files

```
server.js            Express + Socket.io + the Room state machine (rules, timers, scoring, views)
data/questions.js    63 four-option questions + 34 "this or that" chase questions
public/
  host.html/.js      TV: scenes per phase, cast strip, narrator, canvases (embers/petals,
                     live slap board, chase track)
  player.html/.js    Phone: join, buttons, Thappad Reflex canvas game, intent outbox
  css/theme.css      Palette + every reusable animation (see below)
  css/cinema.css     Curtains, letterbox, film leader, film burn, projector, tickets, clapper, sky
  css/host.css       TV layout (vh/vw so it scales laptop → TV)
  css/player.css     Mobile-first controller, ghost theme
  js/shared.js       DOM builder, PhaseClock, storage, shatter/kill/revive, cinema builders
  js/art.js          Hand-drawn SVG portraits, sprites, icons, haveli skyline
  js/narration.js    Shaitaan Seth's script (subtitles + voice lines)
  js/audio.js        Web Audio synth soundtrack + SFX + recorded ghost voice playback
  audio/vo/          Pre-recorded ghost voice (119 lines) + manifest.json
tools/bots.js        Bot players and a headless full-game simulator
tools/make-voice.js  Records the ghost voice (macOS say + pure-JS effects + afconvert)
render.yaml          One-click free hosting on Render
```

### Animation classes (`public/css/theme.css`)

| Class | Effect |
|---|---|
| `.flicker` | Candle/neon flicker (filter-based, works on gradient text) |
| `.diya` + `__flame` / `__bowl` | CSS clay lamp with a living flame |
| `.candlelight`, `.grain`, `.vignette` | Breathing warm light, film grain, lens vignette |
| `.dhan-zoom` | The TV-serial triple zoom |
| `.avatar--dying` | Red flash + tremble before death |
| `.shatter-layer` / `.shard` | Fade-and-shatter pieces (built by `MKM.shatter(el)`) |
| `.avatar--ghost`, `.avatar--ghost-enter` | Spectral, desaturated, floating bhoot |
| `.avatar--revive` | Golden resurrection ring (possession) |
| `.shake`, `.pop-in`, `.rise-in`, `.fade-in`, `.drips` | Beats and entrances |

`MKM.killAvatar(el)` runs the whole death: flash → shatter → ghost fade-in.

### Look and sound

- **Art (`public/js/art.js`):** every visual is hand-built SVG, no emoji or image files. That covers 10
  retro-poster character portraits (sunburst, halftone, ink outlines), Shaitaan Seth himself, the
  Shaitaan and Maa sprites for the slap game, an icon set and the haunted haveli skyline.
- **Cinema layer (`public/css/cinema.css`):** red velvet curtains, letterbox bars for big moments, an old
  film-leader 3-2-1 countdown, film-burn flashes between scenes, projector scratches, cinema-ticket
  answer cards and a clapperboard scene header.
- **Ghost voice:** Shaitaan Seth speaks every line and reads every question in a ghostly Indian-English
  voice. `npm run voice` (macOS only) records each line with the `Aman` (en-IN) voice, then a pure-JS
  effects chain slows and deepens it and adds a sub-octave demon layer, breathy whispers, a spectral
  chorus, a cave echo and haunted-hall reverb. The resulting `.m4a` files in `public/audio/vo/` are
  committed, so hosting needs no macOS. Edit lines in `public/js/narration.js`, then re-run
  `npm run voice` (`--force` re-records everything, `--voice Rishi` tries another voice).
- **Music and SFX** are synthesized live with Web Audio: tanpura drone, tabla *theka*, Raag Bhairav
  bells, the *dhan-dhan-DHAAN* stinger, *thappad* slaps and a shehnai fanfare. You can drop real
  recordings into `AUDIO_FILES` in `public/js/audio.js`.

The host needs one click before sound can play (browser autoplay rule).

---

## Testing

```bash
# Fill a real room with bots (host on the TV, you on your phone)
node tools/bots.js ABCD 3

# Headless end-to-end game: fake host + 5 bots, exits 0 when the film ends
TIME_SCALE=0.05 npm start            # terminal 1: every timer ×0.05
node tools/bots.js --simulate 5      # terminal 2 (add --chaos to randomly drop connections)
```

Other knobs: `PORT`, `MIN_PLAYERS` (set it to `1` to test solo), and `PUBLIC_URL` (used for the QR
code when you're behind a tunnel or deployed). Open `/host?dev=1` to skip phases with **S**.
**M** mutes and **F** goes fullscreen.

### Adding questions

Edit `data/questions.js`. Always put the **correct answer in `a`**, because the server shuffles options:

```js
{ cat: 'Villain Vault', q: 'Who played Mogambo?', a: 'Amrish Puri', wrong: ['Amjad Khan', 'Prem Chopra', 'Pran'] }
```

---

## Known limits and next steps

- **State is in memory.** A server restart ends running games. For multiple instances, move rooms
  to Redis and use the Socket.io Redis adapter.
- **Mini-game timing is client-reported.** It's clamped server-side, but a determined cheater could
  still fake a fast run. Next step: sign the sequence and add server-side timing heuristics.
- **The Wake Lock API needs HTTPS**, so on plain-HTTP LAN play phones may dim. Vibration only works
  on Android.
- **Ideas:** more Climax Scene games (Antakshari speed round, "Dance like Govinda" tilt game),
  audience mode, Hindi/English language toggle, recorded voice-over.
