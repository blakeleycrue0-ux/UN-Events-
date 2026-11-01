"use strict";
// Jarvis: a room assistant that runs entirely in this browser. Face templates
// stay in localStorage on this device; nothing is uploaded.
(() => {
  // Old pairing links pointed at the home page; the camera app now lives at /camara.
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
      try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
    },
  };
  const settings = Object.assign({ name: "Crew", facing: "user", greet: true }, store.get("jarvis-settings", {}));
  const jarvis = window.jarvis = {
    started: false, stream: null, detector: null, faces: store.get("jarvis-faces", []),
    threshold: 0.55, absenceMS: 5 * 60000, lastSeen: 0, present: false, busy: false,
    enrolling: null, loop: null, wakeLock: null, timers: [],
  };

  // ---------- Pantalla ----------
  function setOrb(state) { $("orb").dataset.state = state; }
  function show(text) { $("say").textContent = text; }
  function tickClock() {
    const now = new Date();
    $("clock").textContent = now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    $("date").textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }
  tickClock(); setInterval(tickClock, 1000);

  // ---------- Voz ----------
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const voices = speechSynthesis.getVoices();
    voice = voices.find((v) => /^es[-_]ES/i.test(v.lang)) || voices.find((v) => /^es/i.test(v.lang)) || null;
  }
  if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    show(text);
    if (!("speechSynthesis" in window)) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; setOrb(jarvis.started ? "idle" : "off"); resolve(); };
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "es-ES"; if (voice) u.voice = voice; u.rate = 1.02;
      u.onend = finish; u.onerror = finish;
      setOrb("speaking");
      speechSynthesis.speak(u);
      setTimeout(finish, 4000 + text.length * 90); // Safari sometimes never fires onend.
    });
  }
  jarvis.speak = speak;

  // ---------- Saludos ----------
  function partOfDay() {
    const h = new Date().getHours();
    return h >= 6 && h < 13 ? "Buenos días" : h >= 13 && h < 21 ? "Buenas tardes" : "Buenas noches";
  }
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  function greeting() {
    return `${partOfDay()}, ${settings.name}. ` +
      pick(["¿Qué quieres hacer hoy?", "¿En qué te ayudo?", "Me alegro de verte.", "Todo listo por aquí."]);
  }

  // ---------- Órdenes ----------
  // Future devices plug in here: when the universal remote or smart plug arrives,
  // set connected:true and give it on/off functions.
  const devices = [
    { id: "luz", names: ["luz", "luces", "led", "leds", "lampara"], label: "las luces", connected: false },
    { id: "aire", names: ["aire", "aire acondicionado", "clima", "split"], label: "el aire acondicionado", connected: false },
    { id: "ventilador", names: ["ventilador"], label: "el ventilador", connected: false },
    { id: "play", names: ["play", "playstation", "ps5", "consola"], label: "la Play", connected: false },
    { id: "tele", names: ["tele", "television", "televisor"], label: "la tele", connected: false },
  ];
  jarvis.devices = devices;
  const normalize = (t) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  const has = (text, ...words) => words.some((w) => new RegExp(`(^| )${w}( |$)`).test(text));
  const numbers = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, quince: 15, veinte: 20, treinta: 30, media: 30 };
  const jokes = [
    "¿Qué le dice un bit a otro? Nos vemos en el bus.",
    "¿Por qué el ordenador fue al médico? Porque tenía un virus.",
    "Hay diez tipos de personas: las que entienden binario y las que no.",
    "¿Cuál es el café más peligroso del mundo? El ex-preso.",
  ];
  function handle(raw) {
    const text = normalize(raw);
    if (!text) return "No te he oído. Prueba otra vez.";
    if (has(text, "hora")) return "Son las " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }) + ".";
    if (has(text, "dia", "fecha") && !has(text, "buenos"))
      return "Hoy es " + new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) + ".";
    const timer = /temporizador|alarma|avisame|cuenta atras/.test(text) && /(\d+|un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince|veinte|treinta|media) ?(minutos?|segundos?|hora)/.exec(text);
    if (timer) {
      const n = /\d+/.test(timer[1]) ? +timer[1] : numbers[timer[1]];
      const unit = timer[2].startsWith("seg") ? 1000 : timer[2].startsWith("hora") ? 3600000 : 60000;
      const ms = timer[1] === "media" && unit === 3600000 ? 1800000 : n * unit;
      if (!ms || ms > 6 * 3600000) return "No he entendido el tiempo del temporizador.";
      jarvis.timers.push(setTimeout(() => speak(`¡${settings.name}, se acabó el tiempo!`), ms));
      return `Vale, te aviso en ${timer[1] === "media" ? "media hora" : n + " " + timer[2]}.`;
    }
    const device = devices.find((d) => d.names.some((n) => has(text, n.split(" ")[0]) && text.includes(n)));
    if (device) {
      const off = has(text, "apaga", "apagar", "desconecta", "quita");
      if (device.connected && device[off ? "off" : "on"]) { device[off ? "off" : "on"](); return `Hecho, ${off ? "apago" : "enciendo"} ${device.label}.`; }
      return `Todavía no puedo controlar ${device.label}. Cuando tengamos el mando universal wifi, lo conecto.`;
    }
    if (/me voy|salgo de casa|modo fuera/.test(text))
      return `Hasta luego, ${settings.name}. Cuando instalemos el láser de la puerta, vigilaré mientras no estás.`;
    if (/he vuelto|ya estoy|estoy en casa/.test(text)) return `Bienvenido, ${settings.name}.`;
    if (has(text, "hola", "buenas", "buenos", "hey", "ey")) return greeting();
    if (has(text, "chiste", "gracioso")) return pick(jokes);
    if (has(text, "gracias")) return pick(["De nada.", "Para eso estoy.", "Cuando quieras."]);
    if (/como te llamas|quien eres/.test(text)) return "Soy Jarvis, el asistente de tu cuarto.";
    if (/como estas|que tal/.test(text)) return "Funcionando al cien por cien. ¿Y tú?";
    if (/que (puedes|sabes) hacer|ayuda|comandos/.test(text))
      return "Puedo decirte la hora y el día, poner temporizadores, contarte un chiste y saludarte al verte. Pronto controlaré tus luces, el aire, el ventilador y la Play.";
    return "No te he entendido. Prueba a decir: qué puedes hacer.";
  }
  jarvis.handle = handle;
  async function respond(raw) {
    $("heard").textContent = "«" + raw + "»";
    await speak(handle(raw));
  }

  // ---------- Escuchar ----------
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, listening = false;
  function listen() {
    if (listening) { recognition?.stop(); return; }
    if (!Recognition) { $("typeForm").hidden = false; $("typeInput").focus(); return; }
    window.speechSynthesis?.cancel();
    recognition = new Recognition();
    recognition.lang = "es-ES"; recognition.interimResults = true; recognition.maxAlternatives = 1;
    let finalText = "";
    recognition.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      $("heard").textContent = text;
      if (e.results[e.results.length - 1].isFinal) finalText = text;
    };
    recognition.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        show("No tengo permiso para el micrófono. Puedes escribirme abajo.");
        $("typeForm").hidden = false;
      }
    };
    recognition.onend = () => {
      listening = false; $("talk").classList.remove("on"); setOrb("idle");
      if (finalText || $("heard").textContent) void respond(finalText || $("heard").textContent);
    };
    listening = true; $("talk").classList.add("on"); setOrb("listening"); $("heard").textContent = "";
    show("Te escucho…");
    recognition.start();
  }

  // ---------- Cámara y caras ----------
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.onload = resolve; s.onerror = () => reject(Error("No se pudo cargar " + src));
      document.head.append(s);
    });
  }
  async function realDetector() {
    if (!window.Human) await loadScript("vendor/human.js");
    const human = new Human.Human({
      backend: "webgl", modelBasePath: new URL("models/", location.href).href,
      cacheModels: false, debug: false, async: false, warmup: "none",
      filter: { enabled: false, return: false },
      face: {
        enabled: true,
        detector: { rotation: false, maxDetected: 3, minConfidence: 0.5, return: false },
        mesh: { enabled: true }, iris: { enabled: false }, description: { enabled: true },
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
          .map((f) => ({ embedding: Array.from(f.embedding), score: f.faceScore ?? f.score ?? 0 }));
      },
      similarity: (a, b) => human.match.similarity(a, b),
    };
  }
  jarvis.createDetector = realDetector;
  function bestMatch(embedding) {
    let best = 0;
    for (const known of jarvis.faces) best = Math.max(best, jarvis.detector.similarity(embedding, known));
    return best;
  }
  async function startCamera() {
    jarvis.stream?.getTracks().forEach((t) => t.stop());
    jarvis.stream = await navigator.mediaDevices.getUserMedia({
      audio: false, video: { facingMode: settings.facing, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    $("video").srcObject = jarvis.stream;
    $("preview").classList.toggle("back", settings.facing === "environment");
    $("preview").hidden = false;
    await $("video").play().catch(() => {});
  }
  async function scan() {
    clearTimeout(jarvis.loop);
    if (!jarvis.started || document.hidden) return;
    const video = $("video");
    if (!jarvis.busy && video.readyState >= 2) {
      jarvis.busy = true;
      try {
        const found = await jarvis.detector.detect(video);
        onFaces(found);
      } catch (e) { $("faceState").textContent = "Error: " + e.message; }
      finally { jarvis.busy = false; }
    }
    jarvis.loop = setTimeout(scan, jarvis.enrolling ? 250 : 700);
  }
  jarvis.scan = scan;
  function onFaces(found) {
    if (jarvis.enrolling) return enrollStep(found);
    if (!found.length) {
      $("faceState").textContent = jarvis.faces.length ? "Nadie a la vista" : "Registra tu cara en ⚙︎";
      return;
    }
    if (!jarvis.faces.length) { $("faceState").textContent = "Veo una cara · regístrala en ⚙︎"; return; }
    const score = Math.max(...found.map((f) => bestMatch(f.embedding)));
    const now = Date.now();
    if (score >= jarvis.threshold) {
      $("faceState").textContent = `${settings.name} · ${Math.round(score * 100)}%`;
      const away = now - jarvis.lastSeen > jarvis.absenceMS;
      jarvis.lastSeen = now;
      if (away && settings.greet && !listening) void speak(greeting());
    } else {
      $("faceState").textContent = "Persona desconocida";
    }
  }
  // Enrolment keeps several samples of one clearly visible face.
  function enrollStep(found) {
    const e = jarvis.enrolling;
    if (found.length !== 1 || found[0].score < 0.6) {
      $("faceInfo").textContent = found.length > 1 ? "Hay más de una cara. Ponte tú solo." : "No te veo bien. Acércate y mira a la cámara.";
      return;
    }
    e.samples.push(found[0].embedding.map((x) => Math.round(x * 1e4) / 1e4));
    $("faceInfo").textContent = `Aprendiendo tu cara… ${e.samples.length}/5`;
    if (e.samples.length >= 5) {
      jarvis.faces = e.samples; jarvis.enrolling = null;
      if (!store.set("jarvis-faces", jarvis.faces)) $("faceInfo").textContent = "No se pudo guardar en este navegador.";
      else { renderFaceInfo(); jarvis.lastSeen = Date.now(); void speak(`Encantado, ${settings.name}. Ya te reconozco.`); }
      $("preview").classList.remove("big");
      document.querySelector(".room").append($("preview"));
    }
  }
  function renderFaceInfo() {
    $("faceInfo").textContent = jarvis.faces.length ? "Tu cara está registrada. Te saludaré al verte." : "Todavía no has registrado tu cara.";
    $("forget").hidden = !jarvis.faces.length;
    $("enroll").textContent = jarvis.faces.length ? "Volver a registrar" : "Registrar mi cara";
  }

  // ---------- Arranque ----------
  async function keepAwake() {
    try { if (navigator.wakeLock && !document.hidden) jarvis.wakeLock = await navigator.wakeLock.request("screen"); } catch {}
  }
  async function start() {
    $("start").disabled = true;
    // Safari only lets a page speak after a tap: say hello inside this tap.
    void speak("Iniciando Jarvis.");
    setOrb("thinking");
    try {
      await startCamera();
      show("Cargando reconocimiento de caras…");
      jarvis.detector = jarvis.detector || await jarvis.createDetector();
      jarvis.started = true;
      $("start").hidden = true; $("talk").hidden = false;
      if (!Recognition) $("typeForm").hidden = false;
      setOrb("idle");
      await keepAwake();
      show(jarvis.faces.length ? "Listo. Te saludaré cuando te vea." : "Listo. Registra tu cara en ⚙︎ para que te reconozca.");
      void scan();
    } catch (e) {
      setOrb("off");
      show(e.name === "NotAllowedError" ? "Necesito permiso para la cámara. Actívalo en Safari y vuelve a pulsar Empezar." : "No he podido arrancar: " + e.message);
      $("start").disabled = false;
    }
  }
  jarvis.start = start;

  $("start").onclick = start;
  $("talk").onclick = listen;
  $("typeForm").onsubmit = (e) => {
    e.preventDefault();
    const value = $("typeInput").value.trim(); $("typeInput").value = "";
    if (value) void respond(value);
  };
  $("openSettings").onclick = () => { $("name").value = settings.name; $("facing").value = settings.facing; $("greetOn").checked = settings.greet; renderFaceInfo(); $("settings").hidden = false; };
  $("closeSettings").onclick = () => {
    $("settings").hidden = true;
    if (jarvis.enrolling) { jarvis.enrolling = null; document.querySelector(".room").append($("preview")); $("preview").classList.remove("big"); }
  };
  $("settings").onclick = (e) => { if (e.target === $("settings")) $("closeSettings").onclick(); };
  $("name").onchange = () => { settings.name = $("name").value.trim() || "Crew"; store.set("jarvis-settings", settings); };
  $("greetOn").onchange = () => { settings.greet = $("greetOn").checked; store.set("jarvis-settings", settings); };
  $("facing").onchange = async () => {
    settings.facing = $("facing").value; store.set("jarvis-settings", settings);
    if (jarvis.started) { try { await startCamera(); } catch (e) { show("No se pudo cambiar de cámara: " + e.message); } }
  };
  $("enroll").onclick = async () => {
    if (!jarvis.started) { $("faceInfo").textContent = "Primero pulsa Empezar en la pantalla principal."; return; }
    jarvis.enrolling = { samples: [] };
    $("preview").classList.add("big");
    $("faceInfo").after($("preview"));
    $("faceInfo").textContent = "Mira a la cámara…";
    void scan();
  };
  $("forget").onclick = () => {
    jarvis.faces = []; store.set("jarvis-faces", []); renderFaceInfo();
    show("He borrado tu cara de este móvil.");
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && jarvis.started) { void keepAwake(); void scan(); }
  });
  renderFaceInfo();
})();
