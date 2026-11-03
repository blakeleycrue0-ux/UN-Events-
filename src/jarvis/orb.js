// The living orb: a glowing network sphere (nodes joined by lines) on a canvas.
// It never stops moving: idle it breathes and ripples; listening it opens and
// shimmers with your voice; thinking it spins fast inside orbit rings;
// speaking it swells and pulses with every word; a flash or a double clap
// makes it burst outwards and snap back.
const PALETTE = {
  off: [110, 140, 170], idle: [80, 210, 255], listening: [70, 255, 200], thinking: [170, 130, 255],
  speaking: [120, 235, 255], blocked: [255, 170, 80], alert: [255, 70, 90], arrival: [90, 255, 170],
};
const MOTION = {   // spin (rad/s), ripple size, ripple speed
  off: [0.12, 0.03, 0.6], idle: [0.45, 0.07, 1.1], listening: [0.9, 0.12, 2.2],
  thinking: [2.4, 0.14, 3.2], speaking: [1.1, 0.16, 2.8], blocked: [0.3, 0.05, 1],
};

export function createOrb(canvas, { count = 340, links = 3 } = {}) {
  const ctx = canvas.getContext("2d");
  // Nodes evenly spread on a sphere (Fibonacci), each with its own ripple phase.
  const pts = [];
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963229728653;
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, a: Math.random() * 6.28, b: Math.random() * 6.28, f: 0.6 + Math.random() * 0.9, sx: 0, sy: 0, sz: 0 });
  }
  // Lines between each node and its nearest neighbours (computed once).
  const edges = [], seen = new Set();
  for (let i = 0; i < count; i++) {
    const near = [];
    for (let j = 0; j < count; j++) {
      if (i === j) continue;
      const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2 + (pts[i].z - pts[j].z) ** 2;
      near.push([d, j]);
    }
    near.sort((p, q) => p[0] - q[0]);
    for (const [, j] of near.slice(0, links)) {
      const key = i < j ? i + ":" + j : j + ":" + i;
      if (!seen.has(key)) { seen.add(key); edges.push([i, j]); }
    }
  }
  // A few long "synapse" lines across the sphere, for the tangled look.
  for (let k = 0; k < count / 6; k++) edges.push([Math.floor(Math.random() * count), Math.floor(Math.random() * count)]);

  let state = "off", color = [...PALETTE.off], spinY = 0, spinX = 0, level = 0, flashUntil = 0, flashColor = null, raf = 0, last = performance.now();
  let burst = 0, motion = [...MOTION.off];
  const orb = { levelSource: () => 0 };
  orb.setState = (s) => { state = s; };
  orb.flash = (kind) => { flashColor = PALETTE[kind] || PALETTE.alert; flashUntil = performance.now() + 1600; burst = Math.max(burst, 0.55); };
  orb.burst = () => { burst = 1; };
  function size() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    return { w: canvas.width, h: canvas.height };
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const t = now / 1000;
    const { w, h } = size(), cx = w / 2, cy = h / 2, base = Math.min(w, h) * 0.25;
    const target = now < flashUntil ? flashColor : PALETTE[state] || PALETTE.idle;
    color = color.map((c, i) => c + (target[i] - c) * Math.min(1, dt * 5));
    const want = Math.max(orb.levelSource() || 0, state === "thinking" ? 0.3 : 0);
    level += (want - level) * Math.min(1, dt * 14);
    const goal = MOTION[state] || MOTION.idle;
    motion = motion.map((m, i) => m + (goal[i] - m) * Math.min(1, dt * 3));
    burst = Math.max(0, burst - dt * 1.4);
    const [spin, ripple, rippleSpeed] = motion;
    spinY += dt * (spin + level * 2.2);
    spinX += dt * (spin * 0.35 + level * 0.6);
    const breathe = 1 + Math.sin(t * 1.7) * 0.03 + Math.sin(t * 0.63) * 0.02;
    const blast = Math.sin(Math.min(1, 1 - burst) * Math.PI) * burst;   // out, then snap back
    const R = base * breathe * (1 + level * 0.32 + blast * 0.45);
    const amp = ripple + level * 0.26;

    ctx.clearRect(0, 0, w, h);
    const [r, g, b] = color.map(Math.round);
    // Halo, kept inside the canvas so there's never a square edge.
    const halo = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, Math.min(R * 2, Math.min(w, h) * 0.49));
    halo.addColorStop(0, `rgba(${r},${g},${b},${0.22 + level * 0.25 + burst * 0.2})`);
    halo.addColorStop(0.45, `rgba(${r},${g},${b},${0.06 + level * 0.08})`);
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);

    // Move every node: rotate on two axes, ripple in and out like it's alive.
    const cy1 = Math.cos(spinY), sy1 = Math.sin(spinY), cx1 = Math.cos(spinX * 0.7 + 0.35), sx1 = Math.sin(spinX * 0.7 + 0.35);
    for (const p of pts) {
      const wave = 1 + amp * Math.sin(t * rippleSpeed * p.f + p.a) * Math.cos(t * rippleSpeed * 0.7 + p.b + p.y * 3)
        + burst * 0.5 * Math.sin(p.a * 3) + 0.04 * Math.sin(t * 9 + p.b) * level;
      let x = p.x * cy1 - p.z * sy1, z = p.x * sy1 + p.z * cy1, y = p.y;
      const y2 = y * cx1 - z * sx1; z = y * sx1 + z * cx1; y = y2;
      const persp = 2 / (2.7 - z);
      p.sx = cx + x * R * wave * persp; p.sy = cy + y * R * wave * persp; p.sz = z;
    }
    ctx.globalCompositeOperation = "lighter";
    // Lines, in three depth layers (back faint, front bright).
    const lw = Math.max(0.6, w / 1100);
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      for (const [i, j] of edges) {
        const z = (pts[i].sz + pts[j].sz) / 2, l = z < -0.33 ? 0 : z < 0.33 ? 1 : 2;
        if (l !== layer) continue;
        ctx.moveTo(pts[i].sx, pts[i].sy); ctx.lineTo(pts[j].sx, pts[j].sy);
      }
      ctx.strokeStyle = `rgba(${r},${g},${b},${[0.08, 0.2, 0.42][layer] * (0.75 + level * 0.9 + burst)})`;
      ctx.lineWidth = lw * (layer + 1) * 0.7;
      ctx.stroke();
    }
    // Nodes: front ones bigger and brighter; a few sparkle.
    const dot = Math.max(1.2, w / 420);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], depth = (p.sz + 1) / 2;
      const sparkle = Math.sin(t * 6 + i * 1.7) > 0.985 ? 1 : 0;
      const a = 0.15 + depth * 0.7 + sparkle * 0.5;
      const s = dot * (0.5 + depth * 1.1 + sparkle * 1.5 + level * 0.6);
      ctx.fillStyle = sparkle ? `rgba(255,255,255,${a})` : `rgba(${r},${g},${b},${a})`;
      ctx.fillRect(p.sx - s / 2, p.sy - s / 2, s, s);
    }
    // Orbit rings while thinking, or on events.
    if (state === "thinking" || now < flashUntil) {
      ctx.lineWidth = lw * 1.2;
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.4 - k * 0.1})`;
        ctx.beginPath(); ctx.ellipse(cx, cy, R * (1.25 + k * 0.13), R * (0.3 + k * 0.09), spinY * (k % 2 ? -1.5 : 1.2) + k, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // Bright core.
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
    core.addColorStop(0, `rgba(255,255,255,${0.35 + level * 0.45 + burst * 0.4})`);
    core.addColorStop(0.25, `rgba(${r},${g},${b},${0.25 + level * 0.3})`);
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, R * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
  }
  raf = requestAnimationFrame(frame);
  orb.stop = () => cancelAnimationFrame(raf);
  return orb;
}
