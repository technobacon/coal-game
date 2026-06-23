/* =====================================================================
   Ember — a tiny cozy coal pet living in a stone fire-pit.
   No menus, no stats, no goals. Just one little coal you can flick
   around a warm, shallow hearth. He laughs when he tumbles, lights up
   his friends, and curls up to sleep when the embers fade — until you
   come back and wake him again.
   Single-file, dependency-free Canvas app. 3/4 oblique view.
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
  //  Palette (charcoal stones, warm brick back wall, pale warm ash)
  // ---------------------------------------------------------------
  const COL = {
    night: "#171310",
    stone: "#3c3531",
    stoneLight: "#5a4f48",
    stoneDark: "#241f1c",
    stoneEdge: "#0e0a09",
    rockDark: "#27110e",
    rockMid: "#43201a",
    glowHot: "#ff8a2b",
  };

  // ---------------------------------------------------------------
  //  Canvas sizing (DPR-aware) + scene geometry
  // ---------------------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  const scene = {};

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

  // The pit is an ellipse seen obliquely. Two stacked ellipses:
  //   - the rim (top of the low stone wall)
  //   - the floor / ash bed, the same shape dropped down by wallH.
  // The visible back wall is the band between their far (upper) halves.
  function computeScene() {
    const SQUISH = 0.54;                 // vertical foreshortening
    const RX = Math.min(W * 0.49, H * 0.72);   // a big, generous hearth
    const RY = RX * SQUISH;
    const cx = W / 2;
    const cyRim = H * 0.47;               // rim ellipse centre
    const stoneT = RX * 0.13;            // stone ring thickness
    const innerRX = RX - stoneT;
    const innerRY = RY - stoneT * SQUISH;

    // A large ash bed filling most of the pit floor, with a low back wall.
    const floorRX = innerRX * 0.95;
    const floorRY = innerRY * 0.72;
    const floorCy = cyRim + RY * 0.30;

    scene.cx = cx;
    scene.RX = RX; scene.RY = RY;
    scene.stoneT = stoneT;
    scene.innerRX = innerRX; scene.innerRY = innerRY;
    scene.cyRim = cyRim;
    scene.floorCy = floorCy;
    scene.floorRX = floorRX; scene.floorRY = floorRY;

    const coalR = floorRX * 0.19;             // a smaller, cuter coal
    scene.coalR = coalR;
    scene.restY = floorCy - floorRY * 0.04;   // rests near the bed's centre
    // The coal may roam almost the whole bed (well above the middle).
    scene.bedRX = floorRX - coalR * 0.6;
    scene.bedRY = floorRY - coalR * 0.8;
    scene.bedCy = floorCy;

    layoutEmbers();

    coal.r = coalR;
    if (coal.x === 0 && coal.y === 0) { coal.x = cx; coal.y = scene.restY; }
  }

  // Stable per-stone variation for the rim ring.
  const RIM_N = 22;
  const stoneVar = (() => {
    const r = mulberry32(1234);
    const a = [];
    for (let i = 0; i < RIM_N; i++) {
      a.push({ ov: 1 + (r() - 0.5) * 0.06, sh: 0.82 + r() * 0.32, gap: 0.10 + r() * 0.05 });
    }
    return a;
  })();

  // ---------------------------------------------------------------
  //  The coal pet
  // ---------------------------------------------------------------
  const coal = {
    x: 0, y: 0, r: 60,
    vx: 0, vy: 0,
    angle: 0, spin: 0,
    held: false,
    grounded: true,
    sqx: 1, sqy: 1, sqvx: 0, sqvy: 0,
    settledTime: 0,
    shape: [], cracks: [],
  };

  function buildCoalArt() {
    const rng = mulberry32(20240617);
    coal.shape = [];
    for (let i = 0; i < 16; i++) coal.shape.push(0.9 + rng() * 0.16);
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
  //  Background embers (the pet's little friends), nestled in the ash
  // ---------------------------------------------------------------
  const embers = [];
  function layoutEmbers() {
    const { cx, floorCy, floorRX, floorRY, coalR } = scene;
    const spots = [
      { dx: -0.58, dy: 0.34, s: 0.62 },
      { dx: 0.60, dy: 0.30, s: 0.68 },
      { dx: -0.20, dy: 0.62, s: 0.46 },
      { dx: 0.26, dy: 0.64, s: 0.50 },
      { dx: 0.05, dy: -0.40, s: 0.40 },
    ];
    embers.length = 0;
    for (const sp of spots) {
      embers.push({
        x: cx + sp.dx * floorRX,
        y: floorCy + sp.dy * floorRY,
        r: coalR * sp.s,
        flare: 0,
        phase: Math.random() * TAU,
      });
    }
  }

  // ---------------------------------------------------------------
  //  Particles
  // ---------------------------------------------------------------
  const sparks = [];
  const ash = [];
  const ambient = [];

  function spawnSparks(x, y, n, power, hue) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.3, 1) * power;
      sparks.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.6 - power * 0.45,   // bias upward (rising sparks)
        life: rand(0.4, 0.95), max: 0.95,
        r: rand(1.2, 3),
        hue: hue == null ? rand(24, 44) : hue,
      });
    }
    if (sparks.length > 420) sparks.splice(0, sparks.length - 420);
  }
  function spawnAsh(x, y, n, power) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const sp = rand(0.2, 0.8) * power;
      ash.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp * 0.5 - power * 0.25,
        life: rand(0.6, 1.3), max: 1.3,
        r: rand(4, 11),
      });
    }
    if (ash.length > 200) ash.splice(0, ash.length - 200);
  }
  function spawnAmbient() {
    const { cx, floorCy, floorRX, floorRY, cyRim, RY } = scene;
    const a = rand(0, TAU), t = Math.sqrt(Math.random());
    ambient.push({
      x: cx + Math.cos(a) * floorRX * t * 0.8,
      y: floorCy + Math.sin(a) * floorRY * t * 0.6,
      vx: rand(-8, 8), vy: rand(-26, -54),
      life: rand(1.6, 3.6), max: 3.6,
      r: rand(0.8, 2),
      top: cyRim - RY,
    });
    if (ambient.length > 44) ambient.shift();
  }

  // ---------------------------------------------------------------
  //  Hearth "life": warmth, sleep, reignition (cozy, never a penalty)
  // ---------------------------------------------------------------
  const life = {
    energy: 1, asleep: false, sleepiness: 0,
    timeSinceInput: 0, igniteFlash: 0,
  };
  const SLEEP_DELAY = 16;
  const SLEEP_FADE = 6;

  // ---------------------------------------------------------------
  //  Cute messages (clean, low-opacity, occasional) — lots of variety
  // ---------------------------------------------------------------
  const MSG = {
    play: [
      "your little coal is having so much fun!",
      "wheee!",
      "again! again!",
      "he loves playing with you",
      "so toasty",
      "tee-hee!",
      "your coal glows a little brighter",
      "boop!",
      "round and round he goes",
      "what a happy little ember",
      "he's giggling",
      "weeee, spinny!",
      "best day ever, he says",
    ],
    chain: [
      "he lit up his little friends!",
      "the whole hearth is glowing",
      "warmth spreads everywhere",
      "everyone's sparkling now",
      "a cozy little chain reaction",
      "the embers cheer him on",
    ],
    wake: [
      "your little coal missed you",
      "you're back! he's so happy",
      "the hearth flickers back to life",
      "he was dreaming of you",
      "rise and shine, little ember",
      "warmth returns to the pit",
    ],
    rest: [
      "he's cozy and warm",
      "your coal is happy you're here",
      "all snug in the ash",
      "a soft, contented glow",
      "he hums a tiny warm hum",
    ],
    sleepy: [
      "shhh… he's getting sleepy",
      "your coal is dozing off",
      "nap time by the fire",
      "the embers settle in for a rest",
    ],
  };
  let msgCooldown = 0;
  let msgHideTimer = null;
  function showMessage(text, force) {
    if (!force && msgCooldown > 0) return;
    messageEl.textContent = text;
    messageEl.classList.add("show");
    msgCooldown = 5.0;
    clearTimeout(msgHideTimer);
    msgHideTimer = setTimeout(() => messageEl.classList.remove("show"), 2600);
  }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // ---------------------------------------------------------------
  //  Audio — tiny WebAudio synth (soft hum + crackles), behind mute
  // ---------------------------------------------------------------
  const audio = { ctx: null, master: null, muted: false, started: false };
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
      const humGain = ac.createGain(); humGain.gain.value = 0.035;
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
      const o1 = ac.createOscillator(); o1.type = "sine"; o1.frequency.value = 64;
      const o2 = ac.createOscillator(); o2.type = "sine"; o2.frequency.value = 81;
      const lfo = ac.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.18;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.018;
      lfo.connect(lfoG); lfoG.connect(humGain.gain);
      o1.connect(lp); o2.connect(lp); lp.connect(humGain); humGain.connect(audio.master);
      o1.start(); o2.start(); lfo.start();
      audio.started = true;
    } catch (e) {}
  }
  function blip(power, hot) {
    if (!audio.started || audio.muted || !audio.ctx) return;
    try {
      const ac = audio.ctx, t = ac.currentTime, len = 0.09;
      const buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const src = ac.createBufferSource(); src.buffer = buf;
      const bp = ac.createBiquadFilter(); bp.type = "bandpass";
      bp.frequency.value = hot ? rand(900, 1600) : rand(400, 800); bp.Q.value = 0.8;
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
      try { audio.master.gain.linearRampToValueAtTime(m ? 0 : 0.6, audio.ctx.currentTime + 0.15); } catch (e) {}
    }
  }
  muteBtn.addEventListener("click", () => {
    initAudio();
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
    setMuted(!audio.muted);
  });

  // ---------------------------------------------------------------
  //  Input — drag & flick
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
    pointer.down = true; pointer.moved = 0;
    pointer.x = p.x; pointer.y = p.y;
    pointer.samples = [{ x: p.x, y: p.y, t: performance.now() }];
    registerInput();
    if (Math.hypot(p.x - coal.x, p.y - coal.y) <= Math.max(coal.r * 1.8, 48)) {
      coal.held = true; coal.grounded = false; coal.vx = coal.vy = 0;
      pointer.grabX = coal.x - p.x; pointer.grabY = coal.y - p.y;
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
    while (pointer.samples.length > 2 && now - pointer.samples[0].t > 120) pointer.samples.shift();
    if (coal.held) { coal.x = p.x + pointer.grabX; coal.y = p.y + pointer.grabY; clampToBed(); }
  }
  function onUp(e) {
    if (!pointer.down) return;
    pointer.down = false;
    canvas.classList.remove("grabbing");
    if (coal.held) {
      coal.held = false; coal.grounded = false;
      const s = pointer.samples;
      let vx = 0, vy = 0;
      if (s.length >= 2) {
        const a = s[0], b = s[s.length - 1];
        const dt = Math.max((b.t - a.t) / 1000, 0.016);
        vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt;
      }
      const GAIN = 0.95, MAXV = 2600;
      coal.vx = clamp(vx * GAIN, -MAXV, MAXV);
      coal.vy = clamp(vy * GAIN, -MAXV, MAXV);
      const speed = Math.hypot(coal.vx, coal.vy);
      coal.spin = clamp(vx / coal.r, -14, 14) + rand(-2, 2);
      if (pointer.moved < 8 && speed < 120) {
        // gentle poke — a happy little hop in a random direction
        const a = rand(0, TAU);
        coal.vx += Math.cos(a) * rand(160, 320);
        coal.vy += Math.sin(a) * rand(160, 320);
        coal.spin += rand(-6, 6);
        spawnSparks(coal.x, coal.y - coal.r * 0.4, 6, 180, 38);
        bumpEnergy(0.25);
        if (Math.random() < 0.5) showMessage(pick(MSG.play));
      } else if (speed > 240) {
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

  function clampToBed() {
    const { cx, bedCy, bedRX, bedRY } = scene;
    const dx = coal.x - cx, dy = coal.y - bedCy;
    const nd = Math.hypot(dx / bedRX, dy / bedRY);
    if (nd > 1) { coal.x = cx + dx / nd; coal.y = bedCy + dy / nd; }
  }
  function registerInput() {
    life.timeSinceInput = 0;
    if (life.asleep || life.sleepiness > 0.05) reignite();
  }
  function bumpEnergy(amt) { life.energy = clamp(life.energy + amt, 0, 1); }

  function reignite() {
    const wasAsleep = life.asleep;
    life.asleep = false; life.sleepiness = 0; life.energy = 1; life.igniteFlash = 1;
    for (let i = 0; i < embers.length; i++) {
      const em = embers[i];
      setTimeout(() => { em.flare = 1; spawnSparks(em.x, em.y - em.r * 0.5, 8, 220, 40); }, i * 70);
    }
    spawnSparks(coal.x, coal.y - coal.r * 0.5, 22, 320, 42);
    spawnAsh(coal.x, coal.y, 8, 120);
    if (wasAsleep) { showMessage(pick(MSG.wake), true); chime(); }
  }

  // ---------------------------------------------------------------
  //  Physics — a shallow bowl seen from above: friction, gentle
  //  centering, and bouncing off the elliptical pit wall.
  // ---------------------------------------------------------------
  const FRICTION = 0.36;   // velocity kept per second (livelier, bouncier play)
  const HOMING = 2.6;      // gentle roll back toward the cozy middle (when slow)
  const REST = 0.62;       // wall restitution
  let settledWasMoving = false;

  function physics(dt) {
    const { cx, bedCy, bedRX, bedRY, restY } = scene;
    const r = coal.r;

    if (coal.held) {
      coal.grounded = false;
      coal.angle += coal.spin * dt;
      coal.spin *= Math.pow(0.02, dt);
      return;
    }

    if (coal.grounded) {
      coal.x = lerp(coal.x, cx, clamp(dt * 0.8, 0, 1));
      coal.y = lerp(coal.y, restY, clamp(dt * 0.8, 0, 1));
      coal.vx *= Math.pow(0.01, dt); coal.vy *= Math.pow(0.01, dt);
      coal.spin *= Math.pow(0.05, dt);
      coal.angle = lerp(coal.angle, 0, clamp(dt * 4, 0, 1));
      coal.settledTime += dt;
      return;
    }

    // Gentle homing — barely there at speed (flicks stay responsive),
    // but once he's slowed he rolls cozily back toward the middle.
    const sp0 = Math.hypot(coal.vx, coal.vy);
    const homeScale = clamp(1 - sp0 / 320, 0, 1);
    coal.vx += (cx - coal.x) * HOMING * homeScale * dt;
    coal.vy += (restY - coal.y) * HOMING * homeScale * dt;
    const fr = Math.pow(FRICTION, dt);
    coal.vx *= fr; coal.vy *= fr;

    coal.x += coal.vx * dt;
    coal.y += coal.vy * dt;
    coal.angle += coal.spin * dt;
    coal.spin = lerp(coal.spin, coal.vx / r, clamp(dt * 3, 0, 1));

    // Wall bounce against the elliptical pit boundary.
    const dx = coal.x - cx, dy = coal.y - bedCy;
    const nd = Math.hypot(dx / bedRX, dy / bedRY);
    if (nd > 1) {
      coal.x = cx + dx / nd; coal.y = bedCy + dy / nd;
      // outward normal of the ellipse
      let nx = dx / (bedRX * bedRX), ny = dy / (bedRY * bedRY);
      const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
      const vn = coal.vx * nx + coal.vy * ny;
      if (vn > 0) {
        coal.vx -= (1 + REST) * vn * nx;
        coal.vy -= (1 + REST) * vn * ny;
        coal.spin += rand(-3, 3);
        if (vn > 80) {
          onImpact(coal.x, coal.y, vn, false);
          kickSquash(nx, ny, Math.min(vn / 1400, 1));
        }
      }
    }

    // Bumping the little background embers → chain reaction.
    for (let i = 0; i < embers.length; i++) {
      const em = embers[i];
      const ex = coal.x - em.x, ey = coal.y - em.y;
      const d = Math.hypot(ex, ey);
      if (d < r + em.r && Math.hypot(coal.vx, coal.vy) > 130 && em.flare < 0.6) {
        flareEmber(i, 1);
        const nx = ex / (d || 1), ny = ey / (d || 1);
        coal.vx += nx * 80; coal.vy += ny * 80;
        if (Math.random() < 0.35) showMessage(pick(MSG.chain));
      }
    }

    // Settle into a true rest once calm.
    const speed = Math.hypot(coal.vx, coal.vy);
    if (speed < 26) {
      coal.settledTime += dt;
      coal.angle = lerp(coal.angle, 0, clamp(dt * 4, 0, 1));
      if (coal.settledTime > 0.35) {
        coal.grounded = true;
        if (settledWasMoving && Math.random() < 0.5) showMessage(pick(MSG.rest));
        settledWasMoving = false;
      }
    } else {
      coal.settledTime = 0;
      settledWasMoving = true;
    }
  }

  function onImpact(x, y, speed, hot) {
    const p = clamp(speed / 1200, 0.1, 1.4);
    spawnSparks(x, y, Math.round(6 + p * 14), speed * 0.16, hot ? rand(36, 48) : undefined);
    spawnAsh(x, y, Math.round(3 + p * 6), speed * 0.05 + 40);
    bumpEnergy(0.18 + p * 0.2);
    blip(p, hot);
    registerInput();
    for (let i = 0; i < embers.length; i++) {
      const em = embers[i];
      if (Math.hypot(x - em.x, y - em.y) < em.r + coal.r * 0.6) flareEmber(i, 0.7);
    }
    if (speed > 800 && Math.random() < 0.4) showMessage(pick(MSG.play));
  }

  function flareEmber(i, amount) {
    const em = embers[i];
    em.flare = Math.max(em.flare, amount);
    spawnSparks(em.x, em.y - em.r * 0.4, 6, 200, 40);
    blip(0.4, true);
    for (let j = 0; j < embers.length; j++) {
      if (j === i) continue;
      const o = embers[j];
      if (Math.hypot(o.x - em.x, o.y - em.y) < em.r * 5) {
        const delay = 90 + Math.random() * 120;
        setTimeout(() => { o.flare = Math.max(o.flare, amount * 0.55); }, delay);
      }
    }
  }

  function kickSquash(nx, ny, strength) {
    if (strength <= 0) return;
    const k = 0.5 * strength;
    coal.sqvx += (Math.abs(nx) > Math.abs(ny) ? -k : k) * 12;
    coal.sqvy += (Math.abs(ny) >= Math.abs(nx) ? -k : k) * 12;
  }
  function updateSquash(dt) {
    const stiff = 220, damp = 14;
    coal.sqvx += (-stiff * (coal.sqx - 1) - damp * coal.sqvx) * dt;
    coal.sqvy += (-stiff * (coal.sqy - 1) - damp * coal.sqvy) * dt;
    coal.sqx += coal.sqvx * dt; coal.sqy += coal.sqvy * dt;
    coal.sqx = clamp(coal.sqx, 0.6, 1.4);
    coal.sqy = clamp(coal.sqy, 0.6, 1.4);
  }

  // ---------------------------------------------------------------
  //  Update
  // ---------------------------------------------------------------
  let last = performance.now();
  let ambientTimer = 0, time = 0;

  function update(dt) {
    if (!coal.held) life.timeSinceInput += dt;
    const speed = Math.hypot(coal.vx, coal.vy);
    const wasAsleep = life.asleep;
    if (!life.asleep && life.timeSinceInput > SLEEP_DELAY && speed < 30 && !coal.held) {
      life.sleepiness = clamp(life.sleepiness + dt / SLEEP_FADE, 0, 1);
      if (life.sleepiness >= 1) life.asleep = true;
    } else if (coal.held || life.timeSinceInput < SLEEP_DELAY) {
      life.sleepiness = clamp(life.sleepiness - dt * 2, 0, 1);
    }
    if (!wasAsleep && life.asleep) showMessage(pick(MSG.sleepy), true);

    const baseline = life.asleep ? 0.14 : lerp(0.72, 0.4, life.sleepiness);
    life.energy = lerp(life.energy, baseline, clamp(dt * 0.4, 0, 1));
    life.igniteFlash = Math.max(0, life.igniteFlash - dt * 1.6);

    physics(dt);
    updateSquash(dt);

    // Spontaneous "alive" wobble when calmly resting & awake.
    if (coal.grounded && !coal.held && !life.asleep && Math.random() < dt * 0.14) {
      const a = rand(0, TAU);
      coal.vx += Math.cos(a) * rand(60, 130);
      coal.vy += Math.sin(a) * rand(60, 130);
      coal.spin += rand(-4, 4);
      coal.grounded = false;
    }

    for (const em of embers) { em.flare = Math.max(0, em.flare - dt * 1.4); em.phase += dt * 1.5; }

    stepParticles(sparks, dt, true);
    stepParticles(ash, dt, false);
    stepAmbient(dt);

    ambientTimer -= dt;
    if (ambientTimer <= 0) { spawnAmbient(); ambientTimer = rand(0.25, 0.7); }

    if (msgCooldown > 0) msgCooldown -= dt;
  }

  function stepParticles(arr, dt, isSpark) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      if (isSpark) { p.vy += 240 * dt; p.vx *= Math.pow(0.5, dt); }   // gentle gravity on rising sparks
      else { p.vy -= 60 * dt; p.vx *= Math.pow(0.2, dt); p.r += 8 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  function stepAmbient(dt) {
    for (let i = ambient.length - 1; i >= 0; i--) {
      const p = ambient[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx += Math.sin(p.life * 3) * 6 * dt;
      if (p.life <= 0 || p.y < p.top) ambient.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------
  //  RENDERING
  // ---------------------------------------------------------------
  function timeOfDayWarmth() {
    const h = new Date().getHours();
    const night = (h >= 23 || h < 6) ? 1 : (h >= 21 || h < 8) ? 0.5 : 0;
    return 1 - night * 0.16;
  }

  function ellipse(cxp, cyp, rxp, ryp, a0, a1, anti) {
    ctx.ellipse(cxp, cyp, rxp, ryp, 0, a0 == null ? 0 : a0, a1 == null ? TAU : a1, !!anti);
  }

  function draw() {
    const { cx, cyRim, RX, RY, innerRX, innerRY, floorCy, floorRX, floorRY } = scene;
    const pulse = 0.5 + 0.5 * Math.sin(time * (TAU / 4.2));
    const tod = timeOfDayWarmth();
    const warm = (0.5 + life.energy * 0.5) * tod + life.igniteFlash * 0.4;

    ctx.fillStyle = COL.night;
    ctx.fillRect(0, 0, W, H);

    // Ambient warm bloom behind the pit
    const bloom = ctx.createRadialGradient(cx, floorCy, RX * 0.2, cx, floorCy, RX * 1.5);
    bloom.addColorStop(0, `rgba(120,55,24,${0.28 * warm})`);
    bloom.addColorStop(1, "rgba(120,55,24,0)");
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, W, H);

    drawRim(false);          // far (back) stones
    drawPitInterior(warm);
    drawAshFloor(warm, pulse);
    drawSmoke(true);         // smoke wisp behind the coal
    drawRim(true);           // near (front) stones
    // The pet and his friends live in the ash and are always fully
    // visible — never clipped by the front stones.
    drawEmbers(pulse, warm);
    drawCoalShadow();
    drawCoal(pulse, warm);
    drawParticles();
    drawAmbient();           // floating sparks drift over everything
    drawSmoke(false);        // a wisp drifting up in front

    // soft vignette
    const vg = ctx.createRadialGradient(cx, floorCy, RX * 0.5, cx, floorCy, Math.max(W, H) * 0.8);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.42)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  // The elliptical ring of stones, split into far/near halves for depth.
  function drawRim(front) {
    const { cx, cyRim, RX, RY, innerRX, innerRY } = scene;
    for (let i = 0; i < RIM_N; i++) {
      const a0 = (i / RIM_N) * TAU, a1 = ((i + 1) / RIM_N) * TAU;
      const amid = (a0 + a1) / 2;
      const isFront = Math.sin(amid) > 0.04;
      if (front !== isFront) continue;
      const v = stoneVar[i];
      const gap = v.gap * (a1 - a0);
      const b0 = a0 + gap, b1 = a1 - gap;
      const ov = v.ov;
      const ix0 = cx + Math.cos(b0) * innerRX, iy0 = cyRim + Math.sin(b0) * innerRY;
      const ix1 = cx + Math.cos(b1) * innerRX, iy1 = cyRim + Math.sin(b1) * innerRY;
      const ox1 = cx + Math.cos(b1) * RX * ov, oy1 = cyRim + Math.sin(b1) * RY * ov;
      const ox0 = cx + Math.cos(b0) * RX * ov, oy0 = cyRim + Math.sin(b0) * RY * ov;

      const pts = [[ix0, iy0], [ix1, iy1], [ox1, oy1], [ox0, oy0]];
      const round = scene.stoneT * 0.26;

      // soft drop shadow so the stones feel chunky and sit on the rim
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = scene.stoneT * 0.5;
      ctx.shadowOffsetY = scene.stoneT * 0.12;
      roundPoly(pts, round);
      ctx.fillStyle = COL.stoneDark;
      ctx.fill();
      ctx.restore();

      // body, lit a touch more on the near (lower) side
      const lightFace = clamp(0.5 + Math.sin(amid) * 0.5, 0, 1);
      const base = lerp(46, 78, lightFace) * v.sh;
      roundPoly(pts, round);
      const g = ctx.createLinearGradient(ix0, iy0, ox0, oy0);
      g.addColorStop(0, `rgb(${(base + 20) | 0},${(base + 13) | 0},${(base + 8) | 0})`);
      g.addColorStop(1, `rgb(${base * 0.55 | 0},${base * 0.48 | 0},${base * 0.42 | 0})`);
      ctx.fillStyle = g;
      ctx.fill();

      ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(2.4, scene.stoneT * 0.14);
      ctx.strokeStyle = COL.stoneEdge;
      ctx.stroke();

      // glossy bevel highlight along the inner (lit) edge
      ctx.beginPath();
      ctx.moveTo(lerp(ix0, ox0, 0.06) + (ix1 - ix0) * 0.12, lerp(iy0, oy0, 0.06) + (iy1 - iy0) * 0.12);
      ctx.lineTo(ix1 - (ix1 - ix0) * 0.12, iy1 - (iy1 - iy0) * 0.12);
      ctx.strokeStyle = "rgba(255,232,205,0.14)";
      ctx.lineWidth = Math.max(1.6, scene.stoneT * 0.1);
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

  // Draw a rounded quadrilateral (cozy pebble-stone corners).
  function roundPoly(pts, r) {
    const n = pts.length;
    const last = pts[n - 1], first = pts[0];
    ctx.beginPath();
    ctx.moveTo((last[0] + first[0]) / 2, (last[1] + first[1]) / 2);
    for (let i = 0; i < n; i++) {
      const corner = pts[i], next = pts[(i + 1) % n];
      ctx.arcTo(corner[0], corner[1], (corner[0] + next[0]) / 2, (corner[1] + next[1]) / 2, r);
    }
    ctx.closePath();
  }

  // Fill the whole inside of the pit (the curved brick wall). The ash
  // bed is drawn on top, so the visible remainder reads as the back wall.
  function drawPitInterior(warm) {
    const { cx, cyRim, innerRX, innerRY, floorCy, floorRX, floorRY } = scene;
    ctx.save();
    ctx.beginPath(); ellipse(cx, cyRim, innerRX, innerRY); ctx.clip();

    const top = cyRim - innerRY, bottom = cyRim + innerRY;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, "#1f140d");
    g.addColorStop(0.7, "#3a2416");
    g.addColorStop(1, "#4a2e1b");
    ctx.fillStyle = g;
    ctx.fillRect(cx - innerRX - 6, top - 6, innerRX * 2 + 12, innerRY * 2 + 12);

    // warm glow rising from where the coal rests
    const rg = ctx.createRadialGradient(cx, floorCy, 8, cx, floorCy, innerRX * 1.3);
    rg.addColorStop(0, `rgba(150,76,32,${0.5 * warm})`);
    rg.addColorStop(1, "rgba(150,76,32,0)");
    ctx.fillStyle = rg;
    ctx.fillRect(cx - innerRX - 6, top - 6, innerRX * 2 + 12, innerRY * 2 + 12);

    // curved brick courses (concentric arcs that flatten toward the bed)
    ctx.strokeStyle = "rgba(12,7,3,0.12)";
    ctx.lineWidth = Math.max(1.2, innerRX * 0.006);
    for (let c = 1; c <= 4; c++) {
      const k = c / 5;
      const ey = lerp(cyRim, floorCy, k * 0.7);
      const erx = lerp(innerRX, floorRX, k * 0.7);
      const ery = lerp(innerRY, floorRY, k * 0.7);
      ctx.beginPath(); ellipse(cx, ey, erx, ery, Math.PI, TAU, false); ctx.stroke();
    }
    // vertical seams fanning down the back wall
    for (let i = 0; i < 13; i++) {
      const a = Math.PI + (i / 13) * Math.PI;
      const x0 = cx + Math.cos(a) * innerRX, y0 = cyRim + Math.sin(a) * innerRY;
      const x1 = cx + Math.cos(a) * floorRX, y1 = floorCy + Math.sin(a) * floorRY;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.restore();
  }

  function drawAshFloor(warm, pulse) {
    const { cx, floorCy, floorRX, floorRY } = scene;
    ctx.beginPath();
    ellipse(cx, floorCy, floorRX, floorRY);
    const g = ctx.createRadialGradient(cx, floorCy - floorRY * 0.1, floorRX * 0.1, cx, floorCy, floorRX);
    g.addColorStop(0, "#cabaa6");
    g.addColorStop(0.6, "#9a8a7b");
    g.addColorStop(1, "#5b4d43");
    ctx.fillStyle = g;
    ctx.fill();

    ctx.save();
    ctx.clip();
    // soft shadow along the far (back) edge so the bed feels sunken
    const sg = ctx.createLinearGradient(0, floorCy - floorRY, 0, floorCy - floorRY * 0.2);
    sg.addColorStop(0, "rgba(20,12,8,0.55)");
    sg.addColorStop(1, "rgba(20,12,8,0)");
    ctx.fillStyle = sg;
    ctx.fillRect(cx - floorRX, floorCy - floorRY, floorRX * 2, floorRY);
    // warm firelight pooling on the ash around the coal
    ctx.globalCompositeOperation = "lighter";
    const wg = ctx.createRadialGradient(coal.x, coal.y, floorRX * 0.04, coal.x, coal.y, floorRX * 0.85);
    const warmA = (0.22 + life.energy * 0.18) * warm;
    wg.addColorStop(0, `rgba(255,140,62,${warmA})`);
    wg.addColorStop(1, "rgba(255,140,62,0)");
    ctx.fillStyle = wg;
    ctx.fillRect(cx - floorRX, floorCy - floorRY, floorRX * 2, floorRY * 2);
    ctx.restore();

    // soft ash mounds for a little gentle texture
    let rng = mulberry32(31);
    ctx.save();
    ctx.beginPath(); ellipse(cx, floorCy, floorRX, floorRY); ctx.clip();
    for (let i = 0; i < 9; i++) {
      const a = rng() * TAU, t = Math.sqrt(rng());
      const x = cx + Math.cos(a) * floorRX * t * 0.85;
      const y = floorCy + Math.sin(a) * floorRY * t * 0.85;
      const rr = floorRX * (0.08 + rng() * 0.12);
      const m = ctx.createRadialGradient(x - rr * 0.3, y - rr * 0.3, 0, x, y, rr);
      const light = rng() > 0.5;
      m.addColorStop(0, light ? "rgba(220,208,193,0.22)" : "rgba(70,58,50,0.18)");
      m.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = m;
      ctx.beginPath(); ctx.ellipse(x, y, rr, rr * 0.6, 0, 0, TAU); ctx.fill();
    }
    ctx.restore();

    // scattered glowing embers buried in the ash
    rng = mulberry32(7);
    for (let i = 0; i < 24; i++) {
      const a = rng() * TAU, t = Math.sqrt(rng());
      const x = cx + Math.cos(a) * floorRX * t * 0.92;
      const y = floorCy + Math.sin(a) * floorRY * t * 0.92;
      const rr = rng() * 2.4 + 1;
      const gl = (0.25 + rng() * 0.5) * (0.4 + life.energy * 0.6);
      glowDot(x, y, rr, `rgba(255,${(120 + gl * 90) | 0},50,${gl})`, rr * 4);
    }
  }

  function drawCoalShadow() {
    const r = coal.r;
    const drop = clamp((coal.y - scene.restY) / r, 0, 1);
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.ellipse(coal.x, coal.y + r * 0.72, r * (0.9 - drop * 0.2), r * (0.3 - drop * 0.1), 0, 0, TAU);
    ctx.fillStyle = "rgba(0,0,0,0.32)";
    ctx.fill();
    ctx.restore();
  }

  function drawEmbers(pulse, warm) {
    for (const em of embers) {
      const base = 0.45 + 0.2 * Math.sin(em.phase) + life.energy * 0.25;
      const lvl = clamp(base + em.flare * 0.9, 0, 1.6) * warm;
      const r = em.r;
      glowDot(em.x, em.y, r * 0.9, `rgba(255,130,46,${0.5 * lvl})`, r * 3.2 + em.flare * r * 2);
      ctx.beginPath();
      ctx.ellipse(em.x, em.y, r, r * 0.86, 0, 0, TAU);
      const eg = ctx.createRadialGradient(em.x, em.y - r * 0.2, r * 0.2, em.x, em.y, r);
      eg.addColorStop(0, `rgba(255,${150 + em.flare * 80},60,1)`);
      eg.addColorStop(0.6, COL.rockMid);
      eg.addColorStop(1, COL.rockDark);
      ctx.fillStyle = eg; ctx.fill();
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.strokeStyle = "rgba(20,10,8,0.8)"; ctx.stroke();
      ctx.save();
      ctx.translate(em.x, em.y);
      ctx.strokeStyle = `rgba(255,${160 + em.flare * 80},70,${(0.5 + em.flare * 0.5) * warm})`;
      ctx.lineWidth = Math.max(1, r * 0.06);
      ctx.shadowColor = COL.glowHot; ctx.shadowBlur = 6 + em.flare * 16;
      ctx.beginPath();
      ctx.moveTo(-r * 0.5, -r * 0.1); ctx.lineTo(0, r * 0.1); ctx.lineTo(r * 0.4, -r * 0.2);
      ctx.moveTo(0, r * 0.1); ctx.lineTo(-r * 0.1, r * 0.5);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawAmbient() {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of ambient) {
      const a = p.life / p.max;
      const fl = 0.6 + 0.4 * Math.sin(p.life * 18);
      glowDot(p.x, p.y, p.r, `rgba(255,${(170 + (1 - a) * 60) | 0},80,${a * 0.8 * fl})`, p.r * 6);
    }
    ctx.restore();
  }

  function drawSmoke(behind) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    const baseX = coal.x, baseY = coal.y - coal.r * 0.7;
    const h = scene.RY * (behind ? 1.5 : 1.1);
    const w = coal.r * (behind ? 0.5 : 0.34);
    const ph = behind ? 0 : 2.1;
    const sp = behind ? 0.45 : 0.5;
    ctx.beginPath();
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const y = baseY - t * h;
      const sway = Math.sin(time * sp + ph + t * 3.2) * w * (0.3 + t * 1.2);
      const x = baseX + sway + (behind ? coal.r * 0.1 : -coal.r * 0.05);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = `rgba(190,170,158,${behind ? 0.05 : 0.045})`;
    ctx.lineWidth = w; ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  // ---- the pet ----------------------------------------------------
  function drawCoal(pulse, warm) {
    const r = coal.r;
    const speed = Math.hypot(coal.vx, coal.vy);
    const moving = (speed > 200 || (coal.held && pointer.moved > 12)) && !life.asleep;

    ctx.save();
    ctx.translate(coal.x, coal.y);
    ctx.scale(coal.sqx, coal.sqy);
    ctx.rotate(coal.angle);

    const heat = clamp(life.energy * warm + pulse * 0.12 + life.igniteFlash * 0.5, 0, 1.4);

    // outer glow
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const gl = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 2.0);
    gl.addColorStop(0, `rgba(255,140,55,${0.55 * heat})`);
    gl.addColorStop(0.5, `rgba(255,110,40,${0.18 * heat})`);
    gl.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = gl;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.0, 0, TAU); ctx.fill();
    ctx.restore();

    // rock body
    ctx.beginPath(); blobPath(r);
    const bg = ctx.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.2, 0, 0, r * 1.1);
    bg.addColorStop(0, "#7a3622"); bg.addColorStop(0.55, "#491f19"); bg.addColorStop(1, "#27110e");
    ctx.fillStyle = bg; ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const mg = ctx.createRadialGradient(0, r * 0.05, r * 0.08, 0, 0, r * 0.95);
    mg.addColorStop(0, `rgba(255,95,30,${0.28 * heat})`); mg.addColorStop(1, "rgba(255,95,30,0)");
    ctx.fillStyle = mg; ctx.beginPath(); blobPath(r); ctx.fill();
    ctx.restore();

    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2.5, r * 0.06);
    ctx.strokeStyle = "#170a08"; ctx.stroke();

    // glowing cracks (subtle rim texture)
    ctx.save();
    ctx.clip();
    const crackA = clamp(0.4 + heat * 0.4, 0, 0.9) * (life.asleep ? 0.5 : 1);
    ctx.strokeStyle = `rgba(255,${(115 + heat * 70) | 0},${(45 + heat * 30) | 0},${crackA})`;
    ctx.lineWidth = Math.max(1.5, r * 0.04);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.shadowColor = COL.glowHot; ctx.shadowBlur = 6 + heat * 10 + pulse * 3;
    for (const cr of coal.cracks) {
      ctx.beginPath();
      for (let i = 0; i < cr.length; i++) {
        const px = cr[i][0] * r, py = cr[i][1] * r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    drawFace(r, moving, heat, pulse);
    ctx.restore();

    if (life.asleep || life.sleepiness > 0.4) drawZ(coal.x + r * 0.7, coal.y - r * 0.9, life.sleepiness);
  }

  function blobPath(r) {
    const pts = coal.shape, n = pts.length, P = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU;
      P.push([Math.cos(ang) * r * pts[i], Math.sin(ang) * r * pts[i]]);
    }
    ctx.moveTo((P[0][0] + P[n - 1][0]) / 2, (P[0][1] + P[n - 1][1]) / 2);
    for (let i = 0; i < n; i++) {
      const cur = P[i], next = P[(i + 1) % n];
      ctx.quadraticCurveTo(cur[0], cur[1], (cur[0] + next[0]) / 2, (cur[1] + next[1]) / 2);
    }
    ctx.closePath();
  }

  function arcInto(cx, cy, rr, s, e) {
    ctx.moveTo(cx + Math.cos(Math.PI * s) * rr, cy + Math.sin(Math.PI * s) * rr);
    ctx.arc(cx, cy, rr, Math.PI * s, Math.PI * e, false);
  }
  function caretInto(cx, cy, rr) {
    ctx.moveTo(cx - rr, cy + rr * 0.5);
    ctx.lineTo(cx, cy - rr * 0.5);
    ctx.lineTo(cx + rr, cy + rr * 0.5);
  }

  function drawFace(r, laughing, heat, pulse) {
    const eyeY = -r * 0.15, eyeX = r * 0.33, mouthY = r * 0.26;
    const lvl = lerp(1, 0.4, life.sleepiness);
    const buildLines = () => {
      ctx.beginPath();
      if (life.asleep || life.sleepiness > 0.5) {
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
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    buildLines();
    ctx.strokeStyle = `rgba(255,150,50,${0.9 * lvl})`;
    ctx.lineWidth = Math.max(4, r * 0.13);
    ctx.shadowColor = "rgba(255,150,40,0.95)"; ctx.shadowBlur = 12 + heat * 10;
    ctx.stroke();
    buildLines();
    ctx.strokeStyle = `rgba(255,${(232 + pulse * 18) | 0},185,${lvl})`;
    ctx.lineWidth = Math.max(2.4, r * 0.058);
    ctx.shadowBlur = 4;
    ctx.stroke();
    if (laughing) {
      const mw = r * 0.24;
      ctx.beginPath();
      ctx.moveTo(-mw, mouthY - r * 0.02); ctx.lineTo(mw, mouthY - r * 0.02);
      ctx.arc(0, mouthY - r * 0.02, mw, 0, Math.PI, false); ctx.closePath();
      ctx.fillStyle = "rgba(110,26,18,0.92)";
      ctx.shadowColor = "rgba(255,150,40,0.9)"; ctx.shadowBlur = 12; ctx.fill();
      ctx.strokeStyle = "rgba(255,225,180,1)"; ctx.lineWidth = Math.max(2.4, r * 0.055);
      ctx.shadowBlur = 6; ctx.stroke();
    }
    ctx.restore();

    // rosy cheeks
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const cheekA = (laughing ? 0.42 : 0.28) * clamp(heat, 0.4, 1.2);
    const cy = eyeY + r * 0.26;
    for (const sx of [-1, 1]) {
      const g = ctx.createRadialGradient(sx * eyeX * 1.18, cy, 0, sx * eyeX * 1.18, cy, r * 0.2);
      g.addColorStop(0, `rgba(255,120,80,${cheekA})`); g.addColorStop(1, "rgba(255,120,80,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx * eyeX * 1.18, cy, r * 0.2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawZ(x, y, amount) {
    amount = clamp(amount, 0, 1);
    if (amount <= 0.01) return;
    ctx.save();
    ctx.fillStyle = "rgba(255,240,218,1)"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(255,180,90,0.6)"; ctx.shadowBlur = 7;
    const t = time * 0.45;
    for (let i = 0; i < 3; i++) {
      const ph = ((t + i * 0.5) % 1.5) / 1.5;
      const a = Math.sin(ph * Math.PI);
      ctx.globalAlpha = amount * 0.75 * a;
      ctx.font = `700 ${Math.round(coal.r * (0.32 + i * 0.2))}px "Quicksand", system-ui, sans-serif`;
      ctx.fillText("z", x + i * coal.r * 0.24 + ph * coal.r * 0.12, y - ph * coal.r * 1.1 - i * coal.r * 0.18);
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
    for (const p of ash) {
      const a = clamp(p.life / p.max, 0, 1) * 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU);
      ctx.fillStyle = `rgba(150,140,134,${a})`; ctx.fill();
    }
  }

  function glowDot(x, y, r, color, blur) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = blur || r * 4;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------
  //  Main loop
  // ---------------------------------------------------------------
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05;
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
  coal.x = scene.cx; coal.y = scene.restY;
  setTimeout(() => showMessage("drag and flick your little coal", true), 900);
  requestAnimationFrame(frame);
})();
