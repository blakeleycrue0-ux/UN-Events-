(() => {
  // src/jarvis/common.js
  var $ = (id) => document.getElementById(id);
  var store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    }
  };
  function loadSettings() {
    const settings2 = Object.assign({
      name: "Crew",
      key: "",
      lang: "en",
      hear: "es-ES",
      facing: "user",
      greet: true,
      crop: { cx: 0.5, cy: 0.5, zoom: 1 },
      wake: true,
      gestures: true,
      quietFrom: 23,
      quietTo: 8,
      city: "Calvi\xE0",
      lat: 39.56,
      lon: 2.51
    }, store.get("jarvis-settings", {}));
    settings2.save = () => {
      const { save, ...plain } = settings2;
      void save;
      store.set("jarvis-settings", plain);
    };
    return settings2;
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(Error("No se pudo cargar " + src));
      document.head.append(s);
    });
  }
  var config = () => window.SECURITY_SUPABASE_PUBLIC || {};
  function call(name, body, key, init = {}) {
    const c = config();
    return fetch(`${c.url}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-jarvis-key": key, apikey: c.key || "", ...init.headers || {} },
      body: init.raw ?? JSON.stringify(body)
    });
  }
  function clockParts(lang) {
    const now = /* @__PURE__ */ new Date(), locale = lang === "es" ? "es-ES" : "en-GB";
    const date = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
    return { time: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), date: date.charAt(0).toUpperCase() + date.slice(1) };
  }

  // src/pared.js
  var settings = loadSettings();
  var wall = window.wall = {
    started: false,
    stream: null,
    detector: null,
    busy: false,
    enrolling: null,
    loop: null,
    threshold: 0.55,
    absenceMS: 9e4,
    seen: {},
    lastUnknown: 0,
    sent: [],
    settings
  };
  store.set("jarvis-role", "wall");
  function tick() {
    const { time, date } = clockParts("es");
    $("clock").textContent = time;
    $("date").textContent = date;
    const m = (/* @__PURE__ */ new Date()).getMinutes();
    $("wallFace").style.transform = `translate(${m % 7 * 6 - 18}px, ${m % 5 * 8 - 16}px)`;
  }
  tick();
  setInterval(tick, 1e3);
  function status(text) {
    $("wallState").textContent = text;
  }
  async function tell(kind, extra = {}) {
    if (!settings.key) {
      status("Falta la clave de Jarvis (toca la pantalla)");
      return false;
    }
    try {
      const response = await call("jarvis-event", { kind, ...extra }, settings.key);
      wall.sent.push({ kind, ...extra, ok: response.ok });
      $("linkDot").classList.toggle("on", response.ok);
      if (!response.ok) status(response.status === 401 ? "La clave de Jarvis no coincide" : "No llego al escritorio");
      return response.ok;
    } catch {
      $("linkDot").classList.remove("on");
      status("Sin conexi\xF3n");
      return false;
    }
  }
  setInterval(() => {
    if (wall.started) void tell("status", { camera: true });
  }, 12e4);
  async function realDetector() {
    if (!window.Human) await loadScript("vendor/human.js");
    const human = new Human.Human({
      backend: "webgl",
      modelBasePath: new URL("models/", location.href).href,
      cacheModels: false,
      debug: false,
      async: false,
      warmup: "none",
      filter: { enabled: false, return: false },
      face: {
        enabled: true,
        // skipFrames/skipTime 0: Human otherwise reuses old results for 2–3 s.
        detector: { rotation: false, maxDetected: 3, minConfidence: 0.5, return: false, skipFrames: 0, skipTime: 0 },
        mesh: { enabled: true, skipFrames: 0, skipTime: 0 },
        iris: { enabled: false },
        description: { enabled: true, skipFrames: 0, skipTime: 0 },
        emotion: { enabled: false },
        antispoof: { enabled: false },
        liveness: { enabled: false },
        attention: { enabled: false }
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
      segmentation: { enabled: false }
    });
    await human.load();
    const stats = human.models.stats();
    const missing = ["blazeface", "facemesh", "faceres"].filter((n) => {
      const m = stats.modelStats.find((s) => s.name === n);
      return !m?.loaded || m.sizeLoadedWeights <= 0;
    });
    if (missing.length) {
      human.reset();
      throw Error("No se cargaron los modelos de caras (" + missing.join(", ") + ").");
    }
    return {
      async detect(input) {
        const result = await human.detect(input);
        const issue = result?.error;
        if (!result || issue && (!Array.isArray(issue) || issue.length)) throw Error("Fallo del modelo de caras.");
        return (result.face || []).filter((f) => f.embedding?.length).map((f) => ({ embedding: Array.from(f.embedding), score: f.faceScore ?? f.score ?? 0, box: f.boxRaw ? Array.from(f.boxRaw) : null }));
      },
      similarity: (a, b) => human.match.similarity(a, b)
    };
  }
  wall.createDetector = realDetector;
  var ROLES = { me: "T\xFA", mom: "Mam\xE1", dad: "Pap\xE1", other: "Otra persona" };
  function loadPeople() {
    const saved = store.get("jarvis-people", null);
    if (Array.isArray(saved)) return saved;
    const legacy = store.get("jarvis-faces", []);
    return legacy.length ? [{ id: "me", role: "me", name: settings.name, greeting: "", samples: legacy }] : [];
  }
  wall.people = loadPeople();
  var savePeople = () => store.set("jarvis-people", wall.people);
  var displayName = (p) => p.role === "me" ? settings.name : p.name;
  function identify(embedding) {
    const scores = wall.people.filter((p) => p.samples?.length).map((p) => ({
      person: p,
      score: Math.max(...p.samples.map((known) => wall.detector.similarity(embedding, known)))
    })).sort((a, b) => b.score - a.score);
    const [best, second] = scores;
    if (!best || best.score < wall.threshold || second && best.score - second.score < 0.03) return { score: best?.score || 0 };
    return best;
  }
  wall.identify = identify;
  async function startCamera() {
    wall.stream?.getTracks().forEach((t) => t.stop());
    wall.stream = await navigator.mediaDevices.getUserMedia({
      // Up to 4K: the door crop needs the pixels for faces ~5 m away.
      audio: false,
      video: { facingMode: settings.facing, width: { ideal: 3840 }, height: { ideal: 2160 } }
    });
    $("video").srcObject = wall.stream;
    $("preview").classList.toggle("back", settings.facing === "environment");
    await $("video").play().catch(() => {
    });
    $("camDot").classList.add("on");
    drawFrame();
  }
  var cropCanvas = document.createElement("canvas");
  var cropCtx = cropCanvas.getContext("2d");
  function cropRect(video) {
    const c = settings.crop || { cx: 0.5, cy: 0.5, zoom: 1 };
    const zoom = Math.min(6, Math.max(1, +c.zoom || 1)), w = 1 / zoom, h = 1 / zoom;
    const x = Math.min(1 - w, Math.max(0, c.cx - w / 2)), y = Math.min(1 - h, Math.max(0, c.cy - h / 2));
    return { x, y, w, h, sx: x * video.videoWidth, sy: y * video.videoHeight, sw: w * video.videoWidth, sh: h * video.videoHeight };
  }
  function frameInput(video) {
    if ((settings.crop?.zoom || 1) <= 1.01) return video;
    const r = cropRect(video), scale = Math.min(1, 960 / r.sw);
    cropCanvas.width = Math.round(r.sw * scale);
    cropCanvas.height = Math.round(r.sh * scale);
    cropCtx.drawImage(video, r.sx, r.sy, r.sw, r.sh, 0, 0, cropCanvas.width, cropCanvas.height);
    return cropCanvas;
  }
  function drawFrame() {
    const box = $("frameBox"), video = $("video");
    if (!video.videoWidth) return;
    const r = cropRect(video), mirror = settings.facing === "user";
    box.style.left = (mirror ? 1 - r.x - r.w : r.x) * 100 + "%";
    box.style.top = r.y * 100 + "%";
    box.style.width = r.w * 100 + "%";
    box.style.height = r.h * 100 + "%";
    box.hidden = (settings.crop?.zoom || 1) <= 1.01;
    $("zoom").value = settings.crop?.zoom || 1;
    $("zoomValue").textContent = (+(settings.crop?.zoom || 1)).toFixed(1) + "\xD7";
    $("frameInfo").textContent = `C\xE1mara ${video.videoWidth}\xD7${video.videoHeight} \xB7 zona analizada ${Math.round(r.sw)}\xD7${Math.round(r.sh)} px`;
  }
  $("video").addEventListener("loadedmetadata", drawFrame);
  async function scan() {
    clearTimeout(wall.loop);
    if (!wall.started || document.hidden) return;
    const video = $("video");
    if (!wall.busy && video.readyState >= 2) {
      wall.busy = true;
      try {
        const found = await wall.detector.detect(frameInput(video));
        drawBoxes(found);
        onFaces(found);
      } catch (e) {
        $("faceState").textContent = "Error: " + e.message;
      } finally {
        wall.busy = false;
      }
    }
    wall.loop = setTimeout(scan, wall.enrolling ? 200 : 120);
  }
  wall.scan = scan;
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
      Object.assign(el.style, { left: (mirror ? 1 - x - w : x) * 100 + "%", top: y * 100 + "%", width: w * 100 + "%", height: h * 100 + "%" });
      const tag = document.createElement("span");
      tag.textContent = m.person ? displayName(m.person) : wall.enrolling ? "\u2026" : "?";
      el.append(tag);
      return el;
    });
    layer.replaceChildren(...boxes);
    if (boxes.length && !wall.enrolling && !framing && $("settings").hidden) {
      clearTimeout(wall.spotTimer);
      const preview = $("preview");
      if (preview.classList.contains("stash")) {
        preview.classList.remove("stash");
        preview.classList.add("spot");
      }
      wall.spotTimer = setTimeout(() => {
        if (preview.classList.contains("spot")) {
          preview.classList.remove("spot");
          preview.classList.add("stash");
          layer.replaceChildren();
        }
      }, 4e3);
    }
  }
  wall.drawBoxes = drawBoxes;
  function onFaces(found) {
    if (wall.enrolling) return enrollStep(found);
    const known = wall.people.some((p) => p.samples?.length);
    if (!found.length) {
      $("faceState").textContent = known ? "Nadie en la puerta" : "Sin caras registradas";
      return;
    }
    const now = Date.now(), names = [];
    let unknown = 0;
    for (const face of found) {
      const match = known ? identify(face.embedding) : {};
      if (!match.person) {
        unknown++;
        continue;
      }
      const p = match.person;
      names.push(displayName(p));
      const away = now - (wall.seen[p.id] || 0) > wall.absenceMS;
      wall.seen[p.id] = now;
      if (away) {
        $("wallSeen").textContent = `${displayName(p)} \xB7 ${(/* @__PURE__ */ new Date()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
        void tell("arrival", { person: { name: displayName(p), role: p.role, greeting: p.greeting || "" } });
      }
    }
    if (unknown && now - wall.lastUnknown > 12e4) {
      wall.lastUnknown = now;
      void tell("unknown", { count: unknown });
    }
    $("faceState").textContent = [...names, ...unknown ? ["Desconocido"] : []].join(" \xB7 ");
  }
  function enrollStep(found) {
    const e = wall.enrolling, person = wall.people.find((p) => p.id === e.personId);
    if (!person) {
      endEnroll();
      return;
    }
    if (found.length !== 1 || found[0].score < 0.6) {
      $("faceInfo").textContent = found.length > 1 ? "Hay m\xE1s de una cara. Que se ponga solo." : "No veo bien la cara. Mira a la c\xE1mara.";
      return;
    }
    e.samples.push(found[0].embedding.map((x) => Math.round(x * 1e4) / 1e4));
    $("faceInfo").textContent = `Aprendiendo la cara de ${displayName(person)}\u2026 ${e.samples.length}/5`;
    if (e.samples.length >= 5) {
      person.samples = e.samples;
      endEnroll();
      if (!savePeople()) {
        $("faceInfo").textContent = "No se pudo guardar en este navegador.";
        return;
      }
      renderPeople();
      $("faceInfo").textContent = `Listo: ya reconozco a ${displayName(person)}.`;
    }
  }
  function endEnroll() {
    wall.enrolling = null;
    $("preview").classList.add("stash");
    document.body.append($("preview"));
  }
  function startEnroll(person) {
    if (framing) setFraming(false);
    if (!wall.started) {
      $("faceInfo").textContent = "Primero pulsa \xABEmpezar a vigilar\xBB.";
      return;
    }
    wall.enrolling = { personId: person.id, samples: [] };
    $("enrollSlot").append($("preview"));
    $("preview").classList.remove("stash", "spot");
    $("faceInfo").textContent = person.role === "me" ? "Ponte delante de la c\xE1mara\u2026" : `Que ${displayName(person)} se ponga delante de la c\xE1mara\u2026`;
    void scan();
  }
  function renderPeople() {
    const list = $("people");
    list.replaceChildren();
    if (!wall.people.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Todav\xEDa no conozco a nadie.";
      list.append(p);
    }
    for (const person of wall.people) {
      const row = document.createElement("div");
      row.className = "person";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = displayName(person);
      const sub = document.createElement("span");
      sub.className = "muted";
      sub.textContent = ROLES[person.role] + " \xB7 " + (person.samples?.length ? "cara registrada" : "falta la cara");
      info.append(title, sub);
      const learn = document.createElement("button");
      learn.className = "pill small";
      learn.textContent = person.samples?.length ? "Repetir cara" : "Registrar cara";
      learn.onclick = () => startEnroll(person);
      const remove = document.createElement("button");
      remove.className = "pill ghost small";
      remove.textContent = "Borrar";
      remove.onclick = () => {
        wall.people = wall.people.filter((p) => p !== person);
        savePeople();
        renderPeople();
      };
      row.append(info, learn, remove);
      list.append(row);
    }
    $("personRole").querySelector('option[value="me"]').disabled = wall.people.some((p) => p.role === "me");
    if ($("personRole").selectedOptions[0]?.disabled) $("personRole").value = "mom";
  }
  wall.renderPeople = renderPeople;
  var framing = false;
  var drag = null;
  function setFraming(on) {
    framing = on && wall.started;
    $("frameEditor").hidden = !framing;
    $("frameToggle").textContent = framing ? "Listo" : "Ajustar encuadre";
    if (on && !wall.started) {
      $("frameInfo").textContent = "Primero pulsa \xABEmpezar a vigilar\xBB.";
      return;
    }
    if (framing) {
      if (wall.enrolling) endEnroll();
      $("frameSlot").append($("preview"));
      $("preview").classList.remove("stash", "spot");
      $("preview").classList.add("framing");
      drawFrame();
    } else if (!wall.enrolling) {
      $("preview").classList.add("stash");
      $("preview").classList.remove("framing");
      document.body.append($("preview"));
    }
  }
  $("frameToggle").onclick = () => setFraming(!framing);
  $("zoom").oninput = () => {
    settings.crop = { ...settings.crop, zoom: +$("zoom").value };
    settings.save();
    drawFrame();
  };
  $("frameReset").onclick = () => {
    settings.crop = { cx: 0.5, cy: 0.5, zoom: 1 };
    settings.save();
    drawFrame();
  };
  $("frameSlot").addEventListener("pointerdown", (e) => {
    if (!framing) return;
    const area = $("video").getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, cx: settings.crop.cx, cy: settings.crop.cy, w: area.width, h: area.height };
    $("frameSlot").setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  $("frameSlot").addEventListener("pointermove", (e) => {
    if (!drag) return;
    const mirror = settings.facing === "user" ? -1 : 1, half = 0.5 / (settings.crop.zoom || 1);
    const cx = Math.min(1 - half, Math.max(half, drag.cx + mirror * (e.clientX - drag.x) / drag.w));
    const cy = Math.min(1 - half, Math.max(half, drag.cy + (e.clientY - drag.y) / drag.h));
    settings.crop = { ...settings.crop, cx, cy };
    drawFrame();
  });
  var endDrag = () => {
    if (drag) {
      drag = null;
      settings.save();
    }
  };
  $("frameSlot").addEventListener("pointerup", endDrag);
  $("frameSlot").addEventListener("pointercancel", endDrag);
  async function keepAwake() {
    try {
      if (navigator.wakeLock && !document.hidden) await navigator.wakeLock.request("screen");
    } catch {
    }
  }
  async function start() {
    $("wallStart").disabled = true;
    status("Encendiendo la c\xE1mara\u2026");
    try {
      await startCamera();
      wall.detector = wall.detector || await wall.createDetector();
      wall.started = true;
      $("wallStart").hidden = true;
      status(settings.key ? "Vigilando la puerta" : "Falta la clave de Jarvis (toca la pantalla)");
      await keepAwake();
      void scan();
      if (settings.key) void tell("status", { camera: true });
    } catch (e) {
      status(e.name === "NotAllowedError" ? "Necesito la c\xE1mara: perm\xEDtela en Safari" : "No he podido arrancar: " + e.message);
      $("wallStart").disabled = false;
    }
  }
  wall.start = start;
  $("wallStart").onclick = start;
  $("wall").onclick = (e) => {
    if (e.target !== $("wallStart")) openSettings();
  };
  function openSettings() {
    $("name").value = settings.name;
    $("voiceKey").value = settings.key;
    $("facing").value = settings.facing;
    renderPeople();
    $("faceInfo").textContent = "";
    $("settings").hidden = false;
    if ($("preview").classList.contains("spot")) {
      $("preview").classList.remove("spot");
      $("preview").classList.add("stash");
    }
  }
  $("closeSettings").onclick = () => {
    if (framing) setFraming(false);
    if (wall.enrolling) endEnroll();
    $("settings").hidden = true;
  };
  $("name").onchange = () => {
    settings.name = $("name").value.trim() || "Crew";
    settings.save();
  };
  $("voiceKey").onchange = () => {
    settings.key = $("voiceKey").value.trim();
    settings.save();
    if (wall.started) status("Vigilando la puerta");
  };
  $("facing").onchange = async () => {
    settings.facing = $("facing").value;
    settings.save();
    if (wall.started) await startCamera().catch(() => {
    });
  };
  $("testLink").onclick = async () => {
    $("linkInfo").textContent = "Enviando\u2026";
    const ok = await tell("test", { person: { name: settings.name, role: "me" } });
    $("linkInfo").textContent = ok ? "Enviado: el Chromebook deber\xEDa decir algo." : "No ha llegado. Revisa la clave.";
  };
  $("addPerson").onclick = () => {
    const role = $("personRole").value;
    const name = role === "me" ? settings.name : $("personName").value.trim() || ROLES[role];
    const person = { id: role === "me" ? "me" : "p" + Date.now().toString(36), role, name: name.slice(0, 30), greeting: $("personGreeting").value.trim().slice(0, 300), samples: [] };
    wall.people.push(person);
    savePeople();
    $("personName").value = "";
    $("personGreeting").value = "";
    renderPeople();
    startEnroll(person);
  };
  $("toDesk").onclick = (e) => {
    e.preventDefault();
    store.set("jarvis-role", "desk");
    location.href = "/";
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && wall.started) {
      void keepAwake();
      void scan();
    }
  });
})();
