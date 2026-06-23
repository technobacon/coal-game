/* =====================================================================
   Ember — a tiny cozy coal pet living in a stone hearth.
   No menus, no stats, no goals. Just one little coal you can flick
   around. He laughs when he tumbles, lights up his friends, and
   curls up to sleep when the embers fade — until you wake him again.
   Single-file, dependency-free Canvas app.
   ===================================================================== */

(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const messageEl = document.getElementById("message");
  const muteBtn = document.getElementById("mute");

  // ---------------------------------------------------------------
  //  Small helpers
  // ---------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  // Deterministic little PRNG so the coal's shape & cracks stay stable.
  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------
  //  Canvas sizing (DPR-aware) + scene geometry
  // ---------------------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  const scene = {}; // computed hearth geometry in CSS pixels

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    computeScene();
  }

  function computeScene() {
    const cx = W / 2;
    // Arch radius: keep the whole hearth comfortably on screen.
    let R = Math.min(W * 0.46, H * 0.42);
    let floorY = H * 0.72;
    let wallH = R * 0.5;            // height of the straight side walls
    let springLine = floorY - wallH; // where the arch begins to curve
    let archTopY = springLine - R;

    // If the arch would run off the top, shrink everything to fit.
    const topMargin = H * 0.05;
    if (archTopY < topMargin) {
      const over = topMargin - archTopY;
      R -= over * 0.55;
      wallH = R * 0.5;
      springLine = floorY - wallH;
      archTopY = springLine - R;
    }

    scene.cx = cx;
    scene.R = R;
    scene.floorY = floorY;
    scene.springLine = springLine;
    scene.archTopY = archTopY;
    scene.innerLeft = cx - R;
    scene.innerRight = cx + R;
    scene.stoneT = R * 0.22;        // thickness of the stone ring
    scene.coalR = R * 0.33;         // resting radius of the pet

    // Place the little background embers nestled in the ash.
    layoutEmbers();
    // Keep the pet inside if the window changed dramatically.
    if (coal.x === 0 && coal.y === 0) {
      coal.x = cx;
      coal.y = floorY - scene.coalR + scene.coalR * 0.22;
    } else {
      coal.x = clamp(coal.x, scene.innerLeft + coal.r, scene.innerRight - coal.r);
      coal.y = clamp(coal.y, archTopY, floorY);
    }
    coal.r = scene.coalR;
    coal.restY = floorY - coal.r + coal.r * 0.22;
  }

  // ---------------------------------------------------------------
  //  Palette
  // ---------------------------------------------------------------
  const COL = {
    night: "#0c0807",
    stone: "#5b4c44",
    stoneLight: "#857064",
    stoneDark: "#2c2420",
    stoneEdge: "#140e0c",
    glowHot: "#ff8a2b",
    glowCore: "#ffd870",
    rockDark: "#2a1512",
    rockMid: "#43201a",
    crack: "#ff7a2b",
    crackHot: "#ffd06a",
    ashLight: "#8a7f78",
    ashDark: "#4f4641",
    face: "#ffdd7a",
  };

  // ---------------------------------------------------------------
  //  The coal pet
  // ---------------------------------------------------------------
  const coal = {
    x: 0, y: 0, r: 60,
    vx: 0, vy: 0,
    angle: 0, spin: 0,
    restY: 0,
    held: false,
    sqx: 1, sqy: 1,      // squash & stretch (springy)
    sqvx: 0, sqvy: 0,
    onFloor: false,
    grounded: true,      // truly at rest in the ash (gravity off, no impacts)
    settledTime: 0,
    shape: [],           // organic outline radii
    cracks: [],          // glowing crack polylines (unit coords)
  };

  function buildCoalArt() {
    const rng = mulberry32(20240617);
    const N = 16;
    coal.shape = [];
    for (let i = 0; i < N; i++) {
      coal.shape.push(0.9 + rng() * 0.16);
    }
    // A web of cracks, kept around the rim so the face stays clear.
    coal.cracks = [
      [[-0.15, -0.52], [0.02, -0.8]],
      [[0.22, -0.48], [0.45, -0.68]],
      [[-0.82, -0.05], [-0.55, 0.06]],
      [[0.84, 0.0], [0.58, 0.14]],
      [[-0.58, 0.34], [-0.28, 0.62], [0.04, 0.8]],
      [[0.52, 0.4], [0.26, 0.66]],
      [[-0.72, 0.18], [-0.5, 0.34]],
      [[0.62, 0.28], [0.4, 0.52]],
    ];
  }

  // ---------------------------------------------------------------
  //  Background embers (the pet's little friends)
  // ---------------------------------------------------------------
  const embers = [];
  function layoutEmbers() {
    const { cx, R, floorY } = scene;
    const spots = [
      { dx: -0.62, dy: 0.02, s: 0.40 },
      { dx: 0.66, dy: -0.02, s: 0.46 },
      { dx: -0.30, dy: 0.10, s: 0.30 },
      { dx: 0.34, dy: 0.11, s: 0.33 },
      { dx: 0.02, dy: 0.16, s: 0.26 },
    ];
    embers.length = 0;
    for (let i = 0; i < spots.length; i++) {
      const sp = spots[i];
      embers.push({
        x: cx + sp.dx * R,
        y: floorY + sp.dy * R,
        r: scene.coalR * sp.s,
        flare: 0,
        phase: Math.random() * TAU,
      });
    }
  }

  // ---------------------------------------------------------------
  //  Particles: sparks (bright, additive) + ash puffs (soft, grey)
  // ---------------------------------------------------------------
  const sparks = [];
  const ash = [];
  const ambient = []; // lazily drifting background sparks

  function spawnSparks(x, y, n, power, hue) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.3, 1) * power;
      sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - power * 0.3,
        life: rand(0.4, 0.9),
        max: 0.9,
        r: rand(1.2, 3),
        hue: hue == null ? rand(24, 44) : hue,
      });
    }
    if (sparks.length > 400) sparks.splice(0, sparks.length - 400);
  }

  function spawnAsh(x, y, n, power) {
    for (let i = 0; i < n; i++) {
      const a = rand(-Math.PI, 0); // puff upward-ish
      const sp = rand(0.2, 0.8) * power;
      ash.push({
        x, y,
        vx: Math.cos(a) * sp + rand(-power * 0.2, power * 0.2),
        vy: Math.sin(a) * sp,
        life: rand(0.6, 1.3),
        max: 1.3,
        r: rand(4, 11),
      });
    }
    if (ash.length > 200) ash.splice(0, ash.length - 200);
  }

  function spawnAmbient() {
    const { innerLeft, innerRight, floorY, archTopY } = scene;
    ambient.push({
      x: rand(innerLeft + 30, innerRight - 30),
      y: rand(floorY - 20, floorY + 10),
      vx: rand(-8, 8),
      vy: rand(-26, -52),
      life: rand(1.6, 3.4),
      max: 3.4,
      r: rand(0.8, 2),
      top: archTopY,
    });
    if (ambient.length > 40) ambient.shift();
  }

  // ---------------------------------------------------------------
  //  Hearth "life" state — warmth, sleep, and reignition.
  //  (Sleep is purely cozy: he is never lost and never needs saving.)
  // ---------------------------------------------------------------
  const life = {
    energy: 1,        // 0..1 overall warmth of the hearth
    asleep: false,
    sleepiness: 0,    // 0 awake .. 1 fast asleep
    timeSinceInput: 0,
    igniteFlash: 0,   // brief warm burst when waking
  };
  const SLEEP_DELAY = 16;   // seconds of calm before he gets drowsy
  const SLEEP_FADE = 6;     // seconds to drift fully to sleep

  // ---------------------------------------------------------------
  //  Cute messages (clean, low-opacity, occasional)
  // ---------------------------------------------------------------
  const MSG = {
    play: [
      "your little coal is having so much fun!",
      "wheee!",
      "again! again!",
      "he loves playing with you",
      "so toasty",
      "tee-hee",
      "your coal glows a little brighter",
    ],
    chain: [
      "he lit up his little friends!",
      "the whole hearth is glowing",
      "warmth spreads everywhere",
    ],
    wake: [
      "your little coal missed you",
      "you're back! he's so happy",
      "the hearth flickers back to life",
    ],
    idle: [
      "he's cozy and warm",
      "your coal is happy you're here",
    ],
  };
  let msgCooldown = 0;
  let msgHideTimer = null;
  function showMessage(text, force) {
    if (!force && msgCooldown > 0) return;
    messageEl.textContent = text;
    messageEl.classList.add("show");
    msgCooldown = 5.5;
    // Hide via setTimeout so it never depends on the animation loop
    // (which the browser throttles when the tab isn't in focus).
    clearTimeout(msgHideTimer);
    msgHideTimer = setTimeout(() => messageEl.classList.remove("show"), 2600);
  }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // ---------------------------------------------------------------
  //  Audio — tiny WebAudio synth (soft hum + crackles). All optional,
  //  fails silently, and is gated behind the mute button.
  // ---------------------------------------------------------------
  const audio = {
    ctx: null, hum: null, humGain: null, master: null,
    muted: false, started: false,
  };
  function initAudio() {
    if (audio.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      audio.ctx = ac;
      audio.master = ac.createGain();
      audio.master.gain.value = audio.muted ? 0 : 0.6;
      audio.master.connect(ac.destination);

      // Low cozy fire hum: detuned sines through a lowpass, gently wobbling.
      const humGain = ac.createGain();
      humGain.gain.value = 0.035;
      const lp = ac.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 320;
      const o1 = ac.createOscillator(); o1.type = "sine"; o1.frequency.value = 64;
      const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = 81;
      const lfo = ac.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.18;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.018;
      lfo.connect(lfoG); lfoG.connect(humGain.gain);
      o1.connect(lp); o2.connect(lp); lp.connect(humGain); humGain.connect(audio.master);
      o1.start(); o2.start(); lfo.start();
      audio.humGain = humGain;

      audio.started = true;
    } catch (e) { /* no audio, no problem */ }
  }
  function blip(power, hot) {
    if (!audio.started || audio.muted || !audio.ctx) return;
    try {
      const ac = audio.ctx;
      const t = ac.currentTime;
      // short filtered noise = a little crackle/pop
      const len = 0.09;
      const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      }
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = hot ? rand(900, 1600) : rand(400, 800);
      bp.Q.value = 0.8;
      const g = ac.createGain();
      const vol = clamp(power, 0.05, 1) * 0.35;
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + len);
      src.connect(bp); bp.connect(g); g.connect(audio.master);
      src.start(t); src.stop(t + len);
    } catch (e) {}
  }
  function chime() {
    if (!audio.started || audio.muted || !audio.ctx) return;
    try {
      const ac = audio.ctx, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(420, t);
      o.frequency.exponentialRampToValueAtTime(760, t + 0.25);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g); g.connect(audio.master);
      o.start(t); o.stop(t + 0.62);
    } catch (e) {}
  }
  function setMuted(m) {
    audio.muted = m;
    muteBtn.classList.toggle("muted", m);
    if (audio.master) {
      try {
        audio.master.gain.linearRampToValueAtTime(
          m ? 0 : 0.6, audio.ctx.currentTime + 0.15);
      } catch (e) {}
    }
  }
  muteBtn.addEventListener("click", () => {
    initAudio();
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
    setMuted(!audio.muted);
  });

  // ---------------------------------------------------------------
  //  Input — drag & flick (pointer events cover mouse + touch)
  // ---------------------------------------------------------------
  const pointer = { down: false, x: 0, y: 0, samples: [], grabX: 0, grabY: 0, moved: 0 };

  function localPoint(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onDown(e) {
    initAudio();
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
    const p = localPoint(e);
    pointer.down = true;
    pointer.moved = 0;
    pointer.x = p.x; pointer.y = p.y;
    pointer.samples = [{ x: p.x, y: p.y, t: performance.now() }];

    registerInput();

    const d = Math.hypot(p.x - coal.x, p.y - coal.y);
    if (d <= coal.r * 1.5) {
      coal.held = true;
      coal.grounded = false;
      coal.vx = coal.vy = 0;
      pointer.grabX = coal.x - p.x;
      pointer.grabY = coal.y - p.y;
      canvas.classList.add("grabbing");
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function onMove(e) {
    if (!pointer.down) return;
    const p = localPoint(e);
    pointer.moved += Math.hypot(p.x - pointer.x, p.y - pointer.y);
    pointer.x = p.x; pointer.y = p.y;
    const now = performance.now();
    pointer.samples.push({ x: p.x, y: p.y, t: now });
    // keep only the last ~120ms of motion for a snappy flick estimate
    while (pointer.samples.length > 2 && now - pointer.samples[0].t > 120) {
      pointer.samples.shift();
    }
    if (coal.held) {
      coal.x = p.x + pointer.grabX;
      coal.y = p.y + pointer.grabY;
    }
  }

  function onUp(e) {
    if (!pointer.down) return;
    pointer.down = false;
    canvas.classList.remove("grabbing");

    if (coal.held) {
      coal.held = false;
      coal.grounded = false;
      // Estimate flick velocity from recent pointer samples.
      const s = pointer.samples;
      let vx = 0, vy = 0;
      if (s.length >= 2) {
        const a = s[0], b = s[s.length - 1];
        const dt = Math.max((b.t - a.t) / 1000, 0.016);
        vx = (b.x - a.x) / dt;
        vy = (b.y - a.y) / dt;
      }
      const GAIN = 0.9;
      const MAXV = 2600;
      coal.vx = clamp(vx * GAIN, -MAXV, MAXV);
      coal.vy = clamp(vy * GAIN, -MAXV, MAXV);
      const speed = Math.hypot(coal.vx, coal.vy);
      coal.spin = clamp(vx / coal.r, -14, 14) + rand(-2, 2);

      if (pointer.moved < 8 && speed < 120) {
        // A gentle poke rather than a flick — little happy wobble.
        coal.spin += rand(-6, 6);
        coal.vy -= rand(120, 260);
        coal.vx += rand(-180, 180);
        spawnSparks(coal.x, coal.y - coal.r * 0.4, 6, 180, 38);
        bumpEnergy(0.25);
        if (Math.random() < 0.5) showMessage(pick(MSG.play));
      } else if (speed > 260) {
        spawnSparks(coal.x, coal.y, 10, speed * 0.18);
        bumpEnergy(0.5);
        if (Math.random() < 0.6) showMessage(pick(MSG.play));
      }
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch (err) {}
  }

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);

  function registerInput() {
    life.timeSinceInput = 0;
    if (life.asleep || life.sleepiness > 0.05) reignite();
  }
  function bumpEnergy(amt) {
    life.energy = clamp(life.energy + amt, 0, 1);
  }

  function reignite() {
    const wasAsleep = life.asleep;
    life.asleep = false;
    life.sleepiness = 0;
    life.energy = 1;
    life.igniteFlash = 1;
    // The whole hearth flickers back to life: friends flare in a ripple.
    for (let i = 0; i < embers.length; i++) {
      const em = embers[i];
      setTimeout(() => {
        em.flare = 1;
        spawnSparks(em.x, em.y - em.r * 0.5, 8, 220, 40);
      }, i * 70);
    }
    spawnSparks(coal.x, coal.y - coal.r * 0.5, 22, 320, 42);
    spawnAsh(coal.x, coal.y, 8, 120);
    if (wasAsleep) {
      showMessage(pick(MSG.wake), true);
      chime();
    }
  }

  // ---------------------------------------------------------------
  //  Physics step
  // ---------------------------------------------------------------
  const GRAV = 2600;
  function physics(dt) {
    const { innerLeft, innerRight, springLine, cx, R } = scene;
    const r = coal.r;

    if (coal.held) {
      coal.grounded = false;
      coal.onFloor = false;
      coal.angle += coal.spin * dt;
      coal.spin *= Math.pow(0.02, dt);
      return;
    }

    // Settled in the ash: rest quietly. No gravity means a slow/laggy
    // frame can't fake a floor impact (and so can't spuriously wake him).
    if (coal.grounded) {
      coal.onFloor = true;
      coal.y = coal.restY;
      coal.vy = 0;
      coal.x = clamp(coal.x + coal.vx * dt, innerLeft + r, innerRight - r);
      coal.vx *= Math.pow(0.015, dt);
      coal.spin *= Math.pow(0.05, dt);
      coal.angle = lerp(coal.angle, 0, clamp(dt * 5, 0, 1));
      coal.settledTime += dt;
      return;
    }

    coal.vy += GRAV * dt;
    coal.x += coal.vx * dt;
    coal.y += coal.vy * dt;
    coal.angle += coal.spin * dt;

    const REST = 0.62;   // bounce restitution
    let impactSpeed = 0, ix = 0, iy = 0, hot = false;

    // Floor (top of the ash bed)
    if (coal.y >= coal.restY) {
      const vAt = coal.vy;
      coal.y = coal.restY;
      coal.vy = vAt > 0 ? -vAt * REST : 0;
      if (Math.abs(coal.vy) < 70) coal.vy = 0;
      coal.vx *= 0.82;                 // rolling friction
      coal.spin = lerp(coal.spin, -coal.vx / r, 0.5) * 0.9;
      coal.onFloor = true;
      if (vAt > 90) {
        impactSpeed = vAt; ix = coal.x; iy = coal.restY + r * 0.6;
        kickSquash(0, 1, Math.min(vAt / 1400, 1));
      }
      // Quiet down into a true rest once the landing is gentle enough.
      if (vAt < 260 && Math.abs(coal.vx) < 70 && Math.abs(coal.spin) < 3) {
        coal.grounded = true;
        coal.vy = 0;
      }
    } else {
      coal.onFloor = false;
    }

    // Side walls (straight portion, below the spring line)
    if (coal.y >= springLine) {
      if (coal.x < innerLeft + r) {
        coal.x = innerLeft + r;
        if (coal.vx < -40) { impactSpeed = -coal.vx; ix = innerLeft + r * 0.4; iy = coal.y; }
        coal.vx = -coal.vx * REST;
        coal.spin += coal.vy / r * 0.2;
        kickSquash(1, 0, Math.min(Math.abs(coal.vx) / 1400, 1));
      } else if (coal.x > innerRight - r) {
        coal.x = innerRight - r;
        if (coal.vx > 40) { impactSpeed = coal.vx; ix = innerRight - r * 0.4; iy = coal.y; }
        coal.vx = -coal.vx * REST;
        coal.spin -= coal.vy / r * 0.2;
        kickSquash(1, 0, Math.min(Math.abs(coal.vx) / 1400, 1));
      }
    } else {
      // Arch region: stay within the curved ceiling (circle at springLine).
      const dx = coal.x - cx, dy = coal.y - springLine;
      const dist = Math.hypot(dx, dy);
      const limit = R - r;
      if (dist > limit) {
        const nx = dx / dist, ny = dy / dist;
        coal.x = cx + nx * limit;
        coal.y = springLine + ny * limit;
        const vn = coal.vx * nx + coal.vy * ny;
        if (vn > 40) { impactSpeed = vn; ix = coal.x; iy = coal.y; hot = true; }
        coal.vx -= (1 + REST) * vn * nx;
        coal.vy -= (1 + REST) * vn * ny;
        coal.spin += rand(-3, 3);
        kickSquash(nx, ny, Math.min(vn / 1400, 1));
      }
    }

    // Resolve an impact (any surface)
    if (impactSpeed > 60) {
      onImpact(ix, iy, impactSpeed, hot);
    }

    // Collisions with the little background embers → chain reaction.
    for (let i = 0; i < embers.length; i++) {
      const em = embers[i];
      const dx = coal.x - em.x, dy = coal.y - em.y;
      const d = Math.hypot(dx, dy);
      const min = r + em.r;
      const moving = Math.hypot(coal.vx, coal.vy) > 130;
      if (d < min && moving && em.flare < 0.6) {
        flareEmber(i, 1);
        // nudge the coal slightly so it reads as a real bump
        const nx = dx / (d || 1), ny = dy / (d || 1);
        coal.vx += nx * 90; coal.vy += ny * 90 - 60;
        coal.grounded = false;
        if (Math.random() < 0.35) showMessage(pick(MSG.chain));
      }
    }

    // Friction & gentle settling
    coal.vx *= Math.pow(0.4, dt);
    coal.spin *= Math.pow(0.5, dt);

    const speed = Math.hypot(coal.vx, coal.vy);
    if (coal.onFloor && speed < 24) {
      coal.vx = lerp(coal.vx, 0, 0.2);
      coal.settledTime += dt;
      // Ease the face back upright once he's calmly resting.
      coal.angle = lerp(coal.angle, 0, clamp(dt * 4, 0, 1));
    } else {
      coal.settledTime = 0;
    }
  }

  function onImpact(x, y, speed, hot) {
    const p = clamp(speed / 1200, 0.1, 1.4);
    spawnSparks(x, y, Math.round(6 + p * 14), speed * 0.16, hot ? rand(36, 48) : undefined);
    spawnAsh(x, y, Math.round(3 + p * 6), speed * 0.05 + 40);
    bumpEnergy(0.18 + p * 0.2);
    blip(p, hot);
    registerInput();
    // flare any ember very close to the impact point
    for (let i = 0; i < embers.length; i++) {
      const em = embers[i];
      if (Math.hypot(x - em.x, y - em.y) < em.r + coal.r * 0.5) flareEmber(i, 0.7);
    }
    if (speed > 800 && Math.random() < 0.4) showMessage(pick(MSG.play));
  }

  function flareEmber(i, amount) {
    const em = embers[i];
    em.flare = Math.max(em.flare, amount);
    spawnSparks(em.x, em.y - em.r * 0.4, 6, 200, 40);
    blip(0.4, true);
    // ripple: gently nudge neighbours a moment later
    for (let j = 0; j < embers.length; j++) {
      if (j === i) continue;
      const other = embers[j];
      if (Math.hypot(other.x - em.x, other.y - em.y) < em.r * 4) {
        const delay = 90 + Math.random() * 120;
        setTimeout(() => { other.flare = Math.max(other.flare, amount * 0.55); }, delay);
      }
    }
  }

  // Squash & stretch as a springy kick along an impact normal.
  function kickSquash(nx, ny, strength) {
    if (strength <= 0) return;
    const k = 0.5 * strength;
    // compress along the normal, stretch across it
    coal.sqvx += (Math.abs(nx) > Math.abs(ny) ? -k : k) * 12;
    coal.sqvy += (Math.abs(ny) >= Math.abs(nx) ? -k : k) * 12;
  }
  function updateSquash(dt) {
    // damped springs returning sqx/sqy toward 1
    const stiff = 220, damp = 14;
    coal.sqvx += (-stiff * (coal.sqx - 1) - damp * coal.sqvx) * dt;
    coal.sqvy += (-stiff * (coal.sqy - 1) - damp * coal.sqvy) * dt;
    coal.sqx += coal.sqvx * dt;
    coal.sqy += coal.sqvy * dt;
    coal.sqx = clamp(coal.sqx, 0.6, 1.4);
    coal.sqy = clamp(coal.sqy, 0.6, 1.4);
  }

  // ---------------------------------------------------------------
  //  Update loop driver
  // ---------------------------------------------------------------
  let last = performance.now();
  let ambientTimer = 0;

  function update(dt) {
    // Drowsiness / sleep (cozy, no penalty)
    if (!coal.held) life.timeSinceInput += dt;
    const speed = Math.hypot(coal.vx, coal.vy);
    if (!life.asleep && life.timeSinceInput > SLEEP_DELAY && speed < 30 && !coal.held) {
      life.sleepiness = clamp(life.sleepiness + dt / SLEEP_FADE, 0, 1);
      if (life.sleepiness >= 1) life.asleep = true;
    } else if (coal.held || life.timeSinceInput < SLEEP_DELAY) {
      life.sleepiness = clamp(life.sleepiness - dt * 2, 0, 1);
    }
    // Energy slowly relaxes toward a warm idle baseline (never to zero).
    const baseline = life.asleep ? 0.14 : lerp(0.72, 0.4, life.sleepiness);
    life.energy = lerp(life.energy, baseline, clamp(dt * 0.4, 0, 1));
    life.igniteFlash = Math.max(0, life.igniteFlash - dt * 1.6);

    physics(dt);
    updateSquash(dt);

    // Spontaneous "alive" wobble when calmly resting & awake.
    if (coal.onFloor && !coal.held && speed < 20 && !life.asleep) {
      if (Math.random() < dt * 0.16) {
        coal.spin += rand(-4, 4);
        coal.vx += rand(-60, 60);
        coal.vy -= rand(20, 80);
        coal.grounded = false;
      }
    }

    // Background embers settle their flare
    for (const em of embers) {
      em.flare = Math.max(0, em.flare - dt * 1.4);
      em.phase += dt * 1.5;
    }

    // Particles
    stepParticles(sparks, dt, true);
    stepParticles(ash, dt, false);
    stepAmbient(dt);

    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      spawnAmbient();
      ambientTimer = rand(0.25, 0.7);
    }

    // Message frequency gate (hiding is handled by a timer in showMessage)
    if (msgCooldown > 0) msgCooldown -= dt;
  }

  function stepParticles(arr, dt, isSpark) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      if (isSpark) {
        p.vy += 900 * dt;          // sparks fall
        p.vx *= Math.pow(0.5, dt);
      } else {
        p.vy -= 120 * dt;          // ash rises & spreads
        p.vx *= Math.pow(0.2, dt);
        p.r += 8 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  function stepAmbient(dt) {
    for (let i = ambient.length - 1; i >= 0; i--) {
      const p = ambient[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx += Math.sin(p.life * 3) * 6 * dt;
      if (p.life <= 0 || p.y < p.top) ambient.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------
  //  RENDERING
  // ---------------------------------------------------------------
  let time = 0;

  function timeOfDayWarmth() {
    // Subtle, purely ambient: a touch cooler & dimmer in the small hours.
    const h = new Date().getHours();
    const night = (h >= 23 || h < 6) ? 1 : (h >= 21 || h < 8) ? 0.5 : 0;
    return 1 - night * 0.18;
  }

  function draw() {
    const { cx, R, floorY, springLine, innerLeft, innerRight, stoneT } = scene;
    const pulse = 0.5 + 0.5 * Math.sin(time * (TAU / 4.2)); // breathing
    const tod = timeOfDayWarmth();
    const warm = (0.5 + life.energy * 0.5) * tod + life.igniteFlash * 0.4;

    // Backdrop
    ctx.fillStyle = COL.night;
    ctx.fillRect(0, 0, W, H);

    // --- Inner cavity (clipped) -------------------------------------
    ctx.save();
    ctx.beginPath();
    innerArchPath();
    ctx.clip();

    // Dark cavity with a warm glow pooled low, around the coal & ash.
    ctx.fillStyle = COL.night;
    ctx.fillRect(innerLeft - 10, scene.archTopY - 10, R * 2 + 20, floorY - scene.archTopY + 40);
    const gx = cx, gy = floorY - R * 0.05;
    const grad = ctx.createRadialGradient(gx, gy, R * 0.04, gx, gy, R * 1.25);
    grad.addColorStop(0, `rgba(116,46,18,${0.62 * warm})`);
    grad.addColorStop(0.35, `rgba(54,22,12,${0.55 * warm})`);
    grad.addColorStop(0.7, "rgba(22,12,9,0.6)");
    grad.addColorStop(1, "rgba(10,6,5,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(innerLeft - 10, scene.archTopY - 10, R * 2 + 20, floorY - scene.archTopY + 40);

    // Subtle domed brickwork on the back wall (concentric + radial seams)
    ctx.strokeStyle = "rgba(78,42,27,0.16)";
    ctx.lineWidth = Math.max(1.3, R * 0.008);
    const rings = [0.5, 0.68, 0.86, 1.04];
    for (const rf of rings) {
      ctx.beginPath();
      ctx.arc(cx, springLine, R * rf, Math.PI, TAU, false);
      ctx.stroke();
    }
    for (let i = 1; i < 12; i++) {
      const ang = Math.PI + (i / 12) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * R * 0.5, springLine + Math.sin(ang) * R * 0.5);
      ctx.lineTo(cx + Math.cos(ang) * R * 1.04, springLine + Math.sin(ang) * R * 1.04);
      ctx.stroke();
    }

    drawSmoke();
    drawAshBed();
    drawEmbers(pulse, warm);
    drawAmbient();
    ctx.restore();

    // Coal sits in front of the cavity contents but behind the front lip
    drawCoal(pulse, warm);
    drawParticles();

    // --- Stone frame (drawn on top to crisply border the cavity) ----
    drawStoneArch(warm);
    drawBaseLip();

    // Soft vignette to focus the eye
    const vg = ctx.createRadialGradient(cx, H * 0.5, R * 0.6, cx, H * 0.5, Math.max(W, H) * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.4)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // NOTE: these add a subpath to the *current* path — the caller owns
  // beginPath(). This lets both arches share one path for even-odd fills.
  function innerArchPath() {
    const { cx, R, floorY, springLine, innerLeft, innerRight } = scene;
    ctx.moveTo(innerLeft, floorY);
    ctx.lineTo(innerLeft, springLine);
    ctx.arc(cx, springLine, R, Math.PI, TAU, false);
    ctx.lineTo(innerRight, floorY);
    ctx.closePath();
  }
  function outerArchPath() {
    const { cx, R, floorY, springLine, innerLeft, innerRight, stoneT } = scene;
    const Ro = R + stoneT;
    ctx.moveTo(innerLeft - stoneT, floorY + stoneT);
    ctx.lineTo(innerLeft - stoneT, springLine);
    ctx.arc(cx, springLine, Ro, Math.PI, TAU, false);
    ctx.lineTo(innerRight + stoneT, floorY + stoneT);
    ctx.closePath();
  }

  function drawStoneArch(warm) {
    const { cx, R, floorY, springLine, innerLeft, innerRight, stoneT } = scene;

    // Fill the ring with a form-giving gradient.
    ctx.save();
    ctx.beginPath();
    outerArchPath();
    innerArchPath();
    ctx.clip("evenodd");
    const sg = ctx.createLinearGradient(0, scene.archTopY, 0, floorY + stoneT);
    sg.addColorStop(0, COL.stoneLight);
    sg.addColorStop(0.5, COL.stone);
    sg.addColorStop(1, COL.stoneDark);
    ctx.fillStyle = sg;
    ctx.fillRect(innerLeft - stoneT * 2, scene.archTopY - stoneT, R * 2 + stoneT * 4, floorY - scene.archTopY + stoneT * 3);

    // Warm inner-edge bounce light
    const ig = ctx.createRadialGradient(cx, floorY, R * 0.4, cx, floorY, R * 1.4);
    ig.addColorStop(0, `rgba(255,140,60,${0.16 * warm})`);
    ig.addColorStop(1, "rgba(255,140,60,0)");
    ctx.fillStyle = ig;
    ctx.fillRect(innerLeft - stoneT * 2, scene.archTopY - stoneT, R * 2 + stoneT * 4, floorY - scene.archTopY + stoneT * 3);

    // Stone seams around the arch
    ctx.strokeStyle = COL.stoneEdge;
    ctx.lineWidth = Math.max(2, stoneT * 0.10);
    ctx.lineCap = "round";
    const segs = 11;
    for (let i = 0; i <= segs; i++) {
      const ang = Math.PI + (i / segs) * Math.PI; // π..2π over the top
      const mx = cx + Math.cos(ang), my = Math.sin(ang);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * R, springLine + Math.sin(ang) * R);
      ctx.lineTo(cx + Math.cos(ang) * (R + stoneT), springLine + Math.sin(ang) * (R + stoneT));
      ctx.stroke();
    }
    // Seams down the straight walls
    const wallSegs = 3;
    for (let i = 1; i <= wallSegs; i++) {
      const y = lerp(springLine, floorY, i / (wallSegs + 1));
      ctx.beginPath(); ctx.moveTo(innerLeft, y); ctx.lineTo(innerLeft - stoneT, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(innerRight, y); ctx.lineTo(innerRight + stoneT, y); ctx.stroke();
    }

    // Soft top bevel highlight along the inner edge
    ctx.strokeStyle = "rgba(255,230,200,0.10)";
    ctx.lineWidth = Math.max(2, stoneT * 0.16);
    ctx.beginPath();
    ctx.arc(cx, springLine, R + stoneT * 0.18, Math.PI, TAU, false);
    ctx.stroke();
    ctx.restore();

    // Thick clean outlines (the "cel" look)
    ctx.lineJoin = "round";
    ctx.strokeStyle = COL.stoneEdge;
    ctx.lineWidth = Math.max(2.5, stoneT * 0.14);
    ctx.beginPath(); outerArchPath(); ctx.stroke();
    ctx.lineWidth = Math.max(2, stoneT * 0.11);
    ctx.beginPath(); innerArchPath(); ctx.stroke();
  }

  function drawBaseLip() {
    const { cx, R, floorY, innerLeft, innerRight, stoneT } = scene;
    const top = floorY + R * 0.12;
    const bottom = Math.min(H, floorY + R * 0.5);
    const left = innerLeft - stoneT;
    const right = innerRight + stoneT;
    const n = 7;
    const w = (right - left) / n;
    const sg = ctx.createLinearGradient(0, top, 0, bottom);
    sg.addColorStop(0, COL.stoneLight);
    sg.addColorStop(1, COL.stoneDark);
    for (let i = 0; i < n; i++) {
      const x = left + i * w + 2;
      roundRect(x, top, w - 4, bottom - top + 30, Math.min(14, w * 0.18));
      ctx.fillStyle = sg;
      ctx.fill();
      ctx.lineWidth = Math.max(2.5, stoneT * 0.12);
      ctx.strokeStyle = COL.stoneEdge;
      ctx.stroke();
      // top highlight
      ctx.beginPath();
      ctx.moveTo(x + 5, top + 4);
      ctx.lineTo(x + w - 9, top + 4);
      ctx.strokeStyle = "rgba(255,230,200,0.10)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function drawAshBed() {
    const { cx, R, floorY, innerLeft, innerRight } = scene;
    const left = innerLeft + 4, right = innerRight - 4;
    const top = floorY - R * 0.06;
    // base mound
    ctx.beginPath();
    ctx.moveTo(left, floorY + R * 0.5);
    ctx.lineTo(left, top + R * 0.04);
    let rng = mulberry32(99);
    const lumps = 16;
    for (let i = 0; i <= lumps; i++) {
      const t = i / lumps;
      const x = lerp(left, right, t);
      const y = top + Math.sin(t * Math.PI) * -R * 0.05 + (rng() - 0.5) * R * 0.05;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(right, floorY + R * 0.5);
    ctx.closePath();
    const ag = ctx.createLinearGradient(0, top - R * 0.1, 0, floorY + R * 0.3);
    ag.addColorStop(0, COL.ashLight);
    ag.addColorStop(0.5, "#6a605a");
    ag.addColorStop(1, COL.ashDark);
    ctx.fillStyle = ag;
    ctx.fill();

    // scattered glowing bits in the ash
    rng = mulberry32(7);
    ctx.save();
    for (let i = 0; i < 18; i++) {
      const x = lerp(left + 20, right - 20, rng());
      const y = lerp(top + 6, floorY + R * 0.16, rng());
      const r = rng() * 2.5 + 1;
      const g = 0.25 + rng() * 0.5;
      glowDot(x, y, r, `rgba(255,${120 + (g * 80) | 0},40,${g * (0.4 + life.energy * 0.6)})`, r * 4);
    }
    ctx.restore();
  }

  function drawEmbers(pulse, warm) {
    for (const em of embers) {
      const base = 0.45 + 0.2 * Math.sin(em.phase) + life.energy * 0.25;
      const lvl = clamp(base + em.flare * 0.9, 0, 1.6) * warm;
      const r = em.r;
      // outer glow
      glowDot(em.x, em.y, r * 0.9, `rgba(255,130,46,${0.5 * lvl})`, r * 3.2 + em.flare * r * 2);
      // body
      ctx.beginPath();
      ctx.arc(em.x, em.y, r, 0, TAU);
      const eg = ctx.createRadialGradient(em.x, em.y - r * 0.2, r * 0.2, em.x, em.y, r);
      eg.addColorStop(0, `rgba(${255},${150 + em.flare * 80},${60},1)`);
      eg.addColorStop(0.6, COL.rockMid);
      eg.addColorStop(1, COL.rockDark);
      ctx.fillStyle = eg;
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.strokeStyle = "rgba(20,10,8,0.8)";
      ctx.stroke();
      // a couple of glowing cracks
      ctx.save();
      ctx.translate(em.x, em.y);
      ctx.strokeStyle = `rgba(255,${160 + em.flare * 80},70,${(0.5 + em.flare * 0.5) * warm})`;
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.shadowColor = COL.glowHot;
      ctx.shadowBlur = (6 + em.flare * 16);
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.1); ctx.lineTo(0, r * 0.1); ctx.lineTo(r * 0.4, -r * 0.2);
      ctx.moveTo(0, r * 0.1); ctx.lineTo(-r * 0.1, r * 0.55);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAmbient() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of ambient) {
      const a = (p.life / p.max);
      const fl = 0.6 + 0.4 * Math.sin(p.life * 18);
      glowDot(p.x, p.y, p.r, `rgba(255,${170 + ((1 - a) * 60) | 0},80,${a * 0.8 * fl})`, p.r * 6);
    }
    ctx.restore();
  }

  function drawSmoke() {
    const { cx, R, springLine, floorY } = scene;
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const wisps = [
      { x: cx - R * 0.5, h: R * 1.1, w: R * 0.16, sp: 0.5, ph: 0 },
      { x: cx + R * 0.55, h: R * 1.0, w: R * 0.14, sp: 0.42, ph: 2.2 },
    ];
    for (const wsp of wisps) {
      const baseY = floorY - R * 0.1;
      ctx.beginPath();
      const steps = 10;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const y = baseY - t * wsp.h;
        const sway = Math.sin(time * wsp.sp + wsp.ph + t * 3) * wsp.w * (0.3 + t);
        const x = wsp.x + sway;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(180,160,150,0.06)`;
      ctx.lineWidth = wsp.w;
      ctx.lineCap = "round";
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- The pet itself --------------------------------------------
  function drawCoal(pulse, warm) {
    const r = coal.r;
    const speed = Math.hypot(coal.vx, coal.vy);
    const moving = (speed > 220 || (coal.held && pointer.moved > 12)) && !life.asleep;

    ctx.save();
    ctx.translate(coal.x, coal.y);
    // world-frame squash, then body rotation
    ctx.scale(coal.sqx, coal.sqy);

    // ground contact shadow (drawn before rotation, in world frame)
    if (coal.onFloor) {
      ctx.save();
      ctx.scale(1 / coal.sqx, 1 / coal.sqy);
      ctx.beginPath();
      ctx.ellipse(0, r * 0.95, r * 0.85, r * 0.22, 0, 0, TAU);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fill();
      ctx.restore();
    }

    ctx.rotate(coal.angle);

    const heat = clamp(life.energy * warm + pulse * 0.12 + life.igniteFlash * 0.5, 0, 1.4);

    // soft body glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gl = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.0);
    gl.addColorStop(0, `rgba(255,140,55,${0.55 * heat})`);
    gl.addColorStop(0.5, `rgba(255,110,40,${0.18 * heat})`);
    gl.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.0, 0, TAU); ctx.fill();
    ctx.restore();

    // rock body (organic blob)
    ctx.beginPath();
    blobPath(r);
    const bg = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.2, 0, 0, r * 1.1);
    bg.addColorStop(0, "#7a3622");
    bg.addColorStop(0.55, "#491f19");
    bg.addColorStop(1, "#27110e");
    ctx.fillStyle = bg;
    ctx.fill();

    // molten inner light bleeding through the rock
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const mg = ctx.createRadialGradient(0, r * 0.05, r * 0.08, 0, 0, r * 0.95);
    mg.addColorStop(0, `rgba(255,95,30,${0.28 * heat})`);
    mg.addColorStop(1, "rgba(255,95,30,0)");
    ctx.fillStyle = mg;
    ctx.beginPath(); blobPath(r); ctx.fill();
    ctx.restore();

    // thick clean outline
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2.5, r * 0.06);
    ctx.strokeStyle = "#170a08";
    ctx.stroke();

    // glowing cracks
    ctx.save();
    ctx.clip(); // keep glow inside the rock
    const crackA = clamp(0.4 + heat * 0.4, 0, 0.9) * (life.asleep ? 0.5 : 1);
    ctx.strokeStyle = `rgba(255,${(115 + heat * 70) | 0},${(45 + heat * 30) | 0},${crackA})`;
    ctx.lineWidth = Math.max(1.5, r * 0.04);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = COL.glowHot;
    ctx.shadowBlur = 6 + heat * 10 + pulse * 3;
    for (const cr of coal.cracks) {
      ctx.beginPath();
      for (let i = 0; i < cr.length; i++) {
        const px = cr[i][0] * r, py = cr[i][1] * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    // face
    drawFace(r, moving, heat, pulse);

    ctx.restore();

    // sleepy "z z Z" floats up beside him
    if (life.asleep || life.sleepiness > 0.4) {
      drawZ(coal.x + r * 0.7, coal.y - r * 0.9, life.sleepiness);
    }
  }

  function blobPath(r) {
    const pts = coal.shape;
    const n = pts.length;
    // Catmull-Rom-ish smooth closed curve through the radii.
    const P = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU;
      P.push([Math.cos(ang) * r * pts[i], Math.sin(ang) * r * pts[i]]);
    }
    ctx.moveTo((P[0][0] + P[n - 1][0]) / 2, (P[0][1] + P[n - 1][1]) / 2);
    for (let i = 0; i < n; i++) {
      const cur = P[i];
      const next = P[(i + 1) % n];
      const mx = (cur[0] + next[0]) / 2;
      const my = (cur[1] + next[1]) / 2;
      ctx.quadraticCurveTo(cur[0], cur[1], mx, my);
    }
    ctx.closePath();
  }

  // Append a smile-shaped arc "◡" (concave up) to the current path.
  function arcInto(cx, cy, rr, s, e) {
    ctx.moveTo(cx + Math.cos(Math.PI * s) * rr, cy + Math.sin(Math.PI * s) * rr);
    ctx.arc(cx, cy, rr, Math.PI * s, Math.PI * e, false);
  }
  // Append a caret "^" (squeezed laughing eye) to the current path.
  function caretInto(cx, cy, rr) {
    ctx.moveTo(cx - rr, cy + rr * 0.5);
    ctx.lineTo(cx, cy - rr * 0.5);
    ctx.lineTo(cx + rr, cy + rr * 0.5);
  }

  function drawFace(r, laughing, heat, pulse) {
    const eyeY = -r * 0.15;
    const eyeX = r * 0.33;
    const mouthY = r * 0.26;

    // Dim & soften the glowing features as he drifts off to sleep.
    const lvl = lerp(1, 0.4, life.sleepiness);

    // Build the eyes + (closed) mouth path for the current mood.
    const buildLines = () => {
      ctx.beginPath();
      if (life.asleep || life.sleepiness > 0.5) {
        // relaxed, almost-flat closed eyes + a tiny content smile
        arcInto(-eyeX, eyeY, r * 0.18, 0.32, 0.68);
        arcInto(eyeX, eyeY, r * 0.18, 0.32, 0.68);
        arcInto(0, mouthY, r * 0.13, 0.14, 0.86);
      } else if (laughing) {
        caretInto(-eyeX, eyeY, r * 0.17);
        caretInto(eyeX, eyeY, r * 0.17);
      } else {
        arcInto(-eyeX, eyeY, r * 0.18, 0.08, 0.92);
        arcInto(eyeX, eyeY, r * 0.18, 0.08, 0.92);
        arcInto(0, mouthY, r * 0.22, 0.06, 0.94);
      }
    };

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Pass 1 — soft warm glow halo
    buildLines();
    ctx.strokeStyle = `rgba(255,150,50,${0.9 * lvl})`;
    ctx.lineWidth = Math.max(4, r * 0.13);
    ctx.shadowColor = "rgba(255,150,40,0.95)";
    ctx.shadowBlur = 12 + heat * 10;
    ctx.stroke();

    // Pass 2 — crisp bright core
    buildLines();
    ctx.strokeStyle = `rgba(255,${(232 + pulse * 18) | 0},185,${lvl})`;
    ctx.lineWidth = Math.max(2.4, r * 0.058);
    ctx.shadowBlur = 4;
    ctx.stroke();

    // Open laughing mouth (filled, with its own glow rim)
    if (laughing) {
      const mw = r * 0.24;
      ctx.beginPath();
      ctx.moveTo(-mw, mouthY - r * 0.02);
      ctx.lineTo(mw, mouthY - r * 0.02);
      ctx.arc(0, mouthY - r * 0.02, mw, 0, Math.PI, false);
      ctx.closePath();
      ctx.fillStyle = "rgba(110,26,18,0.92)";
      ctx.shadowColor = "rgba(255,150,40,0.9)";
      ctx.shadowBlur = 12;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,225,180,1)";
      ctx.lineWidth = Math.max(2.4, r * 0.055);
      ctx.shadowBlur = 6;
      ctx.stroke();
    }
    ctx.restore();

    // Rosy glowing cheeks
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const cheekA = (laughing ? 0.42 : 0.28) * clamp(heat, 0.4, 1.2);
    const cy = eyeY + r * 0.26;
    for (const sx of [-1, 1]) {
      const g = ctx.createRadialGradient(sx * eyeX * 1.18, cy, 0, sx * eyeX * 1.18, cy, r * 0.2);
      g.addColorStop(0, `rgba(255,120,80,${cheekA})`);
      g.addColorStop(1, "rgba(255,120,80,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx * eyeX * 1.18, cy, r * 0.2, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawZ(x, y, amount) {
    amount = clamp(amount, 0, 1);
    if (amount <= 0.01) return;
    ctx.save();
    ctx.fillStyle = "rgba(255,240,218,1)";
    ctx.textAlign = "center";
    ctx.shadowColor = "rgba(255,180,90,0.6)";
    ctx.shadowBlur = 7;
    const t = time * 0.45;
    for (let i = 0; i < 3; i++) {
      const ph = ((t + i * 0.5) % 1.5) / 1.5;      // slow 0..1 loop
      const a = Math.sin(ph * Math.PI);            // gentle fade in/out
      ctx.globalAlpha = amount * 0.75 * a;
      const size = coal.r * (0.2 + i * 0.13);
      ctx.font = `700 ${Math.round(size)}px "Inter", system-ui, sans-serif`;
      ctx.fillText("z", x + i * coal.r * 0.24 + ph * coal.r * 0.12,
                   y - ph * coal.r * 1.1 - i * coal.r * 0.18);
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of sparks) {
      const a = clamp(p.life / p.max, 0, 1);
      glowDot(p.x, p.y, p.r, `hsla(${p.hue},100%,${60 + a * 25}%,${a})`, p.r * 5);
    }
    ctx.restore();
    // ash puffs (soft, normal blend)
    for (const p of ash) {
      const a = clamp(p.life / p.max, 0, 1) * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fillStyle = `rgba(150,140,134,${a})`;
      ctx.fill();
    }
  }

  // ---------------------------------------------------------------
  //  Tiny drawing utilities
  // ---------------------------------------------------------------
  function glowDot(x, y, r, color, blur) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur || r * 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------------------------------------------------------------
  //  Main loop
  // ---------------------------------------------------------------
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05; // clamp big gaps (tab switches)
    time += dt;

    update(dt);
    draw();

    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------
  //  Boot
  // ---------------------------------------------------------------
  window.addEventListener("resize", resize);
  buildCoalArt();
  resize();
  // place the pet on the ash
  coal.x = scene.cx;
  coal.y = coal.restY;

  // A single, gentle first-run hint (fades on its own).
  setTimeout(() => showMessage("drag and flick your little coal", true), 900);

  requestAnimationFrame(frame);
})();
