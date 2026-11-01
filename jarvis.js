"use strict";
(() => {
  const toCamera = () => {
    if (!/invite=[a-f0-9]{64}/i.test(location.hash)) return false;
    location.replace("camara.html" + location.hash);
    return true;
  };
  window.addEventListener("hashchange", toCamera);
  if (toCamera()) return;
  const $ = (id) => document.getElementById(id);
  const store = {
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
  const settings = Object.assign({ name: "Crew", facing: "user", greet: true, typing: false, key: "" }, store.get("jarvis-settings", {}));
  const save = () => store.set("jarvis-settings", settings);
  const jarvis = window.jarvis = {
    started: false,
    stream: null,
    detector: null,
    faces: store.get("jarvis-faces", []),
    threshold: 0.55,
    absenceMS: 5 * 6e4,
    lastSeen: 0,
    busy: false,
    enrolling: null,
    loop: null,
    wakeLock: null,
    timers: [],
    speaking: false,
    listening: false,
    voiceError: ""
  };
  let mood = "off";
  function setState(state) {
    mood = state;
    document.body.dataset.state = state;
  }
  const rest = () => setState(jarvis.started ? "idle" : "off");
  function show(text) {
    $("say").textContent = text;
  }
  function tickClock() {
    const now = /* @__PURE__ */ new Date();
    $("clock").textContent = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    $("date").textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }
  tickClock();
  setInterval(tickClock, 1e3);
  const audio = new Audio();
  audio.preload = "auto";
  let speechId = 0, endSpeech = null;
  function silentUrl() {
    const b = new ArrayBuffer(46), v = new DataView(b), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF");
    v.setUint32(4, 38, true);
    w(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, 8e3, true);
    v.setUint32(28, 16e3, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    w(36, "data");
    v.setUint32(40, 2, true);
    return URL.createObjectURL(new Blob([b], { type: "audio/wav" }));
  }
  function unlockAudio() {
    audio.src = silentUrl();
    audio.play().catch(() => {
    });
  }
  const voiceEndpoint = () => {
    const c = window.SECURITY_SUPABASE_PUBLIC;
    return (c == null ? void 0 : c.url) ? c.url + "/functions/v1/jarvis-voice" : "";
  };
  async function voiceBlob(text) {
    const cacheable = !/\d/.test(text) && "caches" in window;
    const keyUrl = location.origin + "/__jarvis-voice?" + encodeURIComponent(text);
    let cache;
    if (cacheable) {
      try {
        cache = await caches.open("jarvis-voice-v1");
        const hit = await cache.match(keyUrl);
        if (hit) return await hit.blob();
      } catch {
      }
    }
    if (!settings.key) throw Error("Falta la clave de Jarvis en Ajustes.");
    const c = window.SECURITY_SUPABASE_PUBLIC;
    const response = await fetch(voiceEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-jarvis-key": settings.key, apikey: c.key },
      body: JSON.stringify({ text })
    });
    if (!response.ok) {
      let error = "";
      try {
        error = (await response.json()).error || "";
      } catch {
      }
      throw Error({
        401: "La clave de Jarvis no coincide con la de Supabase.",
        428: "Falta configurar la voz en Supabase."
      }[response.status] || {
        "ElevenLabs key rejected": "ElevenLabs no acepta la clave. C\xF3piala otra vez en Supabase.",
        "ElevenLabs key lacks text to speech permission": "A la clave de ElevenLabs le falta el permiso Text to Speech.",
        "ElevenLabs blocked free tier": "ElevenLabs ha bloqueado el plan gratis desde servidores. Hace falta el plan Starter.",
        "ElevenLabs quota reached": "Se han acabado los cr\xE9ditos de ElevenLabs este mes."
      }[error] || "La voz no est\xE1 disponible ahora.");
    }
    const blob = await response.blob();
    if (cache) {
      try {
        await cache.put(keyUrl, new Response(blob, { headers: { "Content-Type": "audio/mpeg" } }));
      } catch {
      }
    }
    return blob;
  }
  function stopSpeaking() {
    speechId++;
    audio.pause();
    endSpeech == null ? void 0 : endSpeech();
    jarvis.speaking = false;
    if (mood === "speaking" || mood === "thinking") rest();
  }
  async function speak(text) {
    const id = ++speechId;
    audio.pause();
    show(text);
    setState("thinking");
    let url;
    try {
      url = URL.createObjectURL(await voiceBlob(text));
      jarvis.voiceError = "";
    } catch (e) {
      jarvis.voiceError = e.message;
      $("voiceInfo").textContent = e.message;
      if (id === speechId) rest();
      return;
    }
    if (id !== speechId) {
      URL.revokeObjectURL(url);
      return;
    }
    jarvis.speaking = true;
    setState("speaking");
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(guard);
        audio.onended = audio.onerror = null;
        endSpeech = null;
        resolve();
      };
      const guard = setTimeout(done, 3e4);
      audio.onended = audio.onerror = endSpeech = done;
      audio.src = url;
      audio.play().catch(done);
    });
    URL.revokeObjectURL(url);
    if (id === speechId) {
      jarvis.speaking = false;
      rest();
    }
  }
  jarvis.speak = speak;
  function partOfDay() {
    const h = (/* @__PURE__ */ new Date()).getHours();
    return h >= 6 && h < 13 ? "Buenos d\xEDas" : h >= 13 && h < 21 ? "Buenas tardes" : "Buenas noches";
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  function greeting() {
    return "".concat(partOfDay(), ", ").concat(settings.name, ". ") + pick(["\xBFQu\xE9 quieres hacer hoy?", "\xBFEn qu\xE9 te ayudo?", "Me alegro de verte.", "Todo listo por aqu\xED."]);
  }
  const devices = [
    { id: "luz", names: ["luz", "luces", "led", "leds", "lampara"], label: "las luces", connected: false },
    { id: "aire", names: ["aire", "aire acondicionado", "clima", "split"], label: "el aire acondicionado", connected: false },
    { id: "ventilador", names: ["ventilador"], label: "el ventilador", connected: false },
    { id: "play", names: ["play", "playstation", "ps5", "consola"], label: "la Play", connected: false },
    { id: "tele", names: ["tele", "television", "televisor"], label: "la tele", connected: false }
  ];
  jarvis.devices = devices;
  const normalize = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  const has = (text, ...words) => words.some((w) => new RegExp("(^| )".concat(w, "( |$)")).test(text));
  const numbers = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, media: 30 };
  const jokes = [
    "\xBFQu\xE9 le dice un bit a otro? Nos vemos en el bus.",
    "\xBFPor qu\xE9 el ordenador fue al m\xE9dico? Porque ten\xEDa un virus.",
    "Hay diez tipos de personas: las que entienden binario y las que no.",
    "\xBFCu\xE1l es el caf\xE9 m\xE1s peligroso del mundo? El ex-preso."
  ];
  function handle(raw) {
    const text = normalize(raw);
    if (!text) return "No te he o\xEDdo. Prueba otra vez.";
    if (has(text, "hora")) return "Son las " + (/* @__PURE__ */ new Date()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) + ".";
    if (has(text, "dia", "fecha") && !has(text, "buenos"))
      return "Hoy es " + (/* @__PURE__ */ new Date()).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) + ".";
    const timer = /temporizador|alarma|avisame|cuenta atras/.test(text) && /(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|media) ?(minutos?|segundos?|hora)/.exec(text);
    if (timer) {
      const n = /\d+/.test(timer[1]) ? +timer[1] : numbers[timer[1]];
      const unit = timer[2].startsWith("seg") ? 1e3 : timer[2].startsWith("hora") ? 36e5 : 6e4;
      const ms = timer[1] === "media" && unit === 36e5 ? 18e5 : n * unit;
      if (!ms || ms > 6 * 36e5) return "No he entendido el tiempo del temporizador.";
      jarvis.timers.push(setTimeout(() => speak("".concat(settings.name, ", se acab\xF3 el tiempo.")), ms));
      return "Vale, te aviso en ".concat(timer[1] === "media" ? "media hora" : n + " " + timer[2], ".");
    }
    const device = devices.find((d) => d.names.some((n) => has(text, n.split(" ")[0]) && text.includes(n)));
    if (device) {
      const off = has(text, "apaga", "apagar", "desconecta", "quita");
      if (device.connected && device[off ? "off" : "on"]) {
        device[off ? "off" : "on"]();
        return "Hecho, ".concat(off ? "apago" : "enciendo", " ").concat(device.label, ".");
      }
      return "Todav\xEDa no puedo controlar ".concat(device.label, ". Cuando tengamos el mando universal, lo conecto.");
    }
    if (/me voy|salgo de casa|modo fuera/.test(text))
      return "Hasta luego, ".concat(settings.name, ". Cuando instalemos el l\xE1ser de la puerta, vigilar\xE9 mientras no est\xE1s.");
    if (/he vuelto|ya estoy|estoy en casa/.test(text)) return "Bienvenido, ".concat(settings.name, ".");
    if (has(text, "hola", "buenas", "buenos", "hey", "ey")) return greeting();
    if (has(text, "chiste", "gracioso")) return pick(jokes);
    if (has(text, "gracias")) return pick(["De nada.", "Para eso estoy.", "Cuando quieras."]);
    if (/como te llamas|quien eres/.test(text)) return "Soy Jarvis, el asistente de tu cuarto.";
    if (/como estas|que tal/.test(text)) return "Funcionando al cien por cien. \xBFY t\xFA?";
    if (/que (puedes|sabes) hacer|ayuda|comandos/.test(text))
      return "Te digo la hora y el d\xEDa, pongo temporizadores, cuento chistes y te saludo al verte. Pronto controlar\xE9 tus luces, el aire, el ventilador y la Play.";
    return "No te he entendido. Prueba a decir: qu\xE9 puedes hacer.";
  }
  jarvis.handle = handle;
  async function respond(raw) {
    $("heard").textContent = "\xAB" + raw + "\xBB";
    await speak(handle(raw));
  }
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, finishListening = null;
  jarvis.listenLimits = { silenceMS: 1300, noSpeechMS: 7e3, maxMS: 12e3 };
  function listen() {
    if (jarvis.listening) {
      finishListening == null ? void 0 : finishListening();
      return;
    }
    if (!Recognition) {
      $("typeForm").hidden = false;
      $("typeInput").focus();
      show("Este navegador no me deja escucharte. Escr\xEDbeme abajo.");
      return;
    }
    stopSpeaking();
    const started = Date.now();
    let text = "", lastChange = started, failure = "", ended = false;
    const rec = recognition = new Recognition();
    rec.lang = "es-ES";
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    const finish = finishListening = () => {
      if (ended) return;
      ended = true;
      clearInterval(watch);
      finishListening = null;
      try {
        rec.abort();
      } catch {
      }
      jarvis.listening = false;
      rest();
      if (text.trim()) void respond(text.trim());
      else if (/not-allowed|service-not-allowed/.test(failure)) {
        show("Necesito permiso para el micr\xF3fono. Revisa Safari y que Siri est\xE9 activado.");
      } else show("No te he o\xEDdo. Toca la burbuja y habla.");
    };
    rec.onresult = (e) => {
      const now = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim();
      if (now !== text) {
        text = now;
        lastChange = Date.now();
        $("heard").textContent = text;
      }
      if (e.results[e.results.length - 1].isFinal) finish();
    };
    rec.onerror = (e) => {
      failure = e.error || "error";
      finish();
    };
    rec.onend = finish;
    const limits = jarvis.listenLimits;
    const watch = setInterval(() => {
      const t = Date.now();
      if (text && t - lastChange > limits.silenceMS || !text && t - started > limits.noSpeechMS || t - started > limits.maxMS) finish();
    }, 200);
    jarvis.listening = true;
    setState("listening");
    $("heard").textContent = "";
    show("Te escucho\u2026");
    try {
      rec.start();
    } catch (e) {
      failure = e.message;
      finish();
    }
  }
  jarvis.listen = listen;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(Error("No se pudo cargar " + src));
      document.head.append(s);
    });
  }
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
        detector: { rotation: false, maxDetected: 3, minConfidence: 0.5, return: false },
        mesh: { enabled: true },
        iris: { enabled: false },
        description: { enabled: true },
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
      return !(m == null ? void 0 : m.loaded) || m.sizeLoadedWeights <= 0;
    });
    if (missing.length) {
      human.reset();
      throw Error("No se cargaron los modelos de caras (" + missing.join(", ") + ").");
    }
    return {
      async detect(input) {
        const result = await human.detect(input);
        const issue = result == null ? void 0 : result.error;
        if (!result || issue && (!Array.isArray(issue) || issue.length)) throw Error("Fallo del modelo de caras.");
        return (result.face || []).filter((f) => {
          var _a;
          return (_a = f.embedding) == null ? void 0 : _a.length;
        }).map((f) => {
          var _a, _b;
          return { embedding: Array.from(f.embedding), score: (_b = (_a = f.faceScore) != null ? _a : f.score) != null ? _b : 0 };
        });
      },
      similarity: (a, b) => human.match.similarity(a, b)
    };
  }
  jarvis.createDetector = realDetector;
  function bestMatch(embedding) {
    let best = 0;
    for (const known of jarvis.faces) best = Math.max(best, jarvis.detector.similarity(embedding, known));
    return best;
  }
  async function startCamera() {
    var _a;
    (_a = jarvis.stream) == null ? void 0 : _a.getTracks().forEach((t) => t.stop());
    jarvis.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: settings.facing, width: { ideal: 640 }, height: { ideal: 480 } }
    });
    $("video").srcObject = jarvis.stream;
    $("preview").classList.toggle("back", settings.facing === "environment");
    await $("video").play().catch(() => {
    });
    $("eye").hidden = false;
  }
  async function scan() {
    clearTimeout(jarvis.loop);
    if (!jarvis.started || document.hidden) return;
    const video = $("video");
    const quiet = jarvis.listening || jarvis.speaking;
    if (!jarvis.busy && !quiet && video.readyState >= 2) {
      jarvis.busy = true;
      try {
        onFaces(await jarvis.detector.detect(video));
      } catch (e) {
        $("faceState").textContent = "Error: " + e.message;
      } finally {
        jarvis.busy = false;
      }
    }
    jarvis.loop = setTimeout(scan, jarvis.enrolling ? 250 : 1e3);
  }
  jarvis.scan = scan;
  function onFaces(found) {
    if (jarvis.enrolling) return enrollStep(found);
    if (!found.length) {
      $("faceState").textContent = jarvis.faces.length ? "Nadie a la vista" : "Sin cara registrada";
      return;
    }
    if (!jarvis.faces.length) {
      $("faceState").textContent = "Veo una cara";
      return;
    }
    const score = Math.max(...found.map((f) => bestMatch(f.embedding)));
    const now = Date.now();
    if (score >= jarvis.threshold) {
      $("faceState").textContent = "".concat(settings.name, " \xB7 ").concat(Math.round(score * 100), "%");
      const away = now - jarvis.lastSeen > jarvis.absenceMS;
      jarvis.lastSeen = now;
      if (away && settings.greet && !jarvis.listening) void speak(greeting());
    } else $("faceState").textContent = "Persona desconocida";
  }
  function enrollStep(found) {
    const e = jarvis.enrolling;
    if (found.length !== 1 || found[0].score < 0.6) {
      $("faceInfo").textContent = found.length > 1 ? "Hay m\xE1s de una cara. Ponte t\xFA solo." : "No te veo bien. Ac\xE9rcate y mira a la c\xE1mara.";
      return;
    }
    e.samples.push(found[0].embedding.map((x) => Math.round(x * 1e4) / 1e4));
    $("faceInfo").textContent = "Aprendiendo tu cara\u2026 ".concat(e.samples.length, "/5");
    if (e.samples.length >= 5) {
      jarvis.faces = e.samples;
      endEnroll();
      if (!store.set("jarvis-faces", jarvis.faces)) $("faceInfo").textContent = "No se pudo guardar en este navegador.";
      else {
        renderFaceInfo();
        jarvis.lastSeen = Date.now();
        void speak("Encantado, ".concat(settings.name, ". Ya te reconozco."));
      }
    }
  }
  function endEnroll() {
    jarvis.enrolling = null;
    $("preview").classList.add("stash");
    document.body.append($("preview"));
  }
  function renderFaceInfo() {
    $("faceInfo").textContent = jarvis.faces.length ? "Registrada. Te saludar\xE9 al verte." : "Sin registrar.";
    $("forget").hidden = !jarvis.faces.length;
    $("enroll").textContent = jarvis.faces.length ? "Volver a registrar" : "Registrar mi cara";
  }
  async function keepAwake() {
    try {
      if (navigator.wakeLock && !document.hidden) jarvis.wakeLock = await navigator.wakeLock.request("screen");
    } catch {
    }
  }
  let starting = false;
  async function start() {
    if (starting) return;
    starting = true;
    unlockAudio();
    setState("thinking");
    show("Despertando\u2026");
    try {
      await startCamera();
      jarvis.detector = jarvis.detector || await jarvis.createDetector();
      jarvis.started = true;
      rest();
      await keepAwake();
      void scan();
      if (!settings.key) show("Listo. Pon la clave de voz en \u2699\uFE0E para que te hable.");
      else void speak(jarvis.faces.length ? "Hola, ".concat(settings.name, ". Estoy listo.") : "Hola. Registra tu cara en ajustes para que te reconozca.");
    } catch (e) {
      setState("off");
      show(e.name === "NotAllowedError" ? "Necesito la c\xE1mara. Perm\xEDtela en Safari y toca otra vez." : "No he podido arrancar: " + e.message);
    } finally {
      starting = false;
    }
  }
  jarvis.start = start;
  $("bubble").onclick = () => jarvis.started ? listen() : start();
  $("typeForm").onsubmit = (e) => {
    e.preventDefault();
    const value = $("typeInput").value.trim();
    $("typeInput").value = "";
    if (value) void respond(value);
  };
  $("typeForm").hidden = !settings.typing;
  $("openSettings").onclick = () => {
    $("name").value = settings.name;
    $("facing").value = settings.facing;
    $("greetOn").checked = settings.greet;
    $("showType").checked = settings.typing;
    $("voiceKey").value = settings.key;
    $("voiceInfo").textContent = jarvis.voiceError || (settings.key ? "" : "Sin clave: Jarvis solo escribir\xE1.");
    renderFaceInfo();
    $("settings").hidden = false;
  };
  $("closeSettings").onclick = () => {
    $("settings").hidden = true;
    if (jarvis.enrolling) endEnroll();
  };
  $("settings").onclick = (e) => {
    if (e.target === $("settings")) $("closeSettings").onclick();
  };
  $("name").onchange = () => {
    settings.name = $("name").value.trim() || "Crew";
    save();
  };
  $("greetOn").onchange = () => {
    settings.greet = $("greetOn").checked;
    save();
  };
  $("showType").onchange = () => {
    settings.typing = $("showType").checked;
    save();
    $("typeForm").hidden = !settings.typing;
  };
  $("voiceKey").onchange = () => {
    settings.key = $("voiceKey").value.trim();
    save();
  };
  $("testVoice").onclick = async () => {
    settings.key = $("voiceKey").value.trim();
    save();
    unlockAudio();
    $("voiceInfo").textContent = "Probando\u2026";
    await speak("Hola, ".concat(settings.name, ". As\xED sueno ahora."));
    $("voiceInfo").textContent = jarvis.voiceError || "Voz funcionando.";
  };
  $("facing").onchange = async () => {
    settings.facing = $("facing").value;
    save();
    if (jarvis.started) {
      try {
        await startCamera();
      } catch (e) {
        show("No se pudo cambiar de c\xE1mara: " + e.message);
      }
    }
  };
  $("enroll").onclick = () => {
    if (!jarvis.started) {
      $("faceInfo").textContent = "Primero toca la burbuja para despertar a Jarvis.";
      return;
    }
    jarvis.enrolling = { samples: [] };
    $("enrollSlot").append($("preview"));
    $("preview").classList.remove("stash");
    $("faceInfo").textContent = "Mira a la c\xE1mara\u2026";
    void scan();
  };
  $("forget").onclick = () => {
    jarvis.faces = [];
    store.set("jarvis-faces", []);
    renderFaceInfo();
    show("He borrado tu cara de este m\xF3vil.");
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (jarvis.listening) finishListening == null ? void 0 : finishListening();
      return;
    }
    if (jarvis.started) {
      void keepAwake();
      void scan();
    }
  });
  setState("off");
  renderFaceInfo();
})();
