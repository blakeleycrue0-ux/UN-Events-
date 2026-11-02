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
  const settings = Object.assign(
    { name: "Crew", facing: "user", greet: true, typing: false, key: "", lang: "en", hear: "es-ES", always: false, engine: "cloud" },
    store.get("jarvis-settings", {})
  );
  const save = () => store.set("jarvis-settings", settings);
  const jarvis = window.jarvis = {
    started: false,
    stream: null,
    detector: null,
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
    voiceError: "",
    history: [],
    lastTalk: 0,
    settings
  };
  const T = {
    en: {
      tap: "Tap the bubble to start",
      waking: "Waking up\u2026",
      ready: (n) => "Hello, ".concat(n, ". I'm online."),
      readyNoFace: "Hello. Register your face in settings so I can recognise you.",
      needKey: "Ready. Add your Jarvis key in \u2699\uFE0E so I can talk.",
      listening: "Listening\u2026",
      notHeard: "I didn't catch that. Tap the bubble and talk.",
      micDenied: "I need the microphone. Check Safari and that Siri is on.",
      noMic: "This browser won't let me listen. Type below.",
      cam: "I need the camera. Allow it in Safari and tap again.",
      cantStart: "I couldn't start: ",
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
      greetTail: ["What shall we do today?", "How can I help?", "Good to see you.", "All systems ready."],
      time: (t2) => "It's ".concat(t2, "."),
      date: (d) => "Today is ".concat(d, "."),
      timerSet: (x) => "Done. I'll remind you in ".concat(x, "."),
      timerBad: "I didn't get how long the timer should be.",
      timerUp: (n) => "".concat(n, ", time's up."),
      device: (d) => "I can't control ".concat(d, " yet. Once the universal remote arrives, I'll take care of it."),
      deviceDone: (on, d) => "Done, ".concat(on ? "turning on" : "turning off", " ").concat(d, "."),
      leaving: (n) => "See you later, ".concat(n, ". Once the door laser is installed, I'll keep watch while you're out."),
      back: (n) => "Welcome back, ".concat(n, "."),
      thanks: ["You're welcome.", "Any time.", "My pleasure."],
      who: "I'm Jarvis, the assistant of this room.",
      how: "Running at a hundred percent. And you?",
      help: "I can chat about anything, tell you the time, set timers and greet you when you come in. Lights, air conditioning, the fan and the PlayStation are coming soon.",
      unknown: "I didn't understand that. Try asking: what can you do?",
      yes: ["Yes?", "At your service.", "I'm listening."],
      jokes: ["I'd tell you a UDP joke, but you might not get it.", "There are ten kinds of people: those who understand binary and those who don't.", "Why did the computer go to the doctor? It had a virus."],
      refused: "I'd rather not answer that one.",
      nice: (n) => "Nice to meet you, ".concat(n, ". I'll recognise you now."),
      test: (n) => "Hello, ".concat(n, ". This is how I sound now."),
      forgot: "I've deleted your face from this phone.",
      thinkErr: { "Claude key rejected": "My brain's key was rejected. Check ANTHROPIC_API_KEY in Supabase.", "Claude credit exhausted": "My brain has run out of Claude credit.", "Claude busy": "My brain is busy. Try again in a moment.", "Brain not configured": "My brain isn't set up yet. Add ANTHROPIC_API_KEY in Supabase.", "Wrong Jarvis key": "The Jarvis key doesn't match Supabase." },
      thinkDown: "I can't reach my brain right now.",
      devices: { luz: "the lights", aire: "the air conditioning", ventilador: "the fan", play: "the PlayStation", tele: "the TV" }
    },
    es: {
      tap: "Toca la burbuja para empezar",
      waking: "Despertando\u2026",
      ready: (n) => "Hola, ".concat(n, ". Estoy listo."),
      readyNoFace: "Hola. Registra tu cara en ajustes para que te reconozca.",
      needKey: "Listo. Pon la clave de Jarvis en \u2699\uFE0E para que te hable.",
      listening: "Te escucho\u2026",
      notHeard: "No te he o\xEDdo. Toca la burbuja y habla.",
      micDenied: "Necesito el micr\xF3fono. Revisa Safari y que Siri est\xE9 activado.",
      noMic: "Este navegador no me deja escucharte. Escr\xEDbeme abajo.",
      cam: "Necesito la c\xE1mara. Perm\xEDtela en Safari y toca otra vez.",
      cantStart: "No he podido arrancar: ",
      morning: "Buenos d\xEDas",
      afternoon: "Buenas tardes",
      evening: "Buenas noches",
      greetTail: ["\xBFQu\xE9 quieres hacer hoy?", "\xBFEn qu\xE9 te ayudo?", "Me alegro de verte.", "Todo listo por aqu\xED."],
      time: (t2) => "Son las ".concat(t2, "."),
      date: (d) => "Hoy es ".concat(d, "."),
      timerSet: (x) => "Vale, te aviso en ".concat(x, "."),
      timerBad: "No he entendido el tiempo del temporizador.",
      timerUp: (n) => "".concat(n, ", se acab\xF3 el tiempo."),
      device: (d) => "Todav\xEDa no puedo controlar ".concat(d, ". Cuando tengamos el mando universal, lo conecto."),
      deviceDone: (on, d) => "Hecho, ".concat(on ? "enciendo" : "apago", " ").concat(d, "."),
      leaving: (n) => "Hasta luego, ".concat(n, ". Cuando instalemos el l\xE1ser de la puerta, vigilar\xE9 mientras no est\xE1s."),
      back: (n) => "Bienvenido, ".concat(n, "."),
      thanks: ["De nada.", "Para eso estoy.", "Cuando quieras."],
      who: "Soy Jarvis, el asistente de tu cuarto.",
      how: "Funcionando al cien por cien. \xBFY t\xFA?",
      help: "Puedo charlar de lo que quieras, decirte la hora, poner temporizadores y saludarte al entrar. Pronto controlar\xE9 las luces, el aire, el ventilador y la Play.",
      unknown: "No te he entendido. Prueba a decir: qu\xE9 puedes hacer.",
      yes: ["\xBFS\xED?", "A tu servicio.", "Te escucho."],
      jokes: ["Hay diez tipos de personas: las que entienden binario y las que no.", "\xBFPor qu\xE9 el ordenador fue al m\xE9dico? Porque ten\xEDa un virus."],
      refused: "Prefiero no contestar a eso.",
      nice: (n) => "Encantado, ".concat(n, ". Ya te reconozco."),
      test: (n) => "Hola, ".concat(n, ". As\xED sueno ahora."),
      forgot: "He borrado tu cara de este m\xF3vil.",
      thinkErr: { "Claude key rejected": "La clave de mi cerebro no vale. Revisa ANTHROPIC_API_KEY en Supabase.", "Claude credit exhausted": "Mi cerebro se ha quedado sin cr\xE9dito de Claude.", "Claude busy": "Mi cerebro est\xE1 ocupado. Prueba en un momento.", "Brain not configured": "Mi cerebro a\xFAn no est\xE1 configurado. A\xF1ade ANTHROPIC_API_KEY en Supabase.", "Wrong Jarvis key": "La clave de Jarvis no coincide con la de Supabase." },
      thinkDown: "Ahora no puedo conectar con mi cerebro.",
      devices: { luz: "las luces", aire: "el aire acondicionado", ventilador: "el ventilador", play: "la Play", tele: "la tele" }
    }
  };
  const t = () => T[settings.lang] || T.en;
  const locale = () => settings.lang === "es" ? "es-ES" : "en-GB";
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
    const date = now.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
    $("date").textContent = date.charAt(0).toUpperCase() + date.slice(1);
  }
  tickClock();
  setInterval(tickClock, 1e3);
  const endpoint = (name) => {
    const c = window.SECURITY_SUPABASE_PUBLIC;
    return (c == null ? void 0 : c.url) ? "".concat(c.url, "/functions/v1/").concat(name) : "";
  };
  const post = (name, body) => {
    var _a;
    return fetch(endpoint(name), {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-jarvis-key": settings.key, apikey: ((_a = window.SECURITY_SUPABASE_PUBLIC) == null ? void 0 : _a.key) || "" },
      body: JSON.stringify(body)
    });
  };
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
  async function voiceBlob(text, lang = settings.lang) {
    const cacheable = !/\d/.test(text) && "caches" in window;
    const keyUrl = location.origin + "/__jarvis-voice?" + lang + "&" + encodeURIComponent(text);
    let cache;
    if (cacheable) {
      try {
        cache = await caches.open("jarvis-voice-v2");
        const hit = await cache.match(keyUrl);
        if (hit) return await hit.blob();
      } catch {
      }
    }
    if (!settings.key) throw Error("Falta la clave de Jarvis en Ajustes.");
    const response = await post("jarvis-voice", { text, lang });
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
  async function speak(text, lang = settings.lang) {
    const id = ++speechId;
    audio.pause();
    show(text);
    setState("thinking");
    let url;
    try {
      url = URL.createObjectURL(await voiceBlob(text, lang));
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
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  function greeting() {
    const h = (/* @__PURE__ */ new Date()).getHours(), s = t();
    const part = h >= 6 && h < 13 ? s.morning : h >= 13 && h < 21 ? s.afternoon : s.evening;
    return "".concat(part, ", ").concat(settings.name, ". ").concat(pick(s.greetTail));
  }
  const devices = [
    { id: "luz", names: ["luz", "luces", "led", "leds", "lampara", "light", "lights", "lamp"], connected: false },
    { id: "aire", names: ["aire", "aire acondicionado", "clima", "air conditioning", "ac", "aircon"], connected: false },
    { id: "ventilador", names: ["ventilador", "fan"], connected: false },
    { id: "play", names: ["play", "playstation", "ps5", "consola", "console"], connected: false },
    { id: "tele", names: ["tele", "television", "televisor", "tv"], connected: false }
  ];
  jarvis.devices = devices;
  const normalize = (x) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  const has = (text, ...words) => words.some((w) => new RegExp("(^| )".concat(w, "( |$)")).test(text));
  const numbers = { un: 1, uno: 1, una: 1, a: 1, an: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, quince: 15, fifteen: 15, veinte: 20, twenty: 20, treinta: 30, thirty: 30 };
  function quick(text) {
    const s = t();
    const timer = /temporizador|alarma|avisame|cuenta atras|timer|remind me/.test(text) && /(\d+|un|uno|una|a|an|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|quince|fifteen|veinte|twenty|treinta|thirty|media|half an?) ?(minutos?|minutes?|segundos?|seconds?|horas?|hours?)/.exec(text);
    if (timer) {
      const half = /^(media|half)/.test(timer[1]);
      const n = half ? 0.5 : /\d+/.test(timer[1]) ? +timer[1] : numbers[timer[1]];
      const unit = /^seg|^sec/.test(timer[2]) ? 1e3 : /^hora|^hour/.test(timer[2]) ? 36e5 : 6e4;
      const ms = n * unit;
      if (!ms || ms > 6 * 36e5) return s.timerBad;
      jarvis.timers.push(setTimeout(() => speak(t().timerUp(settings.name)), ms));
      return s.timerSet(half ? settings.lang === "es" ? "media hora" : "half an hour" : "".concat(n, " ").concat(timer[2]));
    }
    const device = devices.find((d) => d.names.some((n) => has(text, n.split(" ")[0]) && text.includes(n)));
    if (device && /enciende|encender|apaga|apagar|pon|quita|turn|switch|power|start/.test(text)) {
      const off = has(text, "apaga", "apagar", "quita", "off");
      if (device.connected && device[off ? "off" : "on"]) {
        device[off ? "off" : "on"]();
        return s.deviceDone(!off, s.devices[device.id]);
      }
      return s.device(s.devices[device.id]);
    }
    if (/me voy|salgo de casa|modo fuera|i'?m leaving|i'?m off|going out|away mode/.test(text)) return s.leaving(settings.name);
    return "";
  }
  function offline(text) {
    const s = t();
    if (has(text, "hora", "time")) return s.time((/* @__PURE__ */ new Date()).toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" }));
    if ((has(text, "dia", "fecha", "date", "day") || /what day/.test(text)) && !has(text, "buenos"))
      return s.date((/* @__PURE__ */ new Date()).toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" }));
    if (/he vuelto|ya estoy|estoy en casa|i'?m (back|home)/.test(text)) return s.back(settings.name);
    if (has(text, "hola", "buenas", "buenos", "hey", "hello", "hi", "morning", "evening")) return greeting();
    if (has(text, "chiste", "gracioso", "joke", "funny")) return pick(s.jokes);
    if (has(text, "gracias", "thanks", "thank")) return pick(s.thanks);
    if (/como te llamas|quien eres|who are you|your name/.test(text)) return s.who;
    if (/como estas|que tal|how are you/.test(text)) return s.how;
    if (/que (puedes|sabes) hacer|ayuda|comandos|what can you do|help/.test(text)) return s.help;
    return s.unknown;
  }
  function handle(raw) {
    const text = normalize(raw);
    return quick(text) || offline(text);
  }
  jarvis.handle = handle;
  async function think(raw) {
    var _a;
    if (Date.now() - jarvis.lastTalk > 5 * 6e4) jarvis.history = [];
    jarvis.lastTalk = Date.now();
    const history = jarvis.history;
    history.push({ role: "user", content: raw.slice(0, 1e3) });
    while (history.length > 19 || ((_a = history[0]) == null ? void 0 : _a.role) !== "user") history.shift();
    try {
      const now = (/* @__PURE__ */ new Date()).toLocaleString(locale(), { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      const response = await post("jarvis-brain", { messages: history, lang: settings.lang, name: settings.name, now });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(t().thinkErr[data.error] || t().thinkDown);
      const reply = data.refused || !data.reply ? t().refused : data.reply;
      history.push({ role: "assistant", content: reply });
      return reply;
    } catch (e) {
      history.pop();
      jarvis.brainError = e.message;
      const local = offline(normalize(raw));
      return local === t().unknown ? e.message || t().thinkDown : local;
    }
  }
  async function respond(raw) {
    $("heard").textContent = "\xAB" + raw + "\xBB";
    const text = normalize(raw);
    let reply = quick(text);
    if (!reply) {
      setState("thinking");
      reply = settings.key ? await think(raw) : offline(text);
    }
    await speak(reply);
  }
  jarvis.respond = respond;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const WAKE = /\b(jarvis|yarvis|jarbis|charvis|harvis|jervis|travis)\b/i;
  let finishListening = null, promoteListening = null, restartTimer = null, quickFails = 0;
  const micLog = jarvis.micLog = [];
  function mlog(message) {
    const d = /* @__PURE__ */ new Date();
    micLog.push("".concat(d.toLocaleTimeString("es-ES"), ".").concat(String(d.getMilliseconds()).padStart(3, "0"), " ").concat(message));
    while (micLog.length > 40) micLog.shift();
    if (!$("settings").hidden) $("micLog").textContent = micLog.slice(-14).join("\n");
  }
  const later = (fn, ms = 350) => setTimeout(fn, ms);
  jarvis.listenLimits = { silenceMS: 1300, noSpeechMS: 7e3, maxMS: 12e3, followMS: 6e3, wakeMS: 15e3 };
  function scheduleWake(delay = 600) {
    clearTimeout(restartTimer);
    if (!settings.always || !jarvis.started || !Recognition) return;
    restartTimer = setTimeout(() => {
      if (!jarvis.listening && !jarvis.speaking && mood !== "thinking" && !document.hidden && $("settings").hidden) listen("wake");
      else scheduleWake(800);
    }, delay);
  }
  function listenNative(mode = "tap") {
    if (jarvis.listening) {
      if (mode === "tap" && jarvis.listenMode === "wake" && promoteListening) promoteListening();
      else finishListening == null ? void 0 : finishListening(true);
      return;
    }
    if (!Recognition) {
      $("typeForm").hidden = false;
      $("typeInput").focus();
      show(t().noMic);
      return;
    }
    clearTimeout(restartTimer);
    if (mode !== "wake") stopSpeaking();
    const started = Date.now(), limits = jarvis.listenLimits;
    let text = "", base = "", lastChange = started, failure = "", ended = false, startedAt = started, promoted = false;
    const rec = new Recognition();
    rec.lang = settings.hear;
    rec.interimResults = true;
    rec.continuous = mode === "wake";
    rec.maxAlternatives = 1;
    const finish = finishListening = (cancelled = false) => {
      if (ended) return;
      ended = true;
      clearInterval(watch);
      finishListening = null;
      promoteListening = null;
      mlog("fin (".concat(mode, ") ").concat(cancelled ? "cancelado" : failure ? "error " + failure : "texto: \xAB" + text.trim() + "\xBB"));
      try {
        rec.abort();
      } catch {
      }
      jarvis.listening = false;
      jarvis.listenMode = "";
      if (mode !== "wake") rest();
      const said = text.trim();
      if (/not-allowed|service-not-allowed/.test(failure)) {
        if (mode === "tap") show(t().micDenied);
        else {
          settings.always = false;
          jarvis.wakeBlocked = true;
        }
        return;
      }
      quickFails = Date.now() - startedAt < 600 && !said ? quickFails + 1 : 0;
      if (cancelled) {
        scheduleWake(1500);
        return;
      }
      if (mode === "wake") {
        const match = WAKE.exec(said);
        if (match) {
          const command = said.slice(match.index + match[0].length).replace(/^[\s,.:]+/, "");
          if (command) void respond(command).then(() => later(() => listen("follow")));
          else {
            show(pick(t().yes));
            $("heard").textContent = "";
            void speak($("say").textContent).then(() => later(() => listen("follow")));
          }
        } else scheduleWake(quickFails > 4 ? 4e3 : 300);
        return;
      }
      if (promoted && !said && !cancelled && Date.now() - startedAt < limits.noSpeechMS) {
        later(() => listen("tap"), 250);
        return;
      }
      if (said) void respond(said).then(() => later(() => listen("follow")));
      else if (mode === "tap") {
        show(t().notHeard);
        scheduleWake();
      } else scheduleWake();
    };
    rec.onresult = (e) => {
      const full = Array.from(e.results).map((r) => r[0].transcript).join(" ").trim();
      const now = full.startsWith(base) ? full.slice(base.length).trim() : full;
      if (now !== text) mlog("oye: \xAB" + full + "\xBB");
      if (now !== text) {
        text = now;
        lastChange = Date.now();
        if (mode !== "wake" || WAKE.test(text)) {
          $("heard").textContent = text;
          if (mode === "wake") setState("listening");
        }
      }
      if (mode !== "wake" && e.results[e.results.length - 1].isFinal) finish();
    };
    rec.onerror = (e) => {
      failure = e.error || "error";
      mlog("error: " + failure);
      finish();
    };
    rec.onend = () => {
      mlog("end");
      finish();
    };
    rec.onstart = () => mlog("start");
    rec.onaudiostart = () => mlog("audio abierto");
    rec.onspeechstart = () => mlog("voz detectada");
    promoteListening = () => {
      base = text ? (base + " " + text).trim() : base;
      text = "";
      mode = "tap";
      promoted = true;
      startedAt = Date.now();
      lastChange = startedAt;
      quietLimitNow = limits.noSpeechMS;
      jarvis.listenMode = "tap";
      setState("listening");
      $("heard").textContent = "";
      show(t().listening);
      mlog("tap: pregunta directa");
    };
    let quietLimitNow = mode === "follow" ? limits.followMS : mode === "wake" ? limits.wakeMS : limits.noSpeechMS;
    const watch = setInterval(() => {
      const now = Date.now();
      if (text && now - lastChange > limits.silenceMS || !text && now - startedAt > quietLimitNow || now - startedAt > Math.max(limits.maxMS, quietLimitNow)) finish();
    }, 200);
    jarvis.listening = true;
    jarvis.listenMode = mode;
    if (mode !== "wake") {
      setState("listening");
      $("heard").textContent = "";
      show(t().listening);
    }
    mlog("escuchar (".concat(mode, ", ").concat(rec.lang, ")"));
    try {
      rec.start();
    } catch (e) {
      failure = /not-allowed/i.test(e.name + e.message) ? "not-allowed" : e.name + ": " + e.message;
      finish();
    }
  }
  let hearCancel = null;
  function audioContext() {
    var _a, _b;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    jarvis.audioCtx = jarvis.audioCtx || new Ctx();
    (_b = (_a = jarvis.audioCtx).resume) == null ? void 0 : _b.call(_a).catch(() => {
    });
    return jarvis.audioCtx;
  }
  const recorderType = () => ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((m) => {
    var _a, _b;
    return (_b = (_a = window.MediaRecorder) == null ? void 0 : _a.isTypeSupported) == null ? void 0 : _b.call(_a, m);
  }) || "";
  async function captureUtterance({ waitMS }) {
    var _a;
    const limits = jarvis.listenLimits;
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const type = recorderType();
    const recorder = new MediaRecorder(mic, type ? { mimeType: type } : void 0);
    const chunks = [];
    recorder.ondataavailable = (e) => {
      var _a2;
      if ((_a2 = e.data) == null ? void 0 : _a2.size) chunks.push(e.data);
    };
    const ctx = audioContext();
    const source = ctx == null ? void 0 : ctx.createMediaStreamSource(mic), analyser = ctx == null ? void 0 : ctx.createAnalyser();
    if (analyser) {
      analyser.fftSize = 1024;
      source.connect(analyser);
    }
    const samples = new Float32Array(1024);
    const level = () => {
      if (!analyser) return 0.05;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const x of samples) sum += x * x;
      return Math.sqrt(sum / samples.length);
    };
    recorder.start(250);
    mlog("grabando (".concat(type || "formato por defecto", ")"));
    const started = Date.now();
    let floor = 0, floorCount = 0, speechAt = 0, lastLoud = 0, cancelled = false;
    await new Promise((resolve) => {
      hearCancel = () => {
        cancelled = true;
        resolve();
      };
      const tick = setInterval(() => {
        const now = Date.now(), rms = level();
        if (now - started < 300) {
          floor += rms;
          floorCount++;
          return;
        }
        const base = floorCount ? floor / floorCount : 0.01;
        const loud = rms > Math.max(0.015, base * 2.5);
        if (loud) {
          lastLoud = now;
          if (!speechAt) {
            speechAt = now;
            mlog("voz detectada");
            setState("listening");
          }
        }
        const done = cancelled || speechAt && now - lastLoud > limits.silenceMS || !speechAt && now - started > waitMS || now - started > limits.maxMS;
        if (done) {
          clearInterval(tick);
          resolve();
        }
      }, 50);
    });
    hearCancel = null;
    await new Promise((resolve) => {
      recorder.onstop = resolve;
      try {
        recorder.stop();
      } catch {
        resolve();
      }
    });
    mic.getTracks().forEach((track) => track.stop());
    try {
      source == null ? void 0 : source.disconnect();
    } catch {
    }
    const blob = new Blob(chunks, { type: (type || ((_a = chunks[0]) == null ? void 0 : _a.type) || "audio/mp4").split(";")[0] });
    mlog("fin grabaci\xF3n: ".concat(cancelled ? "cancelada" : speechAt ? Math.round(blob.size / 1024) + " KB" : "sin voz"));
    return cancelled || !speechAt ? null : blob;
  }
  jarvis.captureUtterance = captureUtterance;
  async function transcribe(blob) {
    var _a;
    const response = await fetch(endpoint("jarvis-hear"), {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/mp4", "x-jarvis-key": settings.key, apikey: ((_a = window.SECURITY_SUPABASE_PUBLIC) == null ? void 0 : _a.key) || "" },
      body: blob
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Error({
        "ElevenLabs key lacks speech to text permission": "A la clave de ElevenLabs le falta el permiso Speech to Text.",
        "ElevenLabs quota reached": "Se han acabado los cr\xE9ditos de ElevenLabs este mes.",
        "ElevenLabs key rejected": "ElevenLabs no acepta la clave.",
        "Wrong Jarvis key": "La clave de Jarvis no coincide con la de Supabase.",
        "Hearing not configured": "Falta configurar el o\xEDdo en Supabase."
      }[data.error] || "No he podido entenderte ahora mismo.");
    }
    mlog("texto: \xAB" + (data.text || "") + "\xBB");
    return data.text || "";
  }
  jarvis.transcribe = transcribe;
  async function listenCloud(mode = "tap") {
    var _a;
    if (jarvis.listening) {
      hearCancel == null ? void 0 : hearCancel();
      return;
    }
    if (!((_a = navigator.mediaDevices) == null ? void 0 : _a.getUserMedia) || !window.MediaRecorder) return listenNative(mode);
    if (!settings.key) {
      show(t().needKey);
      return;
    }
    clearTimeout(restartTimer);
    stopSpeaking();
    audioContext();
    jarvis.listening = true;
    jarvis.listenMode = mode;
    setState("listening");
    $("heard").textContent = "";
    show(t().listening);
    mlog("escuchar (".concat(mode, ", grabaci\xF3n propia)"));
    let blob = null;
    try {
      blob = await jarvis.captureUtterance({ waitMS: mode === "follow" ? jarvis.listenLimits.followMS : jarvis.listenLimits.noSpeechMS });
    } catch (e) {
      jarvis.listening = false;
      jarvis.listenMode = "";
      rest();
      mlog("micr\xF3fono: " + e.name + " " + e.message);
      show(e.name === "NotAllowedError" ? t().micDenied : t().cantStart + e.message);
      return;
    }
    jarvis.listening = false;
    jarvis.listenMode = "";
    if (!blob) {
      rest();
      if (mode === "tap") show(t().notHeard);
      scheduleWake();
      return;
    }
    setState("thinking");
    let text = "";
    try {
      text = (await jarvis.transcribe(blob)).trim();
    } catch (e) {
      rest();
      show(e.message);
      return;
    }
    if (!text) {
      rest();
      if (mode === "tap") show(t().notHeard);
      scheduleWake();
      return;
    }
    await respond(text);
    later(() => listen("follow"));
  }
  function listen(mode = "tap") {
    if (mode === "wake" || settings.engine === "native") return listenNative(mode);
    if (jarvis.listening && jarvis.listenMode === "wake") finishListening == null ? void 0 : finishListening(true);
    return listenCloud(mode);
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
  const FAMILY = {
    mom: [
      "Hi Mum! Are you here to make my bed, or to drop off some clean clothes?",
      "Hello Mum. The room is under control... mostly. Did you bring the laundry?",
      "Welcome, Mum. If you're looking for dirty plates, I saw nothing. Officially."
    ],
    dad: [
      "Hello Dad. Don't worry, the air conditioning is off. I'm watching the electricity bill for you.",
      "Hi Dad. Checking whether the air conditioning is on again? Relax, everything's under control.",
      "Good to see you, Dad. Yes, the lights are off. Every euro is safe."
    ]
  };
  const ROLES = { me: "T\xFA", mom: "Mam\xE1", dad: "Pap\xE1", other: "Otra persona" };
  function loadPeople() {
    const saved = store.get("jarvis-people", null);
    if (Array.isArray(saved)) return saved;
    const legacy = store.get("jarvis-faces", []);
    return legacy.length ? [{ id: "me", role: "me", name: settings.name, greeting: "", samples: legacy }] : [];
  }
  jarvis.people = loadPeople();
  const savePeople = () => store.set("jarvis-people", jarvis.people);
  const displayName = (p) => p.role === "me" ? settings.name : p.name;
  function identify(embedding) {
    const scores = jarvis.people.filter((p) => {
      var _a;
      return (_a = p.samples) == null ? void 0 : _a.length;
    }).map((p) => ({
      person: p,
      score: Math.max(...p.samples.map((known) => jarvis.detector.similarity(embedding, known)))
    })).sort((a, b) => b.score - a.score);
    const [best, second] = scores;
    if (!best || best.score < jarvis.threshold || second && best.score - second.score < 0.03) return { score: (best == null ? void 0 : best.score) || 0 };
    return best;
  }
  jarvis.identify = identify;
  function greetingFor(person) {
    if (person.greeting) return { text: person.greeting, lang: person.role === "me" ? settings.lang : "en" };
    if (person.role === "me") return { text: greeting(), lang: settings.lang };
    if (FAMILY[person.role]) return { text: pick(FAMILY[person.role]), lang: "en" };
    return { text: "Hello, ".concat(person.name, ". Welcome."), lang: "en" };
  }
  async function startCamera() {
    var _a;
    (_a = jarvis.stream) == null ? void 0 : _a.getTracks().forEach((track) => track.stop());
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
    const talking = jarvis.listening && jarvis.listenMode !== "wake" || jarvis.speaking || mood === "thinking";
    if (!jarvis.busy && !talking && video.readyState >= 2) {
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
  const seen = jarvis.seen = {};
  function onFaces(found) {
    if (jarvis.enrolling) return enrollStep(found);
    const known = jarvis.people.some((p) => {
      var _a;
      return (_a = p.samples) == null ? void 0 : _a.length;
    });
    if (!found.length) {
      $("faceState").textContent = known ? "Nadie a la vista" : "Sin cara registrada";
      return;
    }
    if (!known) {
      $("faceState").textContent = "Veo una cara";
      return;
    }
    const now = Date.now(), names = [];
    let toGreet = null;
    for (const face of found) {
      const match = identify(face.embedding);
      if (!match.person) continue;
      names.push(displayName(match.person));
      const away = now - (seen[match.person.id] || 0) > jarvis.absenceMS;
      seen[match.person.id] = now;
      if (match.person.role === "me") jarvis.lastSeen = now;
      if (away && !toGreet) toGreet = match.person;
    }
    $("faceState").textContent = names.length ? names.join(" \xB7 ") : "Persona desconocida";
    if (toGreet && settings.greet && !(jarvis.listening && jarvis.listenMode !== "wake") && !jarvis.speaking) {
      if (jarvis.listening) finishListening == null ? void 0 : finishListening(true);
      const person = toGreet, { text, lang } = greetingFor(person);
      void speak(text, lang).then(() => {
        if (person.role === "me") later(() => listen("follow"));
      });
    }
  }
  function enrollStep(found) {
    const e = jarvis.enrolling;
    const person = jarvis.people.find((p) => p.id === e.personId);
    if (!person) {
      endEnroll();
      return;
    }
    if (found.length !== 1 || found[0].score < 0.6) {
      $("faceInfo").textContent = found.length > 1 ? "Hay m\xE1s de una cara. Que se ponga solo." : "No veo bien la cara. Ac\xE9rcate y mira a la c\xE1mara.";
      return;
    }
    e.samples.push(found[0].embedding.map((x) => Math.round(x * 1e4) / 1e4));
    $("faceInfo").textContent = "Aprendiendo la cara de ".concat(displayName(person), "\u2026 ").concat(e.samples.length, "/5");
    if (e.samples.length >= 5) {
      person.samples = e.samples;
      endEnroll();
      if (!savePeople()) {
        $("faceInfo").textContent = "No se pudo guardar en este navegador.";
        return;
      }
      seen[person.id] = Date.now();
      if (person.role === "me") jarvis.lastSeen = Date.now();
      renderPeople();
      $("faceInfo").textContent = "Listo: ya reconozco a ".concat(displayName(person), ".");
      void speak(person.role === "me" ? t().nice(settings.name) : "Nice to meet you, ".concat(person.name, ". I'll remember you."), person.role === "me" ? settings.lang : "en");
    }
  }
  function endEnroll() {
    jarvis.enrolling = null;
    $("preview").classList.add("stash");
    document.body.append($("preview"));
  }
  function startEnroll(person) {
    if (!jarvis.started) {
      $("faceInfo").textContent = "Primero toca la burbuja para despertar a Jarvis.";
      return;
    }
    jarvis.enrolling = { personId: person.id, samples: [] };
    $("enrollSlot").append($("preview"));
    $("preview").classList.remove("stash");
    $("faceInfo").textContent = person.role === "me" ? "Ponte delante de la c\xE1mara\u2026" : "Que ".concat(displayName(person), " se ponga delante de la c\xE1mara\u2026");
    void scan();
  }
  function renderPeople() {
    var _a, _b, _c;
    const list = $("people");
    list.replaceChildren();
    if (!jarvis.people.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Todav\xEDa no conozco a nadie.";
      list.append(p);
    }
    for (const person of jarvis.people) {
      const row = document.createElement("div");
      row.className = "person";
      const info = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = displayName(person);
      const sub = document.createElement("span");
      sub.className = "muted";
      sub.textContent = ROLES[person.role] + " \xB7 " + (((_a = person.samples) == null ? void 0 : _a.length) ? "cara registrada" : "falta la cara");
      info.append(title, sub);
      const learn = document.createElement("button");
      learn.className = "pill small";
      learn.textContent = ((_b = person.samples) == null ? void 0 : _b.length) ? "Repetir cara" : "Registrar cara";
      learn.onclick = () => startEnroll(person);
      const remove = document.createElement("button");
      remove.className = "pill ghost small";
      remove.textContent = "Borrar";
      remove.onclick = () => {
        jarvis.people = jarvis.people.filter((p) => p !== person);
        savePeople();
        renderPeople();
        $("faceInfo").textContent = "He borrado a ".concat(displayName(person), " de este m\xF3vil.");
      };
      row.append(info, learn, remove);
      list.append(row);
    }
    $("personRole").querySelector('option[value="me"]').disabled = jarvis.people.some((p) => p.role === "me");
    if ((_c = $("personRole").selectedOptions[0]) == null ? void 0 : _c.disabled) $("personRole").value = "mom";
  }
  jarvis.renderPeople = renderPeople;
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
    show(t().waking);
    try {
      await startCamera();
      jarvis.detector = jarvis.detector || await jarvis.createDetector();
      jarvis.started = true;
      rest();
      await keepAwake();
      void scan();
      if (!settings.key) {
        show(t().needKey);
        scheduleWake();
      } else void speak(jarvis.people.some((p) => {
        var _a;
        return p.role === "me" && ((_a = p.samples) == null ? void 0 : _a.length);
      }) ? t().ready(settings.name) : t().readyNoFace).then(() => scheduleWake());
    } catch (e) {
      setState("off");
      show(e.name === "NotAllowedError" ? t().cam : t().cantStart + e.message);
    } finally {
      starting = false;
    }
  }
  jarvis.start = start;
  $("bubble").onclick = () => {
    if (!jarvis.started) return start();
    if (jarvis.speaking) {
      stopSpeaking();
      return scheduleWake();
    }
    if (jarvis.wakeBlocked) {
      jarvis.wakeBlocked = false;
      settings.always = store.get("jarvis-settings", {}).always === true;
    }
    listen("tap");
  };
  $("typeForm").onsubmit = (e) => {
    e.preventDefault();
    const value = $("typeInput").value.trim();
    $("typeInput").value = "";
    if (value) void respond(value);
  };
  $("typeForm").hidden = !settings.typing;
  show(t().tap);
  $("openSettings").onclick = () => {
    if (jarvis.listening) finishListening == null ? void 0 : finishListening(true);
    $("name").value = settings.name;
    $("facing").value = settings.facing;
    $("greetOn").checked = settings.greet;
    $("showType").checked = settings.typing;
    $("voiceKey").value = settings.key;
    $("lang").value = settings.lang;
    $("hear").value = settings.hear;
    $("always").checked = store.get("jarvis-settings", {}).always === true;
    $("engine").value = settings.engine;
    $("voiceInfo").textContent = jarvis.voiceError || (settings.key ? "" : "Sin clave: Jarvis solo escribir\xE1.");
    renderPeople();
    $("faceInfo").textContent = "";
    $("settings").hidden = false;
    $("micLog").textContent = micLog.slice(-14).join("\n");
  };
  $("micTest").onclick = () => {
    const out = (m) => mlog("[prueba] " + m);
    if (jarvis.listening) finishListening == null ? void 0 : finishListening(true);
    out("soporte: ".concat(Recognition ? "s\xED" : "NO", " \xB7 pantalla de inicio: ").concat(navigator.standalone ? "s\xED" : "no", " \xB7 idioma: ").concat(settings.hear));
    if (!Recognition) {
      out("Este modo no tiene reconocimiento de voz. Abre Jarvis en Safari normal.");
      return;
    }
    const rec = new Recognition();
    rec.lang = settings.hear;
    rec.interimResults = true;
    rec.continuous = false;
    ["start", "audiostart", "soundstart", "speechstart", "speechend", "audioend", "end"].forEach((n) => {
      rec["on" + n] = () => out(n);
    });
    rec.onresult = (e) => out("oye: \xAB" + Array.from(e.results).map((r) => r[0].transcript).join(" ") + "\xBB");
    rec.onerror = (e) => out("error: " + e.error);
    try {
      rec.start();
      out("habla ahora\u2026 (6 s)");
    } catch (e) {
      out("no arranca: " + e.name + " " + e.message);
    }
    setTimeout(() => {
      try {
        rec.stop();
      } catch {
      }
    }, 6e3);
  };
  $("closeSettings").onclick = () => {
    $("settings").hidden = true;
    if (jarvis.enrolling) endEnroll();
    scheduleWake();
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
  $("lang").onchange = () => {
    settings.lang = $("lang").value;
    jarvis.history = [];
    save();
    tickClock();
  };
  $("hear").onchange = () => {
    settings.hear = $("hear").value;
    save();
  };
  $("engine").onchange = () => {
    settings.engine = $("engine").value;
    save();
  };
  $("always").onchange = () => {
    settings.always = $("always").checked;
    jarvis.wakeBlocked = false;
    save();
  };
  $("testVoice").onclick = async () => {
    settings.key = $("voiceKey").value.trim();
    save();
    unlockAudio();
    $("voiceInfo").textContent = "Probando\u2026";
    await speak(t().test(settings.name));
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
  $("addPerson").onclick = () => {
    const role = $("personRole").value;
    const name = role === "me" ? settings.name : $("personName").value.trim() || ROLES[role];
    const person = { id: role === "me" ? "me" : "p" + Date.now().toString(36), role, name: name.slice(0, 30), greeting: $("personGreeting").value.trim().slice(0, 300), samples: [] };
    jarvis.people.push(person);
    savePeople();
    $("personName").value = "";
    $("personGreeting").value = "";
    renderPeople();
    startEnroll(person);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (jarvis.listening) finishListening == null ? void 0 : finishListening(true);
      clearTimeout(restartTimer);
      return;
    }
    if (jarvis.started) {
      void keepAwake();
      void scan();
      scheduleWake();
    }
  });
  setState("off");
})();
