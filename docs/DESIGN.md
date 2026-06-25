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
├── game.js                 # everything else: the low-poly renderer, scene, physics, particles, bloom, audio
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

No build step, no dependencies, no bundler, **no WebGL**. Open `index.html`
and it runs. The only external *runtime* asset is the **Quicksand** web font
(SIL OFL) for the floating messages (graceful fallback to a system sans if
offline); everything else — the whole 3-D-looking scene and even the app
icons — is generated and drawn procedurally on a 2-D `<canvas>`. Served over
http(s) the app is **installable** and runs **offline** via a cache-first
service worker.

---

## 3. Runtime architecture

`game.js` is one IIFE (`(() => { "use strict"; … })()`) so nothing leaks to
the global scope. It is organised top-to-bottom in clearly commented
sections:

`helpers → 3-D math & projection → mesh helpers → lighting → scene build →
sizing → the pet → friends → particles/motes → life → messages → audio →
input → physics → update → rendering → loop → boot`.

### Main loop

```
requestAnimationFrame(frame)
  dt = clamp(now - last, 0, 0.05)   // cap large gaps (tab switches)
  if hitStop > 0:  draw() only, advance time at 12%   // freeze on hard hits
  else:            time += dt; update(dt); draw()
```

`dt` is clamped to **50 ms** so a backgrounded tab can't integrate a huge
step. Per-frame the dynamic scene is fully re-evaluated; the *static* scene
(walls, rim, coal bed) is baked once and blitted (see §5).

**Hit-stop.** A hard impact sets a small `hitStop` timer (scaled by impact
speed, max ~60 ms; zero under reduced-motion). While it counts down the loop
keeps *drawing* but skips `update`, with `time` advancing at 12% so the glow
still breathes — a brief freeze that makes hard hits really land.

**Lifecycle.** The loop's `requestAnimationFrame` handle is kept in `raf`. On
`visibilitychange → hidden` the loop is cancelled (and the visit time saved);
on return it resumes from a fresh `last`. All state is time-based, so it picks
up cleanly and the tab uses no battery while hidden.

### Resolution / DPR

`resize()` sets the canvas backing store to `cssSize × devicePixelRatio`
(capped at 2 for cost) and scales the context so all drawing is in CSS
pixels. It then calls `computeProjection()` and `buildScene()`, so the hearth
is fully responsive — the entire low-poly scene is re-projected and re-baked
to fit the new viewport.

---

## 4. The low-poly renderer

Ember is drawn by a tiny **flat-shaded software renderer** in plain Canvas 2-D.
There is no WebGL and no retained scene graph: geometry is a list of triangles,
each one **projected to 2-D, flat-shaded by its own normal, and painted
back-to-front** (the painter's algorithm).

### Projection — a fixed 3/4 isometric

The camera never moves. World space is `x` right, `y` up, `z` toward the
camera; the floor is the plane `y = 0`. A fixed yaw (`28°`) and pitch (`33°`)
collapse to a simple **orthographic** map that's pre-computed once per resize
in `computeProjection()`:

```
sx = cx + A00·x + A01·z
sy = cy + A10·x + A11·z − HUP·y          // height just lifts a point up-screen
depth = y·sinP + (x·sinY + z·cosZ)·cosP  // painter key: larger = nearer
```

Because the map is linear on the floor plane, its 2×2 inverse (`screenToFloor`)
turns a pointer position or a drag velocity straight back into floor `(x, z)` —
that's how dragging and flicking work (§12).

### Meshes

Two generators, both seeded so the scene is identical every run:

- **`makeBox`** — a jittered cube (8 corners nudged), 12 triangles. The stone
  bricks and the rim stones.
- **`makeRock`** — a jittered **icosahedron** (12 verts pushed in/out by a
  random radius), 20 triangles. Every coal chunk, every friend ember, and the
  pet himself. Jitter gives the chiselled, faceted low-poly look.

### Lighting

`shade()` colours each face with **two lights**:

- a soft directional **key** (`AMB + KEY·max(0, n·LIGHT)`) for form, and
- **fire light rising from the coals** — a point at the pit centre
  (`FIRE_POS`) whose contribution is `max(0, n·toFire) · falloff(dist) ·
  FIRE_INT`, tinted `FIRE_COL`.

Stone is a dark charcoal base, so faces *facing the fire near the floor* glow
warm orange while tops and far corners fall to near-black — exactly the
concept's look. `FIRE_RANGE` controls how high up the wall the glow climbs.
Glowing coals additionally carry an **emissive** term so they read as hot
regardless of angle. Normals are oriented outward from each mesh's centre, so
lighting is correct no matter the triangle winding.

### Baking the static scene

`buildScene()` generates the walls, the rim ring and the **coal bed** (a
packed heap of ~380 rocks that mounds toward the centre and banks up against
the back wall), bakes every triangle to a screen-space record
`{pts, color, depth, wy, layer}`, sorts them back-to-front and paints them
**once** into an offscreen `bgCanvas`. Each frame the visible canvas just
blits that image — only the pet, friends, motes, particles and glow are live.

> **One gotcha worth knowing:** the floor is a single large quad. Sorting it by
> one centroid depth wrongly paints it over the back coals, so it's forced to
> `depth = -1e6` (always first). Big spanning polygons can't be depth-sorted
> against many small ones by centroid alone.

### Frame draw order

`draw()` each frame:

| # | Layer | Why here |
|---|-------|----------|
| 1 | blit `bgCanvas` | black bg + walls + floor + coal bed, baked |
| 2 | `drawFirePool` | flickering additive warm pool on the bed |
| 3 | `drawMotes` | little ember cubes drifting up the back wall |
| 4 | `drawFriends` | the bumpable embers (live, so they can flare & hop) |
| 5 | `drawTrail` + `drawPetGlow` | after-image + contact glow/shadow |
| 6 | `drawPet` | the pet, depth-sorted within itself, + billboard face |
| 7 | `drawForegroundCoals` | only the bed rocks **in front of & below** the pet, so he's nestled |
| 8 | `paintInto(rimFrontRecs)` | the near rim stones, always over the pet |
| 9 | `drawParticles` + `drawAmbient` | sparks, ash, motes |
| 10 | `applyBloom` | soft filmic bloom over the whole frame |
| 11 | `drawHint` | first-run animated "flick me" cue |

**Nestling without full sorting.** The pet roams a static, cached bed. Rather
than re-sort everything each frame, only the coals whose `depth` is *greater*
than the pet's **and** whose world height `wy` is *below* his centre **and**
which are near him on screen are re-drawn over him (`drawForegroundCoals`). A
few rocks tuck in front of his base; his face stays clear. The near half of the
rim (`rimFront`) is always painted last, so it occludes him when he rolls to
the front and harmlessly sits below him when he's at the back.

### Bloom

`applyBloom()` downscales (`BLOOM_SCALE = 0.28`) the just-rendered frame, blurs
it (via `ctx.filter`) on a small offscreen canvas, and adds it back with
`globalCompositeOperation = "lighter"` at ~0.26 alpha. Bright, additive layers
(coals, sparks, glow) bloom; the black surround stays black. The pass is
wrapped in `try/catch` and self-disables (`bloomOK = false`) if a browser
can't do it, so the visuals never break.

### Organic firelight flicker

`fireFlicker()` sums a few octaves of smooth 1-D **value noise** (`vnoise`)
into a multiplier hovering around 1.0 (≈ 0.75…1.09). It modulates the global
`warm` term every frame, so the fire pool, the friend embers, the motes and
the pet's heat all shimmer like real coals instead of breathing on a single
clean sine. Under `prefers-reduced-motion` it returns a flat `1`.

---

## 5. The coal pet

### Art

The body is a seeded jittered **icosahedron** (`PET_R = 0.9` world units),
flat-shaded like everything else — dark charcoal that catches the fire glow on
its lower facets, near-black on top, with a faint emissive so it never goes
fully flat. It **tumbles in real 3-D**: a rotation matrix `pet.R` is advanced
each frame about the axis perpendicular to its floor velocity, so the facets
roll as he travels. **Squash & stretch** (`sqXZ`/`sqY`, a damped spring) is
kicked on every impact, and a slow **breathing** scale plays while he rests.

### Face

The face is a 2-D **billboard** drawn in screen space at his projected centre,
so it always faces the camera (cute over correct), scaled to his on-screen
radius. Moods:

| Mood | When | Eyes / mouth |
|------|------|--------------|
| **content** | resting, awake | glossy round eyes (white + pupil + sparkle), gentle smile |
| **laughing** | floor speed high, or dragged fast | squeezed carets `^ ^`, open laughing mouth |
| **sleepy** | `sleepiness > 0.5` | relaxed arcs, tiny smile, `z z z` |

**Idle micro-life.** When calmly grounded and awake he gives an occasional
happy **eye-smile "twinkle"** (the round eyes briefly become carets, on a
randomised `blink` timer). Suppressed under `prefers-reduced-motion`.

---

## 6. Physics — an air-hockey puck in a rectangular pit

There is **no screen-down gravity** (that's a side-view idea). The pet slides
on the floor plane in world units like a puck in a shallow box:

```
if held:        place him under the pointer (screenToFloor), clamped to the bed
elif grounded:  ease to rest at centre, do nothing else  (no false impacts)
else:
    homeScale = clamp(1 − speed/HOME_CUT)   # 0 at speed, 1 when slow
    v += (centre − pos) · HOMING · homeScale · dt
    v *= FRICTION^dt
    pos += v · dt ; tumble the mesh with speed
    clamp to the rectangle [±bedHX, ±bedHZ], reflecting v · REST on a wall
    if bumps a friend ember while fast:  flare it + chain ripple
    if speed < 0.45 for 0.35 s:  grounded = true  (→ a "plop")
```

| Knob | Value | Feel it controls |
|------|-------|------------------|
| `FRICTION` | `0.42` | fraction of velocity kept per second — lower = stops sooner |
| `HOMING` | `2.4` | how firmly he rolls back to the middle **once slow** |
| `REST` | `0.62` | wall bounciness (0 = dead stop, 1 = perfect bounce) |
| `HOME_CUT` | `5` | speed above which homing is off, so flicks stay responsive |
| `GAIN` / `MAXV` | `0.95` / `34` | flick strength (drag→floor velocity) and its cap, in world u/s |

**Why "homing only when slow":** a constant centring spring fights the player.
Gating it by speed lets a flick travel and bounce freely, then *gently roll
home* once calm. Responsive and cozy.

**Grounded rest** skips integration entirely when settled, killing a class of
bug where a slow frame faked a wall impact. The pit walls are a simple
axis-aligned rectangle, so collision is four clamps + a reflected component —
far cheaper than the old ellipse normal, and a better fit for a square hearth.

---

## 7. Particles, friends & motes

- **sparks** — bright, additive, biased upward, hot hues; on impacts / flares /
  poke / reignite.
- **ash** — soft grey puffs; on impact and on the settle "plop."
- **ambient** — lazy motes rising from the bed continuously.
- **trail** — a short ring buffer of recent pet screen positions, faint hot
  after-images while flicked fast (off under reduced-motion).
- **motes** — the **floating ember cubes** that drift up the back wall; small
  glowing diamonds that recycle to the bottom when they reach the top.
- **friends** — five bumpable embers living in the bed. They flare on contact,
  ripple the flare to neighbours, **wobble on a spring** and occasionally
  **hop**. They're drawn live (not baked) so they can move.

Spark/ash counts and the bed/mote density scale by `PARTICLE_MUL` (`0.45` under
`prefers-reduced-motion`, else `1`).

---

## 8. Hearth life — energy, sleep, reignition

A single `life` object holds `energy`, `sleepiness`, `asleep`, and
`igniteFlash`. `energy` relaxes toward a warm baseline
(`lerp(0.72, 0.4, sleepiness)` awake, `0.14` asleep) and is bumped by play.

- After **`SLEEP_DELAY` = 16 s** of calm, `sleepiness` ramps over
  **`SLEEP_FADE` = 6 s** until he naps: dimmer hearth, relaxed eyes, `z z z`.
- **Any** touch calls `reignite()`: energy to full, a warm `igniteFlash`, and
  the friend embers flare and hop in a staggered ripple — "the whole hearth
  flickers back to life" — with a wake message and a soft chime.

Resolved as **ambience, not stakes**: nothing is lost, nothing must be done.

---

## 9. Messages

Low-opacity Quicksand text, faded in/out via CSS. Pools by context: `play`,
`chain`, `wake`, `rest`, `sleepy`. Shown on relevant events with a **5 s
frequency gate** and a **2.6 s** display timer driven by `setTimeout`
(deliberately *not* the rAF loop, so messages still hide when the tab is
backgrounded). Copy is short, lowercase, affectionate.

---

## 10. Audio

Tiny Web Audio synth, no files, started on first gesture, behind the mute
button:

- **Hum:** two detuned sines (64/81 Hz) → lowpass, slow LFO. **Swells with
  `energy`** (`updateHum`).
- **Crackle:** filtered noise bursts on impacts/flares, plus the odd randomised
  **pop** while awake so the loop never feels static.
- **Giggle:** a pitched-up two-note blip on big flicks.
- **Tok:** a low, woody thud on a hard wall carom.
- **Chime:** a soft rising sine on wake.

All wrapped in `try/catch`. Master gain ramps on mute, and the mute choice is
persisted.

---

## 11. Input

Pointer Events (mouse + touch). Pointer-down within ~1.5 pet-radii grabs him;
while held he follows the pointer, mapped to the floor plane via
`screenToFloor` and clamped to the bed. On release, flick velocity is estimated
from the last ~120 ms of pointer samples and run through `screenToFloor` to
become a floor-plane velocity. A near-zero drag is treated as a **poke** — a
happy hop. Big flicks add a giggle and a haptic tap.

---

## 12. Platform, persistence & accessibility

- **`prefers-reduced-motion`:** thinned particles & coal bed (`PARTICLE_MUL`),
  no trail, no idle wobble, no hit-stop, no haptics, flat flicker, no tumble.
- **Haptics:** `navigator.vibrate` on impacts/pokes/caroms, guarded and off for
  reduced-motion.
- **Persistence:** a few bytes of `localStorage` — mute, "hint seen," and last
  visit time. A returning visitor gets a "missed you" / cozy greeting; a brand
  new one gets the animated first-run hint.
- **Installable & offline:** `manifest.webmanifest` + a cache-first service
  worker (`sw.js`) + icons rendered from the coal art.
- **Battery:** the rAF loop pauses while the tab is hidden.

---

## 13. Tuning quick-reference

| Want… | Change |
|-------|--------|
| Bigger / smaller hearth | `proj.S` in `computeProjection` |
| Camera angle | `YAW` / `PITCH` |
| Smaller / larger coal | `PET_R` |
| Where he rests on the heap | `petBodyY()` |
| Denser / sparser coal bed | `N` and the size/`mound`/`backRise` terms in `buildScene` |
| Warmer / cooler, more / less lit stone | `AMB`, `KEY`, `FIRE_INT`, `FIRE_RANGE`, base colours |
| He glides longer / stops sooner | `FRICTION` |
| Bouncier / deader walls | `REST` |
| Returns home faster / barely | `HOMING`, `HOME_CUT` |
| Flicks stronger / weaker | `GAIN`, `MAXV` |
| Naps sooner / later | `SLEEP_DELAY`, `SLEEP_FADE` |
| Stronger / softer bloom | the `globalAlpha` (0.26) & `BLOOM_SCALE` in `applyBloom` |
| Bigger / smaller flicker | the coefficients in `fireFlicker` |
| Longer / shorter hit-stop | the `speed / 80` (wall) & `speed / 4200`-style caps feeding `hitStop` |
| Fewer particles for reduced-motion | `PARTICLE_MUL` |

---

## 14. Suggestions for where Ember goes next

None are required; all respect the design pillars in §1.

### Look
- **Per-vertex jitter caching / instancing.** The bed bakes ~380 rocks once;
  if it ever feels heavy on low-end phones, share a handful of pre-built rock
  meshes and only vary placement/colour.
- **Time-of-day / seasonal tint.** Shift `FIRE_COL`, `AMB` and the bg by hour
  for ambient variety with zero gameplay weight.
- **A wisp of smoke / heat-haze** rising off the brightest coals.
- **Soft contact deformation** — the coals immediately under the pet pressing
  down a touch as he rolls over them.

### Game feel / juice
- **Tune by feel, on a device.** The constants were set by eye from rendered
  frames; drag weight, bounce liveliness and homing speed want a hands-on pass
  on a real touch device (see §16).
- **Depth-correct coal kick-up:** when he caroms through the bed, nudge the
  nearest few coal rocks (they're already live-capable for friends).
- **Rare wandering ember** that drifts across the bed and makes him glance.

### UI / platform
- **First-run finger cue polish**, **a quiet "let him sleep" toggle** (≤ 2
  top-corner icons, per pillar #1).
- **Self-host the Quicksand woff2** for a fully-offline first run.

### Audio
- **Layered fire bed** that swells further with energy, plus pitched giggles
  that vary with flick strength.

---

## 15. Known limitations / caveats

- **Feel is unverified on hardware.** Visuals and state are validated via
  headless screenshots; drag latency and "weight" need a real device pass.
- **Pet ↔ coal depth is approximate.** The nestling heuristic
  (`drawForegroundCoals`) is screen-distance + height based, not a full
  per-triangle sort, so a stray coal can very occasionally pop in front of or
  behind where you'd expect at the bed's edges. It's cheap and reads correctly
  almost everywhere.
- **Single coal only.** The friend embers are decorative bodies, not a full
  physics broad-phase.
- **Web font dependency.** Quicksand loads from Google Fonts at runtime (system
  fallback offline; cached by the SW after the first online visit).
- **Minimal persistence (by design).** Only mute, "hint seen," and last-visit
  time — nothing that reads as a stat or a chore.

---

## 16. How to verify changes

There's a lightweight visual-check workflow using Playwright (Chromium is
preinstalled in the dev container): load `index.html` headless, drive the
pointer to flick/drag the coal, and screenshot specific states (idle / flick /
drag-to-front / drag-to-back / sleep). This catches projection, lighting,
draw-order and occlusion bugs (it found the floor-over-coals depth bug and the
back-wall coal banking). What it **cannot** judge is *feel* — latency, inertia,
bounce satisfaction — so any physics tuning should finish with a hands-on pass
on desktop and mobile.
