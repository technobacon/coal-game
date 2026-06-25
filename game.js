/* =====================================================================
   Ember — a tiny cozy coal pet living in a low-poly stone fire-pit.
   No menus, no stats, no goals. Just one little faceted coal you can
   flick around a chunky, glowing hearth. He laughs when he tumbles,
   lights up his friends, and curls up to sleep when the embers fade —
   until you come back and wake him again.

   Single-file, dependency-free Canvas app. The whole scene — the stone
   bricks, the rim, the coal bed, the pet — is a tiny flat-shaded
   low-poly renderer drawn in a fixed 3/4 isometric view. Fire light
   comes up from the coals, exactly like the concept art.
   ===================================================================== */

(() => {
  "use strict";

  const canvas = document.getElementById("scene");
  const ctx = canvas.getContext("2d");
  const messageEl = document.getElementById("message");
  const muteBtn = document.getElementById("mute");

  // Soft filmic bloom buffer (downscale + blur the frame, add it back).
  const bloomCanvas = document.createElement("canvas");
  const bloomCtx = bloomCanvas.getContext("2d");
  const BLOOM_SCALE = 0.28;
  let bloomOK = true;

  // Cached static scene (walls, rim, floor, coal bed) — re-rendered on resize.
  const bgCanvas = document.createElement("canvas");
  const bgCtx = bgCanvas.getContext("2d");

  // ---------------------------------------------------------------
  //  Small helpers
  // ---------------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;
  const rad = (d) => (d * Math.PI) / 180;

  function mulberry32(seed) {
    let t = seed >>> 0;
    return () => {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
  }

  const reduceMotion = (() => {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  })();
  const PARTICLE_MUL = reduceMotion ? 0.45 : 1;

  const store = {
    get(k, d) { try { const v = localStorage.getItem("ember." + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("ember." + k, String(v)); } catch (e) {} },
  };
  function haptic(ms) {
    if (reduceMotion || !ms) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }

  const noiseTable = (() => { const r = mulberry32(98765); const a = []; for (let i = 0; i < 256; i++) a.push(r()); return a; })();
  function vnoise(t) {
    const i = Math.floor(t), f = t - i;
    const a = noiseTable[i & 255], b = noiseTable[(i + 1) & 255];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  }
  function fireFlicker() {
    if (reduceMotion) return 1;
    const n = 0.5 * vnoise(time * 6.0) + 0.3 * vnoise(time * 11 + 5) + 0.2 * vnoise(time * 19 + 2);
    return 0.9 + (n - 0.5) * 0.4;
  }

  // ---------------------------------------------------------------
  //  3-D math (just enough for a flat-shaded low-poly scene)
  // ---------------------------------------------------------------
  function norm(x, y, z) { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; }
  function rotAxis(ax, ang) {
    const { x, y, z } = ax, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [
      t * x * x + c, t * x * y - s * z, t * x * z + s * y,
      t * x * y + s * z, t * y * y + c, t * y * z - s * x,
      t * x * z - s * y, t * y * z + s * x, t * z * z + c,
    ];
  }
  function mul3(a, b) {
    const r = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      let s = 0; for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
      r[i * 3 + j] = s;
    }
    return r;
  }
  function apply3(m, v) {
    return {
      x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
      y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
      z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
    };
  }
  const IDENT3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // Camera / projection (fixed 3/4 isometric). Built in computeProjection().
  const YAW = rad(28), PITCH = rad(33);
  const cosY = Math.cos(YAW), sinY = Math.sin(YAW), cosP = Math.cos(PITCH), sinP = Math.sin(PITCH);
  const proj = { cx: 0, cy: 0, S: 60, A00: 0, A01: 0, A10: 0, A11: 0, HUP: 0, iA00: 0, iA01: 0, iA10: 0, iA11: 0 };

  function computeProjection() {
    proj.cx = W / 2;
    proj.cy = H * 0.47;
    proj.S = Math.min(W / 12.2, H / 10.4);
    const S = proj.S;
    proj.A00 = S * cosY; proj.A01 = -S * sinY;
    proj.A10 = S * sinP * sinY; proj.A11 = S * sinP * cosY;
    proj.HUP = S * cosP;
    const det = proj.A00 * proj.A11 - proj.A01 * proj.A10 || 1;
    proj.iA00 = proj.A11 / det; proj.iA01 = -proj.A01 / det;
    proj.iA10 = -proj.A10 / det; proj.iA11 = proj.A00 / det;
  }
  // World (x,y,z) → screen [sx, sy]. y is up.
  function project(x, y, z) {
    return [proj.cx + proj.A00 * x + proj.A01 * z, proj.cy + proj.A10 * x + proj.A11 * z - proj.HUP * y];
  }
  // Depth key (larger = nearer the camera).
  function depthOf(x, y, z) { return y * sinP + (x * sinY + z * cosY) * cosP; }
  // Screen delta → floor (x,z) delta (for dragging / flicking on the floor plane).
  function screenToFloor(dsx, dsy) {
    return { x: proj.iA00 * dsx + proj.iA01 * dsy, z: proj.iA10 * dsx + proj.iA11 * dsy };
  }

  // ---------------------------------------------------------------
  //  Mesh helpers — boxes (bricks) and rocks (faceted lumps)
  // ---------------------------------------------------------------
  // Icosahedron, the base for every rounded rock & the pet.
  const ICO = (() => {
    const t = (1 + Math.sqrt(5)) / 2;
    const v = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ].map((p) => norm(p[0], p[1], p[2]));
    const f = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    return { v, f };
  })();

  // A faceted rock: jittered icosahedron, scaled (sx,sy,sz).
  function makeRock(sx, sy, sz, jitter, seed) {
    const rng = mulberry32(seed);
    const verts = ICO.v.map((p) => {
      const k = 1 + (rng() - 0.5) * jitter;
      return { x: p.x * k * sx, y: p.y * k * sy, z: p.z * k * sz };
    });
    return { verts, tris: ICO.f };
  }

  // A chunky brick / stone block: a jittered box.
  function makeBox(sx, sy, sz, jitter, seed) {
    const rng = mulberry32(seed);
    const c = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
    ];
    const verts = c.map((p) => ({
      x: p[0] * sx * (1 + (rng() - 0.5) * jitter),
      y: p[1] * sy * (1 + (rng() - 0.5) * jitter),
      z: p[2] * sz * (1 + (rng() - 0.5) * jitter),
    }));
    const tris = [
      [0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6],
      [4, 0, 3], [4, 3, 7], [1, 5, 6], [1, 6, 2],
      [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0],
    ];
    return { verts, tris };
  }

  // ---------------------------------------------------------------
  //  Lighting — a soft key plus warm light rising from the coals,
  //  so dark stone glows orange near the fire and falls to black above.
  // ---------------------------------------------------------------
  const LIGHT = norm(-0.35, 1.0, 0.5);
  const AMB = 0.20, KEY = 0.40;
  const FIRE_COL = [255, 148, 60];
  const FIRE_POS = { x: 0, y: 0.35, z: 0.1 };
  const FIRE_RANGE = 3.0, FIRE_INT = 0.95;

  function shade(nx, ny, nz, cx, cy, cz, base, em, fireScale) {
    const kd = Math.max(0, nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z);
    const lum = AMB + KEY * kd;
    const fx = FIRE_POS.x - cx, fy = FIRE_POS.y - cy, fz = FIRE_POS.z - cz;
    const fd = Math.hypot(fx, fy, fz) || 1;
    const fdot = Math.max(0, (nx * fx + ny * fy + nz * fz) / fd);
    const fall = 1 / (1 + (fd / FIRE_RANGE) * (fd / FIRE_RANGE));
    const fterm = fdot * fall * FIRE_INT * (fireScale == null ? 1 : fireScale);
    let r = base[0] * lum + FIRE_COL[0] * fterm;
    let g = base[1] * lum + FIRE_COL[1] * fterm;
    let b = base[2] * lum + FIRE_COL[2] * fterm;
    if (em) { r += em[0]; g += em[1]; b += em[2]; }
    return "rgb(" + clamp(r, 0, 255).toFixed(0) + "," + clamp(g, 0, 255).toFixed(0) + "," + clamp(b, 0, 255).toFixed(0) + ")";
  }

  // Fill one triangle, stroking with the same colour to hide AA seams.
  function fillTri(p0, p1, p2, color) {
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = color; ctx.stroke();
  }

  // Turn a placed mesh into screen-space triangle records (projected once).
  // Normals are oriented outward from the instance centre so lighting is
  // correct regardless of winding.
  function bakeMesh(mesh, ox, oy, oz, layer, base, em, out) {
    let ccx = 0, ccy = 0, ccz = 0;
    for (const v of mesh.verts) { ccx += v.x; ccy += v.y; ccz += v.z; }
    ccx /= mesh.verts.length; ccy /= mesh.verts.length; ccz /= mesh.verts.length;
    const W3 = mesh.verts.map((v) => ({ x: v.x + ox, y: v.y + oy, z: v.z + oz }));
    const cwx = ccx + ox, cwy = ccy + oy, cwz = ccz + oz;
    for (const tri of mesh.tris) {
      const a = W3[tri[0]], b = W3[tri[1]], c = W3[tri[2]];
      let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      let ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const mx = (a.x + b.x + c.x) / 3, my = (a.y + b.y + c.y) / 3, mz = (a.z + b.z + c.z) / 3;
      if ((mx - cwx) * nx + (my - cwy) * ny + (mz - cwz) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      out.push({
        pts: [project(a.x, a.y, a.z), project(b.x, b.y, b.z), project(c.x, c.y, c.z)],
        color: shade(nx, ny, nz, mx, my, mz, base, em),
        depth: depthOf(mx, my, mz), wy: my, layer,
      });
    }
  }

  // ---------------------------------------------------------------
  //  Scene geometry (built on resize)
  // ---------------------------------------------------------------
  // Pit interior is a rectangle on the floor (y=0): x in [-HX,HX], z in [-HZ,HZ].
  const HX = 4.6, HZ = 3.1;        // interior half-extents
  const WALL_TOP = 3.6;            // back wall height
  let coalRecs = [];               // baked coal-bed tris (for fg redraw over pet)
  let rimFrontRecs = [];           // near rim tris (drawn over the pet)

  function buildScene() {
    const all = [];                // background-layer tris
    coalRecs = []; rimFrontRecs = [];
    let seed = 1000;

    const STONE = [40, 37, 41];
    const STONE2 = [50, 46, 50];
    const RIM = [46, 43, 47];

    // --- back wall: staggered courses of bricks ---
    const rows = 4, bw = 1.9, bh = WALL_TOP / rows, bd = 0.7;
    const zBack = -HZ - bd * 0.5;
    for (let r = 0; r < rows; r++) {
      const y = bh * (r + 0.5);
      const off = (r % 2) * bw * 0.5;
      for (let x = -HX - bw; x <= HX + bw; x += bw) {
        const px = x + off;
        if (px < -HX - bw * 0.6 || px > HX + bw * 0.6) continue;
        const base = r === 0 ? STONE : (r % 2 ? STONE2 : STONE);
        bakeMesh(makeBox(bw * 0.5 * 0.92, bh * 0.5 * 0.92, bd * 0.5, 0.16, seed++),
          px, y, zBack, "wall", base, null, all);
      }
    }

    // --- side walls: a couple of courses, stepping down toward the front ---
    const srows = 3, sd = 1.9, sh = (WALL_TOP * 0.78) / srows, sw = 0.7;
    for (const side of [-1, 1]) {
      const xWall = side * (HX + sw * 0.5);
      for (let r = 0; r < srows; r++) {
        const y = sh * (r + 0.5);
        const off = (r % 2) * sd * 0.5;
        for (let z = -HZ; z <= HZ - 0.4; z += sd) {
          const pz = z + off;
          const drop = clamp((pz + HZ) / (2 * HZ), 0, 1);   // shorter toward front
          if (y > WALL_TOP * (0.82 - drop * 0.5)) continue;
          bakeMesh(makeBox(sw * 0.5, sh * 0.5 * 0.92, sd * 0.5 * 0.92, 0.16, seed++),
            xWall, y, pz, "wall", r % 2 ? STONE2 : STONE, null, all);
        }
      }
    }

    // --- dark floor plane under the coals ---
    bakeMesh({
      verts: [
        { x: -HX, y: 0, z: -HZ }, { x: HX, y: 0, z: -HZ },
        { x: HX, y: 0, z: HZ }, { x: -HX, y: 0, z: HZ },
      ],
      tris: [[0, 1, 2], [0, 2, 3]],
    }, 0, -0.02, 0, "floor", [22, 13, 11], null, all);

    // --- rim: chunky rounded stones ringing the pit base ---
    const rimRecsBack = [];
    function placeRim(x, z, s, sd2) {
      const front = z > -0.2;                      // near half occludes the pet
      const rock = makeRock(s, s * 0.78, sd2 || s, 0.28, seed++);
      const tmp = [];
      bakeMesh(rock, x, s * 0.55, z, front ? "rimFront" : "rimBack", RIM, null, tmp);
      if (front) rimFrontRecs.push(...tmp); else rimRecsBack.push(...tmp);
    }
    const rimS = 0.95;
    for (let x = -HX - 0.2; x <= HX + 0.2; x += rimS * 1.5) placeRim(x, HZ + 0.45, rimS);   // front
    for (let z = -HZ + 0.2; z <= HZ + 0.2; z += rimS * 1.5) {                                 // sides
      placeRim(-HX - 0.45, z, rimS);
      placeRim(HX + 0.45, z, rimS);
    }
    all.push(...rimRecsBack);

    // --- coal bed: a packed heap of faceted rocks, some glowing hot ---
    const N = reduceMotion ? 240 : 380;
    const rng = mulberry32(77);
    for (let i = 0; i < N; i++) {
      const x = rand(-HX - 0.3, HX + 0.3);
      const z = rand(-HZ - 0.45, HZ + 0.35);
      const d = Math.hypot(x / HX, z / HZ);
      const mound = (1 - d * 0.6) * 0.34;          // gently piled toward the centre
      const backRise = clamp((-z + 0.4) / HZ, 0, 1.2) * 0.62;  // bank up against the wall
      const s = rand(0.34, 0.58) * (1 - d * 0.05);
      const y = s * 0.4 + Math.max(0, mound) * rand(0.4, 1.0) + backRise * rand(0.5, 1.0);
      const hot = rng();
      let base, em;
      if (hot < 0.44) {                            // glowing coal
        const k = rng();
        base = [120, 40, 18];
        em = [120 + k * 135, 48 + k * 115, 8 + k * 55];
      } else if (hot < 0.7) {
        base = [92, 36, 21]; em = [50, 17, 7];
      } else {
        base = [50, 30, 27]; em = [10, 5, 4];      // dark char (faint warmth)
      }
      const rock = makeRock(s, s * 0.8, s, 0.34, seed++);
      const recs = [];
      bakeMesh(rock, x, y, z, "coal", base, em, recs);
      coalRecs.push(...recs);
      all.push(...recs);
    }

    // The floor is one big spanning quad, so painter-sorting it by a single
    // centroid depth wrongly covers the back coals. Force it behind all.
    for (const r of all) if (r.layer === "floor") r.depth = -1e6;

    // sort background back-to-front and paint into the cache
    all.sort((a, b) => a.depth - b.depth);
    bgCtx.setTransform(1, 0, 0, 1, 0, 0);
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bgCtx.fillStyle = "#000";
    bgCtx.fillRect(0, 0, W, H);
    const save = ctx;
    paintInto(bgCtx, all);
    void save;

    rimFrontRecs.sort((a, b) => a.depth - b.depth);
  }

  function paintInto(c, recs) {
    c.lineJoin = "round";
    for (const r of recs) {
      c.beginPath();
      c.moveTo(r.pts[0][0], r.pts[0][1]);
      c.lineTo(r.pts[1][0], r.pts[1][1]);
      c.lineTo(r.pts[2][0], r.pts[2][1]);
      c.closePath();
      c.fillStyle = r.color; c.fill();
      c.lineWidth = 1; c.strokeStyle = r.color; c.stroke();
    }
  }

  // ---------------------------------------------------------------
  //  Canvas sizing
  // ---------------------------------------------------------------
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    for (const cv of [canvas, bgCanvas]) {
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    }
    canvas.style.width = W + "px"; canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    bloomCanvas.width = Math.max(1, Math.round(canvas.width * BLOOM_SCALE));
    bloomCanvas.height = Math.max(1, Math.round(canvas.height * BLOOM_SCALE));
    computeProjection();
    buildScene();
    layoutFriends();
  }

  // ---------------------------------------------------------------
  //  The coal pet — moves on the floor plane (x,z), tumbles in 3-D
  // ---------------------------------------------------------------
  const PET_R = 0.9;
  const pet = {
    x: 0, z: 0, vx: 0, vz: 0,
    R: IDENT3.slice(), spin: 0,
    held: false, grounded: true, settledTime: 0,
    sqXZ: 1, sqY: 1, sqvXZ: 0, sqvY: 0,
    hop: 0, vhop: 0,
    blink: 0, blinkT: rand(2.5, 6),
    mesh: null,
  };
  function buildPet() { pet.mesh = makeRock(PET_R, PET_R * 0.92, PET_R, 0.26, 4242); }

  // Inner bounds the pet centre may roam.
  const bedHX = () => HX - PET_R * 0.7;
  const bedHZ = () => HZ - PET_R * 0.7;

  // ---------------------------------------------------------------
  //  Friend embers (the little ones he lights up) — live in the bed
  // ---------------------------------------------------------------
  const friends = [];
  function layoutFriends() {
    const spots = [
      { x: -0.46, z: 0.30, s: 0.42 },
      { x: 0.50, z: 0.18, s: 0.46 },
      { x: -0.16, z: 0.64, s: 0.34 },
      { x: 0.22, z: 0.66, s: 0.36 },
      { x: 0.04, z: -0.42, s: 0.30 },
    ];
    friends.length = 0;
    let seed = 9000;
    for (const sp of spots) {
      const s = sp.s;
      friends.push({
        x: sp.x * HX, z: sp.z * HZ, s,
        flare: 0, phase: Math.random() * TAU, hop: 0, vhop: 0,
        mesh: makeRock(s, s * 0.82, s, 0.32, seed++),
      });
    }
  }

  // ---------------------------------------------------------------
  //  Particles & floating ember motes
  // ---------------------------------------------------------------
  const sparks = [], ash = [], ambient = [], trail = [], motes = [];

  function spawnSparks(sx, sy, n, power, hue) {
    n = Math.max(1, Math.round(n * PARTICLE_MUL));
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(0.3, 1) * power;
      sparks.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.6 - power * 0.5,
        life: rand(0.4, 0.95), max: 0.95, r: rand(1.2, 3), hue: hue == null ? rand(24, 44) : hue });
    }
    if (sparks.length > 420) sparks.splice(0, sparks.length - 420);
  }
  function spawnAsh(sx, sy, n, power) {
    n = Math.max(1, Math.round(n * PARTICLE_MUL));
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(0.2, 0.8) * power;
      ash.push({ x: sx, y: sy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - power * 0.25,
        life: rand(0.6, 1.3), max: 1.3, r: rand(4, 11) });
    }
    if (ash.length > 200) ash.splice(0, ash.length - 200);
  }
  function spawnAmbient() {
    const [sx, sy] = project(rand(-HX + 0.6, HX - 0.6), rand(0.2, 0.5), rand(-HZ + 0.5, HZ - 0.5));
    ambient.push({ x: sx, y: sy, vx: rand(-8, 8), vy: rand(-26, -54), life: rand(1.6, 3.6), max: 3.6,
      r: rand(0.8, 2), top: proj.cy - proj.S * 4 });
    if (ambient.length > 44) ambient.shift();
  }
  function seedMotes() {
    motes.length = 0;
    const n = reduceMotion ? 5 : 10;
    for (let i = 0; i < n; i++) motes.push(newMote(rand(0, WALL_TOP)));
  }
  function newMote(y0) {
    return { x: rand(-HX * 0.8, HX * 0.8), y: y0 == null ? 0.4 : y0, z: rand(-HZ + 0.4, HZ - 0.6),
      vy: rand(0.5, 1.1), phase: rand(0, TAU), r: rand(2.6, 5) };
  }

  // ---------------------------------------------------------------
  //  Hearth life
  // ---------------------------------------------------------------
  const life = { energy: 1, asleep: false, sleepiness: 0, timeSinceInput: 0, igniteFlash: 0 };
  const SLEEP_DELAY = 16, SLEEP_FADE = 6;

  // ---------------------------------------------------------------
  //  Messages
  // ---------------------------------------------------------------
  const MSG = {
    play: ["your little coal is having so much fun!", "wheee!", "again! again!", "he loves playing with you",
      "so toasty", "tee-hee!", "your coal glows a little brighter", "boop!", "round and round he goes",
      "what a happy little ember", "he's giggling", "weeee, spinny!", "best day ever, he says"],
    chain: ["he lit up his little friends!", "the whole hearth is glowing", "warmth spreads everywhere",
      "everyone's sparkling now", "a cozy little chain reaction", "the embers cheer him on"],
    wake: ["your little coal missed you", "you're back! he's so happy", "the hearth flickers back to life",
      "he was dreaming of you", "rise and shine, little ember", "warmth returns to the pit"],
    rest: ["he's cozy and warm", "your coal is happy you're here", "all snug in the coals",
      "a soft, contented glow", "he hums a tiny warm hum"],
    sleepy: ["shhh… he's getting sleepy", "your coal is dozing off", "nap time by the fire",
      "the embers settle in for a rest"],
  };
  let msgCooldown = 0, msgHideTimer = null, hintActive = false;
  function showMessage(text, force) {
    if (!force && msgCooldown > 0) return;
    messageEl.textContent = text;
    messageEl.classList.add("show");
    msgCooldown = 5.0;
    clearTimeout(msgHideTimer);
    msgHideTimer = setTimeout(() => messageEl.classList.remove("show"), 2600);
  }
  function pick(a) { return a[(Math.random() * a.length) | 0]; }

  // ---------------------------------------------------------------
  //  Audio (synth, behind mute)
  // ---------------------------------------------------------------
  const audio = { ctx: null, master: null, muted: false, started: false, humGain: null };
  function initAudio() {
    if (audio.started) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = new AC(); audio.ctx = ac;
      audio.master = ac.createGain(); audio.master.gain.value = audio.muted ? 0 : 0.6;
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
      audio.humGain = humGain; audio.started = true;
    } catch (e) {}
  }
  function updateHum() {
    if (!audio.started || !audio.humGain || !audio.ctx) return;
    try { audio.humGain.gain.setTargetAtTime(audio.muted ? 0 : 0.026 + life.energy * 0.03, audio.ctx.currentTime, 0.5); } catch (e) {}
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
      const g = ac.createGain(); const vol = clamp(power, 0.05, 1) * 0.35;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
      src.connect(bp); bp.connect(g); g.connect(audio.master);
      src.start(t); src.stop(t + len);
    } catch (e) {}
  }
  function chime() {
    if (!audio.started || audio.muted || !audio.ctx) return;
    try {
      const ac = audio.ctx, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(420, t); o.frequency.exponentialRampToValueAtTime(760, t + 0.25);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + 0.62);
    } catch (e) {}
  }
  function giggle() {
    if (!audio.started || audio.muted || !audio.ctx) return;
    try {
      const ac = audio.ctx, t = ac.currentTime;
      [0, 0.11].forEach((off, i) => {
        const o = ac.createOscillator(); o.type = "sine"; const f = i ? 900 : 720;
        o.frequency.setValueAtTime(f, t + off); o.frequency.exponentialRampToValueAtTime(f * 1.16, t + off + 0.09);
        const g = ac.createGain();
        g.gain.setValueAtTime(0.0001, t + off); g.gain.exponentialRampToValueAtTime(0.05, t + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.14);
        o.connect(g); g.connect(audio.master); o.start(t + off); o.stop(t + off + 0.16);
      });
    } catch (e) {}
  }
  function tok(power) {
    if (!audio.started || audio.muted || !audio.ctx) return;
    try {
      const ac = audio.ctx, t = ac.currentTime;
      const o = ac.createOscillator(); o.type = "sine";
      o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(70, t + 0.16);
      const g = ac.createGain();
      g.gain.setValueAtTime(clamp(power, 0.1, 1) * 0.22, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
      o.connect(g); g.connect(audio.master); o.start(t); o.stop(t + 0.2);
    } catch (e) {}
  }
  function setMuted(m) {
    audio.muted = m; muteBtn.classList.toggle("muted", m); store.set("muted", m ? 1 : 0);
    if (audio.master) { try { audio.master.gain.linearRampToValueAtTime(m ? 0 : 0.6, audio.ctx.currentTime + 0.15); } catch (e) {} }
  }
  muteBtn.addEventListener("click", () => {
    initAudio();
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
    setMuted(!audio.muted);
  });

  // ---------------------------------------------------------------
  //  Input — drag & flick (mapped onto the floor plane)
  // ---------------------------------------------------------------
  const pointer = { down: false, x: 0, y: 0, samples: [], grabX: 0, grabZ: 0, moved: 0 };
  function localPoint(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function petScreen() { return project(pet.x, petBodyY() + pet.hop, pet.z); }
  // The pet rests up on top of the coal heap so its face stays clear.
  function petBodyY() { return 0.74; }

  function onDown(e) {
    initAudio();
    if (audio.ctx && audio.ctx.state === "suspended") audio.ctx.resume();
    const p = localPoint(e);
    pointer.down = true; pointer.moved = 0; pointer.x = p.x; pointer.y = p.y;
    pointer.samples = [{ x: p.x, y: p.y, t: performance.now() }];
    registerInput();
    if (hintActive) { hintActive = false; store.set("hintSeen", 1); }
    const ps = petScreen();
    const grabR = Math.max(PET_R * proj.S * 1.5, 52);
    if (Math.hypot(p.x - ps[0], p.y - ps[1]) <= grabR) {
      pet.held = true; pet.grounded = false; pet.vx = pet.vz = 0;
      const f = screenToFloor(p.x - ps[0], p.y - ps[1]);
      pointer.grabX = pet.x - (pet.x + f.x); pointer.grabZ = pet.z - (pet.z + f.z);
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
    if (pet.held) {
      // place the pet under the pointer on the floor plane
      const f = screenToFloor(p.x - proj.cx, p.y - proj.cy + proj.HUP * (petBodyY()));
      pet.x = f.x + pointer.grabX; pet.z = f.z + pointer.grabZ;
      clampToBed();
    }
  }
  function onUp(e) {
    if (!pointer.down) return;
    pointer.down = false; canvas.classList.remove("grabbing");
    if (pet.held) {
      pet.held = false; pet.grounded = false;
      const s = pointer.samples; let dsx = 0, dsy = 0, dt = 0.05;
      if (s.length >= 2) {
        const a = s[0], b = s[s.length - 1];
        dt = Math.max((b.t - a.t) / 1000, 0.016); dsx = b.x - a.x; dsy = b.y - a.y;
      }
      const fv = screenToFloor(dsx / dt, dsy / dt);
      const GAIN = 0.95, MAXV = 34;
      pet.vx = clamp(fv.x * GAIN, -MAXV, MAXV);
      pet.vz = clamp(fv.z * GAIN, -MAXV, MAXV);
      const speed = Math.hypot(pet.vx, pet.vz);
      if (pointer.moved < 8 && speed < 2) {
        const a = rand(0, TAU), pw = rand(3, 6);
        pet.vx += Math.cos(a) * pw; pet.vz += Math.sin(a) * pw;
        spawnSparksAt(pet.x, pet.z, 6, 180, 38); bumpEnergy(0.25); haptic(8);
        if (Math.random() < 0.5) showMessage(pick(MSG.play));
      } else if (speed > 4) {
        spawnSparksAt(pet.x, pet.z, 10, speed * 9); bumpEnergy(0.5);
        haptic(Math.round(clamp(6 + speed, 6, 18)));
        if (speed > 12) giggle();
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
    pet.x = clamp(pet.x, -bedHX(), bedHX());
    pet.z = clamp(pet.z, -bedHZ(), bedHZ());
  }
  function registerInput() { life.timeSinceInput = 0; if (life.asleep || life.sleepiness > 0.05) reignite(); }
  function bumpEnergy(a) { life.energy = clamp(life.energy + a, 0, 1); }

  function spawnSparksAt(x, z, n, power, hue) {
    const [sx, sy] = project(x, petBodyY() + PET_R * 0.4, z);
    spawnSparks(sx, sy, n, power, hue);
  }

  function reignite() {
    const wasAsleep = life.asleep;
    life.asleep = false; life.sleepiness = 0; life.energy = 1; life.igniteFlash = 1;
    friends.forEach((em, i) => setTimeout(() => {
      em.flare = 1; em.vhop -= em.s * 8;
      const [sx, sy] = project(em.x, em.s, em.z); spawnSparks(sx, sy, 8, 220, 40);
    }, i * 70));
    spawnSparksAt(pet.x, pet.z, 22, 320, 42);
    if (wasAsleep) { showMessage(pick(MSG.wake), true); chime(); }
  }

  // ---------------------------------------------------------------
  //  Physics — air-hockey puck in a rectangular pit (floor plane)
  // ---------------------------------------------------------------
  const FRICTION = 0.42, HOMING = 2.4, REST = 0.62, HOME_CUT = 5;
  let settledWasMoving = false, hitStop = 0;

  function physics(dt) {
    if (pet.held) { tumble(dt); return; }

    if (pet.grounded) {
      pet.x = lerp(pet.x, 0, clamp(dt * 0.8, 0, 1));
      pet.z = lerp(pet.z, 0, clamp(dt * 0.8, 0, 1));
      pet.vx *= Math.pow(0.01, dt); pet.vz *= Math.pow(0.01, dt);
      pet.spin *= Math.pow(0.05, dt);
      pet.settledTime += dt; return;
    }

    const sp0 = Math.hypot(pet.vx, pet.vz);
    const homeScale = clamp(1 - sp0 / HOME_CUT, 0, 1);
    pet.vx += (0 - pet.x) * HOMING * homeScale * dt;
    pet.vz += (0 - pet.z) * HOMING * homeScale * dt;
    const fr = Math.pow(FRICTION, dt); pet.vx *= fr; pet.vz *= fr;
    pet.x += pet.vx * dt; pet.z += pet.vz * dt;

    // rectangular wall bounce
    let hit = 0, nx = 0, nz = 0;
    if (pet.x < -bedHX()) { pet.x = -bedHX(); if (pet.vx < 0) { pet.vx = -pet.vx * REST; nx = 1; hit = Math.abs(pet.vx); } }
    else if (pet.x > bedHX()) { pet.x = bedHX(); if (pet.vx > 0) { pet.vx = -pet.vx * REST; nx = -1; hit = Math.abs(pet.vx); } }
    if (pet.z < -bedHZ()) { pet.z = -bedHZ(); if (pet.vz < 0) { pet.vz = -pet.vz * REST; nz = 1; hit = Math.max(hit, Math.abs(pet.vz)); } }
    else if (pet.z > bedHZ()) { pet.z = bedHZ(); if (pet.vz > 0) { pet.vz = -pet.vz * REST; nz = -1; hit = Math.max(hit, Math.abs(pet.vz)); } }
    if (hit > 1.2) {
      onImpact(pet.x, pet.z, hit, false);
      kickSquash(Math.min(hit / 22, 1));
      if (hit > 9) {
        spawnSparksAt(pet.x, pet.z, Math.round(8 + Math.min(hit, 18)), hit * 16, rand(28, 46));
        tok(clamp(hit / 24, 0.25, 1)); haptic(13);
        if (Math.random() < 0.4) showMessage(pick(MSG.play));
      }
    }

    // friend-ember chain reaction
    for (let i = 0; i < friends.length; i++) {
      const em = friends[i];
      const d = Math.hypot(pet.x - em.x, pet.z - em.z);
      if (d < PET_R + em.s && Math.hypot(pet.vx, pet.vz) > 2.2 && em.flare < 0.6) {
        flareFriend(i, 1);
        const ux = (pet.x - em.x) / (d || 1), uz = (pet.z - em.z) / (d || 1);
        pet.vx += ux * 2; pet.vz += uz * 2;
        if (Math.random() < 0.35) showMessage(pick(MSG.chain));
      }
    }

    tumble(dt);

    const speed = Math.hypot(pet.vx, pet.vz);
    if (speed < 0.45) {
      pet.settledTime += dt;
      if (pet.settledTime > 0.35) {
        pet.grounded = true;
        if (settledWasMoving) { plop(); if (Math.random() < 0.5) showMessage(pick(MSG.rest)); }
        settledWasMoving = false;
      }
    } else { pet.settledTime = 0; settledWasMoving = true; }
  }

  function tumble(dt) {
    const speed = Math.hypot(pet.vx, pet.vz);
    if (speed > 0.15 && !reduceMotion) {
      const axis = norm(-pet.vz, 0, pet.vx);
      const ang = speed * dt * 1.7;
      pet.R = mul3(rotAxis(axis, ang), pet.R);
    }
    pet.vhop += (-90 * pet.hop - 12 * pet.vhop) * dt;
    pet.hop += pet.vhop * dt;
  }

  function onImpact(x, z, speed, hot) {
    const p = clamp(speed / 22, 0.1, 1.4);
    spawnSparksAt(x, z, Math.round(6 + p * 14), speed * 14, hot ? rand(36, 48) : undefined);
    spawnAsh(...project(x, petBodyY(), z), Math.round(3 + p * 6), speed * 4 + 40);
    bumpEnergy(0.18 + p * 0.2);
    blip(p, hot);
    haptic(Math.round(clamp(4 + speed * 1.2, 4, 16)));
    if (!reduceMotion) hitStop = Math.max(hitStop, clamp(speed / 80, 0, 0.06));
    registerInput();
    for (let i = 0; i < friends.length; i++) {
      const em = friends[i];
      if (Math.hypot(x - em.x, z - em.z) < em.s + PET_R * 0.6) flareFriend(i, 0.7);
    }
    if (speed > 16 && Math.random() < 0.4) showMessage(pick(MSG.play));
  }

  function flareFriend(i, amount) {
    const em = friends[i];
    em.flare = Math.max(em.flare, amount);
    const [sx, sy] = project(em.x, em.s, em.z); spawnSparks(sx, sy, 6, 200, 40);
    blip(0.4, true);
    em.vhop -= em.s * (amount >= 0.9 ? 9 : 5);
    if (amount >= 1 && Math.random() < 0.2) em.vhop -= em.s * 10;
    for (let j = 0; j < friends.length; j++) {
      if (j === i) continue; const o = friends[j];
      if (Math.hypot(o.x - em.x, o.z - em.z) < em.s * 6) {
        setTimeout(() => { o.flare = Math.max(o.flare, amount * 0.55); o.vhop -= o.s * 4; }, 90 + Math.random() * 120);
      }
    }
  }

  function plop() {
    pet.sqvY -= 5; pet.sqvXZ += 3;
    spawnAsh(...project(pet.x, petBodyY() * 0.4, pet.z), 5, 70);
    blip(0.16, false); haptic(6);
  }
  function kickSquash(strength) {
    if (strength <= 0) return; const k = 6 * strength;
    pet.sqvY -= k; pet.sqvXZ += k * 0.6;
  }
  function updateSquash(dt) {
    const stiff = 220, damp = 14;
    pet.sqvXZ += (-stiff * (pet.sqXZ - 1) - damp * pet.sqvXZ) * dt;
    pet.sqvY += (-stiff * (pet.sqY - 1) - damp * pet.sqvY) * dt;
    pet.sqXZ += pet.sqvXZ * dt; pet.sqY += pet.sqvY * dt;
    pet.sqXZ = clamp(pet.sqXZ, 0.7, 1.3); pet.sqY = clamp(pet.sqY, 0.7, 1.3);
  }

  // ---------------------------------------------------------------
  //  Update
  // ---------------------------------------------------------------
  let last = performance.now();
  let ambientTimer = 0, time = 0, popTimer = 2.5, audioTimer = 0, raf = 0;

  function update(dt) {
    if (!pet.held) life.timeSinceInput += dt;
    const speed = Math.hypot(pet.vx, pet.vz);
    const wasAsleep = life.asleep;
    if (!life.asleep && life.timeSinceInput > SLEEP_DELAY && speed < 0.5 && !pet.held) {
      life.sleepiness = clamp(life.sleepiness + dt / SLEEP_FADE, 0, 1);
      if (life.sleepiness >= 1) life.asleep = true;
    } else if (pet.held || life.timeSinceInput < SLEEP_DELAY) {
      life.sleepiness = clamp(life.sleepiness - dt * 2, 0, 1);
    }
    if (!wasAsleep && life.asleep) showMessage(pick(MSG.sleepy), true);

    const baseline = life.asleep ? 0.14 : lerp(0.72, 0.4, life.sleepiness);
    life.energy = lerp(life.energy, baseline, clamp(dt * 0.4, 0, 1));
    life.igniteFlash = Math.max(0, life.igniteFlash - dt * 1.6);

    physics(dt);
    updateSquash(dt);

    if (!reduceMotion && pet.grounded && !pet.held && !life.asleep && Math.random() < dt * 0.14) {
      const a = rand(0, TAU); pet.vx += Math.cos(a) * rand(1.2, 2.6); pet.vz += Math.sin(a) * rand(1.2, 2.6);
      pet.grounded = false;
    }

    pet.blink = Math.max(0, pet.blink - dt * 7);
    if (!life.asleep && pet.grounded && !pet.held) {
      pet.blinkT -= dt; if (pet.blinkT <= 0) { pet.blink = 1; pet.blinkT = rand(2.8, 7); }
    }

    for (const em of friends) {
      em.flare = Math.max(0, em.flare - dt * 1.4); em.phase += dt * 1.5;
      em.vhop += (-90 * em.hop - 11 * em.vhop) * dt; em.hop += em.vhop * dt;
      if (em.hop < 0) { em.hop = 0; if (em.vhop < 0) em.vhop = 0; }
    }
    if (pet.hop < 0) { pet.hop = 0; if (pet.vhop < 0) pet.vhop = 0; }

    // trail
    if (!reduceMotion && !pet.held && speed > 7) {
      const ps = petScreen();
      trail.push({ x: ps[0], y: ps[1], r: PET_R * proj.S, life: 0.3, max: 0.3 });
      if (trail.length > 16) trail.shift();
    }
    for (let i = trail.length - 1; i >= 0; i--) { trail[i].life -= dt; if (trail[i].life <= 0) trail.splice(i, 1); }

    // floating ember motes
    for (const m of motes) {
      m.y += m.vy * dt; m.x += Math.sin(time * 0.6 + m.phase) * 0.12 * dt; m.phase += dt;
      if (m.y > WALL_TOP + 0.4) Object.assign(m, newMote(0.3));
    }

    audioTimer -= dt; if (audioTimer <= 0) { updateHum(); audioTimer = 0.4; }
    popTimer -= dt;
    if (popTimer <= 0) { popTimer = rand(1.4, 3.8); if (audio.started && !audio.muted && !life.asleep && Math.random() < 0.6) blip(rand(0.05, 0.16), Math.random() < 0.5); }

    stepParticles(sparks, dt, true); stepParticles(ash, dt, false); stepAmbient(dt);
    ambientTimer -= dt; if (ambientTimer <= 0) { spawnAmbient(); ambientTimer = rand(0.25, 0.7); }
    if (msgCooldown > 0) msgCooldown -= dt;
  }

  function stepParticles(arr, dt, isSpark) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i]; p.life -= dt;
      if (p.life <= 0) { arr.splice(i, 1); continue; }
      if (isSpark) { p.vy += 240 * dt; p.vx *= Math.pow(0.5, dt); }
      else { p.vy -= 60 * dt; p.vx *= Math.pow(0.2, dt); p.r += 8 * dt; }
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  function stepAmbient(dt) {
    for (let i = ambient.length - 1; i >= 0; i--) {
      const p = ambient[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx += Math.sin(p.life * 3) * 6 * dt;
      if (p.life <= 0 || p.y < p.top) ambient.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------
  //  Rendering
  // ---------------------------------------------------------------
  function glowDot(x, y, r, color, blur) {
    ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = blur || r * 4;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.restore();
  }

  // Draw a placed mesh live (pet / friends), shaded & depth-sorted.
  function drawMesh(mesh, ox, oy, oz, R, sxz, syy, base, em, fireScale) {
    const recs = [];
    let cwx = 0, cwy = 0, cwz = 0;
    const W3 = mesh.verts.map((v) => {
      const rv = R ? apply3(R, v) : v;
      const p = { x: rv.x * sxz + ox, y: rv.y * syy + oy, z: rv.z * sxz + oz };
      cwx += p.x; cwy += p.y; cwz += p.z; return p;
    });
    cwx /= W3.length; cwy /= W3.length; cwz /= W3.length;
    for (const tri of mesh.tris) {
      const a = W3[tri[0]], b = W3[tri[1]], c = W3[tri[2]];
      let nx = (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y);
      let ny = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      let nz = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const mx = (a.x + b.x + c.x) / 3, my = (a.y + b.y + c.y) / 3, mz = (a.z + b.z + c.z) / 3;
      if ((mx - cwx) * nx + (my - cwy) * ny + (mz - cwz) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      recs.push({ pts: [project(a.x, a.y, a.z), project(b.x, b.y, b.z), project(c.x, c.y, c.z)],
        color: shade(nx, ny, nz, mx, my, mz, base, em, fireScale), depth: depthOf(mx, my, mz) });
    }
    recs.sort((a, b) => a.depth - b.depth);
    for (const r of recs) fillTri(r.pts[0], r.pts[1], r.pts[2], r.color);
  }

  function draw() {
    const warm = (0.5 + life.energy * 0.5) * fireFlicker() + life.igniteFlash * 0.4;

    // 1) static scene (black bg + walls + floor + coal bed)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bgCanvas, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    // 2) warm firelight pool flickering on the bed
    drawFirePool(warm);

    // 3) floating ember motes against the wall
    drawMotes(warm);

    // 4) friend embers
    drawFriends(warm);

    // 5) the pet (with its little contact glow + trail)
    drawTrail();
    drawPetGlow(warm);
    drawPet(warm);

    // 6) coal rocks that sit in front of the pet → he's nestled in the bed
    drawForegroundCoals();

    // 7) near rim (chunky stones) over everyone
    paintInto(ctx, rimFrontRecs);

    // 8) particles
    drawParticles();
    drawAmbient();

    // 9) filmic bloom, then the first-run hint
    applyBloom();
    drawHint();
  }

  function drawFirePool(warm) {
    const [sx, sy] = project(0, 0.1, 0.2);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const r = proj.S * 4.6;
    const g = ctx.createRadialGradient(sx, sy, proj.S * 0.3, sx, sy, r);
    g.addColorStop(0, `rgba(255,140,60,${0.26 * warm})`);
    g.addColorStop(0.5, `rgba(255,110,40,${0.12 * warm})`);
    g.addColorStop(1, "rgba(255,110,40,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy, r, r * 0.62, 0, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawMotes(warm) {
    ctx.save();
    for (const m of motes) {
      const [sx, sy] = project(m.x, m.y, m.z);
      const fl = 0.65 + 0.35 * Math.sin(time * 5 + m.phase);
      const a = clamp(1 - m.y / (WALL_TOP + 0.5), 0.1, 1);
      ctx.globalCompositeOperation = "lighter";
      glowDot(sx, sy, m.r * 0.7, `rgba(255,${(160 + fl * 70) | 0},70,${0.8 * a * fl * warm})`, m.r * 5);
      // a little glowing ember cube (diamond), like the concept's floaters
      ctx.globalCompositeOperation = "source-over";
      const s = m.r * 0.62 * (0.85 + fl * 0.2);
      ctx.translate(sx, sy); ctx.rotate(0.5);
      ctx.fillStyle = `rgba(255,${(190 + fl * 50) | 0},110,${a})`;
      ctx.fillRect(-s, -s, s * 2, s * 2);
      ctx.fillStyle = `rgba(255,150,70,${a})`;
      ctx.fillRect(-s, 0, s * 2, s);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    ctx.restore();
  }

  function drawFriends(warm) {
    for (const em of friends) {
      const lvl = clamp(0.5 + 0.2 * Math.sin(em.phase) + em.flare, 0, 1.6);
      const [sx, sy] = project(em.x, em.s + em.hop, em.z);
      glowDot(sx, sy, em.s * proj.S * 0.7, `rgba(255,140,50,${0.5 * lvl * warm})`, em.s * proj.S * (2.4 + em.flare * 2));
      const glow = 0.7 + em.flare;
      drawMesh(em.mesh, em.x, em.s + em.hop, em.z, null, 1, 1,
        [120, 44, 20], [90 * glow + em.flare * 80, 44 * glow, 14 * glow], 1.1);
    }
  }

  function drawPetGlow(warm) {
    const [sx, sy] = project(pet.x, 0.05, pet.z);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const heat = clamp(life.energy * warm + life.igniteFlash * 0.5, 0, 1.4);
    glowDot(sx, sy, PET_R * proj.S * 1.1, `rgba(255,130,50,${0.4 * heat})`, PET_R * proj.S * 3);
    ctx.restore();
    // soft contact shadow
    ctx.save();
    ctx.beginPath(); ctx.ellipse(sx, sy + 2, PET_R * proj.S * 0.9, PET_R * proj.S * 0.34, 0, 0, TAU);
    ctx.fillStyle = "rgba(0,0,0,0.30)"; ctx.fill(); ctx.restore();
  }

  function drawPet(warm) {
    const bs = (reduceMotion || pet.held || !pet.grounded) ? 0
      : Math.sin(time * (life.asleep ? 1.0 : 1.5)) * (life.asleep ? 0.03 : 0.015);
    const sxz = pet.sqXZ * (1 - bs * 0.5), syy = pet.sqY * (1 + bs);
    const oy = petBodyY() + pet.hop;
    drawMesh(pet.mesh, pet.x, oy, pet.z, pet.R, sxz, syy, [40, 35, 38], [10, 7, 7], 1);
    drawFace(warm);
  }

  // Always-facing cute face, billboarded onto the pet in screen space.
  function drawFace(warm) {
    const speed = Math.hypot(pet.vx, pet.vz);
    const laughing = (speed > 3.2 || (pet.held && pointer.moved > 12)) && !life.asleep;
    const [sx, sy0] = project(pet.x, petBodyY() + pet.hop, pet.z);
    const R = PET_R * proj.S * pet.sqXZ;
    const sy = sy0 - R * 0.08;
    const eyeX = R * 0.36, eyeY = -R * 0.04, eyeR = R * 0.2;
    const lvl = lerp(1, 0.45, life.sleepiness);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    const sleepy = life.asleep || life.sleepiness > 0.5;
    if (sleepy) {
      strokeArc(-eyeX, eyeY, eyeR, 0.1, 0.9, R * 0.07, `rgba(245,232,218,${lvl})`);
      strokeArc(eyeX, eyeY, eyeR, 0.1, 0.9, R * 0.07, `rgba(245,232,218,${lvl})`);
      strokeArc(0, R * 0.32, R * 0.13, 0.15, 0.85, R * 0.06, `rgba(245,232,218,${lvl})`);
    } else if (laughing || pet.blink > 0.4) {
      // happy squeezed eyes ^ ^ (light so they pop on the dark body)
      caret(-eyeX, eyeY, eyeR * 0.95, R * 0.085);
      caret(eyeX, eyeY, eyeR * 0.95, R * 0.085);
      if (laughing) {
        // open laughing mouth
        ctx.beginPath();
        ctx.moveTo(-R * 0.22, R * 0.26); ctx.lineTo(R * 0.22, R * 0.26);
        ctx.arc(0, R * 0.26, R * 0.22, 0, Math.PI, false); ctx.closePath();
        ctx.fillStyle = "rgba(140,30,20,0.95)"; ctx.fill();
        ctx.lineWidth = R * 0.06; ctx.strokeStyle = "rgba(255,236,205,0.98)"; ctx.stroke();
      } else {
        smile(R, lvl);
      }
    } else {
      // glossy round eyes with sparkle
      eye(-eyeX, eyeY, eyeR, lvl);
      eye(eyeX, eyeY, eyeR, lvl);
      smile(R, lvl);
    }
    ctx.restore();

    // sleepy z z z
    if (sleepy) drawZ(sx + R * 0.8, sy - R * 0.9, life.sleepiness);
  }

  function eye(x, y, r, lvl) {
    ctx.beginPath(); ctx.ellipse(x, y, r * 0.82, r, 0, 0, TAU);
    ctx.fillStyle = `rgba(248,240,235,${lvl})`; ctx.fill();
    ctx.beginPath(); ctx.ellipse(x + r * 0.12, y + r * 0.16, r * 0.42, r * 0.5, 0, 0, TAU);
    ctx.fillStyle = `rgba(30,18,20,${lvl})`; ctx.fill();
    ctx.beginPath(); ctx.arc(x - r * 0.18, y - r * 0.28, r * 0.22, 0, TAU);
    ctx.fillStyle = `rgba(255,255,255,${lvl})`; ctx.fill();
  }
  function smile(R, lvl) {
    ctx.beginPath();
    ctx.moveTo(-R * 0.2, R * 0.26);
    ctx.quadraticCurveTo(0, R * 0.48, R * 0.2, R * 0.26);
    ctx.lineWidth = R * 0.08; ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(245,232,218,${0.92 * lvl})`; ctx.stroke();
  }
  function caret(x, y, r, w) {
    ctx.beginPath();
    ctx.moveTo(x - r, y + r * 0.45); ctx.lineTo(x, y - r * 0.45); ctx.lineTo(x + r, y + r * 0.45);
    ctx.lineWidth = w; ctx.lineCap = "round"; ctx.strokeStyle = "rgba(248,238,228,0.96)"; ctx.stroke();
  }
  function strokeArc(x, y, r, s, e, w, color) {
    ctx.beginPath(); ctx.arc(x, y, r, Math.PI * s, Math.PI * e, false);
    ctx.lineWidth = w; ctx.strokeStyle = color; ctx.stroke();
  }
  function drawZ(x, y, amount) {
    amount = clamp(amount, 0, 1); if (amount <= 0.01) return;
    ctx.save(); ctx.fillStyle = "rgba(255,240,218,1)"; ctx.textAlign = "center";
    ctx.shadowColor = "rgba(255,180,90,0.6)"; ctx.shadowBlur = 7;
    const t = time * 0.45, u = PET_R * proj.S;
    for (let i = 0; i < 3; i++) {
      const ph = ((t + i * 0.5) % 1.5) / 1.5, a = Math.sin(ph * Math.PI);
      ctx.globalAlpha = amount * 0.75 * a;
      ctx.font = `700 ${Math.round(u * (0.34 + i * 0.2))}px "Quicksand", system-ui, sans-serif`;
      ctx.fillText("z", x + i * u * 0.26 + ph * u * 0.12, y - ph * u * 1.1 - i * u * 0.18);
    }
    ctx.restore();
  }

  // Re-draw only the coals that sit in front of *and below* the pet, so a
  // few rocks nestle his base while his face stays clear.
  function drawForegroundCoals() {
    const petD = depthOf(pet.x, petBodyY() + pet.hop, pet.z);
    const petCY = petBodyY() + pet.hop;
    const ps = petScreen();
    const near = PET_R * proj.S * 1.7;
    for (const r of coalRecs) {
      if (r.depth <= petD || r.wy > petCY - 0.05) continue;
      if (Math.abs(r.pts[0][0] - ps[0]) > near && Math.abs(r.pts[1][0] - ps[0]) > near) continue;
      fillTri(r.pts[0], r.pts[1], r.pts[2], r.color);
    }
  }

  function drawTrail() {
    if (!trail.length) return;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const t of trail) {
      const a = t.life / t.max;
      glowDot(t.x, t.y, t.r * 0.6 * a, `rgba(255,140,55,${0.14 * a})`, t.r * 1.4);
    }
    ctx.restore();
  }

  function drawParticles() {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
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
  function drawAmbient() {
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    for (const p of ambient) {
      const a = p.life / p.max, fl = 0.6 + 0.4 * Math.sin(p.life * 18);
      glowDot(p.x, p.y, p.r, `rgba(255,${(170 + (1 - a) * 60) | 0},80,${a * 0.8 * fl})`, p.r * 6);
    }
    ctx.restore();
  }

  function applyBloom() {
    if (!bloomOK) return;
    try {
      const bw = bloomCanvas.width, bh = bloomCanvas.height;
      bloomCtx.setTransform(1, 0, 0, 1, 0, 0); bloomCtx.globalCompositeOperation = "source-over";
      bloomCtx.clearRect(0, 0, bw, bh);
      bloomCtx.filter = "blur(" + Math.max(1, bw * 0.012).toFixed(2) + "px)";
      bloomCtx.drawImage(canvas, 0, 0, bw, bh); bloomCtx.filter = "none";
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.26; ctx.imageSmoothingEnabled = true;
      ctx.drawImage(bloomCanvas, 0, 0, bw, bh, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    } catch (e) { bloomOK = false; }
  }

  function drawHint() {
    if (!hintActive) return;
    const ps = petScreen(); const r = PET_R * proj.S;
    const cyc = (time % 2.6) / 2.6, ease = cyc < 0.5 ? cyc * 2 : 1 - (cyc - 0.5) * 2, fade = Math.sin(cyc * Math.PI);
    const hx = ps[0] - r * 1.6 * ease, hy = ps[1] - r * 0.3 - r * 1.0 * ease;
    ctx.save(); ctx.globalAlpha = 0.55 * fade;
    glowDot(hx, hy, r * 0.16, "rgba(255,240,220,0.95)", r * 0.8);
    ctx.beginPath(); ctx.arc(hx, hy, r * 0.16 + (1 - fade) * r * 0.5, 0, TAU);
    ctx.strokeStyle = "rgba(255,240,220,0.5)"; ctx.lineWidth = Math.max(1.5, r * 0.03); ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------
  //  Main loop
  // ---------------------------------------------------------------
  function frame(now) {
    let dt = (now - last) / 1000; last = now;
    if (dt > 0.05) dt = 0.05;
    if (hitStop > 0) { hitStop -= dt; time += dt * 0.12; draw(); raf = requestAnimationFrame(frame); return; }
    time += dt; update(dt); draw(); raf = requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------
  //  Boot
  // ---------------------------------------------------------------
  window.addEventListener("resize", resize);

  function rememberVisit() { store.set("lastVisit", Date.now()); }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { rememberVisit(); if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    else if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
  });
  window.addEventListener("pagehide", rememberVisit);

  if (store.get("muted") === "1") { audio.muted = true; muteBtn.classList.add("muted"); }

  buildPet();
  resize();
  seedMotes();

  const hintSeen = store.get("hintSeen") === "1";
  const lastVisit = parseInt(store.get("lastVisit", "0"), 10) || 0;
  const away = lastVisit ? Date.now() - lastVisit : 0;
  setTimeout(() => {
    if (!hintSeen) { showMessage("drag and flick your little coal", true); hintActive = true; }
    else if (away > 45000) { showMessage(pick(MSG.wake), true); }
    else { showMessage(pick(MSG.rest), true); }
  }, 900);

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => {}); });
  }

  raf = requestAnimationFrame(frame);
})();
