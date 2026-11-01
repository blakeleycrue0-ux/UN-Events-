"use strict";
// Small DOM compatibility shim for older Safari; APIs below are capability checked.
if (!Element.prototype.replaceChildren)
  Element.prototype.replaceChildren = function (...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append(...nodes);
  };

const $ = (id) => document.getElementById(id),
  video = $("video"),
  overlay = $("overlay"),
  ctx = overlay.getContext("2d");
const frame = document.createElement("canvas"),
  fx = frame.getContext("2d", { willReadFrequently: true });
const aiFrame = document.createElement("canvas");
aiFrame.width = 512;
aiFrame.height = 240;
const aiCtx = aiFrame.getContext("2d");
const motionDetector = new SecurityDetection.Motion();
let personTimer = null, personRunning = false, detectionGeneration = 0, modelLoadPromise = null;
let aiPass = 0, zoneDraft = null, editorScroll = 0;
const analysis = document.createElement("canvas"),
  ax = analysis.getContext("2d", { willReadFrequently: true });
const state = {
  stream: null,
  armed: false,
  recording: false,
  alarm: false,
  model: null,
  persons: [],
  zone: null,
  mask: null,
  previous: null,
  lastEvent: 0,
  lastAlarm: 0,
  confirmed: 0,
  started: 0,
  light: 0,
  slow: false,
  night: false,
  busy: false,
  storageFailed: false,
};
let db,
  recorder,
  recTimer,
  alarmTimer,
  flashTimer,
  torchTimer,
  siren,
  activeAudio = null,
  drawMode = null,
  drag = null,
  lastAI = 0,
  loopTimer,
  wakeLock;
let events = [],
  clipURLs = [],
  soundURLs = {},
  soundBlobs = {},
  soundGeneration = 0;
const settingIds = [
  "mode",
  "responseMode",
  "autoDetail",
  "surveillanceMode", "motionConfirm", "recordCooldown", "repeatEvents",
  "analysisSize", "analysisInterval", "recordQuality", "previewQuality",
  "nightMode",
  "motion",
  "sensitivity",
  "person",
  "confidence",
  "aiInterval",
  "recordMode",
  "clip",
  "autoDelete",
  "volume",
  "autoVoice",
  "autoNotice",
  "autoWarning",
  "eventLight",
  "autoAlarm",
  "alarmSource",
  "confirmation",
  "cooldown",
  "alarmDuration",
  "brightness",
  "contrast",
  "gamma",
  "nightSensitivity",
  "zoom",
  "lowPower",
  "torchLimit",
  "alarmFlash",
];
function error(message, type = "cámara") {
  $("error").textContent = message;
  log(type, message);
}
function log(type, message, context = {}) {
  const e = { ...context, type, message, time: Date.now() };
  events.unshift(e);
  events = events.slice(0, 500);
  try {
    localStorage.setItem("security-events", JSON.stringify(events));
  } catch {}
  renderEvents();
  document.dispatchEvent(new CustomEvent("security:event", { detail: e }));
}
function renderEvents(limit = 150) {
  $("events").replaceChildren();
  events
    .filter((e) => !$("filter").value || e.type === $("filter").value)
    .slice(0, typeof limit === "number" ? limit : 150)
    .forEach((e) => {
      const li = document.createElement("li");
      li.dataset.eventTime=String(e.time);
      li.textContent =
        new Date(e.time).toLocaleString() + " · " + e.type + " · " + e.message;
      $("events").append(li);
    });
}
function save() {
  try {
    const s = {};
    settingIds.forEach(
      (id) => (s[id] = $(id).type === "checkbox" ? $(id).checked : $(id).value),
    );
    s.eventSettingsVersion = 2;
    s.detectionVersion = 3;
    s.peopleOnlyVersion = 1;
    s.motion=false;s.alarmSource="person";
    s.zone = state.zone;
    s.mask = state.mask;
    localStorage.setItem("security-settings", JSON.stringify(s));
  } catch (e) {
    error("No se pueden guardar ajustes: " + e.message, "pérdida");
  }
}
try {
  const s = JSON.parse(localStorage.getItem("security-settings") || "{}");
  settingIds.forEach((id) => {
    if (s[id] !== undefined) {
      if ($(id).type === "checkbox") $(id).checked = s[id];
      else $(id).value = s[id];
    }
  });
  if (s.eventSettingsVersion !== 2) $("recordMode").value = "event";
  if (s.detectionVersion !== 3) {
    $("previewQuality").value = "1280";
    $("analysisSize").value = "256";
    $("person").checked = true;
    $("confidence").value = "45";
    $("aiInterval").value = "2";
    $("lowPower").checked = false;
    $("motionConfirm").value = "0.5";
  }
  if (s.peopleOnlyVersion !== 1) $("recordMode").value="event";
  state.zone = s.zone || null;
  state.mask = s.mask || null;
  events = JSON.parse(localStorage.getItem("security-events") || "[]");
} catch {}
// Migrate legacy continuous/person-only preferences to event recording. Never re-arm on reload.
if ($("recordMode").value !== "manual") $("recordMode").value = "event";
$("mode").value = "disarmed";
$("motion").checked=false;
$("person").checked=true;
$("alarmSource").value="person";
renderEvents();
let cameraGeneration = 0, analysisGeneration = 0;
let configuredRecordQuality = $("recordQuality").value;
function openDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(Error("IndexedDB no disponible"));
    const r = indexedDB.open("security-cam", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("clips", { keyPath: "id" });
      r.result.createObjectStore("sounds", { keyPath: "id" });
    };
    r.onsuccess = () => {
      db = r.result;
      db.onversionchange = () => db.close();
      resolve();
    };
    r.onerror = () => reject(r.error);
  });
}
function store(name, method, value) {
  return new Promise((resolve, reject) => {
    if (!db) return reject(Error("Almacenamiento no disponible"));
    const t = db.transaction(
      name,
      ["getAll", "get"].includes(method) ? "readonly" : "readwrite",
    );
    const r = t.objectStore(name)[method](value);
    let result;
    r.onsuccess = () => (result = r.result);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || Error("Transacción cancelada"));
  });
}
async function storage() {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      state.storageEstimate=e;
      $("storage").textContent =
        `Uso del origen: ${(e.usage / 1048576).toFixed(1)} MB / ${(e.quota / 1048576).toFixed(0)} MB (cuota estimada, no garantía)`;
      $("storageBadge").textContent = `STORAGE · ${(e.usage / 1048576).toFixed(1)} MB` ;
      return e;
    }
    $("storage").textContent = "Cuota no disponible en este navegador";
  } catch (e) {
    error(e.message, "pérdida");
  }
  return null;
}
async function capacity() {
  // Bound this origin's clip collection even when Safari cannot estimate quota.
  const all = (await store("clips", "getAll")).sort((a,b) => a.id-b.id);
  let bytes = all.reduce((n,c) => n+c.blob.size, 0), count = all.length;
  if (bytes > 480*1024*1024 || count >= 100) {
    if (!$("autoDelete").checked) throw Error("Límite local de 100 clips / 480 MB. Descarga o elimina grabaciones.");
    for (const c of all.filter(c => !c.important)) {
      await store("clips", "delete", c.id); bytes -= c.blob.size; count--;
      if (bytes <= 450*1024*1024 && count < 95) break;
    }
    if (bytes > 480*1024*1024 || count >= 100) throw Error("Límite ocupado por clips importantes. Descárgalos antes de continuar.");
  }
  const e = await storage();
  if (e && e.usage / e.quota > 0.8) {
    if (!$("autoDelete").checked)
      throw Error("Cuota superior al 80%. Descarga o elimina evidencias.");
    const clips = (await store("clips", "getAll"))
      .filter((c) => !c.important)
      .sort((a, b) => a.id - b.id);
    for (const c of clips) {
      await store("clips", "delete", c.id);
      const n = await storage();
      if (n && n.usage / n.quota < 0.75) return;
    }
    throw Error(
      "No hay suficiente espacio libre; se protegen los clips importantes.",
    );
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.className = blob.type.startsWith("image/")
    ? "download-link"
    : "download-link pending-evidence";
  a.textContent =
    (blob.type.startsWith("image/")
      ? "Descargar fotografía: "
      : "Clip pendiente · descargar: ") + name;
  $("clips").prepend(a);
  a.click();
  // Keep emergency-download URLs alive until this page is closed. Safari may block automatic download.
}
async function renderClips() {
  clipURLs.forEach(URL.revokeObjectURL);
  clipURLs = [];
  const pending = [...$("clips").children].filter((el) => el.tagName === "A");
  $("clips").replaceChildren(...pending);
  const clips = await store("clips", "getAll");
  state.clipSummary=clips.map(c=>({id:c.id,reason:c.reason,thumbnail:c.thumbnail,important:c.important,size:c.blob.size,eventId:c.eventId}));
  clips
    .sort((a, b) => b.id - a.id)
    .forEach((c) => {
      const card = document.createElement("div");
      card.className = "clip";
      card.dataset.clipId=String(c.id);
      const p = document.createElement("p");
      p.textContent = new Date(c.id).toLocaleString() + " · " + c.reason;
      const v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.preload = "none";
      v.src = URL.createObjectURL(c.blob);
      clipURLs.push(v.src);
      if (c.thumbnail) v.poster = c.thumbnail;
      const a = document.createElement("a");
      a.href = v.src;
      a.download =
        "SECURITY-" + c.id + (c.blob.type.includes("mp4") ? ".mp4" : ".webm");
      a.textContent = "Descargar";
      const star = document.createElement("button");
      star.textContent = c.important ? "Importante ✓" : "Marcar importante";
      star.onclick = async () => {
        c.important = !c.important;
        await store("clips", "put", c);
        renderClips();
      };
      const del = document.createElement("button");
      del.textContent = "Eliminar";
      del.onclick = () =>
        authorizeLocalAction("Eliminar grabación", async () => {
          await store("clips", "delete", c.id);
          await renderClips();
          await storage();
        });
      card.append(p, v, a, star, del);
      $("clips").append(card);
    });
  document.dispatchEvent(new Event("security:clips"));
  storage();
}
function crop() {
  const z = +$("zoom").value / 100;
  const w = video.videoWidth / z,
    h = video.videoHeight / z;
  return [(video.videoWidth - w) / 2, (video.videoHeight - h) / 2, w, h];
}
let colorKey = "",
  colorTable;
function nightEnabled() {
  return (
    $("nightMode").value === "on" ||
    ($("nightMode").value === "auto" && state.night)
  );
}
function updatePreview() {
  const enabled = nightEnabled();
  video.style.filter = `brightness(${+$("brightness").value * (enabled ? 1.6 : 1)}%) contrast(${+$("contrast").value * (enabled ? 1.12 : 1)}%)`;
  video.style.transform = `scale(${+$("zoom").value / 100})`;
  const label = { off: "OFF", on: "ON", auto: "AUTO" }[$("nightMode").value];
  $("nightToggle").textContent = "Noche: " + label;
  $("nightToggle").setAttribute("aria-pressed", String(enabled));
  $("nightHint").textContent = enabled
    ? "Mejora nocturna activa · necesita luz visible"
    : $("nightMode").value === "auto"
      ? "Noche automática según la luz de la cámara"
      : "";
}
function processed(target = frame, context = fx, region = null) {
  if (!video.videoWidth) return;
  const [x, y, w, h] = crop();
  const r = region || {x:0,y:0,w:1,h:1};
  context.drawImage(video, x+w*r.x, y+h*r.y, w*r.w, h*r.h, 0, 0, target.width, target.height);
  const boost = nightEnabled();
  const brightness = (+$("brightness").value / 100) * (boost ? 1.6 : 1),
    contrast = (+$("contrast").value / 100) * (boost ? 1.12 : 1),
    gamma = (+$("gamma").value / 100) * (boost ? 1.25 : 1);
  state.rawLight = null;
  if (brightness !== 1 || contrast !== 1 || gamma !== 1) {
    const key = [brightness, contrast, gamma].join(",");
    if (key !== colorKey) {
      colorKey = key;
      colorTable = new Uint8Array(256);
      for (let i = 0; i < 256; i++) {
        const v = Math.max(
          0,
          Math.min(255, (i * brightness - 127.5) * contrast + 127.5),
        );
        colorTable[i] = 255 * Math.pow(v / 255, 1 / gamma);
      }
    }
    const image = context.getImageData(0, 0, target.width, target.height),
      d = image.data;
    let light = 0,
      n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (i % 256 === 0) {
        light += (d[i] + d[i + 1] + d[i + 2]) / 3;
        n++;
      }
      d[i] = colorTable[d[i]];
      d[i + 1] = colorTable[d[i + 1]];
      d[i + 2] = colorTable[d[i + 2]];
    }
    state.rawLight = light / Math.max(1, n);
    context.putImageData(image, 0, 0);
  }
  if (state.mask) {
    const m = state.mask;
    context.fillStyle = "#000";
    context.fillRect(
      (m.x-r.x)/r.w * target.width,
      (m.y-r.y)/r.h * target.height,
      m.w/r.w * target.width,
      m.h/r.h * target.height,
    );
  }
}
function viewRect() {
  const r = overlay.getBoundingClientRect();
  const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : frame.width / frame.height;
  let w = r.width,
    h = w / ratio;
  if (h > r.height) {
    h = r.height;
    w = h * ratio;
  }
  return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h };
}
function draw() {
  if (document.body.classList.contains("auth-pending")) return;
  if ($("cameraPage").hidden && $("landingPage").hidden) return;
  const r = overlay.getBoundingClientRect();
  if (
    overlay.width !== Math.round(r.width) ||
    overlay.height !== Math.round(r.height)
  ) {
    overlay.width = r.width;
    overlay.height = r.height;
  }
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const v = viewRect();
  const viewport = $("videoViewport");
  viewport.style.left = v.x + "px";
  viewport.style.top = v.y + "px";
  viewport.style.width = v.w + "px";
  viewport.style.height = v.h + "px";
  viewport.style.opacity = state.stream && video.videoWidth ? "1" : "0";
  // Overlay contains annotations only. The native video must never wait for inference.
  if (state.mask) {
    const m = state.mask;
    ctx.fillStyle = "#000";
    ctx.fillRect(v.x + m.x * v.w, v.y + m.y * v.h, m.w * v.w, m.h * v.h);
  }
  function rect(b, color, label) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(v.x + b.x * v.w, v.y + b.y * v.h, b.w * v.w, b.h * v.h);
    if (label) {
      ctx.font = "600 13px -apple-system, sans-serif";
      const width=Math.min(v.w,ctx.measureText(label).width+12);
      const left=Math.max(v.x,Math.min(v.x+v.w-width,v.x+b.x*v.w));
      const top=Math.max(v.y,Math.min(v.y+v.h-23,v.y+b.y*v.h));
      ctx.fillStyle="rgba(9,24,17,.88)";ctx.fillRect(left,top,width,23);
      ctx.fillStyle=color;ctx.fillText(label,left+6,top+16);
    }
  }
  if (state.zone && !drawMode) rect(state.zone, "#70d39a", "Zona de vigilancia");
  for (const p of state.persons.filter(p=>!p.seen || Date.now()-p.seen<Math.max(3000,personInterval()*3000)))
    rect(p, "#85efa9", "Persona " + Math.round(p.score * 100) + "%" + (p.seen && Date.now()-p.seen>=2000 ? " · hace " + Math.floor((Date.now()-p.seen)/1000) + " s" : ""));
  if (drawMode && zoneDraft) {
    rect(zoneDraft, "#9ce6bd", "Zona pendiente · ajusta los tiradores");
    ctx.fillStyle = "#9ce6bd";
    for (const x of [zoneDraft.x,zoneDraft.x+zoneDraft.w])
      for (const y of [zoneDraft.y,zoneDraft.y+zoneDraft.h])
        ctx.fillRect(v.x+x*v.w-7,v.y+y*v.h-7,14,14);
  }
}
async function torch(on) {
  const track = state.stream?.getVideoTracks()[0];
  if (!track?.getCapabilities?.().torch) {
    $("torch").checked = false;
    return;
  }
  try {
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    $("torch").checked = !!on;
    if (on && !torchTimer) {
      torchTimer = setTimeout(
        () => {
          torchTimer = null;
          clearInterval(flashTimer);
          flashTimer = null;
          torch(false);
          log("modo", "Linterna apagada por límite de tiempo");
        },
        Math.min(120, Math.max(5, +$("torchLimit").value)) * 1000,
      );
    }
    if (!on && !flashTimer) {
      clearTimeout(torchTimer);
      torchTimer = null;
    }
  } catch (e) {
    $("torch").checked = false;
    $("torch").disabled = true;
    $("alarmFlash").disabled = true;
    $("eventLight").disabled = true;
    clearInterval(flashTimer);
    $("torchInfo").textContent = "Linterna no disponible: " + e.message;
    error("Linterna no controlable: " + e.message);
  }
}
async function startCamera() {
  const generation = ++cameraGeneration;
  await stopCamera(false);
  if (generation !== cameraGeneration) return;
  if (!protecting) $("error").textContent = "";
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    error(
      "Se requiere HTTPS (o localhost) y un navegador con acceso a cámara.",
    );
    return;
  }
  try {
    const requestedStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        ...($("device").value
          ? { deviceId: { exact: $("device").value } }
          : { facingMode: { ideal: "environment" } }),
        width: { ideal: +$("previewQuality").value },
        height: { ideal: Math.round(+$("previewQuality").value * 9 / 16) },
        frameRate: { ideal: 15, max: 20 },
      },
    });
    if (generation !== cameraGeneration) {
      requestedStream.getTracks().forEach((t) => t.stop());
      return;
    }
    state.stream = requestedStream;
    video.srcObject = state.stream;
    await video.play();
    if (generation !== cameraGeneration) {
      requestedStream.getTracks().forEach((t) => t.stop());
      return;
    }
    frame.width = Math.min(video.videoWidth, +$("recordQuality").value);
    frame.height = Math.round(
      (frame.width * video.videoHeight) / video.videoWidth,
    );
    draw();
    const track = state.stream.getVideoTracks()[0];
    track.onended = () => {
      error("La cámara se ha desconectado. Reiníciala manualmente.");
      stopCamera();
    };
    state.cameraMuted = false;
    track.onmute = () => {
      state.cameraMuted = true;
      state.confirmed = 0;
      $("live").textContent = "PAUSA";
      $("live").className = "";
      log(
        "cámara",
        "La cámara no está entregando imágenes; vigilancia pausada",
      );
      stopSounds();
      stopRecording();
    };
    track.onunmute = () => {
      state.cameraMuted = false;
      state.previous = null;
      state.movingSince = 0; state.lastMotionAt = 0; state.motionConfirmedAt = 0; state.persons = []; state.episode = null;
      state.confirmed = 0;
      $("live").textContent = "LIVE";
      $("live").className = "active";
      log("cámara", "Captura de cámara recuperada");
    };
    const caps = track.getCapabilities?.() || {};
    $("torch").disabled = !caps.torch;
    $("eventLight").disabled = !caps.torch;
    $("alarmFlash").disabled = !caps.torch;
    $("torchInfo").textContent = caps.torch
      ? "Linterna disponible según la cámara. Se verificará cada orden."
      : "Este navegador/cámara no expone torch; Safari o este iPhone no permiten controlarlo.";
    state.started = Date.now();
    state.previous = null;
    state.storageFailed = false;
    $("cameraMessageDetail").textContent = "Cámara local · sin micrófono";
    $("cameraMessage").hidden=true;
    $("live").textContent = "LIVE";
    $("live").className = "active";
    $("camera").textContent = "Detener cámara";
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selected = $("device").value;
    $("device").replaceChildren(new Option("Trasera automática", ""));
    devices
      .filter((d) => d.kind === "videoinput")
      .forEach((d, i) =>
        $("device").add(new Option(d.label || "Cámara " + (i + 1), d.deviceId)),
      );
    $("device").value = selected;
    log("cámara", "Cámara iniciada sin micrófono");
    try {
      wakeLock = await navigator.wakeLock?.request("screen");
    } catch {}
    tick();
    if ($("person").checked) loadModel().then(() => ensurePersonAnalysis());
  } catch (e) {
    if (generation !== cameraGeneration) return;
    error("No se puede iniciar la cámara: " + e.name + " · " + e.message);
    await stopCamera();
  }
}
async function stopCamera(invalidate = true) {
  detectionGeneration++; clearTimeout(personTimer); personTimer = null;
  if (invalidate) cameraGeneration++;
  clearTimeout(loopTimer);
  await stopRecording();
  stopSounds();
  clearInterval(flashTimer);
  flashTimer = null;
  clearTimeout(torchTimer);
  torchTimer = null;
  await torch(false);
  state.stream?.getTracks().forEach((t) => t.stop());
  state.stream = null;
  video.srcObject = null;
  $("videoViewport").style.opacity = "0";
  state.persons = [];
  state.previous = null;
  state.confirmed = 0;
  state.armed = false;
  $("arm").textContent = "ACTIVAR VIGILANCIA";
  $("status").textContent = "DESARMADO";
  $("live").textContent = "SIN CÁMARA";
  $("live").className = "";
  $("camera").textContent = "Iniciar cámara";
  $("cameraMessageDetail").textContent = "Cámara detenida · sin captura";
  $("cameraMessage").hidden=false;
  $("health").textContent = "";
  $("eventLight").disabled = true;
  $("alarmFlash").disabled = true;
  $("torch").checked = false;
  $("torch").disabled = true;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  try {
    await wakeLock?.release();
  } catch {}
}
function mime() {
  if (!window.MediaRecorder) return null;
  return (
    [
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((t) => MediaRecorder.isTypeSupported(t)) || ""
  );
}
let recordingRenderTimer;
function renderRecording() {
  clearTimeout(recordingRenderTimer);
  if (!state.stream || !recorder || recorder.state === "inactive") return;
  try {
    processed();
  } catch (e) {
    error("Fallo de imagen grabada: " + e.message, "pérdida");
    stopRecording();
    return;
  }
  recordingRenderTimer = setTimeout(
    renderRecording,
    $("lowPower").checked ? 200 : 100,
  );
}
async function startRecording(reason, episode = null) {
  if (
    document.hidden ||
    drawMode ||
    state.recording ||
    state.recordStarting ||
    state.recordFinalizing ||
    !state.stream ||
    state.storageFailed
  )
    return;
  state.recordStarting = true;
  let captureStream = null;
  const recordingCameraID = cameraGeneration;
  if (!window.MediaRecorder) {
    state.recordStarting = false;
    error(
      "MediaRecorder no disponible. Usa fotografías manuales.",
      "grabación",
    );
    return;
  }
  try {
    await capacity();
    if (!state.stream || drawMode || recordingCameraID !== cameraGeneration || (episode && (!state.armed || state.episode !== episode))) return;
    const type = mime();
    let stream;
    if (frame.captureStream) {
      processed();
      stream = frame.captureStream($("lowPower").checked ? 5 : 10);
      captureStream = stream;
    } else {
      if (state.mask || +$("zoom").value !== 100) {
        throw Error(
          "Este navegador no permite grabar vídeo procesado con máscara/zoom. Usa fotos o elimina la máscara explícitamente.",
        );
      }
      stream = new MediaStream(state.stream.getVideoTracks());
      log(
        "grabación",
        "Grabación nativa: brillo, contraste y gamma solo afectan al análisis y a las fotos.",
      );
    }
    const chunks = [];
    const id = Date.now(),
      thumbnail = frame.toDataURL("image/jpeg", 0.5);
    recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const current = recorder;
    current.episode = episode;
    if (episode) episode.clipID = id;
    let finish;
    current.finished = new Promise((r) => (finish = r));
    current.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    current.onerror = (e) => {
      state.storageFailed = true;
      error(
        "Fallo de grabación: " + (e.error?.message || "error del codificador"),
        "pérdida",
      );
      stopRecording();
    };
    current.onstart = () => {
      state.recording = true;
      $("rec").hidden = false;
      $("record").textContent = "Detener grabación";
      renderSurveillanceStatus();
      if (episode) state.recordStartMS = Date.now()-episode.started;
      log("grabación", "Iniciada: " + reason,{clipId:id});
    };
    current.onstop = async () => {
      state.recordFinalizing = true;
      state.recording = false;
      if (current.episode) state.recordCooldownUntil = Date.now() + +$("recordCooldown").value * 1000;
      $("rec").hidden = true;
      $("record").textContent = "Grabar manual";
      renderSurveillanceStatus();
      const blob = new Blob(chunks, { type: current.mimeType || type });
      try {
        if (!blob.size) throw Error("Clip vacío");
        await store("clips", "put", {
          id,
          blob,
          reason: episode?.kind || reason,
          eventId: episode?.started || null,
          thumbnail,
          important: false,
        });
        log("grabación", "Finalizada y guardada: " + (episode?.kind || reason),{clipId:id});
        await renderClips();
      } catch (e) {
        state.storageFailed = true;
        error(
          "No se ha guardado el clip: " +
            e.message +
            ". Tienes la descarga pendiente en Actividad.",
          "pérdida",
        );
        if (blob.size)
          download(
            blob,
            "SECURITY-" + id + (blob.type.includes("mp4") ? ".mp4" : ".webm"),
          );
      } finally {
        if (frame.captureStream) stream.getTracks().forEach((t) => t.stop());
        state.recordFinalizing = false;
        finish();

      }
    };
    current.start(1000);
    if (frame.captureStream) renderRecording();
    recTimer = setTimeout(
      () => stopRecording(),
      Math.min(60, Math.max(10, +$("clip").value)) * 1000,
    );
  } catch (e) {
    state.storageFailed = true;
    captureStream?.getTracks().forEach(t => t.stop());
    error("Grabación no iniciada: " + e.message + ". Corrige la causa y reinicia la cámara.", "pérdida");
  } finally {
    state.recordStarting = false;
  }
}
async function stopRecording() {
  clearTimeout(recordingRenderTimer);
  clearTimeout(recTimer);
  const r = recorder;
  if (r && r.state !== "inactive") {
    r.stop();
    await r.finished;
  }
  if (recorder === r) recorder = null;
}
// One reusable HTML media element: iOS media playback is distinct from Web Audio's silent-mode routing.
const mediaAudio = document.createElement("audio");
mediaAudio.id = "securityAudio";
mediaAudio.preload = "auto";
mediaAudio.setAttribute("playsinline", "");
document.body.append(mediaAudio);
let audioReady = false;
function playbackSession() {
  try {
    if (navigator.audioSession) navigator.audioSession.type = "playback";
  } catch (e) {
    log("audio", "La sesión playback no está disponible: " + e.message);
  }
}
async function enableAudio() {
  if (audioReady) return true;
  playbackSession();
  try {
    if (!activeAudio && !siren) {
      mediaAudio.onended = null;
      mediaAudio.loop = false;
      mediaAudio.muted = false;
      mediaAudio.src = "assets/comprobar-sonido.wav";
      mediaAudio.volume = Math.max(0.25, +$("volume").value / 100);
      // play() is invoked synchronously in the original user gesture.
      const attempt = mediaAudio.play();
      await attempt;
    }
    audioReady = true;
    $("enableAudio").textContent = "Reproducción multimedia habilitada";
    return true;
  } catch (e) {
    audioReady = false;
    error(
      "El navegador bloqueó el audio: " + e.name + " · " + e.message + ". Toca Probar sonido.",
      "audio",
    );
    return false;
  }
}
mediaAudio.addEventListener("pause", () => {
  if (mediaAudio.paused && !mediaAudio.ended && (activeAudio || siren)) {
    audioReady = false;
    stopSounds();
    error(
      "La reproducción se ha interrumpido. Toca Reactivar sonido.",
      "audio",
    );
  }
});
function stopSounds() {
  state.warningPending = false;
  $("sequenceStatus").textContent = "";
  soundGeneration++;
  mediaAudio.onended = null;
  activeAudio = null;
  mediaAudio.pause();
  if (siren) {
    try {
      siren.stop();
    } catch {}
    siren = null;
  }
  clearTimeout(alarmTimer);
  if (state.alarm) log("alarma", "Desactivada / silenciada");
  state.alarm = false;
  $("alarmStatus").hidden = true;
  clearInterval(flashTimer);
  flashTimer = null;
  torch(false);
}
async function sound(id) {
  if (!audioReady) {
    error(
      "Toca Probar sonido para autorizar reproducción multimedia.",
      "audio",
    );
    return false;
  }
  const generation = ++soundGeneration;
  try {
    playbackSession();
    mediaAudio.onended = null;
    activeAudio = null;
    siren = null;
    mediaAudio.pause();
    mediaAudio.muted = false;
    mediaAudio.loop = id === "siren";
    mediaAudio.volume = +$("volume").value / 100;
    mediaAudio.src =
      id === "siren" ? "assets/sirena.mp3" : "assets/aviso-seguridad.mp3";
    await mediaAudio.play();
    if (generation !== soundGeneration) return false;
    if (mediaAudio.paused || mediaAudio.readyState < 2)
      throw Error("El audio no ha comenzado a reproducirse");
    activeAudio = mediaAudio;
    if (id === "siren") {
      siren = {
        stop() {
          mediaAudio.pause();
        },
      };
      log("audio", "Sirena multimedia iniciada");
    } else log("audio", "Reproduciendo MP3: " + id);
    return true;
  } catch (e) {
    if (generation !== soundGeneration) return false;
    audioReady = false;
    activeAudio = null;
    siren = null;
    error("Fallo real de reproducción: " + e.name + " · " + e.message, "audio");
    return false;
  }
}
async function alarm(reason, manual = false) {
  if (
    state.alarm ||
    (!manual &&
      Date.now() - state.lastAlarm < Math.max(10, +$("cooldown").value) * 1000)
  )
    return;
  stopSounds();
  state.alarm = true;
  $("alarmStatus").hidden = false;
  state.lastAlarm = Date.now();
  log("alarma", "Activada: " + reason);
  const playback = sound("siren");
  const generation = soundGeneration;
  await playback;
  if (!state.alarm || generation !== soundGeneration) return;
  if ($("alarmFlash").checked && !$("alarmFlash").disabled) {
    await torch(true);
    flashTimer = setInterval(() => torch(!$("torch").checked), 2000);
  }
  alarmTimer = setTimeout(
    stopSounds,
    Math.min(30, +$("alarmDuration").value) * 1000,
  );
}
function threatActive() {
  return !!state.stream && !document.hidden && !state.cameraMuted && !state.peopleError && $("person").checked &&
    state.persons.some(p=>!p.seen || Date.now()-p.seen<Math.max(3000,personInterval()*3000)) &&
    Date.now()-(state.personResultAt||0)<Math.max(3,personInterval()*2)*1000;
}
function considerThreat() {
  const allowed =
    state.armed &&
    $("mode").value === "alarm" &&
    $("autoAlarm").checked &&
    state.zone && state.episode;
  if (!allowed || !threatActive()) {
    state.threatSince = 0;
    if (state.warningPending) {
      stopSounds();
      log(
        "alarma",
        "Aviso cancelado: la detección desapareció. No se activa sirena.",
      );
      $("sequenceStatus").textContent =
        "Detección terminada · sirena cancelada";
    }
    return;
  }
  state.threatSince ||= Date.now();
  if (
    Date.now() - state.threatSince >=
      Math.max(1, +$("confirmation").value) * 1000 &&
    !state.warningPending &&
    !state.alarm &&
    !state.episode.alerted &&
    Date.now() - state.lastAlarm >= Math.max(10, +$("cooldown").value) * 1000
  )
    { state.episode.alerted = true;
      if ($("autoVoice").checked) warnThenAlarm();
      else confirmedAutoAlarm("Evento confirmado en zona de vigilancia");
    }
}
async function currentPersonVisible() {
  const token = soundGeneration, cameraID = cameraGeneration;
  state.personVerificationRequested=true;
  const deadline = Date.now()+5000;
  while(state.busy && Date.now()<deadline) await new Promise(resolve => setTimeout(resolve,100));
  if(state.busy || !state.model || state.peopleError || !state.armed || !$("person").checked || drawMode || document.hidden || token!==soundGeneration || cameraID!==cameraGeneration) { state.personVerificationRequested=false; return false; }
  state.busy=true;
  try {
    const region = SecurityDetection.expand(state.persons[0] || state.zone || {x:0,y:0,w:1,h:1},.15);
    const check=document.createElement("canvas"),ratio=video.videoWidth*region.w/(video.videoHeight*region.h);
    check.width=Math.round(ratio>=1?512:512*ratio);check.height=Math.round(ratio>=1?512/ratio:512);
    processed(check,check.getContext("2d"),region);
    const result=await state.model.detect(check,{object:{minConfidence:+$("confidence").value/100}});
    checkPeopleResult(result);
    if(token!==soundGeneration || cameraID!==cameraGeneration || !state.armed || drawMode || document.hidden) return false;
    const fresh=(result.object||[]).filter(p=>p.label==="person" && p.score>=+$("confidence").value/100 && p.boxRaw)
      .map(p=>({...SecurityDetection.mapBox(p.boxRaw,region),score:p.score,seen:Date.now()}))
      .filter(p=>SecurityDetection.personInside(p,state.zone) && !(state.mask && SecurityDetection.personInside(p,state.mask)));
    state.persons=fresh;state.personResultAt=Date.now();draw();
    return fresh.length>0;
  } catch(e) {
    error("No se pudo confirmar presencia antes de sirena: "+e.message,"alarma");return false;
  } finally { state.busy=false; state.personVerificationRequested=false; ensurePersonAnalysis(); }
}
async function confirmedAutoAlarm(reason, afterVoice = false) {
  const token=soundGeneration, episode=state.episode;
  const present=await currentPersonVisible();
  if(token!==soundGeneration || state.peopleError || !$("person").checked || !state.armed || $("mode").value!=="alarm" || !$("autoAlarm").checked || state.episode!==episode) return;
  if(afterVoice) state.warningPending=false;
  if(present && state.zone) alarm(reason,true);
  else {
    $("sequenceStatus").textContent="Sin presencia confirmada · sirena cancelada";
    log("alarma","Sirena cancelada: comprobación actual sin detección");
  }
}
async function warnThenAlarm() {
  stopSounds();
  state.warningPending = true;
  state.warningStarted = Date.now();
  state.lastAlarm = Date.now();
  const generation = soundGeneration;
  $("sequenceStatus").textContent =
    "Reproduciendo aviso · sirena solo si continúa la detección";
  log("alarma", "Aviso previo iniciado: " + $("alarmSource").value);
  try {
    await loadSounds();
    if (!state.warningPending || generation !== soundGeneration) return;
    await sound("warning");
    if (!state.warningPending || !activeAudio) {
      $("sequenceStatus").textContent =
        "Aviso no reproducido · sirena cancelada";
      state.warningPending = false;
      return;
    }
    state.warningStarted = Date.now();
    activeAudio.onended = () => {
      if (!state.warningPending) return;
      $("sequenceStatus").textContent="Comprobando presencia antes de sirena…";
      confirmedAutoAlarm("Detección persistente después del aviso",true);
    };
  } catch (e) {
    stopSounds();
    error(
      "Aviso no reproducido. Sirena automática cancelada: " + e.message,
      "audio",
    );
  }
}
// One episode owns one automatic clip. Cooldown begins when encoding ends.
function personInterval() {
  const base = $("responseMode").value === "fast" ? .35 : Math.max(.25,+$("aiInterval").value);
  return Math.max(base, $("lowPower").checked ? 5 : .25, (state.aiMS || 0)*1.4/1000);
}
function updateResponseControls() {
  $("aiInterval").disabled = $("responseMode").value === "fast";
  $("aiInterval").title = $("aiInterval").disabled ? "El modo rápido ajusta la frecuencia al tiempo real de inferencia." : "Intervalo objetivo entre análisis.";
}
function personEligible() {
  return state.stream && state.stream.active !== false && !state.cameraMuted && !document.hidden && !drawMode && $("person").checked && state.model && !state.peopleError;
}
function ensurePersonAnalysis(delay = 0) {
  if (!personEligible() || personRunning || personTimer !== null) return;
  personTimer = setTimeout(() => { personTimer=null; analyzePeople(); }, delay);
}

function personFresh() {
  return $("person").checked && state.persons.length &&
    Date.now() - (state.personResultAt || 0) < Math.max(3, personInterval() * 2) * 1000;
}
function recordEpisode(episode) {
  if (episode.recordAttempted || state.recording || state.recordStarting || state.storageFailed ||
      Date.now() < (state.recordCooldownUntil || 0) || $("recordMode").value !== "event") return;
  episode.recordAttempted = true;
  startRecording(episode.kind, episode);
}
function detected(type) {
  // Movement is not an event source, including legacy stored settings and callers.
  if(type!=="persona" || !state.armed || state.peopleError || !$("person").checked || state.episode) return;
  const episode=state.episode={started:Date.now(),kind:"persona detectada"};
  log("persona","Persona detectada en la zona de vigilancia",{eventId:episode.started});
  if(Date.now()<(state.recordCooldownUntil||0)) {
    episode.recordAttempted=true;log("grabación","Persona registrada sin clip: cooldown activo");
  } else recordEpisode(episode);
  if(($("mode").value==="deter" || ($("mode").value==="alarm" && !$("autoAlarm").checked)) && $("autoVoice").checked) sound("warning");
}
function updateEpisode() {
  const quiet = Date.now() - (state.lastMotionAt || 0) > 4000 && !personFresh();
  if (quiet) state.episode = null;
  else if (state.episode && $("repeatEvents").checked &&
      !state.recording && !state.recordStarting && Date.now() >= (state.recordCooldownUntil || 0)) {
    state.episode.recordAttempted = false;
    recordEpisode(state.episode);
  }
}
function loadModel() {
  if(state.model) return Promise.resolve();
  if(modelLoadPromise) return modelLoadPromise;
  if(!$("person").checked) return Promise.resolve();
  state.peopleError="";state.peopleLoading=true;state.busy=true;renderPeopleStatus();
  modelLoadPromise=(async()=>{
  try {
    if (!window.Human) await loadScript("vendor/human.js");
    const detector = new Human.Human({
      backend: "webgl",
      modelBasePath: new URL("models/", location.href).href,
      cacheModels: false,
      debug: false,
      async: false,
      warmup: "none",
      filter: { enabled: false, return: false },
      face: { enabled: false },
      body: { enabled: false },
      hand: { enabled: false },
      gesture: { enabled: false },
      segmentation: { enabled: false },
      object: {
        enabled: true,
        modelPath: "centernet.json",
        minConfidence: +$("confidence").value / 100,
        // Preserve lower-ranked person candidates in scenes containing many cars.
        maxDetected: 32,
        skipFrames: 0,
        skipTime: 0,
      },
    });
    await detector.load();
    // loaded() lists cached names even if Human failed to fetch their weights.
    const statistics=detector.models.stats();
    const personModel=statistics.modelStats.find(m=>m.name==="centernet");
    if(!personModel?.loaded || statistics.numLoadedModels<1 || personModel.sizeLoadedWeights<=0) {
      // The public reset also invalidates Human's module-level partial-model cache.
      // A later retry creates a fresh instance with our person-only configuration.
      detector.reset();
      throw Error("No se han cargado los pesos de reconocimiento de personas. Comprueba la conexión o los archivos locales del modelo.");
    }
    state.model = detector;
    log("modo", "Modelo local CenterNet MobileNet cargado (4 MB de pesos)");
  } catch (e) {
    state.peopleError=e.name+": "+e.message;
    state.persons=[];
    error(
      "Detección de personas no disponible: " + e.message + ". No habrá clips ni alarmas automáticas. Pulsa Reintentar.",
      "cámara",
    );
  } finally {
    state.busy=false;state.peopleLoading=false;Promise.resolve().then(()=>{modelLoadPromise=null;});
    renderPeopleStatus();ensurePersonAnalysis();
  }
  })();
  return modelLoadPromise;
}
function checkPeopleResult(result) {
  const issue=result?.error;
  if(!result || (issue && (!Array.isArray(issue) || issue.length)))
    throw Error("Fallo del modelo: "+(Array.isArray(issue)?issue.join("; "):issue||"resultado vacío"));
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(Error("Falta recurso local " + src));
    document.head.append(s);
  });
}
function inside(p, z) {
  return (
    !z ||
    (p.x + p.w / 2 >= z.x &&
      p.x + p.w / 2 <= z.x + z.w &&
      p.y + p.h / 2 >= z.y &&
      p.y + p.h / 2 <= z.y + z.h)
  );
}
async function analyzePeople() {
  if (!personEligible()) return;
  if (state.busy || state.personVerificationRequested || state.recordStarting || state.recordFinalizing || video.readyState<2) {
    ensurePersonAnalysis(100); return;
  }
  const cameraID=cameraGeneration, session=detectionGeneration, started=performance.now();
  personRunning=true; state.busy=true;
  state.aiCadenceMS=lastAI ? Date.now()-lastAI : 0;
  lastAI=Date.now();
  try {
    const pass = aiPass++;
    const zone = state.zone || {x:0,y:0,w:1,h:1};
    const detail = $("autoDetail").checked && pass % 2 === 1;
    const region = detail
      ? SecurityDetection.detailRegion(zone, Date.now()-(state.lastVisualChange||0)<5000 ? state.motionBounds : null, Math.floor(pass/2)%4)
      : SecurityDetection.expand(zone, .06);
    const ratio = (video.videoWidth*region.w)/(video.videoHeight*region.h);
    aiFrame.width = Math.round(ratio>=1 ? 512 : 512*ratio);
    aiFrame.height = Math.round(ratio>=1 ? 512/ratio : 512);
    processed(aiFrame, aiCtx, region);
    const aiStarted = performance.now();
    const result = await state.model.detect(aiFrame, {
      object: { minConfidence: +$("confidence").value / 100 },
    });
    checkPeopleResult(result);
    if (session !== detectionGeneration || cameraID !== cameraGeneration || drawMode || !$("person").checked || document.hidden) return;
    state.aiMS = performance.now()-aiStarted;
    state.aiRegion = region;
    state.aiDetail = detail;
    const predictions = result.object || [];
    const found = predictions.filter(p => p.label === "person" && p.score >= +$("confidence").value / 100 && p.boxRaw)
      .map(p => ({...SecurityDetection.mapBox(p.boxRaw, region),score:p.score,seen:Date.now()}))
      .filter(p => SecurityDetection.personInside(p, state.zone) && !(state.mask && SecurityDetection.personInside(p,state.mask)));
    // A low-resolution general pass may miss a person found in a detail pass.
    // Keep its last observation briefly, without changing the observation time.
    state.persons = SecurityDetection.mergePeople(found, state.persons, Date.now(), Math.max(3000,personInterval()*3000))
      .filter(p => SecurityDetection.personInside(p,state.zone) && !(state.mask && SecurityDetection.personInside(p,state.mask)));
    state.personResultAt = Date.now();
    if (state.persons.length) {
      if(found.length) detected("persona");
      state.personPresent = true;
      state.personMissing = 0;
    } else {
      state.confirmed = 0;
      state.personMissing = (state.personMissing || 0) + 1;
      if (state.personMissing >= 2) state.personPresent = false;
    }
  } catch (e) {
    if (session !== detectionGeneration || cameraID !== cameraGeneration) return;
    state.peopleError=e.name+": "+e.message;
    state.persons = [];
    state.confirmed = 0;
    error(
      "Detección de personas detenida: " +
        e.message +
        ". No habrá nuevos clips automáticos. Pulsa Reintentar.",
    );
    save();
  } finally {
    state.busy = false;
    personRunning = false;
    if (personEligible()) ensurePersonAnalysis(Math.max(80,personInterval()*1000-(performance.now()-started)));
  }
  renderPeopleStatus();
  renderDetectionStatus();
  draw();
}

async function tick() {
  const cycle = ++analysisGeneration, cameraID = cameraGeneration;
  clearTimeout(loopTimer);
  if (!state.stream || document.hidden) return;
  if (drawMode) { draw(); loopTimer = setTimeout(tick, 1000); return; }
  if (state.cameraMuted || video.readyState < 2) {
    loopTimer = setTimeout(tick, 1000);
    return;
  }
  const started = performance.now();
  try {
    if(!state.armed) state.episode=null;
    if(!$("person").checked) {
      state.previous=null;state.persons=[];draw();
      $("health").textContent="Detección de personas pausada · sin clips automáticos";
      return;
    }
    const size = state.slow || $("lowPower").checked ? Math.min(128, +$("analysisSize").value) : +$("analysisSize").value;
    if (analysis.width !== size) state.previous = null;
    analysis.width = size;
    analysis.height = Math.round((analysis.width * video.videoHeight) / video.videoWidth);
    processed(analysis, ax);
    const d = ax.getImageData(0, 0, analysis.width, analysis.height).data;
    const grey = new Uint8Array(d.length / 4);
    let sum = 0, count = 0;
    for (let i = 0; i < grey.length; i++) {
      grey[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      const p = {
        x: (i % analysis.width) / analysis.width,
        y: Math.floor(i / analysis.width) / analysis.height,
        w: 0,
        h: 0,
      };
      if (!inside(p, state.zone) || (state.mask && inside(p, state.mask)))
        continue;
      sum += grey[i];
      count++;
    }
    state.light =
      state.rawLight === null ? sum / Math.max(1, count) : state.rawLight;
    state.night = state.night ? state.light < 65 : state.light < 40;
    updatePreview();
    if (!state.previous) motionDetector.reset();
    const signal = motionDetector.analyze(grey, analysis.width, analysis.height,
      state.zone, state.mask, +$("sensitivity").value, +$("motionConfirm").value,
      Date.now(), +$("analysisInterval").value);
    state.motionSignal = signal;
    if (signal.moving) { state.lastVisualChange = Date.now(); state.motionBounds = signal.bounds; }
    state.moving=false;
    state.previous = grey;
    const motionMS = performance.now() - started;
    ensurePersonAnalysis();
    if (!$("person").checked) { state.persons=[]; state.personPresent=false; }
    state.analysisAt=Date.now();
    updateEpisode();
    considerThreat();
    renderDetectionStatus();
    draw();
    state.slow = motionMS > 120 || (state.slow && motionMS > 70);
    $("health").textContent =
      `${state.night ? "Luz insuficiente: detección limitada" : "Iluminación disponible"} · análisis ${analysis.width} px · ${Math.round(motionMS)} ms${state.slow ? " · resolución reducida por rendimiento" : ""} · activo ${Math.floor((Date.now() - state.started) / 60000)} min`;
  } catch (e) {
    error("Fallo de análisis: " + e.message);
  } finally {
    if (cycle === analysisGeneration && cameraID === cameraGeneration && state.stream && !document.hidden)
      loopTimer = setTimeout(tick, !$("person").checked ? 1500 : Math.max($("lowPower").checked ? 500 : 200, +$("analysisInterval").value));
  }
}
function setMode() {
  detectionGeneration++; clearTimeout(personTimer); personTimer=null; lastAI=0;
  state.personResultAt=0; state.aiCadenceMS=0;
  state.confirmed = 0;
  state.previous = null; state.movingSince = 0; state.moving = false;
  state.lastMotionAt = 0; state.motionConfirmedAt = 0; state.persons = []; state.episode = null;
  state.lastEvent = 0;
  state.personPresent = false;
  state.eventTimes = {};
  state.armed = $("mode").value !== "disarmed" && !!state.stream;
  $("status").textContent = $("mode").selectedOptions[0].textContent;
  $("arm").textContent = state.armed
    ? "DESACTIVAR VIGILANCIA"
    : "ACTIVAR VIGILANCIA";
  stopSounds();
  if (!state.armed) stopRecording();
  renderProtection();
  renderSurveillanceStatus();
  log("modo", $("status").textContent);
  if ($("person").checked) loadModel().then(() => ensurePersonAnalysis());
  ensurePersonAnalysis();
  tick();
  save();
}
$("camera").onclick = () => (state.stream ? stopCamera() : startCamera());
$("restart").onclick = startCamera;
$("device").onchange = startCamera;
$("arm").onclick = () => {
  enableAudio();
  if (!state.stream) {
    error("Inicia la cámara primero");
    return;
  }
  if (state.armed) $("mode").value = "disarmed";
  else if ($("mode").value === "disarmed") $("mode").value = "silent";
  setMode();
};
$("record").onclick = () =>
  state.recording ? stopRecording() : startRecording("manual");
$("alarm").onclick = async () => {
  if (await enableAudio()) await alarm("Activación manual", true);
};
$("silence").onclick = stopSounds;
$("enableAudio").onclick = enableAudio;
$("photo").onclick = () => {
  if (!state.stream) return error("Inicia la cámara primero");
  processed();
  frame.toBlob(
    (b) => {
      if (b) download(b, "SECURITY-" + Date.now() + ".jpg");
    },
    "image/jpeg",
    0.9,
  );
};
function exitExpandedVideo() {
  document.body.classList.remove("video-expanded");
  $("exitExpanded").hidden=true;
  if(document.fullscreenElement) document.exitFullscreen?.();
  requestAnimationFrame(draw);
}
$("fullscreen").onclick = async () => {
  if(!state.stream) return error("Inicia la cámara para ampliar la imagen.");
  if(document.fullscreenElement || document.body.classList.contains("video-expanded")) return exitExpandedVideo();
  try {
    if($("stage").requestFullscreen) await $("stage").requestFullscreen();
    else document.body.classList.add("video-expanded");
  } catch { document.body.classList.add("video-expanded"); }
  $("exitExpanded").hidden=false;
  requestAnimationFrame(draw);
};
$("exitExpanded").onclick=exitExpandedVideo;
document.addEventListener("fullscreenchange",()=>{if(!document.fullscreenElement) exitExpandedVideo();});
$("hide").onclick = () => {
  document.body.classList.add("hidden-controls");
  $("unlock").textContent = "Mostrar controles";
};
$("unlock").onclick = async () => {
  if (document.body.classList.contains("locked")) {
    const pin = await requestPin("Desbloquear SECURITY CAM");
    if (
      pin === null ||
      (await hash(pin)) !== localStorage.getItem("security-pin")
    )
      return error("PIN incorrecto", "modo");
    document.body.classList.remove("locked");
  } else if (document.body.classList.contains("hidden-controls"))
    document.body.classList.remove("hidden-controls");
  else if (localStorage.getItem("security-pin"))
    document.body.classList.add("locked");
  else {
    $("pin").click();
    return;
  }
  $("unlock").textContent = document.body.classList.contains("locked")
    ? "Desbloquear"
    : "Bloquear controles";
};
function requestPin(title, options = {}) {
  return new Promise((resolve) => {
    const panel = document.createElement("div");
    panel.className = "pin-screen";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", title);
    const card = document.createElement("form");
    card.className = "pin-card";
    const heading = document.createElement("h2");
    heading.textContent = title;
    const hint = document.createElement("p");
    hint.textContent =
      options.hint ||
      "PIN local de 6 a 12 cifras. Protege los controles, no cifra las grabaciones.";
    const input = document.createElement("input");
    input.id = "pinEntry";
    input.type = "password";
    input.inputMode = "none";
    input.maxLength = 12;
    input.autocomplete = "off";
    input.setAttribute("aria-label", "PIN");
    const keys = document.createElement("div");
    keys.className = "pin-keys";
    for (const digit of [
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "Borrar",
      "0",
      "Cancelar",
    ]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = digit;
      if (digit === "Cancelar" && options.required) button.disabled = true;
      button.onclick = () => {
        if (digit === "Cancelar") {
          panel.remove();
          resolve(null);
        } else if (digit === "Borrar") input.value = input.value.slice(0, -1);
        else if (input.value.length < 12) input.value += digit;
        input.focus();
      };
      keys.append(button);
    }
    const accept = document.createElement("button");
    accept.id = "pinAccept";
    accept.type = "submit";
    accept.textContent = "Continuar";
    accept.className = "pin-accept";
    card.onsubmit = (e) => {
      e.preventDefault();
      if (!/^\d{6,12}$/.test(input.value)) {
        hint.textContent = "Introduce de 6 a 12 cifras.";
        return;
      }
      if (options.onGesture) options.onGesture();
      const value = input.value;
      panel.remove();
      resolve(value);
    };
    input.oninput = () =>
      (input.value = input.value.replace(/\D/g, "").slice(0, 12));
    const pinBrand=document.createElement("div");pinBrand.className="pin-brand";
    pinBrand.innerHTML='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m12 2 5 10M21 7H10m11 10-5-10m-4 15L7 12M3 17h11M3 7l5 10"/></svg><span>SECURITY CAM</span>';
    const pinEmblem=document.createElement("div");pinEmblem.className="pin-emblem";
    pinEmblem.innerHTML='<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 8 3v6c0 5-4 8-8 11-4-3-8-6-8-11V5Zm-4 9 3 3 5-6"/></svg>';
    card.append(pinBrand,pinEmblem,heading, hint, input, keys, accept);
    if (
      state.armed ||
      state.alarm ||
      state.warningPending ||
      (activeAudio && !mediaAudio.paused)
    ) {
      const silence = document.createElement("button");
      silence.type = "button";
      silence.id = "pinSilence";
      silence.textContent = "Silenciar sonidos";
      silence.onclick = stopSounds;
      card.append(silence);
    }
    panel.append(card);
    panel.onkeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!options.required) {
          panel.remove();
          resolve(null);
        }
      }
      if (event.key === "Tab") {
        const nodes = [...panel.querySelectorAll("input,button")].filter(
          (el) => !el.disabled,
        );
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.body.append(panel);
    input.focus();
  });
}
async function hash(s) {
  if (!crypto.subtle) throw Error("PIN requiere HTTPS");
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
$("pin").onclick = async () => {
  try {
    const pin = await requestPin("Crear tu PIN de seguridad");
    if (pin === null) return;
    if (!/^\d{6,}$/.test(pin)) return error("Usa al menos 6 cifras", "modo");
    localStorage.setItem("security-pin", await hash(pin));
    log("modo", "PIN local establecido");
  } catch (e) {
    error(e.message, "modo");
  }
};
settingIds.forEach((id) =>
  $(id).addEventListener("change", () => {
    save();
    state.previous = null;
    if (["person","confidence","autoDetail","responseMode","aiInterval","lowPower","zoom","brightness","contrast","gamma","nightMode"].includes(id)) {
      detectionGeneration++; clearTimeout(personTimer); personTimer=null;
      updateResponseControls(); ensurePersonAnalysis();
    }
    $("motion").checked=false;$("alarmSource").value="person";
    if (id === "mode") setMode();
    if (id === "person") state.persons = [];
    if (id === "motion") { state.movingSince = 0; state.lastMotionAt = 0; state.moving = false; }
    if (["brightness", "contrast", "gamma", "zoom", "nightMode"].includes(id)) {
      updatePreview();
      draw();
    }
    if (["person", "autoAlarm", "confirmation"].includes(id))
      state.confirmed = 0;
    if (id === "person" && state.stream) loadModel().then(() => ensurePersonAnalysis());
    if (id === "recordQuality" && (state.recording || state.recordStarting)) {
      $(id).value = configuredRecordQuality;
      save();
      error("Detén el clip antes de cambiar su resolución.", "grabación");
    }
    if (id === "recordQuality" && !state.recording && !state.recordStarting) {
      configuredRecordQuality = $(id).value;
      frame.width = Math.min(video.videoWidth || 640, +$(id).value);
      frame.height = Math.round(frame.width * (video.videoHeight || 480) / (video.videoWidth || 640));
    }
    if (id === "previewQuality" && state.stream) $("sequenceStatus").textContent = "Calidad de captura guardada. Reinicia la cámara para aplicarla.";
    if (id === "zoom") {
      state.confirmed = 0;
      if (state.zone || state.mask) {
        error(
          "El zoom cambia el encuadre: revisa la zona y la máscara.",
          "modo",
        );
      }
    }
    if (id === "recordMode" && state.armed) stopRecording();
  }),
);
$("volume").oninput = () => {
  if (activeAudio) activeAudio.volume = +$("volume").value / 100;
};
$("torch").onchange = () => torch($("torch").checked);
async function beginZoneEditor(kind) {
  if (drawMode) return;
  if (!state.stream) await startCamera();
  if (!state.stream || !video.videoWidth) {
    error("Inicia y autoriza la cámara para dibujar la zona."); return;
  }
  await stopRecording();
  stopSounds();
  analysisGeneration++; detectionGeneration++; clearTimeout(personTimer); personTimer=null;
  state.previous = null;
  editorScroll = window.scrollY;
  drawMode = kind;
  zoneDraft = state[kind] ? {...state[kind]} : null;
  $("zoneEditorTitle").textContent = kind === "mask" ? "Máscara de privacidad" : "Zona de vigilancia";
  $("zoneEditorTools").hidden = false;
  $("zoneEditorHeading").hidden = false;
  $("zoneApply").disabled = !zoneDraft;
  document.body.classList.add("drawing");
  requestAnimationFrame(draw);
  tick();
}
function closeZoneEditor() {
  drawMode = null; zoneDraft = null; drag = null;
  document.body.classList.remove("drawing");
  $("zoneEditorTools").hidden = true;
  $("zoneEditorHeading").hidden = true;
  state.previous = null; state.movingSince = 0;
  window.scrollTo(0, editorScroll);
  requestAnimationFrame(draw);
  tick();
}
$("zone").onclick = () => beginZoneEditor("zone");
$("mask").onclick = () => beginZoneEditor("mask");
$("zoneCancel").onclick = closeZoneEditor;
$("zoneNew").onclick = () => { zoneDraft=null; $("zoneApply").disabled=true; draw(); };
$("zoneApply").onclick = async () => {
  if (!zoneDraft || !drawMode) return;
  state[drawMode] = {...zoneDraft};
  state.episode = null; state.persons=[]; state.motionBounds=null;
  save();
  log("modo", drawMode === "mask" ? "Máscara privada guardada" : "Zona de vigilancia guardada");
  $("sequenceStatus").textContent = "Zona guardada. Puedes ajustarla de nuevo con los tiradores.";
  closeZoneEditor();
};
$("clearZones").onclick = async () => {
  await stopRecording(); stopSounds();
  detectionGeneration++; clearTimeout(personTimer); personTimer=null;
  state.zone = null; state.mask = null; state.episode=null; state.persons=[];
  state.confirmed = 0; state.previous = null;
  save(); draw();
};
function point(e) {
  const b = overlay.getBoundingClientRect(), v = viewRect();
  return {x:Math.max(0,Math.min(1,(e.clientX-b.left-v.x)/v.w)),y:Math.max(0,Math.min(1,(e.clientY-b.top-v.y)/v.h))};
}
overlay.onpointerdown = (e) => {
  if (!drawMode || !state.stream || drag || (e.pointerType === "mouse" && e.button !== 0)) return;
  e.preventDefault();
  const p = point(e), v=viewRect();
  let corner=null;
  if(zoneDraft) for(const x of [0,1]) for(const y of [0,1]) {
    if(Math.abs(p.x-zoneDraft.x-x*zoneDraft.w)*v.w<26 && Math.abs(p.y-zoneDraft.y-y*zoneDraft.h)*v.h<26) corner={x,y};
  }
  const moving = zoneDraft && SecurityDetection.contains(p.x,p.y,zoneDraft) && !corner;
  drag={pointerId:e.pointerId,start:p,original:zoneDraft?{...zoneDraft}:null,corner,moving};
  if (!corner && !moving) zoneDraft={...p,w:0,h:0};
  try { overlay.setPointerCapture(e.pointerId); } catch {}
  draw();
};
overlay.onpointermove = (e) => {
  if(!drag || e.pointerId!==drag.pointerId) return;
  e.preventDefault();
  const p=point(e),o=drag.original;
  if(drag.moving) zoneDraft={...o,x:Math.max(0,Math.min(1-o.w,o.x+p.x-drag.start.x)),y:Math.max(0,Math.min(1-o.h,o.y+p.y-drag.start.y))};
  else {
    const anchor=drag.corner ? {x:o.x+(1-drag.corner.x)*o.w,y:o.y+(1-drag.corner.y)*o.h} : drag.start;
    zoneDraft={x:Math.min(p.x,anchor.x),y:Math.min(p.y,anchor.y),w:Math.abs(p.x-anchor.x),h:Math.abs(p.y-anchor.y)};
  }
  $("zoneApply").disabled=zoneDraft.w<.02 || zoneDraft.h<.02;
  draw();
};
overlay.onpointerup = (e) => {
  if(!drag || e.pointerId!==drag.pointerId) return;
  overlay.onpointermove(e);
  drag=null;
  $("zoneApply").disabled=!zoneDraft || zoneDraft.w<.02 || zoneDraft.h<.02;
  draw();
};
overlay.onpointercancel = () => {
  if(drag) zoneDraft=drag.original;
  drag=null;
  $("zoneApply").disabled=!zoneDraft;
  draw();
};
window.addEventListener("keydown", e => {if(e.key==="Escape" && drawMode) closeZoneEditor();});
$("filter").onchange = renderEvents;
$("clearLog").onclick = () =>
  authorizeLocalAction("Borrar historial", () => {
    events = [];
    localStorage.removeItem("security-events");
    renderEvents();
  });
let builtInSound;
async function loadSounds() {
  if (!builtInSound)
    builtInSound = fetch("assets/aviso-seguridad.mp3")
      .then((r) => {
        if (!r.ok) throw Error("No se puede cargar el aviso de seguridad");
        return r.blob();
      })
      .catch((e) => {
        builtInSound = null;
        throw e;
      });
  const blob = await builtInSound;
  soundBlobs.warning = blob;
  soundBlobs.notice = blob;
}
for (const [id, label] of [
  ["warning", "Escuchar aviso"],
  ["siren", "Probar sirena"],
]) {
  const button = document.createElement("button");
  button.textContent = label;
  button.onclick = async () => {
    stopSounds();
    await enableAudio();
    await loadSounds();
    await sound(id);
    if (id === "siren")
      alarmTimer = setTimeout(stopSounds, +$("alarmDuration").value * 1000);
  };
  $("sounds").append(button);
}
$("diagnose").onclick = async () => {
  const results = {
    HTTPS: isSecureContext,
    cámaraAPI: !!navigator.mediaDevices?.getUserMedia,
    cámaraActiva: !!state.stream,
    grabaciónAPI: !!window.MediaRecorder,
    formato: mime(),
    vídeoProcesado: !!frame.captureStream,
    linterna: !!state.stream?.getVideoTracks()[0]?.getCapabilities?.().torch,
    audio: {
      multimedia: audioReady,
      paused: mediaAudio.paused,
      readyState: mediaAudio.readyState,
      error: mediaAudio.error?.code || null,
      session: navigator.audioSession?.type || "no disponible",
    },
    IA: !!state.model,
    pantallaActivaAPI: !!navigator.wakeLock,
    IndexedDB: !!db,
  };
  try {
    const id = Date.now();
    await store("sounds", "put", {
      id: "diagnostic",
      blob: new Blob(["test"]),
    });
    await store("sounds", "delete", "diagnostic");
    results.escrituraLocal = "correcta";
  } catch (e) {
    results.escrituraLocal = e.message;
  }
  if (state.stream) {
    try {
      processed();
      const snapshot = await new Promise((resolve) =>
        frame.toBlob(resolve, "image/jpeg", 0.7),
      );
      results.fotografía =
        snapshot && snapshot.size > 0 ? "codificación correcta" : "falló";
      results.micrófono =
        state.stream.getAudioTracks().length === 0
          ? "ausente (correcto)"
          : "ERROR: pista inesperada";
      if (
        !state.armed &&
        !state.recording &&
        window.MediaRecorder &&
        !state.storageFailed
      ) {
        await startRecording("prueba integral");
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const started = state.recording;
        await stopRecording();
        results.clipDePrueba =
          started && !state.storageFailed
            ? "codificado y guardado; revisa Evidencias"
            : "no completado; revisa errores";
      } else
        results.clipDePrueba =
          "No se interrumpe la vigilancia o grabación activa. Usa Grabar manual para verificar.";
    } catch (e) {
      results.pruebaImagen = e.message;
    }
  }
  results.prueba =
    "No activa sirena ni concede permisos automáticamente. Prueba cámara, clip y cada audio con sus botones; verifica la evidencia descargada.";
  $("diagnostics").textContent = JSON.stringify(results, null, 2);
  log("modo", "Diagnóstico ejecutado");
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    analysisGeneration++; detectionGeneration++; clearTimeout(personTimer); personTimer=null;
    state.previous = null; state.movingSince = 0; state.lastMotionAt = 0; state.persons = []; state.episode = null;
    clearTimeout(loopTimer);
    state.confirmed = 0;
    stopSounds();
    stopRecording();
    log(
      "cámara",
      "Safari en segundo plano: vigilancia pausada, no se garantiza captura",
    );
  } else if (state.stream) {
    state.previous = null;
    tick();
  }
});
window.addEventListener("pagehide", () => {
  stopSounds();
  state.stream?.getTracks().forEach((t) => t.stop());
});
setInterval(
  () => ($("clock").textContent = new Date().toLocaleString("es-ES")),
  1000,
);
if (navigator.getBattery)
  navigator
    .getBattery()
    .then((b) => {
      const el = document.createElement("span");
      $("health").after(el);
      const update = () =>
        (el.textContent = `Batería ${Math.round(b.level * 100)}% · ${b.charging ? "con alimentación" : "sin alimentación"}`);
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    })
    .catch(() => {});
openDB()
  .then(async () => {
    await renderClips();
  })
  .catch((e) => {
    state.storageFailed = true;
    error("Almacenamiento local no disponible: " + e.message, "pérdida");
  });

if (!window.MediaRecorder) {
  $("record").disabled = true;
  $("record").textContent = "Vídeo no compatible";
  for (const option of $("recordMode").options)
    if (option.value !== "manual") option.disabled = true;
  $("recordMode").value = "manual";
  const hint = document.createElement("p");
  hint.textContent =
    "Este navegador no permite grabar vídeo con MediaRecorder. Usa fotografías manuales.";
  $("recordMode").parentElement.after(hint);
}

if (!window.PointerEvent) {
  $("zone").disabled = true;
  $("mask").disabled = true;
  const hint = document.createElement("p");
  hint.textContent =
    "Este Safari no admite Pointer Events para dibujar zonas táctiles. Actualiza iOS para usar zona restringida y máscaras.";
  $("clearZones").after(hint);
}

$("nightToggle").onclick = () => {
  const modes = ["auto", "on", "off"];
  $("nightMode").value = modes[(modes.indexOf($("nightMode").value) + 1) % 3];
  state.previous = null;
  updatePreview();
  save();
};
for (const id of ["brightness", "contrast", "zoom"])
  $(id).addEventListener("input", () => {
    updatePreview();
    draw();
  });
window.addEventListener("resize", draw);
updatePreview();

$("fullZone").onclick = () => {
  detectionGeneration++; clearTimeout(personTimer); personTimer=null; state.persons=[];
  state.zone = { x: 0, y: 0, w: 1, h: 1 };
  state.previous = null;
  save();
  draw();
  $("sequenceStatus").textContent =
    "Zona: imagen completa. Oriéntala solo a tu propiedad.";
};
function prepareDetection() {
  state.threatSince = 0;
  if (state.warningPending) stopSounds();
  save();
}
$("autoAlarm").addEventListener("change", prepareDetection);
$("alarmSource").addEventListener("change", prepareDetection);


let protecting = false;
function renderProtection() {
  const title = $("protectionTitle"),
    hint = $("protectionHint");
  document.body.dataset.protection = state.alarm
    ? "alarm"
    : state.warningPending
      ? "warning"
      : state.armed
        ? "armed"
        : "idle";
  if (protecting) {
    title.textContent = "Preparando protección";
    hint.textContent = state.stream
      ? "Preparando cámara y detectores…"
      : "Esperando permiso de cámara…";
  } else if (state.alarm) {
    title.textContent =
      siren || activeAudio ? "Alarma activada" : "Alarma sin sonido";
    hint.textContent =
      siren || activeAudio
        ? "El navegador reproduce la sirena. Si no la oyes, toca Probar sonido."
        : "El navegador no ha iniciado el audio. Revisa el error de sonido.";
  } else if (state.warningPending) {
    title.textContent = activeAudio ? "Aviso de seguridad" : "Preparando aviso";
    const left = Math.max(
      0,
      Math.ceil(22.13 - (Date.now() - state.warningStarted) / 1000),
    );
    hint.textContent =
      "Aviso de voz · " +
      left +
      " s. Después, sirena si continúa la detección.";
  } else if(state.peopleError) {
    title.textContent="Detección de personas detenida";hint.textContent="No se generan clips nuevos. Pulsa Reintentar en el visor.";
  } else if(state.stream && !$("person").checked) {
    title.textContent="Personas en pausa";hint.textContent="Activa la detección en el visor para mostrar recuadros.";
  } else if (state.armed) {
    title.textContent = $("mode").selectedOptions[0].textContent;
    hint.textContent = $("recordMode").value === "event"
      ? "Un clip por evento · " + $("clip").value + " s · sin micrófono"
      : "Detección activa · grabación automática deshabilitada";
  } else {
    title.textContent = "Sistema desarmado";
    hint.textContent = state.stream ? "Recuadros de personas en directo. Arma para grabar y activar alertas." : "Enciende la cámara para ver la detección de personas.";
  }
  $("protect").disabled = protecting;
  $("protect").textContent = protecting
    ? "Preparando…"
    : state.armed
      ? "Desarmar"
      : "Armar sistema";

}
// Unwrapped arming routine; the button below gets the local PIN wrapper in security.js.
async function armProtection() {
  if (protecting) return;
  if (state.armed) {
    $("mode").value = "disarmed";
    setMode();
    renderProtection();
    return;
  }
  protecting = true;
  $("error").textContent = "";
  renderProtection();
  try {
    // Audio is optional: a blocked speaker must not prevent silent surveillance.
    if ($("surveillanceMode").value !== "silent" && ($("autoVoice").checked || $("autoAlarm").checked)) await enableAudio();
    if (!state.stream) await startCamera();
    if (!state.stream) throw Error("No se ha podido iniciar la cámara. Revisa el permiso.");
    $("motion").checked=false;$("person").checked=true;$("alarmSource").value="person";
    await loadModel();
    if(!state.model || state.peopleError) throw Error("No se puede armar sin detección de personas: "+(state.peopleError||"modelo pendiente"));
    if(!state.stream) throw Error("La cámara se ha detenido. Iníciala antes de armar.");
    state.zone ||= { x: 0, y: 0, w: 1, h: 1 };
    $("mode").value = $("surveillanceMode").value;
    state.threatSince = 0;
    state.lastAlarm = 0;
    setMode();
    updatePreview();
    draw();
    save();
  } catch (e) {
    error(e.message, "alarma");
  } finally {
    protecting = false;
    renderProtection();
  }
}
$("protect").onclick = armProtection;
setInterval(renderProtection, 500);
renderProtection();

$("navHome").onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
for (const [id, selector] of [
  ["navClips", ".evidence"],
  ["navSettings", ".settings"],
])
  $(id).onclick = () => {
    const panel = document.querySelector(selector);
    panel.open = true;
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  };

$("testSpeaker").onclick = async () => {
  stopSounds();
  state.lastAlarm = Date.now();
  $("speakerStatus").textContent = "Preparando prueba…";
  if (await enableAudio()) {
    const played = await sound("warning");
    $("speakerStatus").textContent = played
      ? "El aviso está reproduciéndose. ¿Lo escuchas por el altavoz? Si no, desactiva Silencio y revisa la salida Bluetooth/AirPlay."
      : "No ha comenzado: " + $("error").textContent;
  } else
    $("speakerStatus").textContent =
      "Safari ha bloqueado la prueba. Toca otra vez para autorizarla.";
};
mediaAudio.addEventListener("error", () => {
  if (activeAudio || siren) {
    audioReady = false;
    stopSounds();
    error(
      "Error multimedia " +
        (mediaAudio.error?.code || "desconocido") +
        ". Toca Probar sonido.",
      "audio",
    );
  }
});

function renderSurveillanceStatus() {
  const cooldown = Math.max(0, Math.ceil(((state.recordCooldownUntil || 0) - Date.now()) / 1000));
  $("eventState").textContent = state.recording ? "REC · grabando clip" : cooldown ? "Cooldown · " + cooldown + " s" : state.episode ? "Episodio activo · sin repetir clip" : "Esperando evento";
  $("motionBadge").hidden = true;
  $("personBadge").hidden = !personFresh();
  renderPeopleStatus();
  $("audioBadge").textContent = audioReady ? "AUDIO READY" : "AUDIO · toca Probar sonido";
  renderDetectionStatus();
  $("powerBadge").textContent = $("lowPower").checked ? "LOW POWER" : state.slow ? "ANÁLISIS REDUCIDO" : "ESTÁNDAR";
  $("darkBadge").hidden = !state.armed || !state.night;
  $("modeBadge").textContent = "MODE · " + (state.armed ? $("mode").selectedOptions[0].textContent : "DESARMADO");
}
setInterval(renderSurveillanceStatus, 500);

$("openRecordings").onclick = () => $("navClips").click();

setInterval(() => {
  if (state.storageFailed) $("storageBadge").textContent = "STORAGE · ERROR";
}, 1000);

function renderDetectionStatus() {
  const signal=state.motionSignal;
  const capture=state.stream?.getVideoTracks()[0]?.getSettings?.() || {};
  $("detectionReadout").textContent = !state.stream ? "Inicia la cámara para comprobar el encuadre." :
    `${capture.width || video.videoWidth} × ${capture.height || video.videoHeight} · movimiento ${signal ? (signal.ratio*100).toFixed(2) : "0"}% de la zona · ` +
    (!$("person").checked ? "Personas pausadas" : state.peopleError ? "Error de IA: no hay clips automáticos" : drawMode ? "Detección en pausa mientras ajustas la zona" : !$("person").checked ? "IA desactivada" : !state.model ? "IA pendiente: se carga al armar" :
      (!state.personResultAt ? "IA preparada · primer análisis pendiente" : `IA ${state.aiDetail ? "detalle" : "general"} · análisis ${Math.round(state.aiMS||0)} ms · ${state.aiCadenceMS ? "ciclo " + Math.round(state.aiCadenceMS) + " ms" : "primer análisis"} · ${state.persons.length} recuadro(s)`) + (state.recordStartMS !== undefined ? ` · último clip: ${state.recordStartMS} ms tras el evento` : ""));
}

updateResponseControls();

function renderPeopleStatus() {
  if(!$("peopleStatus")) return;
  const status=$("peopleStatus"),detail=$("peopleStatusDetail");
  const live=!!state.stream&&!state.cameraMuted;
  const observed=state.persons.filter(p=>!p.seen || Date.now()-p.seen<Math.max(3000,personInterval()*3000));
  status.className="people-state";
  $("retryPeople").hidden=!live || (!state.peopleError && $("person").checked);
  $("retryPeople").textContent=state.peopleError?"Reintentar":"Activar personas";
  $("retryPeople").disabled=state.peopleLoading||personRunning;
  $("retryPeople").title=personRunning?"Espera al análisis en curso":"Volver a iniciar el reconocimiento de personas";
  if(!state.stream) {status.textContent="DETECCIÓN DE PERSONAS";detail.textContent="Enciende la cámara: aparecerá un recuadro sobre cada persona reconocida.";}
  else if(state.cameraMuted) {status.textContent="CÁMARA EN PAUSA";detail.textContent="No llegan imágenes. No se generan clips automáticos.";}
  else if(drawMode) {status.textContent="AJUSTANDO ZONA";detail.textContent="La detección se reanuda al salir del editor.";}
  else if(state.peopleError) {status.textContent="ERROR DE DETECCIÓN";status.classList.add("error");detail.textContent=state.peopleError+" · No se grabará por movimiento. Reintenta el detector.";}
  else if(!$("person").checked) {status.textContent="PERSONAS EN PAUSA";detail.textContent="Activa la detección para mostrar recuadros. No hay clips automáticos.";}
  else if(state.peopleLoading || !state.model) {status.textContent="CARGANDO DETECTOR DE PERSONAS…";detail.textContent="Preparando el modelo local. Todavía no hay reconocimiento activo.";}
  else if(!state.personResultAt) {status.textContent="PREPARANDO PRIMER ANÁLISIS…";detail.textContent="La IA está preparando su primer fotograma. Aún no hay reconocimiento confirmado.";}
  else {status.classList.add("ready");status.textContent=observed.length?"PERSONA DETECTADA · "+Math.round(Math.max(...observed.map(p=>p.score))*100)+"%":"BUSCANDO PERSONAS";detail.textContent=(state.zone?"Zona guardada":"Imagen completa")+" · "+(state.armed?($("recordMode").value==="event"?"Clips automáticos solo por personas.":"Recuadros activos · clips en modo manual."):"Recuadros activos. Arma para grabar automáticamente.");}
}
$("retryPeople").onclick=async()=>{
  if(state.peopleLoading || personRunning) return;
  $("person").checked=true;state.peopleError="";save();
  await loadModel();ensurePersonAnalysis();renderPeopleStatus();
};
$("peopleZone").onclick=()=>$("zone").onclick();
