# Ember — Design & Technical Documentation

This document explains how *Ember* is built, why it's built that way, and
where it could go next. It's both a map of the code and a design brief for
future work on the **look**, the **UI**, and the **game feel**.

For the player-facing pitch and how to run it, see [`../README.md`](../README.md).

---

## 1. Design pillars

Everything in Ember is measured against four pillars. When in doubt, favour
these over features:

1. **One creature, one screen.** No menus, no navigation, no second view.
   The whole app is the coal and his hearth.
2. **Calm, never demanding.** No stats, no currency, no timers counting
   down, no neglect penalty, no notifications. The sleep state is *cozy*,
   not a threat — he is never lost and never needs "saving."
3. **Tactile delight.** The single interaction (flick) must feel physical
   and satisfying every single time. Juice (squash, sparks, glow, sound)
   is the product, not decoration.
4. **Warmth.** Colour, light, motion and copy should all read as *cozy*:
   slow, soft, warm, affectionate.

If a change makes Ember busier, noisier, or more demanding, it's probably
wrong even if it's "more game."

---

## 2. Project structure

```
coal-game/
├── index.html              # single page: <canvas>, message overlay, mute button, manifest/icon/font links
├── styles.css              # full-bleed canvas, the floating message, the mute button
├── game.js                 # everything else: scene, physics, the coal, particles, bloom, audio
├── manifest.webmanifest    # web-app manifest (installable)
├── sw.js                   # tiny offline cache (service worker)
├── icon.svg                # app icon (vector), drawn to match the coal
├── icon-192.png            # app icon (raster, maskable)
├── icon-512.png            # app icon (raster, maskable)
├── README.md               # player-facing readme
└── docs/
    ├── DESIGN.md     # this file
    └── screenshot.png
```

No build step, no dependencies, no bundler. Open `index.html` and it runs.
The only external *runtime* asset is the **Quicksand** web font (SIL OFL)
loaded from Google Fonts for the floating messages (graceful fallback to a
system sans if offline); everything else — including the app icons — is drawn
procedurally on a `<canvas>`. Served over http(s) the app is **installable**
and runs **offline** via a cache-first service worker.

---

## 3. Runtime architecture

`game.js` is one IIFE (`(() => { "use strict"; … })()`) so nothing leaks to
the global scope. It is organised top-to-bottom in clearly commented
sections:

`helpers → palette → sizing/geometry → coal struct → embers → particles →
life state → messages → audio → input → physics → update → rendering → loop
→ boot`.

### Main loop

```
requestAnimationFrame(frame)
  dt = clamp(now - last, 0, 0.05)   // cap large gaps (tab switches)
  time += dt
  update(dt)                        // sim: life, physics, particles, spawns
  draw()                            // render the whole scene every frame
```

`dt` is clamped to **50 ms** so a backgrounded tab can't integrate a huge
step and fling the coal through a wall. The simulation is fully
re-evaluated each frame (no retained scene graph) — the scene is cheap
enough that immediate-mode redraw keeps the code simple.

**Hit-stop.** A hard impact sets a small `hitStop` timer (scaled by impact
speed, max ~60 ms; zero under reduced-motion). While it's counting down the
loop keeps *drawing* but skips `update`, with `time` advancing at 12% so the
glow still breathes — a brief freeze that makes hard hits really land.

**Lifecycle.** The loop's `requestAnimationFrame` handle is kept in `raf`. On
`visibilitychange → hidden` the loop is cancelled (and the visit time saved);
on return it resumes from a fresh `last`. All state is time-based, so it picks
up cleanly and the tab uses no battery while hidden.

### Resolution / DPR

`resize()` sets the canvas backing store to `cssSize × devicePixelRatio`
(capped at 2 for cost) and scales the context so all drawing is in CSS
pixels. `computeScene()` recomputes all geometry on resize, so the hearth
is fully responsive.

---

## 4. Scene geometry — the oblique fire-pit

The scene is a round pit seen from a **3/4 overhead angle**. The trick is
that a circle viewed obliquely is an **ellipse**, and the pit is described
by a few nested ellipses that all share a horizontal centre `cx`:

```
                 ___________________________
            ,-'''        rim ellipse        '''-.       (cx, cyRim) r=(RX,RY)
          /            inner rim ellipse          \     r=(innerRX, innerRY)
         |   ....   back wall (pit interior)  ...   |
         |  :    ` - . _______________ . - '     :  |
         |  :        ash bed ellipse           :  |   (cx, floorCy) r=(floorRX, floorRY)
          \  `.        ( ( coal ) )         .'  /
            `-._____________________________.-'
```

| Symbol | Meaning | Current value |
|--------|---------|---------------|
| `SQUISH` | vertical foreshortening of every ellipse | `0.54` |
| `RX, RY` | outer rim radii | `RX = min(W·0.49, H·0.72)`, `RY = RX·SQUISH` |
| `cyRim` | rim centre, vertically | `H · 0.47` |
| `stoneT` | stone-ring thickness | `RX · 0.13` |
| `innerRX/RY` | inner edge of the stone ring | `R − stoneT` |
| `floorRX/RY` | ash bed radii | `innerRX·0.95`, `innerRY·0.72` |
| `floorCy` | ash bed centre (dropped below the rim) | `cyRim + RY·0.30` |
| `coalR` | coal radius | `floorRX · 0.19` |
| `bedRX/RY` | where the coal's **centre** may travel | `floorRX − coalR·0.6`, `floorRY − coalR·0.8` |

The ash bed is a separate, smaller, lower ellipse than the rim. The gap
between the inner-rim ellipse and the ash ellipse, on the **far** side, is
what reads as the **back wall**. Because the ash sits low and the coal is
drawn on top of the front stones (see §5), the coal can roam nearly the
whole bed — well above the visual middle — without ever being clipped.

---

## 5. Rendering pipeline

`draw()` paints back-to-front every frame. Order matters for depth:

| # | Layer | Why here |
|---|-------|----------|
| 1 | night fill + warm bloom | backdrop |
| 2 | `drawRim(false)` — far stones | behind the pit |
| 3 | `drawPitInterior` | the curved brick wall fills the whole inner ellipse (so there are never background gaps) |
| 4 | `drawAshFloor` | ash ellipse on top of the wall; its upper edge becomes the back-wall base |
| 5 | `drawSmoke(true)` | a wisp rising *behind* the coal |
| 6 | `drawRim(true)` — near stones | the front rim |
| 7 | `drawEmbers` | friends in the ash, **on top of the front stones** → never clipped |
| 8 | `drawTrail` | hot after-image behind a fast flick, under the coal |
| 9 | `drawCoalShadow` + `drawCoal` | the pet, always fully visible |
| 10 | `drawParticles` | impact sparks/ash over the coal |
| 11 | `drawAmbient` | floating sparks drift over everything |
| 12 | `drawSmoke(false)` | a front wisp |
| 13 | `applyBloom` | soft filmic bloom over the whole frame (before the vignette) |
| 14 | `drawHint` | first-run animated "flick me" cue |
| 15 | vignette | focuses the eye on the warm centre |

### Bloom

`applyBloom()` is the cheap, robust bloom from §14.1: a downscaled
(`BLOOM_SCALE = 0.28`) copy of the just-rendered frame is blurred (via
`ctx.filter`) on a small offscreen canvas, then added back over the frame
with `globalCompositeOperation = "lighter"` at ~0.3 alpha. Bright, additive
layers (coal glow, embers, firelight, sparks) bloom; the near-black night and
the vignette that follows keep the edges dark. The whole pass is wrapped in
`try/catch` and self-disables (`bloomOK = false`) if a browser can't do it,
so the visuals never break.

### Organic firelight flicker

`fireFlicker()` sums a few octaves of smooth 1-D **value noise** (`vnoise`)
into a multiplier hovering around 1.0 (≈ 0.75…1.09). It modulates the global
`warm` term every frame, so the ash pool, the back-wall glow and the coal's
heat all shimmer like real coals instead of breathing on a single clean sine.
Under `prefers-reduced-motion` it returns a flat `1`.

**Key decision:** the coal and embers render *after* the front stones.
Earlier they were drawn before, so the rim clipped the coal's lower half
when he rolled forward. Drawing him last means he's never cut off — he
simply passes in front of the near rim, which reads correctly as depth.

### Stones

`drawRim` walks `RIM_N = 22` angular slots around the ellipse, splitting
them into **far** (`sin θ ≤ 0.04`) and **near** halves so they can be drawn
on either side of the interior. Each stone is a rounded quad
(`roundPoly` via `arcTo`) with: a soft drop shadow, a vertical body
gradient (lit a little more on the near/lower side), a thick dark cel
outline, and a glossy inner-edge highlight. Per-stone variation (`stoneVar`,
seeded once) keeps them from looking mechanical.

### The ash bed

A radial gradient (warm pale centre → darker rim), a back-edge shadow so
the bed feels sunken, an **additive firelight pool** that follows the coal's
position, gentle procedural **mounds** (seeded soft blobs) for texture, and
scattered glowing embers buried in the ash whose brightness tracks
`life.energy`.

---

## 6. The coal

### Art

The body is a seeded, slightly irregular **blob** (16 radii, smoothed with
quadratic segments) so it reads as an organic lump, not a circle. Over it:
an additive outer glow, a molten inner-light gradient, a thick dark
outline, and a sparse web of **glowing cracks** kept around the rim so they
never fight the face. All crack/glow intensity scales with `heat`
(`energy · warm + pulse + igniteFlash`), so the whole coal "breathes."

### Expressions

The face is two passes — a soft orange glow halo then a crisp bright core —
so it pops over the cracks. Three moods:

| Mood | When | Eyes / mouth |
|------|------|--------------|
| **content** | resting, awake | closed smile-curve eyes `◡ ◡`, gentle smile |
| **laughing** | speed > ~200 or being dragged fast | squeezed carets `^ ^`, open laughing mouth |
| **sleepy** | `sleepiness > 0.5` | relaxed near-flat eyes, tiny smile, dimmed, `z z z` |

Plus rosy additive cheeks, and **squash & stretch** (`sqx/sqy`, a damped
spring) kicked on every impact along the contact normal.

**Idle micro-life.** When he's calmly grounded and awake he gives an
occasional happy **eye-smile "twinkle"** (the content arc-eyes briefly become
laughing carets, on a randomised `blink` timer) and **breathes** on a slow
sine scale — gentler awake, deeper and slower asleep. Both are suppressed
under `prefers-reduced-motion`.

---

## 7. Physics — a shallow bowl, seen from above

There is **no screen-down gravity** (that's a side-view idea). Instead the
coal slides on the ash plane like an air-hockey puck in a soft bowl:

```
if held:        follow the pointer (clamped into the bed ellipse)
elif grounded:  ease to rest, upright, do nothing else  (no false impacts)
else:
    homeScale = clamp(1 − speed/320)        # 0 at speed, 1 when slow
    v += (restSpot − pos) · HOMING · homeScale · dt
    v *= FRICTION^dt
    pos += v · dt
    spin  ← rolls with horizontal velocity
    if outside bed ellipse:  reflect v across the ellipse normal (REST), spark
    if bumps a friend ember while fast:  flare it + chain ripple
    if speed < 26 for 0.35 s:  grounded = true
```

| Knob | Value | Feel it controls |
|------|-------|------------------|
| `FRICTION` | `0.36` | fraction of velocity kept per second — **lower = he stops sooner**, higher = he glides and bounces longer |
| `HOMING` | `2.6` | how firmly he rolls back to the middle **once slow** |
| `REST` | `0.62` | wall bounciness (0 = dead stop, 1 = perfect bounce) |
| `GAIN` / `MAXV` | `0.95` / `2600` | flick strength from drag speed, and its cap |
| homing cutoff | `320` px/s | above this, homing is off so flicks stay responsive |

**Why "homing only when slow":** a constant centring spring fights the
player (he can't put the coal where he wants). Gating it by speed means a
flick travels and bounces freely, then — once it's calmed down — the coal
*gently rolls home* on its own. Responsive and cozy.

**Grounded rest** is important: when settled, gravity/integration is
skipped entirely. This was added to kill a class of bug where a single slow
frame's integration faked a wall impact (spurious sparks, even
self-waking). Resting = inert.

Ellipse wall collision is done by normalising into unit-circle space
(`hypot(dx/bedRX, dy/bedRY) > 1`), pushing the coal back onto the boundary,
and reflecting velocity across the true ellipse normal
`(dx/bedRX², dy/bedRY²)`.

---

## 8. Particles

Four pools, all capped to bound cost:

- **sparks** — bright, additive, biased upward (rising embers), gentle
  gravity, hot hues; spawned on impacts/flares/poke/reignite.
- **ash** — soft grey puffs that rise, spread and fade; spawned on impact
  and on the settle "plop."
- **ambient** — lazy background motes drifting up from the bed continuously,
  flickering, for life.
- **trail** — a short ring buffer of recent coal positions, drawn as faint
  hot after-images while he's flicked fast (off under reduced-motion).

Spark and ash spawn counts are scaled by `PARTICLE_MUL` (`0.45` under
`prefers-reduced-motion`, else `1`) so motion-sensitive players get a calmer
hearth.

---

## 9. Hearth life — energy, sleep, reignition

A single `life` object holds `energy`, `sleepiness`, `asleep`, and
`igniteFlash`. `energy` relaxes toward a warm baseline
(`lerp(0.72, 0.4, sleepiness)` awake, `0.14` asleep) and is bumped by play.

- After **`SLEEP_DELAY` = 16 s** of calm, `sleepiness` ramps over
  **`SLEEP_FADE` = 6 s** until he naps: dimmer hearth, relaxed eyes, `z z z`.
- **Any** touch calls `reignite()`: energy to full, a warm `igniteFlash`,
  and the friend embers flare in a staggered ripple — "the whole hearth
  flickers back to life" — with a wake message and a soft chime.

This is the one place where the spec's "no death" rule and the requested
"sleeps when embers fade / flick relights it" behaviour meet. It's resolved
as **ambience, not stakes**: nothing is lost, nothing must be done.

---

## 10. Messages

Low-opacity (`0.7`) Quicksand text, faded in/out via CSS. Pools by context:
`play`, `chain`, `wake`, `rest`, `sleepy`. Shown on relevant events with a
**5 s frequency gate** and a **2.6 s** display timer driven by `setTimeout`
(deliberately *not* the rAF loop, so messages still hide correctly when the
tab is backgrounded). Copy is short, lowercase, affectionate.

---

## 11. Audio

Tiny Web Audio synth, no files, started on first gesture, behind the mute
button:

- **Hum:** two detuned sines (64/81 Hz) → lowpass, with a slow LFO — a low
  cozy fire bed. It **swells gently with `energy`** (`updateHum` eases the hum
  gain a few times a second) so a livelier hearth sounds a touch warmer.
- **Crackle:** short filtered noise bursts on impacts/flares, plus the odd
  randomised **pop** every couple of seconds while he's awake, so the loop
  never feels static.
- **Giggle:** a pitched-up two-note sine blip on big flicks, to match the
  laughing face.
- **Tok:** a low, woody sine thud when he caroms *hard* off the stone rim.
- **Chime:** a soft rising sine on wake.

All wrapped in `try/catch` so a missing/blocked AudioContext never breaks
the visuals. Master gain ramps on mute, and the mute choice is persisted.

---

## 12. Input

Pointer Events (mouse + touch). Pointer-down within `max(coalR·1.8, 48)px`
grabs him; while held he follows the pointer (clamped into the bed). On
release, flick velocity is estimated from the **last ~120 ms** of pointer
samples (robust to a stationary final frame). A near-zero drag is treated
as a **poke** — a happy little hop in a random direction.

---

## 13. Tuning quick-reference

All the feel lives in a handful of constants near the top of each section:

| Want… | Change |
|-------|--------|
| Bigger / smaller hearth | `RX` multipliers in `computeScene` |
| Smaller / larger coal | `coalR = floorRX · 0.19` |
| Coal can roam more/less of the bed | `bedRX/bedRY` margins |
| He glides longer / stops sooner | `FRICTION` (↑ = longer) |
| Bouncier / deader walls | `REST` |
| Returns home faster / barely | `HOMING`, and the `320` cutoff |
| Flicks stronger / weaker | `GAIN`, `MAXV` |
| Naps sooner / later | `SLEEP_DELAY`, `SLEEP_FADE` |
| Chattier / quieter messages | `msgCooldown` gate, pool contents |
| Warmer / cooler scene | the gradient stops in `drawPitInterior`, `drawAshFloor`, and `warm` in `draw` |
| Stronger / softer bloom | the `globalAlpha` (0.3) and `BLOOM_SCALE`/blur in `applyBloom` |
| Bigger / smaller flicker | the coefficients in `fireFlicker` |
| Longer / shorter hit-stop | the `speed / 4200` (and wall `vn / 3000`) caps feeding `hitStop` |
| Longer / shorter flick trail | the `spd > 540` gate and trail cap in `update` |
| Fewer particles for reduced-motion | `PARTICLE_MUL` |

---

## 14. Suggestions for the look, the UI, and the game feel

These are prioritised ideas for where Ember goes next. None are required;
all respect the design pillars in §1.

### 14.0 Shipped since first draft

A good chunk of this roadmap is now in the build (✓ items below):

- **Look:** soft global **bloom** pass, **animated firelight flicker** (value
  noise), **idle micro-life** (blink "twinkle" + breathing). *(The
  time-of-day warmth hook and depth-haze remain open.)*
- **Game feel:** **hit-stop** on hard impacts, **after-image trail** on fast
  flicks, a settle **"plop,"** **friend-ember personality** (wobble + rare
  hop + pip), and a **rewarding wall carom** (fat sparks + "tok").
- **UI / platform:** **`prefers-reduced-motion`** support (thinned particles,
  no trail/wobble/hit-stop/haptics, flat flicker), **haptics** on mobile,
  **installable + offline** (manifest + service worker), a **persisted mute**
  and a one-time **animated first-run hint**, plus a **"missed you" greeting**
  for returning visitors and an `rAF` **pause while hidden**.
- **Audio:** the fire bed **swells with energy**, randomised **pops**, a
  **giggle** on big flicks and a woody **"tok"** on hard caroms.

The remaining un-checked ideas below are still the best next steps.

### 14.1 Look / art direction

- **Final illustrated assets.** The procedural art is a strong placeholder
  but the highest-impact upgrade is hand-drawn/illustrated sprites for the
  coal (idle + a small frame set for blink/laugh), the stone ring, and the
  back wall, dropped in over the same geometry. Keep the procedural glow,
  particles and lighting on top so motion stays alive.
- **Soft global grade.** A subtle bloom/blur pass on just the bright
  (additive) layer would make the glow feel filmic and cozier than the
  current per-element `shadowBlur`. Cheap to fake with one offscreen canvas.
- **Animated firelight.** Let the warm pool on the ash and the back-wall
  glow flicker on a low-frequency noise (not just the breathing sine) so
  the whole pit subtly shimmers like real coals.
- **Depth haze.** A faint warm haze/heat-shimmer rising from the bed would
  sell the temperature. A 1–2 px sinusoidal horizontal displacement on a
  clipped strip above the coal is enough.
- **Idle micro-life.** Occasional blinks, a slow sleepy "breath" scale on
  the whole body, an ember that drifts past and makes him glance at it.
- **Seasonal/time tints.** The time-of-day warmth hook already exists;
  extend it to a gentle palette shift (cooler blue night, golden evening)
  for ambient variety with zero gameplay weight.

### 14.2 UI / UX

- **First-run hint polish.** The one-line hint is good; consider a faint
  pulsing finger/cursor that mimics a flick once, then never again
  (persist "seen" in `localStorage`).
- **Respect `prefers-reduced-motion`.** Already partly handled in CSS;
  extend it to damp particle counts and the idle wobble for motion-sensitive
  players.
- **Settle the mute control.** Add a matching, equally quiet control cluster
  position for future toggles (e.g. a tiny moon for "let him sleep"); keep
  them to icons only, ≤ 2, top-corner, low opacity, per pillar #1.
- **Haptics on mobile.** A short `navigator.vibrate(8)` on impacts would add
  real tactility on phones (guarded + respectful of reduced-motion).
- **Installable.** A web-app manifest + a tiny service worker makes Ember a
  proper offline "open it for ten seconds" home-screen toy — which is
  exactly its use case.

### 14.3 Game feel / juice

- **Hit-stop.** A 30–60 ms freeze on hard impacts makes them *land*. Scale
  the freeze with impact speed; skip it for gentle taps.
- **Trail on fast flicks.** A short motion trail / after-image when the coal
  is moving fast amplifies speed and reads beautifully against the dark.
- **Squash into the surface, not just the wall.** A tiny squash + ash poof
  when he comes to rest ("plop") would make settling satisfying, not just
  ending.
- **Friend-ember personality.** Let bumped embers do a little wobble and
  brighten with a soft *pip* sound, and very rarely have one hop — so the
  chain reaction feels like waking up friends, not lighting bulbs.
- **Reward exploration of the wall.** A slightly stronger spark burst and a
  satisfying *tok* when he caroms hard off the rim makes wall-bouncing a
  goal in itself.
- **Tune by feel, on a device.** The current constants were set by eye from
  rendered frames. The drag *weight* (latency, inertia), bounce liveliness,
  and homing speed should be dialled in on a real touch device — that's the
  one thing screenshots can't validate (see §16).

### 14.4 Audio

- **Layered fire bed** that swells slightly with `energy`, plus occasional
  randomised pops so the loop never feels static.
- **Pitched-up giggle** synthesised on big flicks (a quick two-note sine
  blip) to match the laughing face.
- Keep everything synthesised and quiet; never autoplay before a gesture.

### 14.5 Performance & platform

- Particle pools are capped, DPR is capped at 2, and the loop is immediate-
  mode — fine for this scope. If illustrated assets and a bloom pass are
  added, move the static layers (stones, wall) to a cached offscreen canvas
  redrawn only on resize.
- Pause `requestAnimationFrame` on `visibilitychange` to save battery when
  hidden (state is all time-based, so it resumes cleanly).

---

## 15. Known limitations / caveats

- **Feel is unverified on hardware.** Visuals and state were validated via
  headless screenshots; drag latency and "weight" need a real device pass.
- **Single coal only.** The chain-reaction embers are decorative, not
  physics bodies; multi-coal collisions would need broad-phase work.
- **Web font dependency.** Quicksand loads from Google Fonts at runtime; it
  falls back to system sans if offline, and the service worker caches it after
  the first online visit. Self-host the woff2 if you want it on the very first
  offline run too.
- **Minimal persistence (by design).** `localStorage` remembers only mute,
  "hint seen," and the last-visit time (for the greeting). Each open is still a
  fresh hearth otherwise — the "ash accumulates over time" nice-to-have from
  the original spec is intentionally not built; it would edge toward a stat.

---

## 16. How to verify changes

There's a lightweight visual-check workflow using Playwright (Chromium is
preinstalled in the dev container):

```js
// render index.html headless, drive the pointer to flick the coal,
// and screenshot specific states (idle / flick / drag-to-top / sleep).
const { chromium } = require('playwright');
// … goto file://…/index.html, page.mouse.down/move/up, page.screenshot()
```

This catches layout, clipping, draw-order and state bugs (it found the
arch even-odd clip bug and the resting-frame false-impact bug). What it
**cannot** judge is *feel* — latency, inertia, bounce satisfaction — so any
physics tuning should finish with a hands-on pass on desktop and mobile.
