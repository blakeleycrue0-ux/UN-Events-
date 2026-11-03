// Jarvis · Pared: the phone on the wall. It never talks: it watches the door,
// recognises who comes in and tells the desk (Chromebook), which does the talking.
import { $, store, loadSettings, loadScript, call, clockParts, connectHome } from "./jarvis/common.js";
import { createWallEars } from "./jarvis/wallears.js";

const settings = loadSettings();
const wall = window.wall = {
  started: false, stream: null, detector: null, busy: false, enrolling: null, loop: null,
  threshold: 0.55, absenceMS: 90000, seen: {}, lastUnknown: 0, sent: [], settings,
};
store.set("jarvis-role", "wall");

// ---------- Pantalla ----------
function tick() {
  const { time, date } = clockParts("es");
  $("clock").textContent = time; $("date").textContent = date;
  // Drift a few pixels every minute so a 24/7 screen never burns in.
  const m = new Date().getMinutes();
  $("wallFace").style.transform = `translate(${(m % 7) * 6 - 18}px, ${(m % 5) * 8 - 16}px)`;
}
tick(); setInterval(tick, 1000);
function status(text) { $("wallState").textContent = text; }

// ---------- Avisos al escritorio ----------
async function tell(kind, extra = {}) {
  if (!settings.key) { status("Falta la clave de Jarvis (toca la pantalla)"); return false; }
  try {
    const response = await call("jarvis-event", { kind, ...extra }, settings.key);
    wall.sent.push({ kind, ...extra, ok: response.ok });
    $("linkDot").classList.toggle("on", response.ok);
    if (!response.ok) status(response.status === 401 ? "La clave de Jarvis no coincide" : "No llego al escritorio");
    return response.ok;
  } catch {
    $("linkDot").classList.remove("on"); status("Sin conexión"); return false;
  }
}
setInterval(() => { if (wall.started) void tell("status", { camera: true }); }, 120000);

// ---------- Caras ----------
async function realDetector() {
  if (!window.Human) await loadScript("vendor/human.js");
  const human = new Human.Human({
    backend: "webgl", modelBasePath: new URL("models/", location.href).href,
    cacheModels: false, debug: false, async: false, warmup: "none",
    filter: { enabled: false, return: false },
    face: {
      enabled: true,
      // skipFrames/skipTime 0: Human otherwise reuses old results for 2–3 s.
      detector: { rotation: false, maxDetected: 3, minConfidence: 0.5, return: false, skipFrames: 0, skipTime: 0 },
      mesh: { enabled: true, skipFrames: 0, skipTime: 0 }, iris: { enabled: false }, description: { enabled: true, skipFrames: 0, skipTime: 0 },
      emotion: { enabled: false }, antispoof: { enabled: false }, liveness: { enabled: false }, attention: { enabled: false },
    },
    body: { enabled: false }, hand: { enabled: false }, object: { enabled: false },
    gesture: { enabled: false }, segmentation: { enabled: false },
  });
  await human.load();
  const stats = human.models.stats();
  const missing = ["blazeface", "facemesh", "faceres"].filter((n) => {
    const m = stats.modelStats.find((s) => s.name === n);
    return !m?.loaded || m.sizeLoadedWeights <= 0;
  });
  if (missing.length) { human.reset(); throw Error("No se cargaron los modelos de caras (" + missing.join(", ") + ")."); }
  return {
    async detect(input) {
      const result = await human.detect(input);
      const issue = result?.error;
      if (!result || (issue && (!Array.isArray(issue) || issue.length))) throw Error("Fallo del modelo de caras.");
      return (result.face || []).filter((f) => f.embedding?.length)
        .map((f) => ({ embedding: Array.from(f.embedding), score: f.faceScore ?? f.score ?? 0, box: f.boxRaw ? Array.from(f.boxRaw) : null }));
    },
    similarity: (a, b) => human.match.similarity(a, b),
  };
}
wall.createDetector = realDetector;

const ROLES = { me: "Tú", mom: "Mamá", dad: "Papá", other: "Otra persona" };
function loadPeople() {
  const saved = store.get("jarvis-people", null);
  if (Array.isArray(saved)) return saved;
  const legacy = store.get("jarvis-faces", []); // very first version: one face
  return legacy.length ? [{ id: "me", role: "me", name: settings.name, greeting: "", samples: legacy }] : [];
}
wall.people = loadPeople();
const savePeople = () => store.set("jarvis-people", wall.people);
const displayName = (p) => (p.role === "me" ? settings.name : p.name);
// Best person for a face, only when clearly ahead of everyone else (family looks alike).
function identify(embedding) {
  const scores = wall.people.filter((p) => p.samples?.length).map((p) => ({
    person: p, score: Math.max(...p.samples.map((known) => wall.detector.similarity(embedding, known))),
  })).sort((a, b) => b.score - a.score);
  const [best, second] = scores;
  if (!best || best.score < wall.threshold || (second && best.score - second.score < 0.03)) return { score: best?.score || 0 };
  return best;
}
wall.identify = identify;

// ---------- Cámara y encuadre ----------
async function startCamera() {
  wall.stream?.getTracks().forEach((t) => t.stop());
  // Up to 4K: the door crop needs the pixels for faces ~5 m away. The camera
  // (front/back) is required, not just preferred, or iPhone keeps the old one.
  const size = { width: { ideal: 3840 }, height: { ideal: 2160 } };
  try { wall.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { exact: settings.facing }, ...size } }); }
  catch { wall.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: settings.facing, ...size } }); }
  $("video").srcObject = wall.stream;
  $("preview").classList.toggle("back", settings.facing === "environment");
  await $("video").play().catch(() => {});
  $("camDot").classList.add("on");
  drawFrame();
}
const cropCanvas = document.createElement("canvas"), cropCtx = cropCanvas.getContext("2d");
function cropRect(video) {
  const c = settings.crop || { cx: 0.5, cy: 0.5, zoom: 1 };
  const zoom = Math.min(6, Math.max(1, +c.zoom || 1)), w = 1 / zoom, h = 1 / zoom;
  const x = Math.min(1 - w, Math.max(0, c.cx - w / 2)), y = Math.min(1 - h, Math.max(0, c.cy - h / 2));
  return { x, y, w, h, sx: x * video.videoWidth, sy: y * video.videoHeight, sw: w * video.videoWidth, sh: h * video.videoHeight };
}
function frameInput(video) {
  if ((settings.crop?.zoom || 1) <= 1.01) return video;
  const r = cropRect(video), scale = Math.min(1, 960 / r.sw);
  cropCanvas.width = Math.round(r.sw * scale); cropCanvas.height = Math.round(r.sh * scale);
  cropCtx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, cropCanvas.width, cropCanvas.height);
  return cropCanvas;
}
function drawFrame() {
  const box = $("frameBox"), video = $("video");
  if (!video.videoWidth) return;
  const r = cropRect(video), mirror = settings.facing === "user";
  box.style.left = ((mirror ? 1 - r.x - r.w : r.x) * 100) + "%"; box.style.top = (r.y * 100) + "%";
  box.style.width = (r.w * 100) + "%"; box.style.height = (r.h * 100) + "%";
  box.hidden = (settings.crop?.zoom || 1) <= 1.01;
  $("zoom").value = settings.crop?.zoom || 1;
  $("zoomValue").textContent = (+(settings.crop?.zoom || 1)).toFixed(1) + "×";
  $("frameInfo").textContent = `Cámara ${video.videoWidth}×${video.videoHeight} · zona analizada ${Math.round(r.sw)}×${Math.round(r.sh)} px`;
}
$("video").addEventListener("loadedmetadata", drawFrame);

// ---------- Vigilar ----------
async function scan() {
  clearTimeout(wall.loop);
  if (!wall.started || document.hidden) return;
  const video = $("video");
  if (!wall.busy && video.readyState >= 2) {
    wall.busy = true;
    try { const found = await wall.detector.detect(frameInput(video)); drawBoxes(found); onFaces(found); }
    catch (e) { $("faceState").textContent = "Error: " + e.message; }
    finally { wall.busy = false; }
  }
  wall.loop = setTimeout(scan, wall.enrolling ? 200 : 120);
}
wall.scan = scan;
// ---------- Recuadro verde ----------
// Face boxes come relative to the analysed area; map them back onto the preview.
function drawBoxes(found) {
  const layer = $("faceBoxes"), video = $("video");
  if (!layer || !video.videoWidth) return;
  const zoomed = (settings.crop?.zoom || 1) > 1.01, r = zoomed ? cropRect(video) : { x: 0, y: 0, w: 1, h: 1 };
  const mirror = settings.facing === "user", known = wall.people.some((p) => p.samples?.length);
  const boxes = found.filter((f) => f.box).map((f) => {
    const m = wall.enrolling || !known ? {} : identify(f.embedding);
    const x = r.x + f.box[0] * r.w, y = r.y + f.box[1] * r.h, w = f.box[2] * r.w, h = f.box[3] * r.h;
    const el = document.createElement("div");
    el.className = "face-box " + (m.person || wall.enrolling ? "known" : "unknown");
    Object.assign(el.style, { left: ((mirror ? 1 - x - w : x) * 100) + "%", top: (y * 100) + "%", width: (w * 100) + "%", height: (h * 100) + "%" });
    const tag = document.createElement("span"); tag.textContent = m.person ? displayName(m.person) : wall.enrolling ? "…" : "?";
    el.append(tag);
    el.face = { x: mirror ? 1 - x - w : x, y, w, h, label: tag.textContent, known: !!m.person };
    return el;
  });
  wall.lastFaces = { at: Date.now(), list: boxes.map((b) => b.face) };
  layer.replaceChildren(...boxes);
  // On the black wall screen, show the camera for a few seconds when someone is there.
  if (boxes.length && !wall.enrolling && !framing && $("settings").hidden) {
    clearTimeout(wall.spotTimer);
    const preview = $("preview");
    if (preview.classList.contains("stash")) { preview.classList.remove("stash"); preview.classList.add("spot"); }
    wall.spotTimer = setTimeout(() => { if (preview.classList.contains("spot")) { preview.classList.remove("spot"); preview.classList.add("stash"); layer.replaceChildren(); } }, 4000);
  }
}
wall.drawBoxes = drawBoxes;

// ---------- Vista en el escritorio ----------
// While the desk's settings are open it asks for a "peek": small snapshots of
// what this camera sees, with the door zone and the face boxes drawn on top.
const peek = document.createElement("canvas"), peekCtx = peek.getContext("2d");
function sendFrame() {
  const video = $("video");
  if (!wall.home || Date.now() > (wall.peekUntil || 0) || !video.videoWidth) return;
  const w = 480, h = Math.round(w * video.videoHeight / video.videoWidth), mirror = settings.facing === "user";
  peek.width = w; peek.height = h;
  peekCtx.save(); if (mirror) { peekCtx.translate(w, 0); peekCtx.scale(-1, 1); }
  peekCtx.drawImage(video, 0, 0, w, h); peekCtx.restore();
  if ((settings.crop?.zoom || 1) > 1.01) {
    const r = cropRect(video);
    peekCtx.setLineDash([6, 5]); peekCtx.strokeStyle = "rgba(255,255,255,.8)"; peekCtx.lineWidth = 1.5;
    peekCtx.strokeRect((mirror ? 1 - r.x - r.w : r.x) * w, r.y * h, r.w * w, r.h * h); peekCtx.setLineDash([]);
  }
  const faces = wall.lastFaces && Date.now() - wall.lastFaces.at < 1500 ? wall.lastFaces.list : [];
  peekCtx.font = "600 13px -apple-system, system-ui, sans-serif";
  for (const f of faces) {
    const color = f.known ? "#34d399" : "#fbbf24";
    peekCtx.strokeStyle = color; peekCtx.lineWidth = 2.5; peekCtx.strokeRect(f.x * w, f.y * h, f.w * w, f.h * h);
    const tw = peekCtx.measureText(f.label).width + 12;
    peekCtx.fillStyle = color; peekCtx.fillRect(f.x * w, Math.max(0, f.y * h - 20), tw, 18);
    peekCtx.fillStyle = "#06130d"; peekCtx.fillText(f.label, f.x * w + 6, Math.max(13, f.y * h - 6));
  }
  wall.home.send({ action: "frame", img: peek.toDataURL("image/jpeg", 0.55), facing: settings.facing, faces: faces.map((f) => f.label), state: $("faceState").textContent });
}
setInterval(sendFrame, 500);
wall.sendFrame = sendFrame;
// Orders from the desk on the private channel.
async function onDesk(e) {
  if (e.action === "peek") wall.peekUntil = Date.now() + 15000;
  if (e.action === "snap") void snapPhoto(e);
  if (e.action === "speaking") { wall.ears.setDeskSpeaking(!!e.on, !e.on && wall.expectReply); if (!e.on) wall.expectReply = false; }
  if (e.action === "camera" && (e.facing === "user" || e.facing === "environment") && e.facing !== settings.facing) {
    settings.facing = e.facing; settings.save(); $("facing").value = e.facing;
    if (wall.started) await startCamera().catch(() => {});
  }
}
wall.onDesk = onDesk;
// Guard mode: a photo of whoever came in, saved privately and sent to your phone.
async function snapPhoto(e) {
  const video = $("video");
  if (!video.videoWidth || !settings.key) return;
  const w = Math.min(1280, video.videoWidth), h = Math.round(w * video.videoHeight / video.videoWidth);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  c.getContext("2d").drawImage(video, 0, 0, w, h);
  const img = c.toDataURL("image/jpeg", 0.72);
  try { await call("jarvis-call", { action: "photo", img, who: String(e.who || "").slice(0, 40), reason: e.reason === "alarm" ? "alarm" : "entry" }, settings.key); } catch { /* offline */ }
}
wall.snapPhoto = snapPhoto;

// ---------- Oído (este móvil hace de micrófono) ----------
wall.ears = createWallEars({
  settings, store,
  onCommand: (text, via) => {
    if (!wall.home) return;
    // Only after a bare "Jarvis" ("¿Sí?") is the next phrase taken without the name.
    wall.expectReply = via === "wake-only";
    if (via === "wake-only") wall.home.send({ action: "ask-wake" });
    else wall.home.send({ action: "ask", text, id: Date.now(), from: "wall" });
    $("wallHeard").textContent = "«" + (via === "wake-only" ? "Jarvis" : text) + "»";
    clearTimeout(wall.heardTimer); wall.heardTimer = setTimeout(() => { $("wallHeard").textContent = ""; }, 6000);
  },
  onStatus: (s, detail) => {
    $("earDot").classList.toggle("on", s === "listening" || (s === "error" && wall.ears.on));
    if (s === "error") {
      $("earInfo").textContent = "Error al transcribir: " + detail;
      // Two failures in a row: hand listening back to the computer until it works again.
      if (wall.ears.failures >= 2) wall.home?.send({ action: "ears", on: false });
    }
  },
});
async function startEars() {
  if (!settings.listen || wall.ears.on) return;
  try { await wall.ears.start(); $("earInfo").textContent = "Escuchando. Di «Jarvis…» y lo que quieras."; }
  catch (e) { $("earInfo").textContent = e.name === "NotAllowedError" ? "Permite el micrófono en Safari para esta página." : "No puedo usar el micrófono: " + e.message; }
}
wall.startEars = startEars;
setInterval(() => {
  if (wall.ears.on) wall.home?.send({ action: "ears", on: !(wall.ears.failures >= 2) });
  if ($("settings").hidden === false && wall.ears.on) $("earInfo").textContent = `Escuchando · ${wall.ears.heardToday} frases hoy` + (wall.ears.last ? ` · última: «${wall.ears.last}»` : "");
}, 30000);
function listenToDesk() {
  wall.home?.stop(); wall.home = null;
  if (settings.key) wall.home = connectHome({ key: settings.key, onEvent: (e) => void onDesk(e) });
}
function onFaces(found) {
  if (wall.enrolling) return enrollStep(found);
  const known = wall.people.some((p) => p.samples?.length);
  if (!found.length) { $("faceState").textContent = known ? "Nadie en la puerta" : "Sin caras registradas"; return; }
  const now = Date.now(), names = [];
  let unknown = 0;
  for (const face of found) {
    const match = known ? identify(face.embedding) : {};
    if (!match.person) { unknown++; continue; }
    const p = match.person;
    names.push(displayName(p));
    const away = now - (wall.seen[p.id] || 0) > wall.absenceMS;
    wall.seen[p.id] = now;
    if (away) {
      $("wallSeen").textContent = `${displayName(p)} · ${new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
      void tell("arrival", { person: { name: displayName(p), role: p.role, greeting: p.greeting || "" } });
    }
  }
  if (unknown && now - wall.lastUnknown > 120000) { wall.lastUnknown = now; void tell("unknown", { count: unknown }); }
  $("faceState").textContent = [...names, ...(unknown ? ["Desconocido"] : [])].join(" · ");
}

// ---------- Registrar caras ----------
function enrollStep(found) {
  const e = wall.enrolling, person = wall.people.find((p) => p.id === e.personId);
  if (!person) { endEnroll(); return; }
  if (found.length !== 1 || found[0].score < 0.6) {
    $("faceInfo").textContent = found.length > 1 ? "Hay más de una cara. Que se ponga solo." : "No veo bien la cara. Mira a la cámara.";
    return;
  }
  e.samples.push(found[0].embedding.map((x) => Math.round(x * 1e4) / 1e4));
  $("faceInfo").textContent = `Aprendiendo la cara de ${displayName(person)}… ${e.samples.length}/5`;
  if (e.samples.length >= 5) {
    person.samples = e.samples; endEnroll();
    if (!savePeople()) { $("faceInfo").textContent = "No se pudo guardar en este navegador."; return; }
    renderPeople();
    $("faceInfo").textContent = `Listo: ya reconozco a ${displayName(person)}.`;
  }
}
function endEnroll() { wall.enrolling = null; $("preview").classList.add("stash"); document.body.append($("preview")); }
function startEnroll(person) {
  if (framing) setFraming(false);
  if (!wall.started) { $("faceInfo").textContent = "Primero pulsa «Empezar a vigilar»."; return; }
  wall.enrolling = { personId: person.id, samples: [] };
  $("enrollSlot").append($("preview")); $("preview").classList.remove("stash", "spot");
  $("faceInfo").textContent = person.role === "me" ? "Ponte delante de la cámara…" : `Que ${displayName(person)} se ponga delante de la cámara…`;
  void scan();
}
function renderPeople() {
  const list = $("people"); list.replaceChildren();
  if (!wall.people.length) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "Todavía no conozco a nadie."; list.append(p); }
  for (const person of wall.people) {
    const row = document.createElement("div"); row.className = "person";
    const info = document.createElement("div");
    const title = document.createElement("strong"); title.textContent = displayName(person);
    const sub = document.createElement("span"); sub.className = "muted";
    sub.textContent = ROLES[person.role] + " · " + (person.samples?.length ? "cara registrada" : "falta la cara");
    info.append(title, sub);
    const learn = document.createElement("button"); learn.className = "pill small"; learn.textContent = person.samples?.length ? "Repetir cara" : "Registrar cara";
    learn.onclick = () => startEnroll(person);
    const remove = document.createElement("button"); remove.className = "pill ghost small"; remove.textContent = "Borrar";
    remove.onclick = () => { wall.people = wall.people.filter((p) => p !== person); savePeople(); renderPeople(); };
    row.append(info, learn, remove); list.append(row);
  }
  $("personRole").querySelector('option[value="me"]').disabled = wall.people.some((p) => p.role === "me");
  if ($("personRole").selectedOptions[0]?.disabled) $("personRole").value = "mom";
}
wall.renderPeople = renderPeople;

// ---------- Encuadre ----------
let framing = false, drag = null;
function setFraming(on) {
  framing = on && wall.started;
  $("frameEditor").hidden = !framing;
  $("frameToggle").textContent = framing ? "Listo" : "Ajustar encuadre";
  if (on && !wall.started) { $("frameInfo").textContent = "Primero pulsa «Empezar a vigilar»."; return; }
  if (framing) {
    if (wall.enrolling) endEnroll();
    $("frameSlot").append($("preview")); $("preview").classList.remove("stash", "spot"); $("preview").classList.add("framing"); drawFrame();
  } else if (!wall.enrolling) { $("preview").classList.add("stash"); $("preview").classList.remove("framing"); document.body.append($("preview")); }
}
$("frameToggle").onclick = () => setFraming(!framing);
$("zoom").oninput = () => { settings.crop = { ...settings.crop, zoom: +$("zoom").value }; settings.save(); drawFrame(); };
$("frameReset").onclick = () => { settings.crop = { cx: 0.5, cy: 0.5, zoom: 1 }; settings.save(); drawFrame(); };
$("frameSlot").addEventListener("pointerdown", (e) => {
  if (!framing) return;
  const area = $("video").getBoundingClientRect();
  drag = { x: e.clientX, y: e.clientY, cx: settings.crop.cx, cy: settings.crop.cy, w: area.width, h: area.height };
  $("frameSlot").setPointerCapture?.(e.pointerId); e.preventDefault();
});
$("frameSlot").addEventListener("pointermove", (e) => {
  if (!drag) return;
  const mirror = settings.facing === "user" ? -1 : 1, half = 0.5 / (settings.crop.zoom || 1);
  const cx = Math.min(1 - half, Math.max(half, drag.cx + mirror * (e.clientX - drag.x) / drag.w));
  const cy = Math.min(1 - half, Math.max(half, drag.cy + (e.clientY - drag.y) / drag.h));
  settings.crop = { ...settings.crop, cx, cy }; drawFrame();
});
const endDrag = () => { if (drag) { drag = null; settings.save(); } };
$("frameSlot").addEventListener("pointerup", endDrag);
$("frameSlot").addEventListener("pointercancel", endDrag);

// ---------- Arranque ----------
async function keepAwake() { try { if (navigator.wakeLock && !document.hidden) await navigator.wakeLock.request("screen"); } catch {} }
async function start() {
  if (settings.listen) wall.ears.prime();   // inside the tap, or iPhone keeps audio off
  $("wallStart").disabled = true; status("Encendiendo la cámara…");
  try {
    await startCamera();
    wall.detector = wall.detector || await wall.createDetector();
    wall.started = true;
    $("wallStart").hidden = true;
    status(settings.key ? "Vigilando la puerta" : "Falta la clave de Jarvis (toca la pantalla)");
    await keepAwake();
    void scan();
    listenToDesk();
    void startEars();
    if (settings.key) void tell("status", { camera: true });
  } catch (e) {
    status(e.name === "NotAllowedError" ? "Necesito la cámara: permítela en Safari" : "No he podido arrancar: " + e.message);
    $("wallStart").disabled = false;
  }
}
wall.start = start;
$("wallStart").onclick = start;
$("wall").onclick = (e) => { if (e.target !== $("wallStart")) openSettings(); };
function openSettings() {
  $("name").value = settings.name; $("voiceKey").value = settings.key; $("facing").value = settings.facing; $("listenOn").checked = !!settings.listen;
  renderPeople(); $("faceInfo").textContent = ""; $("settings").hidden = false;
  if ($("preview").classList.contains("spot")) { $("preview").classList.remove("spot"); $("preview").classList.add("stash"); }
}
$("closeSettings").onclick = () => { if (framing) setFraming(false); if (wall.enrolling) endEnroll(); $("settings").hidden = true; };
$("name").onchange = () => { settings.name = $("name").value.trim() || "Crew"; settings.save(); };
$("voiceKey").onchange = () => { settings.key = $("voiceKey").value.trim(); settings.save(); if (wall.started) { status("Vigilando la puerta"); listenToDesk(); } };
$("listenOn").onchange = () => {
  settings.listen = $("listenOn").checked; settings.save();
  if (settings.listen) wall.ears.prime();
  if (settings.listen && wall.started) void startEars();
  if (!settings.listen) { wall.ears.stop(); $("earInfo").textContent = ""; }
};
$("facing").onchange = async () => { settings.facing = $("facing").value; settings.save(); if (wall.started) await startCamera().catch(() => {}); };
$("testLink").onclick = async () => {
  $("linkInfo").textContent = "Enviando…";
  const ok = await tell("test", { person: { name: settings.name, role: "me" } });
  $("linkInfo").textContent = ok ? "Enviado: el Chromebook debería decir algo." : "No ha llegado. Revisa la clave.";
};
$("addPerson").onclick = () => {
  const role = $("personRole").value;
  const name = role === "me" ? settings.name : $("personName").value.trim() || ROLES[role];
  const person = { id: role === "me" ? "me" : "p" + Date.now().toString(36), role, name: name.slice(0, 30), greeting: $("personGreeting").value.trim().slice(0, 300), samples: [] };
  wall.people.push(person); savePeople();
  $("personName").value = ""; $("personGreeting").value = "";
  renderPeople(); startEnroll(person);
};
$("toDesk").onclick = (e) => { e.preventDefault(); store.set("jarvis-role", "desk"); location.href = "/"; };
document.addEventListener("visibilitychange", () => { if (!document.hidden && wall.started) { void keepAwake(); void scan(); } });
