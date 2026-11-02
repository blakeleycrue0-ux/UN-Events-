// The living orb: ~900 particles on a 3D sphere drawn on a canvas.
// idle: slow breathing · listening: cyan, opens with your voice · thinking:
// fast orbit rings · speaking: pulses with every word · alert: red flash.
const PALETTE = {
  off: [120, 130, 150], idle: [140, 190, 255], listening: [60, 230, 255], thinking: [170, 140, 255],
  speaking: [120, 210, 255], blocked: [255, 170, 80], alert: [255, 80, 90], arrival: [90, 255, 170], gesture: [255, 220, 120],
};
export function createOrb(canvas, { count = 900 } = {}) {
  const ctx = canvas.getContext("2d");
  const pts = [];
  for (let i = 0; i < count; i++) { // Fibonacci sphere: evenly spread points
    const y = 1 - (i / (count - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963229728653;
    pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, seed: Math.random() * 6.28 });
  }
  let state = "off", color = [...PALETTE.off], spin = 0, level = 0, flashUntil = 0, flashColor = null, raf = 0, last = performance.now();
  const orb = { levelSource: () => 0 };
  orb.setState = (s) => { state = s; };
  orb.flash = (kind) => { flashColor = PALETTE[kind] || PALETTE.alert; flashUntil = performance.now() + 1600; };
  function size() {
    const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(r.width * dpr)) { canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr); }
    return { w: canvas.width, h: canvas.height };
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const { w, h } = size(), cx = w / 2, cy = h / 2, base = Math.min(w, h) * 0.33;
    const target = now < flashUntil ? flashColor : PALETTE[state] || PALETTE.idle;
    color = color.map((c, i) => c + (target[i] - c) * Math.min(1, dt * 4));
    const want = Math.max(orb.levelSource() || 0, state === "thinking" ? 0.25 : 0);
    level += (want - level) * Math.min(1, dt * 10);
    spin += dt * (state === "thinking" ? 1.6 : state === "speaking" ? 0.7 : state === "listening" ? 0.5 : 0.18);
    const breathe = state === "off" ? 0.9 : 1 + Math.sin(now / 1400) * 0.025;
    const R = base * breathe * (1 + level * 0.28);
    ctx.clearRect(0, 0, w, h);
    // Soft halo
    const [r, g, b] = color.map(Math.round);
    const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
    halo.addColorStop(0, `rgba(${r},${g},${b},${0.16 + level * 0.18})`); halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    // Orbit rings while thinking or on events
    if (state === "thinking" || now < flashUntil) {
      ctx.lineWidth = Math.max(1, w / 900);
      for (let k = 0; k < 3; k++) {
        ctx.strokeStyle = `rgba(${r},${g},${b},${0.35 - k * 0.09})`;
        ctx.beginPath(); ctx.ellipse(cx, cy, R * (1.18 + k * 0.12), R * (0.32 + k * 0.08), spin * (k % 2 ? -1.3 : 1) + k, 0, Math.PI * 2); ctx.stroke();
      }
    }
    const cs = Math.cos(spin), sn = Math.sin(spin), tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
    const dot = Math.max(1, w / 520);
    for (const p of pts) {
      // rotate around Y then tilt around X
      let x = p.x * cs - p.z * sn, z = p.x * sn + p.z * cs, y = p.y;
      const y2 = y * ct - z * st; z = y * st + z * ct; y = y2;
      const wobble = 1 + Math.sin(now / 380 + p.seed) * 0.04 * (0.4 + level * 2.2);
      const persp = 1.9 / (2.6 - z);
      const px = cx + x * R * wobble * persp, py = cy + y * R * wobble * persp;
      const a = 0.18 + (z + 1) * 0.38;
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      const s = dot * (0.6 + (z + 1) * 0.55);
      ctx.fillRect(px - s / 2, py - s / 2, s, s);
    }
    // Core
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
    core.addColorStop(0, `rgba(255,255,255,${0.18 + level * 0.3})`); core.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = core; ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2); ctx.fill();
  }
  raf = requestAnimationFrame(frame);
  orb.stop = () => cancelAnimationFrame(raf);
  return orb;
}
