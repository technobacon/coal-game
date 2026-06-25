# Ember — a tiny cozy coal pet 🔥

A single-screen digital pet: one little faceted coal nestled in a chunky,
**low-poly** stone fire-pit packed with glowing embers, seen from a cozy 3/4
isometric angle. No menus, no stats, no goals — just calm, satisfying play with
one very cute creature who's always happy you came to visit.

![Ember in his hearth](docs/screenshot.png)

## Play

Open `index.html` in any modern browser. That's it — no build step, no
dependencies.

```sh
# or serve it, if your browser is fussy about file:// URLs
python3 -m http.server
# then visit http://localhost:8000
```

It's also an **installable, offline little toy**: served over http(s) it
registers a tiny service worker and ships a web-app manifest, so you can add
it to your home screen and open it for ten cozy seconds with no network.

## What he does

- **Idle:** sits in the glowing coal bed with a gentle, breathing glow that
  **flickers like real coals**, his faceted little body softly warm. He blinks a
  happy eye‑smile now and then, and every so often does a small spontaneous
  wobble, just to feel alive. Tiny ember cubes drift up against the back wall.
- **Flick him:** click/touch‑drag and release to send him tumbling. He rolls
  with real momentum, leaves a short **hot trail**, bounces off the hearth
  walls and floor, and **laughs** the whole time (squeezed‑shut eyes, open
  grin, a pitched‑up giggle) with squash‑and‑stretch on every impact. Hard
  hits land with a tiny **hit‑stop freeze**, sparks, ash puffs and a phone
  buzz. When he finally comes to rest he settles with a satisfying little
  **"plop."**
- **Caroms:** smack him hard off the stone rim and he rewards you — a fat
  spark burst and a woody **"tok."** Bouncing off the walls is a goal in itself.
- **Chain reaction:** if he bumps one of the small embers nestled in the coals,
  it **wobbles awake**, flares up bright — and very occasionally gives a happy
  little hop — while the warmth ripples out to its neighbours. This is the most
  satisfying thing in the app.
- **He sleeps:** if you leave him be for a while, the embers dim and he curls
  up for a cozy nap (`z z z`), breathing slow and deep. He is *never* lost and
  never needs saving.
- **Wake him:** the moment you touch or flick him, the whole hearth flickers
  back to life in a ripple of sparks — and he lets you know he missed you. Come
  back after a while away and he greets you all over again.
- **Little notes** drift by in clean, low‑opacity text when you play with him
  ("your little coal is having so much fun!").

A small mute button in the corner toggles the soft ambient fire hum and crackle
(synthesised with the Web Audio API — no audio files); the bed swells gently
with his warmth and pops the odd crackle so it never feels static. Your mute
choice is remembered between visits.

The whole hearth is a **flat-shaded low-poly scene** — faceted stone bricks, a
ring of chunky rim stones and a packed bed of glowing coal chunks — lit by warm
light rising from the fire, and finished with a soft, filmic **bloom** so the
embers glow. Motion‑sensitive players are respected: with
`prefers-reduced-motion`, particles are thinned and the trail, idle wobble,
hit‑stop and haptics step aside for a calmer hearth.

## Design constraints (intentionally absent)

No hunger/health/happiness meters, no currency or shop, no neglect/death
mechanic, no nagging notifications, no menus. The sleep state is purely cozy
ambience, not a punishment — he's always fine.

## Tech

Plain HTML5 Canvas + a little CSS — no frameworks, no WebGL, no image assets,
no bundler. `game.js` contains a tiny **flat-shaded low-poly renderer**: the
bricks, rim stones, coal bed and the pet are all generated as faceted 3-D
meshes (jittered boxes and icosahedra), lit per-face by a soft key light plus
warm light rising from the coals, and painted back-to-front in a fixed 3/4
isometric projection. The static scene is baked to an offscreen canvas once;
only the pet, embers, particles and glow redraw each frame. The pet tumbles in
real 3-D and moves on the floor plane, with the physics, juice, bloom and sound
all procedural. The app icons are rendered from the same coal art. The only
external runtime asset is the free, open-source
**[Quicksand](https://fonts.google.com/specimen/Quicksand)** font (SIL Open
Font License) for the cozy floating messages; it falls back to a system sans
if offline.

A few bytes of `localStorage` remember only the friendly things — your mute
choice, whether you've seen the first‑run hint, and when you last visited (so
he can say he missed you). Nothing that reads as a stat or a chore.

| File | What it is |
|------|------------|
| `index.html` | The single page + message/mute overlay, manifest & icon links |
| `styles.css` | Layout, the floating message, the mute button |
| `game.js`   | Low-poly renderer, scene geometry, physics, the coal, particles, bloom, audio |
| `manifest.webmanifest` | Web‑app manifest (installable) |
| `sw.js` | Tiny offline cache (service worker) |
| `icon.svg`, `icon-192.png`, `icon-512.png` | App icons, drawn from the coal art |

## Documentation

[`docs/DESIGN.md`](docs/DESIGN.md) is the full design & technical reference:
the design pillars, the low-poly isometric renderer, the scene geometry and
lighting, the floor-plane physics, a **tuning quick-reference** for every feel
knob, and a prioritised set of **suggestions for where Ember goes next**.
