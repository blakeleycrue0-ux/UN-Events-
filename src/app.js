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
aiFrame.width = 320;
aiFrame.height = 240;
const aiCtx = aiFrame.getContext("2d");
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
  audioContext,
  siren,
  gain,
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
function log(type, message) {
  const e = { type, message, time: Date.now() };
  events.unshift(e);
  events = events.slice(0, 500);
  try {
    localStorage.setItem("security-events", JSON.stringify(events));
  } catch {}
  renderEvents();
  document.dispatchEvent(new CustomEvent("security:event", { detail: e }));
}
function renderEvents() {
  $("events").replaceChildren();
  events
    .filter((e) => !$("filter").value || e.type === $("filter").value)
    .slice(0, 150)
    .forEach((e) => {
      const li = document.createElement("li");
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
  state.zone = s.zone || null;
  state.mask = s.mask || null;
  events = JSON.parse(localStorage.getItem("security-events") || "[]");
} catch {}
renderEvents();
let cameraGeneration = 0;
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
      method === "getAll" ? "readonly" : "readwrite",
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
      $("storage").textContent =
        `Uso del origen: ${(e.usage / 1048576).toFixed(1)} MB / ${(e.quota / 1048576).toFixed(0)} MB (cuota estimada, no garantía)`;
      return e;
    }
    $("storage").textContent = "Cuota no disponible en este navegador";
  } catch (e) {
    error(e.message, "pérdida");
  }
  return null;
}
async function capacity() {
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
  a.textContent = "Descargar clip pendiente: " + name;
  $("clips").prepend(a);
  a.click();
  // Keep emergency-download URLs alive until this page is closed. Safari may block automatic download.
}
async function renderClips() {
  clipURLs.forEach(URL.revokeObjectURL);
  clipURLs = [];
  $("clips").replaceChildren();
  const clips = await store("clips", "getAll");
  clips
    .sort((a, b) => b.id - a.id)
    .forEach((c) => {
      const card = document.createElement("div");
      card.className = "clip";
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
      del.onclick = async () => {
        if (confirm("¿Eliminar este clip?")) {
          await store("clips", "delete", c.id);
          renderClips();
          storage();
        }
      };
      card.append(p, v, a, star, del);
      $("clips").append(card);
    });
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
function processed() {
  if (!video.videoWidth) return;
  const [x, y, w, h] = crop();
  fx.drawImage(video, x, y, w, h, 0, 0, frame.width, frame.height);
  const brightness = +$("brightness").value / 100,
    contrast = +$("contrast").value / 100,
    gamma = +$("gamma").value / 100;
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
    const image = fx.getImageData(0, 0, frame.width, frame.height),
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
    fx.putImageData(image, 0, 0);
  }
  if (state.mask) {
    const m = state.mask;
    fx.fillStyle = "#000";
    fx.fillRect(
      m.x * frame.width,
      m.y * frame.height,
      m.w * frame.width,
      m.h * frame.height,
    );
  }
}
function viewRect() {
  const r = overlay.getBoundingClientRect();
  const ratio = frame.width / frame.height;
  let w = r.width,
    h = w / ratio;
  if (h > r.height) {
    h = r.height;
    w = h * ratio;
  }
  return { x: (r.width - w) / 2, y: (r.height - h) / 2, w, h };
}
function draw() {
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
  if (video.videoWidth) ctx.drawImage(frame, v.x, v.y, v.w, v.h);
  function rect(b, color, label) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(v.x + b.x * v.w, v.y + b.y * v.h, b.w * v.w, b.h * v.h);
    if (label) {
      ctx.fillStyle = color;
      ctx.font = "14px sans-serif";
      ctx.fillText(label, v.x + b.x * v.w + 4, v.y + b.y * v.h + 18);
    }
  }
  if (state.zone) rect(state.zone, "#70d39a", "Zona restringida");
  for (const p of state.persons)
    rect(p, "#fff", "Persona " + Math.round(p.score * 100) + "%");
  if (drag)
    rect(drag.rect, drawMode === "mask" ? "#ff9c9c" : "#70d39a", "Selección");
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
    error("Linterna no controlable: " + e.message);
  }
}
async function startCamera() {
  const generation = ++cameraGeneration;
  await stopCamera(false);
  if (generation !== cameraGeneration) return;
  $("error").textContent = "";
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
        width: { ideal: 640 },
        height: { ideal: 480 },
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
    frame.width = Math.min(video.videoWidth, 640);
    frame.height = Math.round(
      (frame.width * video.videoHeight) / video.videoWidth,
    );
    const track = state.stream.getVideoTracks()[0];
    track.onended = () => {
      error("La cámara se ha desconectado. Reiníciala manualmente.");
      stopCamera();
    };
    state.cameraMuted = false;
    track.onmute = () => {
      state.cameraMuted = true;state.confirmed = 0;
      $('live').textContent = 'PAUSA';$('live').className = '';
      log('cámara','La cámara no está entregando imágenes; vigilancia pausada');
      stopSounds();stopRecording();
    };
    track.onunmute = () => {
      state.cameraMuted = false;state.previous = null;state.confirmed = 0;
      $('live').textContent = 'LIVE';$('live').className = 'active';
      log('cámara','Captura de cámara recuperada');
      if(!document.hidden&&state.armed&&$('recordMode').value==='continuous')startRecording('continua');
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
    $("cameraMessage").textContent = "Cámara local · sin micrófono";
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
    if ($("person").checked) loadModel();
    if (state.armed && $("recordMode").value === "continuous")
      startRecording("continua");
  } catch (e) {
    if (generation !== cameraGeneration) return;
    error("No se puede iniciar la cámara: " + e.name + " · " + e.message);
    await stopCamera();
  }
}
async function stopCamera(invalidate = true) {
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
  state.persons = [];
  state.previous = null;
  state.confirmed = 0;
  state.armed = false;
  $("arm").textContent = "ACTIVAR VIGILANCIA";
  $("status").textContent = "DESARMADO";
  $("live").textContent = "SIN CÁMARA";
  $("live").className = "";
  $("camera").textContent = "Iniciar cámara";
  $("cameraMessage").textContent = "Cámara detenida · sin captura";
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
async function startRecording(reason) {
  if (
    document.hidden ||
    state.recording ||
    state.recordStarting ||
    !state.stream ||
    state.storageFailed
  )
    return;
  state.recordStarting = true;
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
    if (!state.stream) return;
    const type = mime();
    let stream;
    if (frame.captureStream) {
      processed();
      stream = frame.captureStream($("lowPower").checked ? 5 : 10);
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
      log("grabación", "Iniciada: " + reason);
    };
    current.onstop = async () => {
      state.recording = false;
      $("rec").hidden = true;
      $("record").textContent = "Grabar manual";
      const blob = new Blob(chunks, { type: current.mimeType || type });
      try {
        if (!blob.size) throw Error("Clip vacío");
        await store("clips", "put", {
          id,
          blob,
          reason,
          thumbnail,
          important: false,
        });
        log("grabación", "Finalizada y guardada: " + reason);
        await renderClips();
      } catch (e) {
        state.storageFailed = true;
        error(
          "No se ha guardado el clip: " + e.message + ". Descárgalo ahora.",
          "pérdida",
        );
        if (blob.size)
          download(
            blob,
            "SECURITY-" + id + (blob.type.includes("mp4") ? ".mp4" : ".webm"),
          );
      } finally {
        if (frame.captureStream) stream.getTracks().forEach((t) => t.stop());
        finish();
        if (
          !document.hidden &&
          !current.noRestart &&
          state.stream &&
          state.armed &&
          $("recordMode").value === "continuous" &&
          !state.storageFailed
        )
          setTimeout(() => startRecording("continua"), 100);
      }
    };
    current.start(1000);
    recTimer = setTimeout(
      () => stopRecording(true),
      Math.min(60, Math.max(10, +$("clip").value)) * 1000,
    );
  } catch (e) {
    error("Grabación no iniciada: " + e.message, "pérdida");
  } finally {
    state.recordStarting = false;
  }
}
async function stopRecording(rotate = false) {
  clearTimeout(recTimer);
  const r = recorder;
  if (r) r.noRestart = !rotate;
  if (r && r.state !== "inactive") {
    r.stop();
    await r.finished;
  }
  recorder = null;
}
async function enableAudio() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    const o = audioContext.createOscillator(),
      g = audioContext.createGain();
    g.gain.value = 0;
    o.connect(g);
    g.connect(audioContext.destination);
    o.start();
    o.stop(audioContext.currentTime + 0.02);
    $("enableAudio").textContent = "Sonido habilitado";
    return true;
  } catch (e) {
    error("No se puede habilitar audio: " + e.message, "audio");
    return false;
  }
}
function stopSounds() {
  soundGeneration++;
  activeAudio?.pause();
  activeAudio = null;
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
  if (!audioContext || audioContext.state !== "running") {
    error("Pulsa Habilitar sonido antes de reproducir.", "audio");
    return;
  }
  const generation = ++soundGeneration;
  try {
    activeAudio?.pause();
    activeAudio = null;
    if (soundBlobs[id]) {
      const bytes = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsArrayBuffer(soundBlobs[id]);
      });
      const buffer = await new Promise((resolve, reject) =>
        audioContext.decodeAudioData(bytes, resolve, reject),
      );
      if (generation !== soundGeneration) return;
      const source = audioContext.createBufferSource(),
        volume = audioContext.createGain();
      source.buffer = buffer;
      source.connect(volume);
      volume.connect(audioContext.destination);
      volume.gain.value = +$("volume").value / 100;
      const playback = {
        onended: null,
        pause() {
          source.onended = null;
          try {
            source.stop();
          } catch {}
          source.disconnect();
          volume.disconnect();
        },
        set volume(v) {
          volume.gain.value = v;
        },
      };
      source.onended = () => {
        source.disconnect();
        volume.disconnect();
        if (playback.onended) playback.onended();
      };
      activeAudio = playback;
      source.start();
      log("audio", "Reproduciendo MP3: " + id);
    } else if (id === "siren") {
      siren = audioContext.createOscillator();
      gain = audioContext.createGain();
      gain.gain.value = (+$("volume").value / 100) * 0.35;
      siren.connect(gain);
      gain.connect(audioContext.destination);
      siren.type = "sawtooth";
      const now = audioContext.currentTime;
      for (let i = 0; i < 31; i++) {
        siren.frequency.setValueAtTime(600, now + i);
        siren.frequency.linearRampToValueAtTime(1000, now + i + 0.5);
      }
      siren.start();
      log("audio", "Sirena sintetizada iniciada");
    } else error("Importa un MP3 para este aviso.", "audio");
  } catch (e) {
    error("Fallo de reproducción: " + e.message, "audio");
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
function detected(type) {
  if (!state.armed || $("mode").value === "disarmed") return;
  const now = Date.now();
  state.eventTimes ||= {};
  if (
    now - (state.eventTimes[type] || 0) <
    Math.max(10000, +$("clip").value * 1000)
  )
    return;
  state.eventTimes[type] = now;
  log(
    type,
    type === "persona"
      ? "Persona en zona de detección"
      : "Movimiento en zona de detección",
  );
  if ($("recordMode").value === (type === "persona" ? "person" : "motion"))
    startRecording(type);
  if ($("mode").value === "deter") {
    if ($("autoVoice").checked) {
      const first = $("autoNotice").checked
        ? "notice"
        : $("autoWarning").checked
          ? "warning"
          : null;
      if (first)
        sound(first).then(() => {
          if (first === "notice" && $("autoWarning").checked && activeAudio) {
            activeAudio.onended = () => {
              if (state.armed && $("mode").value === "deter") sound("warning");
            };
          }
        });
    }
    if (!$("torch").disabled && $("eventLight").checked) torch(true);
  }
}
async function loadModel() {
  if (state.model || state.busy || !$("person").checked) return;
  state.busy = true;
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
        maxDetected: 8,
        skipFrames: 0,
        skipTime: 0,
      },
    });
    await detector.load();
    if (!detector.models.loaded().length)
      throw Error("No se han cargado pesos del modelo");
    state.model = detector;
    log("modo", "Modelo local CenterNet MobileNet cargado (4 MB de pesos)");
  } catch (e) {
    $("person").checked = false;
    save();
    error(
      "IA no disponible: " + e.message + ". Movimiento sigue disponible.",
      "cámara",
    );
  } finally {
    state.busy = false;
  }
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
async function tick() {
  if (!state.stream || document.hidden) return;
  if(state.cameraMuted||video.readyState<2){loopTimer=setTimeout(tick,1000);return;}
  const started = performance.now();
  try {
    processed();
    analysis.width = state.slow || $("lowPower").checked ? 128 : 192;
    analysis.height = Math.round((analysis.width * frame.height) / frame.width);
    ax.drawImage(frame, 0, 0, analysis.width, analysis.height);
    const d = ax.getImageData(0, 0, analysis.width, analysis.height).data;
    const grey = new Uint8Array(d.length / 4);
    let sum = 0,
      count = 0,
      diff = 0,
      meanDiff = 0;
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
      if (state.previous) meanDiff += grey[i] - state.previous[i];
    }
    meanDiff /= Math.max(1, count);
    state.light =
      state.rawLight === null ? sum / Math.max(1, count) : state.rawLight;
    state.night = state.light < 45;
    const sensitivity = +(
      state.night ? $("nightSensitivity") : $("sensitivity")
    ).value;
    if (state.previous) {
      for (let i = 0; i < grey.length; i++) {
        const p = {
          x: (i % analysis.width) / analysis.width,
          y: Math.floor(i / analysis.width) / analysis.height,
          w: 0,
          h: 0,
        };
        if (!inside(p, state.zone) || (state.mask && inside(p, state.mask)))
          continue;
        if (
          Math.abs(grey[i] - state.previous[i] - meanDiff) >
          16 + (100 - sensitivity) * 0.35
        )
          diff++;
      }
      const moving =
        diff / Math.max(1, count) > 0.015 + (100 - sensitivity) * 0.001;
      state.motionFrames = moving ? (state.motionFrames || 0) + 1 : 0;
      if ($("motion").checked && state.motionFrames >= 2)
        detected("movimiento");
    }
    state.previous = grey;
    if (
      $("person").checked &&
      state.model &&
      !state.busy &&
      Date.now() - lastAI >= Math.max(1, +$("aiInterval").value) * 1000
    ) {
      lastAI = Date.now();
      state.busy = true;
      try {
        aiFrame.height = Math.round((320 * frame.height) / frame.width);
        aiCtx.drawImage(frame, 0, 0, aiFrame.width, aiFrame.height);
        const result = await state.model.detect(aiFrame, {
          object: { minConfidence: +$("confidence").value / 100 },
        });
        const predictions = result.object || [];
        state.persons = predictions
          .filter(
            (p) =>
              p.label === "person" && p.score >= +$("confidence").value / 100,
          )
          .map((p) => ({
            x: p.boxRaw[0],
            y: p.boxRaw[1],
            w: p.boxRaw[2],
            h: p.boxRaw[3],
            score: p.score,
          }))
          .filter((p) => inside(p, state.zone));
        if (state.persons.length) {
          if (!state.personPresent) {
            detected("persona");
            state.personPresent = true;
          }
          state.personMissing = 0;
          if (
            state.armed &&
            $("mode").value === "alarm" &&
            $("autoAlarm").checked &&
            state.zone
          ) {
            if (
              state.lastPersonAt &&
              Date.now() - state.lastPersonAt >
                Math.max(1, +$("aiInterval").value) * 2500
            )
              state.confirmed = 0;
            state.lastPersonAt = Date.now();
            state.confirmed ||= Date.now();
            if (
              Date.now() - state.confirmed >=
              Math.max(1, +$("confirmation").value) * 1000
            )
              alarm("Persona confirmada en zona restringida");
          }
        } else {
          state.confirmed = 0;
          state.personMissing = (state.personMissing || 0) + 1;
          if (state.personMissing >= 2) state.personPresent = false;
        }
      } catch (e) {
        $("person").checked = false;
        state.persons = [];
        state.confirmed = 0;
        error(
          "IA detenida: " +
            e.message +
            ". Se mantiene detección de movimiento.",
        );
        save();
      } finally {
        state.busy = false;
      }
    } else if (!$("person").checked) {
      state.persons = [];
      state.confirmed = 0;
      state.personPresent = false;
    }
    draw();
    const ms = performance.now() - started;
    state.slow = ms > 220 || (state.slow && ms > 100);
    $("health").textContent =
      `${state.night ? "Luz insuficiente: detección limitada" : "Iluminación disponible"} · análisis ${analysis.width} px · ${Math.round(ms)} ms${state.slow ? " · resolución reducida por rendimiento" : ""} · activo ${Math.floor((Date.now() - state.started) / 60000)} min`;
  } catch (e) {
    error("Fallo de análisis: " + e.message);
  } finally {
    if (state.stream && !document.hidden)
      loopTimer = setTimeout(tick, $("lowPower").checked ? 500 : 250);
  }
}
function setMode() {
  state.confirmed = 0;
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
  else if ($("recordMode").value === "continuous") startRecording("continua");
  log("modo", $("status").textContent);
  save();
}
$("camera").onclick = () => (state.stream ? stopCamera() : startCamera());
$("restart").onclick = startCamera;
$("device").onchange = startCamera;
$("arm").onclick = () => {
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
$("alarm").onclick = () => alarm("Activación manual", true);
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
$("fullscreen").onclick = async () => {
  try {
    if ($("stage").requestFullscreen) await $("stage").requestFullscreen();
    else
      error(
        "Pantalla completa no disponible en este Safari. Usa Ocultar controles.",
      );
  } catch (e) {
    error(e.message);
  }
};
$("hide").onclick = () => {
  document.body.classList.add("hidden-controls");
  $("unlock").textContent = "Mostrar controles";
};
$("unlock").onclick = async () => {
  if (document.body.classList.contains("locked")) {
    const pin = prompt("PIN local");
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
  else return error("Establece primero un PIN local", "modo");
  $("unlock").textContent = document.body.classList.contains("locked")
    ? "Desbloquear"
    : "Bloquear controles";
};
async function hash(s) {
  if (!crypto.subtle) throw Error("PIN requiere HTTPS");
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
$("pin").onclick = async () => {
  try {
    const pin = prompt(
      "Nuevo PIN local (mínimo 6 cifras). No cifra los clips.",
    );
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
    if (id === "mode") setMode();
    if (["person", "autoAlarm", "confirmation"].includes(id))
      state.confirmed = 0;
    if (id === "person") loadModel();
    if (id === "zoom") {
      state.confirmed = 0;
      if (state.zone || state.mask) {
        error(
          "El zoom cambia el encuadre: revisa la zona y la máscara.",
          "modo",
        );
      }
    }
    if (id === "recordMode" && state.armed) {
      stopRecording().then(() => {
        if ($("recordMode").value === "continuous") startRecording("continua");
      });
    }
  }),
);
$("volume").oninput = () => {
  if (activeAudio) activeAudio.volume = +$("volume").value / 100;
  if (gain) gain.gain.value = (+$("volume").value / 100) * 0.35;
};
$("torch").onchange = () => torch($("torch").checked);
$("zone").onclick = () => {
  drawMode = "zone";
  document.body.classList.add("drawing");
};
$("mask").onclick = () => {
  drawMode = "mask";
  document.body.classList.add("drawing");
};
$("clearZones").onclick = async () => {
  await stopRecording();
  state.zone = null;
  state.mask = null;
  state.confirmed = 0;
  state.previous = null;
  save();
};
function point(e) {
  const b = overlay.getBoundingClientRect(),
    v = viewRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - b.left - v.x) / v.w)),
    y: Math.max(0, Math.min(1, (e.clientY - b.top - v.y) / v.h)),
  };
}
overlay.onpointerdown = (e) => {
  if (!drawMode || !state.stream) return;
  const p = point(e);
  drag = { start: p, rect: { ...p, w: 0, h: 0 } };
  overlay.setPointerCapture(e.pointerId);
};
overlay.onpointermove = (e) => {
  if (!drag) return;
  const p = point(e),
    s = drag.start;
  drag.rect = {
    x: Math.min(p.x, s.x),
    y: Math.min(p.y, s.y),
    w: Math.abs(p.x - s.x),
    h: Math.abs(p.y - s.y),
  };
  draw();
};
overlay.onpointerup = async () => {
  if (!drag) return;
  const r = drag.rect,
    kind = drawMode;
  drag = null;
  drawMode = null;
  document.body.classList.remove("drawing");
  if (r.w > 0.02 && r.h > 0.02) {
    await stopRecording();
    state[kind] = r;
    state.previous = null;
    state.confirmed = 0;
    save();
    log(
      "modo",
      kind === "mask"
        ? "Máscara privada aplicada"
        : "Zona restringida aplicada",
    );
  }
};
$("filter").onchange = renderEvents;
$("clearLog").onclick = () => {
  if (confirm("¿Borrar historial de eventos?")) {
    events = [];
    localStorage.removeItem("security-events");
    renderEvents();
  }
};
async function loadSounds() {
  for (const s of await store("sounds", "getAll")) {
    if (soundURLs[s.id]) URL.revokeObjectURL(soundURLs[s.id]);
    soundURLs[s.id] = URL.createObjectURL(s.blob);
    soundBlobs[s.id] = s.blob;
    $("label-" + s.id).textContent = s.name;
  }
}
for (const [id, label] of [
  ["notice", "Aviso de zona videovigilada"],
  ["warning", "Respeto a la propiedad"],
  ["siren", "Sirena de seguridad"],
]) {
  const wrap = document.createElement("div"),
    name = document.createElement("p"),
    test = document.createElement("button"),
    input = document.createElement("input");
  name.id = "label-" + id;
  name.textContent = label + (id === "siren" ? " · sintetizada" : " · sin MP3");
  test.textContent = "Probar: " + label;
  test.onclick = async () => {
    stopSounds();
    await sound(id);
    alarmTimer = setTimeout(
      stopSounds,
      Math.min(30, +$("alarmDuration").value) * 1000,
    );
  };
  input.type = "file";
  input.accept = "audio/mpeg,.mp3";
  input.setAttribute("aria-label", "Importar MP3: " + label);
  input.onchange = async () => {
    try {
      const file = input.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024)
        throw Error(
          "Máximo 5 MB por audio; usa avisos cortos para ahorrar memoria",
        );
      await store("sounds", "put", { id, name: file.name, blob: file });
      await loadSounds();
      log("audio", "MP3 importado: " + label);
    } catch (e) {
      error("No se puede guardar el MP3: " + e.message, "audio");
    }
  };
  wrap.append(name, test, input);
  $("sounds").append(wrap);
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
    audio: audioContext?.state || "sin habilitar",
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
    if (state.armed && $("recordMode").value === "continuous")
      startRecording("continua");
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
    await loadSounds();
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
