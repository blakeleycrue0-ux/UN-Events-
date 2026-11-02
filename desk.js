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
      guardPin: "",
      listen: true,
      wake: true,
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
  var pick = (list) => list[Math.floor(Math.random() * list.length)];
  var normalize = (x) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
  var has = (text, ...words) => words.some((w) => new RegExp(`(^| )${w}( |$)`).test(text));
  async function sha256hex(text) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  var homeTopic = async (key) => "jarvis-pc-" + (await sha256hex("jarvis-pc:" + key.trim())).slice(0, 40);
  var config = () => window.SECURITY_SUPABASE_PUBLIC || {};
  function call(name, body, key, init = {}) {
    const c = config();
    return fetch(`${c.url}/functions/v1/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-jarvis-key": key, apikey: c.key || "", ...init.headers || {} },
      body: init.raw ?? JSON.stringify(body)
    });
  }
  function connectHome({ key, onEvent, onStatus = () => {
  } }) {
    let ws = null, beat = null, ref = 0, topic = "", stopped = false, retry = null;
    const send = (m) => {
      if (ws?.readyState === 1) ws.send(JSON.stringify({ ...m, ref: String(++ref) }));
    };
    async function open() {
      if (stopped) return;
      topic = "realtime:" + await homeTopic(key);
      const c = config();
      const socket = ws = new WebSocket(c.url.replace(/^http/, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(c.key) + "&vsn=1.0.0");
      socket.onopen = () => {
        send({ topic, event: "phx_join", join_ref: "1", payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false } } });
        beat = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {} }), 2e4);
      };
      socket.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.topic !== topic) return;
        if (m.event === "phx_reply" && m.payload?.status) onStatus(m.payload.status === "ok" ? "online" : "error");
        if (m.event === "broadcast" && m.payload?.event === "command") onEvent(m.payload.payload || {});
      };
      socket.onclose = () => {
        clearInterval(beat);
        if (ws === socket && !stopped) {
          onStatus("offline");
          retry = setTimeout(open, 4e3);
        }
      };
    }
    void open();
    return {
      stop() {
        stopped = true;
        clearTimeout(retry);
        clearInterval(beat);
        try {
          ws?.close();
        } catch {
        }
      },
      // Straight to the other devices on the same private channel (no server function).
      send(payload) {
        if (!topic || ws?.readyState !== 1) return false;
        send({ topic, event: "broadcast", payload: { type: "broadcast", event: "command", payload } });
        return true;
      }
    };
  }
  function clockParts(lang) {
    const now = /* @__PURE__ */ new Date(), locale = lang === "es" ? "es-ES" : "en-GB";
    const date = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
    return { time: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), date: date.charAt(0).toUpperCase() + date.slice(1) };
  }

  // src/jarvis/words.js
  var T = {
    en: {
      start: "Click anywhere to wake me up",
      waking: "Booting up\u2026",
      listening: "Listening\u2026",
      idleHint: "Say \u201CJarvis\u2026\u201D or press Space",
      online: (n) => pick([`Systems online. Good to have you back, ${n}.`, `All systems online, ${n}.`, `Online and at your service, ${n}.`]),
      morning: "Good morning",
      afternoon: "Good afternoon",
      evening: "Good evening",
      greetTail: ["What are we doing today?", "How can I help?", "Good to see you.", "Everything is ready."],
      notHeard: "I didn't catch that.",
      micDenied: "I need the microphone. Allow it in Chrome.",
      needKey: "Add your Jarvis key in settings so I can talk.",
      time: (t2) => `It's ${t2}.`,
      date: (d) => `Today is ${d}.`,
      timerSet: (x) => `Done. Timer set for ${x}.`,
      timerBad: "I didn't get how long the timer should be.",
      timerUp: (n) => `${n}, time's up.`,
      device: (d) => `I can't control ${d} yet. Once the universal remote arrives, I'll take care of it.`,
      leaving: (n) => `See you later, ${n}. I'll keep an eye on the door.`,
      thanks: ["You're welcome.", "Any time.", "My pleasure."],
      who: "I'm Jarvis, the assistant of this room.",
      how: "Running at a hundred percent. And you?",
      help: "Ask me anything. I can play music, open Teams or Gmail, search the web, set timers, email you, and I know who comes through the door.",
      unknown: "I didn't understand that.",
      yes: ["Yes?", "At your service.", "I'm listening."],
      jokes: ["I'd tell you a UDP joke, but you might not get it.", "There are ten kinds of people: those who understand binary and those who don't."],
      refused: "I'd rather not answer that one.",
      thinkErr: { "Claude key rejected": "My brain's key was rejected. Check ANTHROPIC_API_KEY in Supabase.", "Claude credit exhausted": "My brain has run out of Claude credit.", "Claude busy": "My brain is busy. Try again in a moment.", "Brain not configured": "My brain isn't set up yet. Add ANTHROPIC_API_KEY in Supabase.", "Wrong Jarvis key": "The Jarvis key doesn't match Supabase." },
      thinkDown: "I can't reach my brain right now.",
      devices: { luz: "the lights", aire: "the air conditioning", ventilador: "the fan", tele: "the TV" },
      stranger: "Someone I don't recognise is at the door.",
      media: { pause: "Paused.", resume: "Playing.", next: "Next one.", louder: "Louder.", quieter: "Quieter." }
    },
    es: {
      start: "Haz clic para despertarme",
      waking: "Arrancando\u2026",
      listening: "Te escucho\u2026",
      idleHint: "Di \xABJarvis\u2026\xBB o pulsa Espacio",
      online: (n) => pick([`Sistemas en l\xEDnea. Bienvenido, ${n}.`, `Todo listo, ${n}.`]),
      morning: "Buenos d\xEDas",
      afternoon: "Buenas tardes",
      evening: "Buenas noches",
      greetTail: ["\xBFQu\xE9 hacemos hoy?", "\xBFEn qu\xE9 te ayudo?", "Me alegro de verte.", "Todo listo por aqu\xED."],
      notHeard: "No te he o\xEDdo.",
      micDenied: "Necesito el micr\xF3fono. Perm\xEDtelo en Chrome.",
      needKey: "Pon tu clave de Jarvis en ajustes para que pueda hablar.",
      time: (t2) => `Son las ${t2}.`,
      date: (d) => `Hoy es ${d}.`,
      timerSet: (x) => `Vale, temporizador de ${x}.`,
      timerBad: "No he entendido el tiempo del temporizador.",
      timerUp: (n) => `${n}, se acab\xF3 el tiempo.`,
      device: (d) => `Todav\xEDa no puedo controlar ${d}. Cuando llegue el mando universal, lo conecto.`,
      leaving: (n) => `Hasta luego, ${n}. Vigilo la puerta.`,
      thanks: ["De nada.", "Para eso estoy.", "Cuando quieras."],
      who: "Soy Jarvis, el asistente de tu cuarto.",
      how: "Funcionando al cien por cien. \xBFY t\xFA?",
      help: "Preg\xFAntame lo que quieras. Pongo m\xFAsica, abro Teams o Gmail, busco en internet, pongo temporizadores, te mando emails y s\xE9 qui\xE9n entra por la puerta.",
      unknown: "No te he entendido.",
      yes: ["\xBFS\xED?", "A tu servicio.", "Te escucho."],
      jokes: ["Hay diez tipos de personas: las que entienden binario y las que no."],
      refused: "Prefiero no contestar a eso.",
      thinkErr: { "Claude key rejected": "La clave de mi cerebro no vale. Revisa ANTHROPIC_API_KEY en Supabase.", "Claude credit exhausted": "Mi cerebro se ha quedado sin cr\xE9dito de Claude.", "Claude busy": "Mi cerebro est\xE1 ocupado. Prueba en un momento.", "Brain not configured": "Mi cerebro a\xFAn no est\xE1 configurado.", "Wrong Jarvis key": "La clave de Jarvis no coincide con la de Supabase." },
      thinkDown: "Ahora no puedo conectar con mi cerebro.",
      devices: { luz: "las luces", aire: "el aire acondicionado", ventilador: "el ventilador", tele: "la tele" },
      stranger: "Hay alguien en la puerta que no reconozco.",
      media: { pause: "Pausa.", resume: "Seguimos.", next: "Siguiente.", louder: "M\xE1s alto.", quieter: "M\xE1s bajo." }
    }
  };
  var FAMILY = {
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
  function greeting(lang, name) {
    const h = (/* @__PURE__ */ new Date()).getHours(), s = T[lang] || T.en;
    const part = h >= 6 && h < 13 ? s.morning : h >= 13 && h < 21 ? s.afternoon : s.evening;
    return `${part}, ${name}. ${pick(s.greetTail)}`;
  }
  var devices = [
    { id: "luz", names: ["luz", "luces", "led", "leds", "lampara", "light", "lights", "lamp"] },
    { id: "aire", names: ["aire", "aire acondicionado", "clima", "air conditioning", "ac", "aircon"] },
    { id: "ventilador", names: ["ventilador", "fan"] },
    { id: "tele", names: ["tele", "television", "televisor", "tv"] }
  ];
  var numbers = { un: 1, uno: 1, una: 1, a: 1, an: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, quince: 15, fifteen: 15, veinte: 20, twenty: 20, treinta: 30, thirty: 30 };
  function quick(raw, lang, name) {
    const text = normalize(raw), s = T[lang] || T.en;
    const timer = /temporizador|alarma|avisame|cuenta atras|timer|remind me in/.test(text) && /(\d+|un|uno|una|a|an|one|dos|two|tres|three|cuatro|four|cinco|five|seis|six|siete|seven|ocho|eight|nueve|nine|diez|ten|quince|fifteen|veinte|twenty|treinta|thirty|media|half an?) ?(minutos?|minutes?|segundos?|seconds?|horas?|hours?)/.exec(text);
    if (timer) {
      const half = /^(media|half)/.test(timer[1]);
      const n = half ? 0.5 : /\d+/.test(timer[1]) ? +timer[1] : numbers[timer[1]];
      const unit = /^seg|^sec/.test(timer[2]) ? 1e3 : /^hora|^hour/.test(timer[2]) ? 36e5 : 6e4;
      const ms = n * unit;
      if (!ms || ms > 6 * 36e5) return { say: s.timerBad };
      const label = half ? lang === "es" ? "media hora" : "half an hour" : `${n} ${timer[2]}`;
      return { say: s.timerSet(label), timer: { ms, label } };
    }
    const device = devices.find((d) => d.names.some((n) => has(text, n.split(" ")[0]) && text.includes(n)));
    if (device && /enciende|encender|apaga|apagar|pon|quita|turn|switch|power/.test(text)) return { say: s.device(s.devices[device.id]) };
    return null;
  }
  function offline(raw, lang, name) {
    const text = normalize(raw), s = T[lang] || T.en, locale = lang === "es" ? "es-ES" : "en-GB";
    if (has(text, "hora", "time")) return s.time((/* @__PURE__ */ new Date()).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }));
    if (has(text, "dia", "fecha", "date", "day") && !has(text, "buenos")) return s.date((/* @__PURE__ */ new Date()).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" }));
    if (has(text, "hola", "buenas", "buenos", "hey", "hello", "hi")) return greeting(lang, name);
    if (has(text, "chiste", "joke")) return pick(s.jokes);
    if (has(text, "gracias", "thanks", "thank")) return pick(s.thanks);
    if (/quien eres|who are you/.test(text)) return s.who;
    if (/como estas|que tal|how are you/.test(text)) return s.how;
    if (/que (puedes|sabes) hacer|ayuda|what can you do|help/.test(text)) return s.help;
    return "";
  }

  // src/jarvis/voice.js
  var MESSAGES = {
    401: "La clave de Jarvis no coincide con la de Supabase.",
    428: "Falta configurar la voz en Supabase.",
    "ElevenLabs key rejected": "ElevenLabs no acepta la clave.",
    "ElevenLabs key lacks text to speech permission": "A la clave de ElevenLabs le falta el permiso Text to Speech.",
    "ElevenLabs quota reached": "Se han acabado los cr\xE9ditos de ElevenLabs este mes."
  };
  function createVoice({ settings: settings2, onState = () => {
  } }) {
    const audio = new Audio();
    audio.preload = "auto";
    let id = 0, finish = null, ctx = null, analyser = null, data = null;
    const voice2 = { speaking: false, error: "", volume: 1 };
    voice2.unlock = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx && !ctx) {
          ctx = new Ctx();
          const source = ctx.createMediaElementSource(audio);
          analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          data = new Uint8Array(analyser.frequencyBinCount);
          source.connect(analyser);
          analyser.connect(ctx.destination);
        }
        ctx?.resume?.();
      } catch {
      }
    };
    voice2.level = () => {
      if (!analyser || !voice2.speaking) return 0;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (const v of data) sum += v;
      return Math.min(1, sum / data.length / 110);
    };
    async function blob(text, lang, extra = {}) {
      const cacheable = !/\d/.test(text) && !!window.caches;
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
      if (!settings2.key) throw Error("Falta la clave de Jarvis en ajustes.");
      const response = await call("jarvis-voice", { text, lang, ...extra }, settings2.key);
      if (!response.ok) {
        let error = "";
        try {
          error = (await response.json()).error || "";
        } catch {
        }
        throw Error(MESSAGES[response.status] || MESSAGES[error] || "La voz no est\xE1 disponible ahora.");
      }
      const result = await response.blob();
      if (cache) {
        try {
          await cache.put(keyUrl, new Response(result, { headers: { "Content-Type": "audio/mpeg" } }));
        } catch {
        }
      }
      return result;
    }
    voice2.prefetch = async (text, lang = settings2.lang) => {
      try {
        if (!/\d/.test(text) && !!window.caches) await blob(text, lang, { prefetch: true });
      } catch {
      }
    };
    voice2.stop = () => {
      id++;
      audio.pause();
      finish?.();
      voice2.speaking = false;
    };
    voice2.speak = async (text, lang = settings2.lang) => {
      const mine = ++id;
      audio.pause();
      onState("thinking", text);
      let url;
      try {
        url = URL.createObjectURL(await blob(text, lang));
        voice2.error = "";
      } catch (e) {
        voice2.error = e.message;
        if (mine === id) onState("idle", text);
        return false;
      }
      if (mine !== id) {
        URL.revokeObjectURL(url);
        return false;
      }
      voice2.speaking = true;
      onState("speaking", text);
      await new Promise((resolve) => {
        const done = () => {
          clearTimeout(guard);
          audio.onended = audio.onerror = null;
          finish = null;
          resolve();
        };
        const guard = setTimeout(done, 45e3);
        audio.onended = audio.onerror = finish = done;
        audio.src = url;
        audio.volume = voice2.volume;
        audio.play().catch(done);
      });
      URL.revokeObjectURL(url);
      if (mine === id) {
        voice2.speaking = false;
        onState("idle", text);
      }
      return true;
    };
    return voice2;
  }

  // src/jarvis/ears.js
  var WAKE = /\b(jarvis|yarvis|jarbis|yarbis|charvis|harvis|harbis|jervis|yervis|jarvi|yarvi|jarviz|jarvice|chavis|travis)\b/i;
  function afterWake(text) {
    const m = WAKE.exec(text);
    return m ? text.slice(m.index + m[0].length).replace(/^[\s,.:!¡¿?]+/, "").trim() : null;
  }
  function createEars({ settings: settings2, onHeard, onState = () => {
  }, log: log2 = () => {
  } }) {
    const ears2 = { listening: false, mode: "", paused: false, limits: { silenceMS: 2200, directMS: 8e3, followMS: 6e3, maxMS: 45e3 }, blocked: false };
    let session = null, restart = null, quickFails = 0, mic = null, analyser = null, data = null;
    const Recognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;
    ears2.openMeter = async () => {
      if (mic) return;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const src = ctx.createMediaStreamSource(mic);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        data = new Float32Array(analyser.fftSize);
        src.connect(analyser);
      } catch (e) {
        log2("medidor: " + e.name);
      }
    };
    ears2.level = () => {
      if (!analyser) return 0;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const x of data) sum += x * x;
      return Math.min(1, Math.sqrt(sum / data.length) * 8);
    };
    function stopSession() {
      const s = session;
      session = null;
      if (s) {
        clearInterval(s.watch);
        try {
          s.rec.abort();
        } catch {
        }
      }
    }
    function scheduleBackground(delay = 400) {
      clearTimeout(restart);
      if (!settings2.wake || ears2.paused || ears2.blocked || !Recognition()) return;
      restart = setTimeout(() => {
        if (!session && !ears2.paused) run("wake");
      }, delay);
    }
    function run(mode) {
      const R = Recognition();
      if (!R) return false;
      stopSession();
      clearTimeout(restart);
      const rec = new R();
      rec.lang = settings2.hear;
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      const s = session = { rec, mode, text: "", started: Date.now(), last: Date.now(), failure: "", done: false };
      ears2.listening = true;
      ears2.mode = mode;
      if (mode !== "wake") onState("listening", "");
      const finish = () => {
        if (s.done) return;
        s.done = true;
        clearInterval(s.watch);
        try {
          rec.abort();
        } catch {
        }
        if (session === s) session = null;
        ears2.listening = false;
        ears2.mode = "";
        log2(`fin ${mode}: ${s.failure || "\xAB" + s.text + "\xBB"}`);
        if (/not-allowed|service-not-allowed/.test(s.failure)) {
          ears2.blocked = true;
          onState("blocked", "");
          return;
        }
        quickFails = Date.now() - s.started < 700 && !s.text ? quickFails + 1 : 0;
        if (mode === "wake") {
          const command = afterWake(s.text);
          if (command !== null) {
            onHeard(command, "wake");
            return;
          }
          scheduleBackground(quickFails > 4 ? 5e3 : 300);
          return;
        }
        onState("idle", "");
        if (s.text) onHeard(s.text, mode);
        else {
          if (mode === "direct") onHeard("", "silence");
          scheduleBackground();
        }
      };
      s.finish = finish;
      rec.onresult = (e) => {
        const text = Array.from(e.results).map((r) => r[0].transcript).join(" ").replace(/\s+/g, " ").trim();
        if (text !== s.text) {
          s.text = text;
          s.last = Date.now();
        }
        if (mode === "wake" && WAKE.test(text)) onState("listening", afterWake(text) || "");
        else if (mode !== "wake") onState("listening", text);
      };
      rec.onerror = (e) => {
        s.failure = e.error || "error";
        if (s.failure !== "no-speech" || mode !== "wake") finish();
      };
      rec.onend = finish;
      const quiet = mode === "follow" ? ears2.limits.followMS : mode === "direct" ? ears2.limits.directMS : 6e4;
      s.watch = setInterval(() => {
        const now = Date.now(), wakeHeard = mode !== "wake" || WAKE.test(s.text);
        if (s.text && wakeHeard && now - s.last > ears2.limits.silenceMS || !s.text && now - s.started > quiet || mode !== "wake" && now - s.started > ears2.limits.maxMS || mode === "wake" && s.text && !wakeHeard && now - s.last > 2500) finish();
      }, 150);
      log2(`escuchar ${mode} (${rec.lang})`);
      try {
        rec.start();
      } catch (e) {
        s.failure = /not-allowed/i.test(e.name + e.message) ? "not-allowed" : e.message;
        finish();
      }
      return true;
    }
    async function recordOnce(waitMS) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : void 0), chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data?.size) chunks.push(e.data);
      };
      const Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx(), an = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(an);
      an.fftSize = 1024;
      const buf = new Float32Array(1024), started = Date.now();
      let floor = 0, n = 0, speech = 0, loud = 0;
      recorder.start(250);
      await new Promise((resolve) => {
        const t2 = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let sum = 0;
          for (const x of buf) sum += x * x;
          const rms = Math.sqrt(sum / buf.length);
          const now = Date.now();
          if (now - started < 300) {
            floor += rms;
            n++;
            return;
          }
          if (rms > Math.max(0.015, floor / Math.max(1, n) * 2.5)) {
            loud = now;
            speech || (speech = now);
          }
          if (speech && now - loud > ears2.limits.silenceMS || !speech && now - started > waitMS || now - started > ears2.limits.maxMS) {
            clearInterval(t2);
            resolve();
          }
        }, 50);
      });
      await new Promise((r) => {
        recorder.onstop = r;
        recorder.stop();
      });
      stream.getTracks().forEach((t2) => t2.stop());
      ctx.close?.();
      return speech ? new Blob(chunks, { type: (type || "audio/webm").split(";")[0] }) : null;
    }
    async function cloud2(mode) {
      ears2.listening = true;
      ears2.mode = mode;
      onState("listening", "");
      try {
        const clip = await recordOnce(mode === "follow" ? ears2.limits.followMS : ears2.limits.directMS);
        if (!clip) {
          ears2.listening = false;
          onState("idle", "");
          if (mode === "direct") onHeard("", "silence");
          return;
        }
        onState("thinking", "");
        const response = await call("jarvis-hear", null, settings2.key, { raw: clip, headers: { "Content-Type": clip.type } });
        const data2 = await response.json().catch(() => ({}));
        ears2.listening = false;
        onHeard(response.ok ? String(data2.text || "").trim() : "", response.ok ? mode : "error");
      } catch (e) {
        ears2.listening = false;
        onState(e.name === "NotAllowedError" ? "blocked" : "idle", "");
      }
    }
    ears2.direct = (mode = "direct") => {
      clearTimeout(restart);
      if (session && session.mode !== "wake") {
        session.finish();
        return;
      }
      ears2.blocked = false;
      if (!run(mode)) void cloud2(mode);
    };
    ears2.background = () => scheduleBackground(200);
    ears2.pause = () => {
      ears2.paused = true;
      clearTimeout(restart);
      if (session) {
        session.done = true;
        stopSession();
        ears2.listening = false;
        ears2.mode = "";
      }
    };
    ears2.resume = (follow = false) => {
      ears2.paused = false;
      if (follow) ears2.direct("follow");
      else scheduleBackground(300);
    };
    return ears2;
  }

  // src/jarvis/orb.js
  var PALETTE = {
    off: [120, 130, 150],
    idle: [140, 190, 255],
    listening: [60, 230, 255],
    thinking: [170, 140, 255],
    speaking: [120, 210, 255],
    blocked: [255, 170, 80],
    alert: [255, 80, 90],
    arrival: [90, 255, 170]
  };
  function createOrb(canvas, { count = 900 } = {}) {
    const ctx = canvas.getContext("2d");
    const pts = [];
    for (let i = 0; i < count; i++) {
      const y = 1 - i / (count - 1) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963229728653;
      pts.push({ x: Math.cos(th) * r, y, z: Math.sin(th) * r, seed: Math.random() * 6.28 });
    }
    let state = "off", color = [...PALETTE.off], spin = 0, level = 0, flashUntil = 0, flashColor = null, raf = 0, last = performance.now();
    const orb2 = { levelSource: () => 0 };
    orb2.setState = (s) => {
      state = s;
    };
    orb2.flash = (kind) => {
      flashColor = PALETTE[kind] || PALETTE.alert;
      flashUntil = performance.now() + 1600;
    };
    function size() {
      const r = canvas.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(r.width * dpr)) {
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
      }
      return { w: canvas.width, h: canvas.height };
    }
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1e3);
      last = now;
      const { w, h } = size(), cx = w / 2, cy = h / 2, base = Math.min(w, h) * 0.33;
      const target = now < flashUntil ? flashColor : PALETTE[state] || PALETTE.idle;
      color = color.map((c, i) => c + (target[i] - c) * Math.min(1, dt * 4));
      const want = Math.max(orb2.levelSource() || 0, state === "thinking" ? 0.25 : 0);
      level += (want - level) * Math.min(1, dt * 10);
      spin += dt * (state === "thinking" ? 1.6 : state === "speaking" ? 0.7 : state === "listening" ? 0.5 : 0.18);
      const breathe = state === "off" ? 0.9 : 1 + Math.sin(now / 1400) * 0.025;
      const R = base * breathe * (1 + level * 0.28);
      ctx.clearRect(0, 0, w, h);
      const [r, g, b] = color.map(Math.round);
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 1.9);
      halo.addColorStop(0, `rgba(${r},${g},${b},${0.16 + level * 0.18})`);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);
      if (state === "thinking" || now < flashUntil) {
        ctx.lineWidth = Math.max(1, w / 900);
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = `rgba(${r},${g},${b},${0.35 - k * 0.09})`;
          ctx.beginPath();
          ctx.ellipse(cx, cy, R * (1.18 + k * 0.12), R * (0.32 + k * 0.08), spin * (k % 2 ? -1.3 : 1) + k, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      const cs = Math.cos(spin), sn = Math.sin(spin), tilt = 0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
      const dot = Math.max(1, w / 520);
      for (const p of pts) {
        let x = p.x * cs - p.z * sn, z = p.x * sn + p.z * cs, y = p.y;
        const y2 = y * ct - z * st;
        z = y * st + z * ct;
        y = y2;
        const wobble = 1 + Math.sin(now / 380 + p.seed) * 0.04 * (0.4 + level * 2.2);
        const persp = 1.9 / (2.6 - z);
        const px = cx + x * R * wobble * persp, py = cy + y * R * wobble * persp;
        const a = 0.18 + (z + 1) * 0.38;
        ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
        const s = dot * (0.6 + (z + 1) * 0.55);
        ctx.fillRect(px - s / 2, py - s / 2, s, s);
      }
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
      core.addColorStop(0, `rgba(255,255,255,${0.18 + level * 0.3})`);
      core.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    raf = requestAnimationFrame(frame);
    orb2.stop = () => cancelAnimationFrame(raf);
    return orb2;
  }

  // src/jarvis/icons.js
  var svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  var sunRays = '<path d="M12 2.8v1.9M12 19.3v1.9M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.8 12h1.9M19.3 12h1.9M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
  var cloud = '<path d="M7.2 18.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 12.2a3.2 3.2 0 0 0 .5 6.3z"/>';
  var ICONS = {
    clear: svg('<circle cx="12" cy="12" r="4.2"/>' + sunRays),
    night: svg('<path d="M19.5 14.6A7.6 7.6 0 1 1 9.4 4.5a6 6 0 0 0 10.1 10.1z"/>'),
    partly: svg('<circle cx="9" cy="8.6" r="3.2"/><path d="M9 2.6v1.2M3.1 8.6h1.2M4.8 4.4l.85.85M13.2 4.4l-.85.85"/><path d="M9.2 19.5h8.6a3.2 3.2 0 0 0 .4-6.38 4.7 4.7 0 0 0-8.9.86 2.8 2.8 0 0 0-.1 5.52z"/>'),
    cloud: svg(cloud),
    fog: svg('<path d="M4 9.5h16M6 13h12M4 16.5h16M8 20h8"/>'),
    drizzle: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M9 18.6l-.6 1.4M13 18.6l-.6 1.4M17 18.6l-.6 1.4"/>'),
    rain: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M8.5 18l-1 2.6M12.5 18l-1 2.6M16.5 18l-1 2.6"/>'),
    storm: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M12.6 15.6l-2 3.4h3l-2 3.2"/>'),
    snow: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M9 19h.01M12 21h.01M15 19h.01"/>'),
    prev: svg('<path d="M18 6.5v11L9.5 12 18 6.5z" fill="currentColor" stroke="none"/><path d="M6.5 6.5v11"/>'),
    next: svg('<path d="M6 6.5v11l8.5-5.5L6 6.5z" fill="currentColor" stroke="none"/><path d="M17.5 6.5v11"/>'),
    play: svg('<path d="M8 5.8v12.4L18 12 8 5.8z" fill="currentColor" stroke="none"/>'),
    pause: svg('<path d="M8.2 6v12M15.8 6v12" stroke-width="2.4"/>'),
    gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.2H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>'),
    door: svg('<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M4 21h16"/><circle cx="14.5" cy="12" r=".6" fill="currentColor"/>'),
    laptop: svg('<rect x="4.5" y="5" width="15" height="10" rx="1.4"/><path d="M2.5 19h19"/>'),
    mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
    shield: svg('<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z"/>'),
    moon: svg('<path d="M19.5 14.6A7.6 7.6 0 1 1 9.4 4.5a6 6 0 0 0 10.1 10.1z"/>')
  };
  function weatherKind(code, night = false) {
    if (code === 0 || code === 1) return [code ? "Mostly clear" : "Clear", code ? "Casi despejado" : "Despejado", night ? "night" : "clear"];
    if (code === 2) return ["Partly cloudy", "Parcialmente nublado", night ? "cloud" : "partly"];
    if (code === 3) return ["Overcast", "Nublado", "cloud"];
    if (code === 45 || code === 48) return ["Fog", "Niebla", "fog"];
    if (code >= 51 && code <= 57) return ["Drizzle", "Llovizna", "drizzle"];
    if (code >= 61 && code <= 67 || code >= 80 && code <= 82) return [code >= 80 ? "Showers" : code >= 65 ? "Heavy rain" : "Rain", code >= 80 ? "Chubascos" : code >= 65 ? "Lluvia fuerte" : "Lluvia", "rain"];
    if (code >= 71 && code <= 77 || code === 85 || code === 86) return ["Snow", "Nieve", "snow"];
    if (code >= 95) return ["Thunderstorm", "Tormenta", "storm"];
    return ["", "", "cloud"];
  }

  // src/desk.js
  var toCamera = () => {
    if (/invite=[a-f0-9]{64}/i.test(location.hash)) location.replace("camara.html" + location.hash);
  };
  toCamera();
  window.addEventListener("hashchange", toCamera);
  if (store.get("jarvis-role", "") === "wall") location.replace("pared.html");
  if (store.get("jarvis-role", "") === "remote") location.replace("mando.html");
  var settings = loadSettings();
  var t = () => T[settings.lang] || T.en;
  var desk = window.desk = {
    started: false,
    state: "off",
    history: [],
    lastTalk: 0,
    memory: store.get("jarvis-memory", []),
    arrivals: store.get("jarvis-arrivals", []),
    timers: [],
    weather: null,
    wallSeen: 0,
    activeAt: Date.now(),
    extension: false,
    music: store.get("jarvis-music", null),
    settings,
    log: []
  };
  var log = (m) => {
    const d = /* @__PURE__ */ new Date();
    desk.log.push(`${d.toLocaleTimeString("es-ES")} ${m}`);
    while (desk.log.length > 60) desk.log.shift();
    if (!$("settings").hidden) $("micLog").textContent = desk.log.slice(-16).join("\n");
  };
  var orb = createOrb($("orb"));
  var STATE_LABEL = { off: "OFFLINE", idle: "STANDBY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", blocked: "MIC BLOCKED" };
  function setState(state, text) {
    desk.state = state;
    document.body.dataset.state = state;
    orb.setState(state);
    $("stateLabel").textContent = STATE_LABEL[state] || "STANDBY";
    duck(state);
    const talking = state === "speaking";
    if (talking !== !!desk.talkingSent) {
      desk.talkingSent = talking;
      try {
        home?.send({ action: "speaking", on: talking });
      } catch {
      }
    }
    if (state !== "idle") wakeUp();
    if (state === "listening") $("heard").textContent = text || "";
  }
  function wakeUp() {
    desk.activeAt = Date.now();
    document.body.classList.remove("ambient");
  }
  document.addEventListener("pointermove", wakeUp);
  document.addEventListener("keydown", wakeUp);
  function chime(kind = "arrival") {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      desk.chimeCtx || (desk.chimeCtx = new Ctx());
      const ctx = desk.chimeCtx, t0 = ctx.currentTime;
      const notes = kind === "alert" ? [523.25, 415.3] : [659.25, 987.77];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = f;
        o.connect(g);
        g.connect(ctx.destination);
        const t2 = t0 + i * 0.16;
        g.gain.setValueAtTime(0, t2);
        g.gain.linearRampToValueAtTime(0.08, t2 + 0.02);
        g.gain.exponentialRampToValueAtTime(1e-4, t2 + 0.9);
        o.start(t2);
        o.stop(t2 + 1);
      });
    } catch {
    }
  }
  desk.chime = chime;
  function say(text) {
    $("say").textContent = text;
    $("say").classList.remove("pop");
    void $("say").offsetWidth;
    $("say").classList.add("pop");
  }
  function toast(text) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    $("toasts").append(el);
    setTimeout(() => el.classList.add("out"), 2200);
    setTimeout(() => el.remove(), 2800);
  }
  function quietNow(h = (/* @__PURE__ */ new Date()).getHours()) {
    if (desk.sleep) return true;
    const { quietFrom: a, quietTo: b } = settings;
    return a === b ? false : a < b ? h >= a && h < b : h >= a || h < b;
  }
  desk.quietNow = quietNow;
  for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = ICONS[el.dataset.icon] || "";
  var isNight = (h = (/* @__PURE__ */ new Date()).getHours()) => h < 7 || h >= 21;
  function weatherText() {
    const w = desk.weather;
    if (!w) return "";
    const [en] = weatherKind(w.code);
    return `${settings.city}: ${Math.round(w.temp)}\xB0C, ${en.toLowerCase()}, high ${Math.round(w.max)}\xB0, low ${Math.round(w.min)}\xB0${w.rain ? `, ${w.rain}% chance of rain` : ""}`;
  }
  desk.weatherText = weatherText;
  async function loadWeather() {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${settings.lat}&longitude=${settings.lon}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`;
      const data = await (await fetch(url)).json();
      const now = Date.now(), times = (data.hourly?.time || []).map((t2) => new Date(t2).getTime());
      const start2 = Math.max(0, times.findIndex((t2) => t2 > now));
      const hours = times.slice(start2, start2 + 5).map((t2, i) => ({ t: t2, temp: data.hourly.temperature_2m[start2 + i], code: data.hourly.weather_code[start2 + i] }));
      desk.weather = { temp: data.current.temperature_2m, code: data.current.weather_code, max: data.daily.temperature_2m_max[0], min: data.daily.temperature_2m_min[0], rain: data.daily.precipitation_probability_max?.[0] || 0, hours };
    } catch {
      log("tiempo: sin conexi\xF3n");
    }
    renderWeather();
    render();
  }
  desk.loadWeather = loadWeather;
  function renderWeather() {
    const w = desk.weather;
    if (!w) return;
    const [en, es, kind] = weatherKind(w.code, isNight());
    $("wxIcon").innerHTML = ICONS[kind];
    $("wxTemp").textContent = Math.round(w.temp) + "\xB0";
    $("wxText").textContent = `${settings.lang === "es" ? es : en} \xB7 H ${Math.round(w.max)}\xB0  L ${Math.round(w.min)}\xB0${w.rain ? ` \xB7 ${w.rain}% rain` : ""}`;
    $("wxCity").textContent = settings.city;
    $("wxHours").replaceChildren(...(w.hours || []).map((h) => {
      const li = document.createElement("li"), d = new Date(h.t);
      const time = document.createElement("span");
      time.textContent = String(d.getHours()).padStart(2, "0");
      const icon = document.createElement("span");
      icon.className = "ico";
      icon.innerHTML = ICONS[weatherKind(h.code, isNight(d.getHours()))[2]];
      const temp = document.createElement("b");
      temp.textContent = Math.round(h.temp) + "\xB0";
      li.append(time, icon, temp);
      return li;
    }));
  }
  function ago(ms) {
    const m = Math.round((Date.now() - ms) / 6e4), es = settings.lang === "es";
    return m < 1 ? es ? "ahora" : "now" : m < 60 ? `${m} min` : new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }
  var ROLE_LABEL = { me: ["You", "T\xFA"], mom: ["Mother", "Madre"], dad: ["Father", "Padre"], other: ["Guest", "Invitado"], unknown: ["Unrecognised", "Desconocido"] };
  var initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  function render() {
    const { time, date } = clockParts(settings.lang);
    $("clock").textContent = time;
    $("date").textContent = date;
    document.body.classList.toggle("night", quietNow());
    $("quiet").hidden = !quietNow();
    const online = Date.now() - desk.wallSeen < 6 * 6e4, es = settings.lang === "es";
    $("wallDot").classList.toggle("on", online);
    $("wallText").textContent = online ? es ? "c\xE1mara en l\xEDnea" : "camera online" : es ? "c\xE1mara sin se\xF1al" : "camera offline";
    const list = $("arrivals"), shown = desk.arrivals.slice(-5).reverse();
    const signature = settings.lang + shown.map((a) => a.at).join(",");
    if (list.dataset.sig === signature) list.querySelectorAll("time").forEach((el, i) => {
      el.textContent = ago(shown[i].at);
    });
    else {
      list.dataset.sig = signature;
      list.replaceChildren();
      for (const a of shown) {
        const li = document.createElement("li");
        li.className = "arrival " + a.role;
        const av = document.createElement("span");
        av.className = "avatar";
        av.textContent = a.role === "unknown" ? "?" : initials(a.name);
        const who = document.createElement("span");
        who.className = "who";
        const name = document.createElement("strong");
        name.textContent = a.name;
        const role = document.createElement("span");
        role.textContent = (ROLE_LABEL[a.role] || ROLE_LABEL.other)[es ? 1 : 0];
        who.append(name, role);
        const when = document.createElement("time");
        when.textContent = ago(a.at);
        li.append(av, who, when);
        list.append(li);
      }
      if (!shown.length) {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = es ? "Nadie ha entrado todav\xEDa" : "No one has come in yet";
        list.append(li);
      }
    }
    $("musicNow").textContent = desk.music ? desk.music.query : es ? "Di \xABJarvis, pon m\xFAsica\xBB" : "Say \u201CJarvis, play some music\u201D";
    $("musicNow").classList.toggle("idle", !desk.music);
    $("musicSvc").textContent = desk.music ? desk.music.service === "spotify" ? "Spotify" : "YouTube" : "";
    const timers = $("timers");
    timers.replaceChildren();
    for (const tm of desk.timers) {
      const li = document.createElement("li"), left = Math.max(0, tm.end - Date.now());
      const label = document.createElement("span");
      label.textContent = tm.label;
      const rest = document.createElement("b");
      rest.textContent = `${Math.floor(left / 6e4)}:${String(Math.floor(left / 1e3) % 60).padStart(2, "0")}`;
      li.append(label, rest);
      timers.append(li);
    }
    $("timersCard").hidden = !desk.timers.length;
    const mem = $("memory");
    mem.replaceChildren();
    for (const m of desk.memory.slice(-4).reverse()) {
      const li = document.createElement("li");
      li.textContent = m;
      mem.append(li);
    }
    $("memoryCard").hidden = !desk.memory.length;
    $("extDot").classList.toggle("on", desk.extension);
    $("earDot").classList.toggle("on", settings.wake && !ears.blocked && desk.started || wallListening());
    document.body.classList.toggle("ambient", desk.started && Date.now() - desk.activeAt > 18e4);
  }
  desk.render = render;
  setInterval(render, 1e3);
  var voice = desk.voice = createVoice({ settings, onState: (state, text) => {
    if (state !== "idle") setState(state === "speaking" ? "speaking" : "thinking");
    else setState("idle");
    if (text) say(text);
  } });
  var ears = desk.ears = createEars({ settings, log, onHeard: (text, via) => void heard(text, via), onState: (state, text) => {
    if (state === "listening") setState("listening", text);
    else if (state === "blocked") {
      if (!wallListening()) say(t().micDenied);
      setState("idle");
    } else if (state === "thinking") setState("thinking");
    else if (desk.state === "listening") setState("idle");
  } });
  {
    const resume = ears.resume;
    ears.resume = (follow = false) => {
      if (wallListening()) {
        ears.paused = true;
        return;
      }
      resume(follow);
    };
  }
  orb.levelSource = () => desk.state === "speaking" ? voice.level() : desk.state === "listening" ? ears.level() : 0;
  async function talk(text, lang) {
    ears.pause();
    desk.lastSaid = text;
    say(text);
    if (!settings.key) {
      setState("idle");
      ears.resume();
      return;
    }
    await voice.speak(text, lang);
  }
  desk.talk = talk;
  async function heard(text, via) {
    if (via === "silence") {
      say(t().notHeard);
      setState("idle");
      ears.resume();
      return;
    }
    if (via === "error") {
      say(t().notHeard);
      setState("idle");
      ears.resume();
      return;
    }
    if (via === "wake" && wallListening()) {
      ears.resume();
      return;
    }
    if (via === "wake" && !text) {
      await talk(pick(t().yes));
      ears.resume(true);
      return;
    }
    if (!text) {
      setState("idle");
      ears.resume();
      return;
    }
    await respond(text);
  }
  async function respond(raw) {
    $("heard").textContent = "\xAB" + raw + "\xBB";
    if (desk.ask) {
      const id = desk.ask;
      desk.ask = 0;
      await extension("agent-answer", { ask: id, text: raw });
      setState("idle");
      ears.resume();
      return;
    }
    if (await wakeVoice(raw)) return;
    if (await guardVoice(raw)) return;
    if (desk.agent && /^\s*(stop|para|parar|cancela|cancel|d[ée]jalo|basta)\b/i.test(raw)) {
      await extension("agent-stop");
      desk.agent = null;
      renderAgent();
      await talk(settings.lang === "es" ? "Vale, lo dejo." : "Alright, I've stopped.");
      ears.resume();
      return;
    }
    const local = quick(raw, settings.lang, settings.name);
    if (local) {
      if (local.timer) addTimer(local.timer.ms, local.timer.label);
      await talk(local.say);
      ears.resume(true);
      return;
    }
    setState("thinking");
    const reply = await think(raw);
    await talk(reply);
    ears.resume(true);
  }
  desk.respond = respond;
  async function think(raw, { remember = true, event = false } = {}) {
    if (!event && Date.now() - desk.lastTalk > 6 * 6e4) desk.history = [];
    if (!event) desk.lastTalk = Date.now();
    const history = event ? [] : desk.history;
    history.push({ role: "user", content: raw.slice(0, 1e3) });
    while (history.length > 19 || history[0]?.role !== "user") history.shift();
    const locale = settings.lang === "es" ? "es-ES" : "en-GB";
    try {
      if (!settings.key) throw Error(t().needKey);
      const now = (/* @__PURE__ */ new Date()).toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
      const timers = desk.timers.map((tm) => `${tm.label} timer, ${Math.ceil((tm.end - Date.now()) / 6e4)} min left`).join("; ");
      const context = [weatherText(), timers, desk.music ? `Last music: ${desk.music.query}` : ""].filter(Boolean).join(". ");
      const off = -(/* @__PURE__ */ new Date()).getTimezoneOffset(), tz = `UTC${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
      const response = await call("jarvis-brain", { messages: history, lang: settings.lang, name: settings.name, now: `${now} (${tz}, ${(/* @__PURE__ */ new Date()).getFullYear()})`, memory: desk.memory, context, hear: settings.hear }, settings.key);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(t().thinkErr[data.error] || t().thinkDown);
      const reply = data.refused || !data.reply ? t().refused : data.reply;
      history.push({ role: "assistant", content: reply });
      if (remember && Array.isArray(data.remember)) {
        for (const fact of data.remember) addMemory(fact);
      }
      if ((data.actions || []).some((a) => String(a).startsWith("reminder:"))) void loadReminders();
      const play = (data.actions || []).includes("play");
      if (play) {
        const m = /play(?:ing)? (.+?)(?: on (?:youtube|spotify))?[.!]?$/i.exec(reply);
        desk.music = { query: m ? m[1] : raw, service: /spotify/i.test(reply + raw) ? "spotify" : "youtube" };
        store.set("jarvis-music", desk.music);
      }
      render();
      return reply;
    } catch (e) {
      history.pop();
      return offline(raw, settings.lang, settings.name) || e.message || t().thinkDown;
    }
  }
  desk.think = think;
  function whenLabel(iso) {
    const d = new Date(iso), now = /* @__PURE__ */ new Date(), es = settings.lang === "es";
    const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = Math.round((day(d) - day(now)) / 864e5);
    if (diff === 0) return hm;
    if (diff === 1) return (es ? "Ma\xF1ana " : "Tomorrow ") + hm;
    return d.toLocaleDateString(es ? "es-ES" : "en-GB", { weekday: "short", day: "numeric", month: "short" }) + " " + hm;
  }
  async function loadReminders() {
    if (!settings.key) return;
    try {
      const response = await call("jarvis-call", { action: "reminders" }, settings.key);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(data.reminders)) return;
      desk.reminders = data.reminders;
      renderReminders();
    } catch {
    }
  }
  desk.loadReminders = loadReminders;
  function renderReminders() {
    const list = desk.reminders || [];
    $("remindersCard").hidden = !list.length;
    $("remindersSub").textContent = list.length ? String(list.length) : "";
    $("reminders").replaceChildren(...list.map((r) => {
      const li = document.createElement("li");
      const when = document.createElement("time");
      when.textContent = whenLabel(r.due_at);
      const text = document.createElement("span");
      text.textContent = r.text + (r.via === "email" ? " (email)" : "");
      const x = document.createElement("button");
      x.textContent = "\u2715";
      x.title = settings.lang === "es" ? "Borrar" : "Delete";
      x.onclick = async () => {
        await call("jarvis-call", { action: "forget", id: r.id }, settings.key).catch(() => {
        });
        void loadReminders();
      };
      li.append(when, text, x);
      return li;
    }));
  }
  setInterval(() => {
    if (desk.started) void loadReminders();
  }, 6e4);
  async function restoreMemory() {
    if (!settings.key) return;
    try {
      const response = await call("jarvis-call", { action: "state" }, settings.key);
      const data = await response.json().catch(() => ({}));
      if (response.ok && /^\d{4}$/.test(data.guardPin || "") && data.guardPin !== settings.guardPin) {
        settings.guardPin = data.guardPin;
        settings.save();
      }
      if (desk.memory.length) return;
      const facts = Array.isArray(data.memory) ? data.memory.map((m) => String(m).slice(0, 200)).filter(Boolean) : [];
      if (!response.ok || !facts.length || desk.memory.length) return;
      desk.memory = facts.slice(-40);
      store.set("jarvis-memory", desk.memory);
      render();
      toast(settings.lang === "es" ? `He recuperado ${facts.length} recuerdos.` : `Restored ${facts.length} memories.`);
    } catch {
    }
  }
  desk.restoreMemory = restoreMemory;
  function addMemory(fact) {
    if (!fact || desk.memory.includes(fact)) return;
    desk.memory.push(fact);
    while (desk.memory.length > 40) desk.memory.shift();
    store.set("jarvis-memory", desk.memory);
    render();
    toast((settings.lang === "es" ? "Recordado: " : "Remembered: ") + fact);
  }
  function addTimer(ms, label) {
    const tm = { end: Date.now() + ms, label };
    tm.handle = setTimeout(async () => {
      desk.timers = desk.timers.filter((x) => x !== tm);
      render();
      orb.flash("alert");
      await talk(t().timerUp(settings.name));
      ears.resume();
    }, ms);
    desk.timers.push(tm);
    render();
  }
  desk.addTimer = addTimer;
  desk.wake = store.get("jarvis-wake", { time: "", done: "" });
  desk.sunriseLeadMS = 15 * 6e4;
  desk.sunriseRingMS = 30 * 6e4;
  desk.snoozeMS = 9 * 6e4;
  function wakeTarget(now = Date.now()) {
    if (desk.wakeOverride) return desk.wakeOverride;
    if (!/^\d{2}:\d{2}$/.test(desk.wake.time || "")) return 0;
    const [h, m] = desk.wake.time.split(":").map(Number), d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (now > d.getTime() + desk.sunriseRingMS) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  desk.wakeTarget = wakeTarget;
  function saveWake() {
    store.set("jarvis-wake", desk.wake);
    renderWake();
  }
  function renderWake() {
    const on = /^\d{2}:\d{2}$/.test(desk.wake.time || "");
    $("alarmInfo").hidden = !on;
    if (on) $("alarmText").textContent = (settings.lang === "es" ? "Despertador " : "Alarm ") + desk.wake.time;
  }
  function setWake(time) {
    desk.wake.time = time;
    desk.wake.done = "";
    desk.wakeOverride = 0;
    saveWake();
  }
  desk.setWake = setWake;
  var SKYK = [
    // progress, zenith, horizon, sun
    [0, [2, 3, 12], [9, 12, 30], [120, 20, 10]],
    [0.25, [6, 9, 30], [56, 26, 66], [170, 40, 20]],
    [0.5, [24, 32, 78], [205, 86, 50], [255, 110, 40]],
    [0.75, [64, 104, 168], [252, 168, 88], [255, 196, 110]],
    [1, [128, 186, 236], [255, 228, 186], [255, 248, 225]]
  ];
  var lerp = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  function skyColors(p) {
    let i = 0;
    while (i < SKYK.length - 2 && p > SKYK[i + 1][0]) i++;
    const [a, b] = [SKYK[i], SKYK[i + 1]], k = Math.min(1, Math.max(0, (p - a[0]) / (b[0] - a[0])));
    return { zen: lerp(a[1], b[1], k), hor: lerp(a[2], b[2], k), sun: lerp(a[3], b[3], k) };
  }
  desk.skyColors = skyColors;
  var stars = Array.from({ length: 340 }, () => ({ x: Math.random(), y: Math.pow(Math.random(), 1.4) * 0.8, r: Math.random() * 1.3 + 0.25, a: Math.random() * 0.7 + 0.3, s: Math.random() * 2 + 0.5, ph: Math.random() * 6.3 }));
  var meteor = null;
  function drawSky(p, t2) {
    const c = $("sky"), dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const { zen, hor, sun } = skyColors(p), horizon = H * 0.78;
    const grd = g.createLinearGradient(0, 0, 0, horizon);
    grd.addColorStop(0, `rgb(${zen})`);
    grd.addColorStop(0.55, `rgb(${lerp(zen, hor, 0.45)})`);
    grd.addColorStop(1, `rgb(${hor})`);
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    const starAlpha = Math.max(0, 1 - p * 2.4);
    if (starAlpha > 0) {
      for (const s of stars) {
        const a = s.a * starAlpha * (0.55 + 0.45 * Math.sin(t2 / 1e3 * s.s + s.ph));
        g.fillStyle = `rgba(235,240,255,${a.toFixed(3)})`;
        g.beginPath();
        g.arc(s.x * W, s.y * horizon, s.r, 0, 6.283);
        g.fill();
      }
      if (!meteor && p < 0.15 && Math.random() < 4e-3) meteor = { x: Math.random() * W * 0.8, y: Math.random() * H * 0.3, t: t2 };
      if (meteor) {
        const k = (t2 - meteor.t) / 900;
        if (k > 1) meteor = null;
        else {
          const x = meteor.x + k * 320, y = meteor.y + k * 140, tail = g.createLinearGradient(x - 120, y - 52, x, y);
          tail.addColorStop(0, "rgba(255,255,255,0)");
          tail.addColorStop(1, `rgba(255,255,255,${(0.9 * (1 - k) * starAlpha).toFixed(3)})`);
          g.strokeStyle = tail;
          g.lineWidth = 1.6;
          g.beginPath();
          g.moveTo(x - 120, y - 52);
          g.lineTo(x, y);
          g.stroke();
        }
      }
    }
    if (p > 0.05) {
      const glow = g.createRadialGradient(W / 2, horizon, 0, W / 2, horizon, W * (0.35 + p * 0.5));
      glow.addColorStop(0, `rgba(${sun},${Math.min(0.85, p * 1.1).toFixed(3)})`);
      glow.addColorStop(1, `rgba(${sun},0)`);
      g.fillStyle = glow;
      g.fillRect(0, 0, W, H);
    }
    if (p > 0.32) {
      const k = (p - 0.32) / 0.68, R = H * 0.065, sy = horizon + R * 1.2 - k * H * 0.42;
      const halo = g.createRadialGradient(W / 2, sy, R * 0.5, W / 2, sy, R * 7);
      halo.addColorStop(0, `rgba(${sun},0.75)`);
      halo.addColorStop(1, `rgba(${sun},0)`);
      g.fillStyle = halo;
      g.fillRect(0, 0, W, H);
      g.fillStyle = `rgb(${lerp(sun, [255, 252, 240], 0.5)})`;
      g.beginPath();
      g.arc(W / 2, sy, R, 0, 6.283);
      g.fill();
    }
    const hill = (base, amp, freq, phase, shade) => {
      g.fillStyle = `rgb(${lerp([3, 4, 9], lerp(hor, [20, 30, 20], 0.6), Math.min(1, p * 0.55 + shade))})`;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) g.lineTo(x, base + Math.sin(x / W * freq + phase) * amp + Math.sin(x / W * freq * 2.7 + phase * 2) * amp * 0.35);
      g.lineTo(W, H);
      g.closePath();
      g.fill();
    };
    hill(horizon + H * 0.03, H * 0.035, 5.5, 1.2, 0.05);
    hill(horizon + H * 0.09, H * 0.045, 3.4, 4, 0);
  }
  desk.drawSky = drawSky;
  function skyLoop(t2) {
    if ($("sunrise").hidden) {
      desk.skyLoop = 0;
      return;
    }
    drawSky(desk.skyP || 0, t2);
    $("sunriseClock").textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    desk.skyLoop = requestAnimationFrame(skyLoop);
  }
  function showSky() {
    const on = !!(desk.sleep || desk.sunrise);
    $("sunrise").hidden = !on;
    $("sunrise").classList.toggle("night", !!desk.sleep && !desk.sunrise);
    if (on && !desk.skyLoop) desk.skyLoop = requestAnimationFrame(skyLoop);
  }
  desk.showSky = showSky;
  function paintSunrise(p) {
    desk.skyP = p;
    $("sunrise").classList.toggle("bright", p > 0.72);
    $("sunriseClock").textContent = (/* @__PURE__ */ new Date()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  }
  desk.paintSunrise = paintSunrise;
  function enterSleep() {
    desk.sleep = true;
    desk.skyP = 0;
    $("sunrise").classList.remove("ring", "bright");
    $("sunriseMsg").textContent = /^\d{2}:\d{2}$/.test(desk.wake.time || "") ? settings.lang === "es" ? `Despertador ${desk.wake.time} \xB7 Buenas noches` : `Alarm ${desk.wake.time} \xB7 Good night` : settings.lang === "es" ? "Buenas noches" : "Good night";
    showSky();
  }
  function exitSleep() {
    desk.sleep = false;
    showSky();
  }
  desk.enterSleep = enterSleep;
  desk.exitSleep = exitSleep;
  $("nightExit").onclick = () => {
    exitSleep();
  };
  var SLEEP = /(me voy a (dormir|la cama|acostar|sobar)|me voy a dormir|buenas noches|a dormir|modo (noche|dormir)|good ?night|going to (sleep|bed)|im going to bed)/;
  function startNature() {
    if (desk.nature) return desk.nature;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      desk.chimeCtx || (desk.chimeCtx = new Ctx());
      const ctx = desk.chimeCtx, master = ctx.createGain();
      master.gain.value = 0;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        data[i] = last * 3.5;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buf;
      noise.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const water = ctx.createGain();
      water.gain.value = 0.55;
      noise.connect(lp);
      lp.connect(water);
      water.connect(master);
      noise.start();
      const chirp = () => {
        if (!desk.nature) return;
        const t0 = ctx.currentTime, notes = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800;
        for (let n = 0; n < notes; n++) {
          const o = ctx.createOscillator(), g = ctx.createGain(), t2 = t0 + n * (0.09 + Math.random() * 0.06), f = base * (0.9 + Math.random() * 0.25);
          o.type = "sine";
          o.frequency.setValueAtTime(f, t2);
          o.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.3), t2 + 0.05);
          o.frequency.exponentialRampToValueAtTime(f * 0.9, t2 + 0.1);
          g.gain.setValueAtTime(0, t2);
          g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t2 + 0.015);
          g.gain.linearRampToValueAtTime(0, t2 + 0.1);
          o.connect(g);
          g.connect(master);
          o.start(t2);
          o.stop(t2 + 0.12);
        }
        desk.birdTimer = setTimeout(chirp, 600 + Math.random() * 2600);
      };
      desk.nature = { master, noise, ctx };
      chirp();
    } catch {
    }
    return desk.nature;
  }
  function stopNature() {
    clearTimeout(desk.birdTimer);
    try {
      desk.nature?.noise.stop();
      desk.nature?.master.disconnect();
    } catch {
    }
    desk.nature = null;
  }
  function endSunrise(dismissed) {
    const target = wakeTarget();
    $("sunrise").classList.remove("ring", "bright");
    stopNature();
    desk.sunrise = false;
    desk.snoozeUntil = 0;
    if (dismissed) desk.sleep = false;
    showSky();
    if (dismissed && target) {
      desk.wake.done = String(target);
      desk.wakeOverride = 0;
      saveWake();
    }
  }
  desk.endSunrise = endSunrise;
  async function ringSunrise(target) {
    if (desk.wakeRang === target) return;
    desk.wakeRang = target;
    $("sunrise").classList.add("ring");
    const es = settings.lang === "es", hm = (/* @__PURE__ */ new Date()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const today = (/* @__PURE__ */ new Date()).toDateString(), due = (desk.reminders || []).filter((r) => new Date(r.due_at).toDateString() === today).length;
    const w = weatherText();
    $("sunriseMsg").textContent = es ? `Buenos d\xEDas, ${settings.name}` : `Good morning, ${settings.name}`;
    const text = es ? `Buenos d\xEDas, ${settings.name}. Son las ${hm}. ${w ? w + "." : ""} ${due ? `Hoy tienes ${due} ${due === 1 ? "recordatorio" : "recordatorios"}.` : "Hoy no tienes nada apuntado."} Arriba, que el d\xEDa no se conquista solo.` : `Good morning, ${settings.name}. It's ${hm}. ${w ? w + "." : ""} ${due ? `You have ${due} ${due === 1 ? "reminder" : "reminders"} today.` : "Nothing on the list today."} Up you get, the day won't conquer itself.`;
    await talk(text.replace(/\s+/g, " ").trim(), es ? "es" : "en");
    ears.resume(true);
  }
  function sunriseTick() {
    const now = Date.now(), target = wakeTarget(now);
    if (!target || desk.wake.done === String(target)) {
      if (desk.sunrise) endSunrise(false);
      return;
    }
    const start2 = target - desk.sunriseLeadMS;
    if (now < start2 || now > target + desk.sunriseRingMS) {
      if (desk.sunrise) endSunrise(false);
      return;
    }
    if (desk.snoozeUntil > now) return;
    if (desk.snoozeUntil) {
      desk.snoozeUntil = 0;
      desk.wakeRang = 0;
    }
    if (!desk.sunrise) {
      desk.sunrise = true;
      showSky();
      wakeUp();
    }
    const p = Math.min(1, (now - start2) / desk.sunriseLeadMS);
    paintSunrise(p);
    const vol = p < 0.65 ? 0 : Math.min(0.9, (p - 0.65) / 0.35 * 0.9);
    if (vol > 0) {
      const n = startNature();
      if (n) n.master.gain.setTargetAtTime(vol, n.ctx.currentTime, 1.5);
    }
    if (now >= target) void ringSunrise(target);
  }
  desk.sunriseTick = sunriseTick;
  setInterval(sunriseTick, 1e3);
  function snooze() {
    desk.snoozeUntil = Date.now() + desk.snoozeMS;
    desk.wakeRang = 0;
    $("sunrise").classList.remove("ring");
    stopNature();
    desk.sunrise = false;
    desk.sleep = true;
    desk.skyP = 0;
    showSky();
  }
  desk.snooze = snooze;
  $("sunriseStop").onclick = async () => {
    endSunrise(true);
    voice.stop();
    await talk(settings.lang === "es" ? "Perfecto. Que tengas un gran d\xEDa." : "Splendid. Have a great day.");
    ears.resume();
  };
  $("sunriseSnooze").onclick = () => {
    voice.stop();
    snooze();
  };
  var NUM = { una: 1, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12 };
  function parseWake(text) {
    const m = /(despiertame|despertador|wake me|alarm clock|alarma (?:a|para) las?)\D*?(\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:[:.h ](\d{2}))?(?: ?(y media|y cuarto|menos cuarto|pm|de la tarde|de la noche|am|de la manana))?/.exec(text);
    if (!m) return null;
    let h = /^\d+$/.test(m[2]) ? +m[2] : NUM[m[2]], min = m[3] ? +m[3] : 0;
    if (m[4] === "y media") min = 30;
    else if (m[4] === "y cuarto") min = 15;
    else if (m[4] === "menos cuarto") {
      h -= 1;
      min = 45;
    }
    if (/pm|tarde|noche/.test(m[4] || "") && h < 12) h += 12;
    if (h > 23 || min > 59 || h < 0) return null;
    return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
  }
  desk.parseWake = parseWake;
  async function wakeVoice(raw) {
    const text = normalize(raw).replace(/'/g, ""), es = settings.lang === "es";
    if (SLEEP.test(text)) {
      const time2 = parseWake(text);
      if (time2) setWake(time2);
      enterSleep();
      const at = /^\d{2}:\d{2}$/.test(desk.wake.time || "") ? desk.wake.time : "";
      await talk(es ? at ? `Buenas noches, ${settings.name}. Te despierto a las ${at} con el amanecer.` : `Buenas noches, ${settings.name}. No tienes despertador puesto; dime \xABdespi\xE9rtame a las\u2026\xBB si quieres uno.` : at ? `Good night, ${settings.name}. I'll wake you at ${at} with the sunrise.` : `Good night, ${settings.name}. No alarm is set; say "wake me at\u2026" if you want one.`, es ? "es" : "en");
      ears.resume();
      return true;
    }
    if (desk.sleep && !desk.sunrise && /(ya )?estoy despierto|me levanto|im up|im awake|buenos dias|good morning/.test(text)) {
      exitSleep();
      await talk(es ? "Buenos d\xEDas. Encendiendo las luces, por as\xED decirlo." : "Good morning. Lights on, so to speak.");
      ears.resume();
      return true;
    }
    if (desk.sunrise && /(ya )?estoy despierto|me levanto|im up|im awake|apaga(r)? (la )?alarma|para(r)? (la )?alarma|stop (the )?alarm/.test(text)) {
      $("sunriseStop").click();
      return true;
    }
    if (desk.sunrise && /cinco minutos|5 minutos|snooze|five more minutes|un rato mas/.test(text)) {
      snooze();
      await talk(es ? "Nueve minutos m\xE1s. Ni uno m\xE1s." : "Nine more minutes. Not one more.");
      ears.resume();
      return true;
    }
    if (/(quita|cancela|apaga|borra)( el)? despertador|no me despiertes|cancel (the )?(wake|alarm clock)/.test(text)) {
      setWake("");
      await talk(es ? "Despertador quitado. Duerme lo que quieras." : "Alarm clock off. Sleep as long as you like.");
      ears.resume();
      return true;
    }
    const time = parseWake(text);
    if (!time) return false;
    setWake(time);
    const [h, m] = time.split(":").map(Number), early = new Date(0, 0, 0, h, m - 15);
    const from = `${String(early.getHours()).padStart(2, "0")}:${String(early.getMinutes()).padStart(2, "0")}`;
    await talk(es ? `Hecho. Te despierto a las ${time}, con el amanecer empezando a las ${from}.` : `Done. I'll wake you at ${time}, with the sunrise starting at ${from}.`);
    ears.resume();
    return true;
  }
  desk.wakeVoice = wakeVoice;
  $("wakeTime").onchange = () => {
    if (/^\d{2}:\d{2}$/.test($("wakeTime").value)) setWake($("wakeTime").value);
  };
  $("wakeClear").onclick = () => {
    setWake("");
    $("wakeTime").value = "";
  };
  $("testSunrise").onclick = () => {
    $("settings").hidden = true;
    desk.sunriseLeadMS = 6e4;
    desk.wakeOverride = Date.now() + 6e4;
    desk.wake.done = "";
    setTimeout(() => {
      desk.sunriseLeadMS = 15 * 6e4;
    }, 15 * 6e4);
  };
  renderWake();
  async function keepScreenOn() {
    try {
      if (document.visibilityState === "visible") desk.wakeLock = await navigator.wakeLock?.request("screen");
    } catch {
    }
  }
  document.addEventListener("visibilitychange", () => void keepScreenOn());
  desk.guard = store.get("jarvis-guard", { on: false, armAt: 0, log: [] });
  desk.guardGraceMS = 1e4;
  desk.guardExitMS = 6e4;
  var guardArmed = () => desk.guard.on && Date.now() >= (desk.guard.armAt || 0);
  function guardLog(text) {
    desk.guard.log.push({ at: Date.now(), text });
    while (desk.guard.log.length > 20) desk.guard.log.shift();
  }
  function guardSend(extra = {}) {
    home?.send({ action: "guard-state", on: desk.guard.on, armAt: desk.guard.armAt || 0, alarm: !!desk.alarm, intruder: desk.intruder?.who || "", log: desk.guard.log.slice(-8), ...extra });
  }
  function saveGuard(extra) {
    store.set("jarvis-guard", desk.guard);
    renderGuard();
    guardSend(extra);
  }
  function notifyPhone(title, body, tag = "guard") {
    if (settings.key) void call("jarvis-call", { action: "notify", title, body, tag }, settings.key).catch(() => {
    });
  }
  desk.notifyPhone = notifyPhone;
  function lookAround() {
    clearTimeout(desk.eyesTimer);
    if ($("guardScreen").hidden) return;
    const eyes = $("eyes"), focused = !!(desk.intruder || desk.alarm);
    const x = focused ? 0 : (Math.random() * 2 - 1) * 2.2, y = focused ? 0 : (Math.random() * 2 - 1) * 1.1;
    eyes.style.setProperty("--lx", x.toFixed(2) + "vw");
    eyes.style.setProperty("--ly", y.toFixed(2) + "vw");
    if (Math.random() < 0.35) {
      eyes.classList.add("blink");
      setTimeout(() => eyes.classList.remove("blink"), 140);
    }
    desk.eyesTimer = setTimeout(lookAround, focused ? 900 : 1200 + Math.random() * 2200);
  }
  function renderGuardScreen() {
    const show = guardArmed() || !!desk.intruder || !!desk.alarm, es = settings.lang === "es";
    const el = $("guardScreen"), was = !el.hidden;
    el.hidden = !show;
    el.classList.toggle("intruder", !!desk.intruder && !desk.alarm);
    el.classList.toggle("alarm", !!desk.alarm);
    $("guardTitle").textContent = desk.alarm ? es ? "INTRUSO" : "INTRUDER" : desk.intruder ? es ? "IDENTIF\xCDCATE" : "IDENTIFY YOURSELF" : es ? "VIGILANDO" : "WATCHING";
    $("guardSub").textContent = desk.intruder ? `${desk.intruder.who} \xB7 ${es ? "pon el c\xF3digo" : "enter the code"}` : es ? `${settings.name} no est\xE1` : `${settings.name} is out`;
    if (show && !was) lookAround();
  }
  desk.renderGuardScreen = renderGuardScreen;
  function renderGuard() {
    renderGuardScreen();
    const armed = guardArmed(), pending2 = desk.guard.on && !armed;
    $("guardDot").classList.toggle("armed", armed);
    $("guardDot").classList.toggle("pending", pending2);
    $("guardLabel").textContent = desk.alarm ? "ALARM" : armed ? "Guard on" : pending2 ? "Guard soon" : "Guard";
  }
  desk.renderGuard = renderGuard;
  function setGuard(on, why = "") {
    stopAlarm();
    closeKeypad();
    desk.intruder = null;
    clearTimeout(desk.intruderTimer);
    desk.guard.on = on;
    desk.guard.armAt = on ? Date.now() + desk.guardExitMS : 0;
    guardLog((on ? "Activada" : "Desactivada") + (why ? " \xB7 " + why : ""));
    saveGuard();
    clearTimeout(desk.guardArmTimer);
    if (on) desk.guardArmTimer = setTimeout(() => {
      renderGuard();
      guardSend();
    }, desk.guardExitMS + 50);
  }
  desk.setGuard = setGuard;
  function guardLine(p, action) {
    const es = settings.lang === "es", name = settings.name;
    if (action !== "unknown" && p.role === "me") return es ? { text: `Bienvenido, ${name}. Pon el c\xF3digo, por si acaso no eres t\xFA. Diez segundos.`, lang: "es" } : { text: `Welcome back, ${name}. Code, please, just in case you're not really you. Ten seconds.`, lang: "en" };
    if (action !== "unknown" && p.role === "mom") return { text: `Hi, Mum. ${name} is out, so I'm in charge. What do you need? Pop the code in within ten seconds, or things get very loud.`, lang: "en" };
    if (action !== "unknown" && p.role === "dad") return { text: `Hello, Dad. ${name} isn't here, and yes, the air conditioning is off. Code in ten seconds, please, or I start singing.`, lang: "en" };
    if (action !== "unknown") return es ? { text: `Hola, ${p.name}. ${name} no est\xE1. \xBFQu\xE9 necesitas? Tienes diez segundos para poner el c\xF3digo.`, lang: "es" } : { text: `Hello, ${p.name}. ${name} is out. What do you need? You've got ten seconds to enter the code.`, lang: "en" };
    return es ? { text: `Vaya, hola. ${name} no est\xE1 y a ti no te conozco. \xBFQu\xE9 necesitas? Pon el c\xF3digo en diez segundos o monto un esc\xE1ndalo.`, lang: "es" } : { text: `Well, hello there. ${name} isn't home, and I don't recognise you. What do you need? Enter the code in ten seconds, or I raise the alarm.`, lang: "en" };
  }
  async function guardIntruder(p, action) {
    if (desk.intruder) return;
    desk.intruder = { who: action === "unknown" ? settings.lang === "es" ? "Desconocido" : "Unknown" : p.name, at: Date.now() };
    guardLog("Ha entrado: " + desk.intruder.who);
    saveGuard({ alert: "entry" });
    notifyPhone(settings.lang === "es" ? "Alguien ha entrado" : "Someone came in", settings.lang === "es" ? `${desk.intruder.who} tiene 10 segundos para poner el c\xF3digo.` : `${desk.intruder.who} has 10 seconds to enter the code.`);
    openKeypad();
    const line = guardLine(p, action);
    voice.stop();
    await talk(line.text, line.lang);
    if (!desk.intruder) return;
    desk.intruderEnds = Date.now() + desk.guardGraceMS;
    desk.intruderTimer = setTimeout(() => {
      if (desk.intruder) void soundAlarm();
    }, desk.guardGraceMS);
  }
  desk.guardIntruder = guardIntruder;
  async function soundAlarm() {
    if (desk.alarm) return;
    guardLog("Alarma" + (desk.intruder ? " \xB7 " + desk.intruder.who : ""));
    desk.alarm = true;
    document.body.classList.add("alarm");
    saveGuard({ alert: "alarm" });
    notifyPhone(settings.lang === "es" ? "\xA1ALARMA!" : "ALARM!", settings.lang === "es" ? `${desk.intruder?.who || "Alguien"} no ha puesto el c\xF3digo.` : `${desk.intruder?.who || "Someone"} didn't enter the code.`);
    const es = settings.lang === "es";
    $("intruderBanner").hidden = false;
    const siren = () => {
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        desk.chimeCtx || (desk.chimeCtx = new Ctx());
        const ctx = desk.chimeCtx, t0 = ctx.currentTime;
        for (const [type, gain, detune] of [["sawtooth", 0.16, 0], ["square", 0.07, 7]]) {
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = type;
          o.detune.value = detune * 100;
          o.frequency.setValueAtTime(600, t0);
          o.frequency.linearRampToValueAtTime(1500, t0 + 0.9);
          o.frequency.linearRampToValueAtTime(600, t0 + 1.8);
          o.connect(g);
          g.connect(ctx.destination);
          g.gain.setValueAtTime(0, t0);
          g.gain.linearRampToValueAtTime(gain, t0 + 0.05);
          g.gain.setValueAtTime(gain, t0 + 1.75);
          g.gain.linearRampToValueAtTime(0, t0 + 1.8);
          o.start(t0);
          o.stop(t0 + 1.82);
        }
      } catch {
      }
    };
    siren();
    desk.alarmTimer = setInterval(siren, 1800);
    desk.alarmStop = setTimeout(stopAlarm, 6e4);
    const lines = es ? [`\xA1Alerta de intruso! \xA1Alerta de intruso! Protocolo de bloqueo activado.`, `${settings.name} ya ha sido avisado. La polic\xEDa todav\xEDa no, pero no me tientes.`, `Repito: esto no es un simulacro. Bueno, un poco s\xED.`] : [`Intruder alert! Intruder alert! Lockdown protocol engaged.`, `${settings.name} has been notified. The police have not. Yet. Don't tempt me.`, `I repeat: this is not a drill. Well, slightly a drill.`];
    for (const line of lines) {
      if (!desk.alarm) break;
      await talk(line, es ? "es" : "en");
    }
  }
  desk.soundAlarm = soundAlarm;
  function stopAlarm() {
    clearInterval(desk.alarmTimer);
    clearTimeout(desk.alarmStop);
    const was = desk.alarm;
    desk.alarm = false;
    document.body.classList.remove("alarm");
    $("intruderBanner").hidden = true;
    if (was) {
      renderGuard();
      guardSend();
    }
  }
  desk.stopAlarm = stopAlarm;
  var typed = "";
  var wrong = 0;
  function openKeypad() {
    typed = "";
    wrong = 0;
    drawKeypad();
    $("keypad").hidden = false;
    clearInterval(desk.keypadClock);
    desk.keypadClock = setInterval(() => {
      const left = desk.intruderEnds ? Math.max(0, Math.ceil((desk.intruderEnds - Date.now()) / 1e3)) : null;
      $("keypadTime").textContent = desk.alarm ? settings.lang === "es" ? "Alarma activada" : "Alarm on" : left === null ? "" : `${left} s`;
    }, 250);
  }
  function closeKeypad() {
    $("keypad").hidden = true;
    clearInterval(desk.keypadClock);
    typed = "";
  }
  function drawKeypad() {
    [...$("keypadDots").children].forEach((d, i) => d.classList.toggle("on", i < typed.length));
  }
  async function keyIn(k) {
    if ($("keypad").hidden) return;
    if (k === "clear") typed = "";
    else if (k === "back") typed = typed.slice(0, -1);
    else if (/^\d$/.test(k) && typed.length < 4) typed += k;
    drawKeypad();
    if (typed.length < 4) return;
    const ok = /^\d{4}$/.test(settings.guardPin || "") && typed === settings.guardPin;
    typed = "";
    drawKeypad();
    if (ok) {
      const who = desk.intruder?.who || "";
      setGuard(false, "c\xF3digo" + (who ? " \xB7 " + who : ""));
      voice.stop();
      await talk(settings.lang === "es" ? "C\xF3digo correcto. Todo tuyo." : "Code accepted. Carry on.");
      ears.resume();
      return;
    }
    wrong++;
    $("keypadDots").classList.remove("bad");
    void $("keypadDots").offsetWidth;
    $("keypadDots").classList.add("bad");
    if (wrong >= 3) void soundAlarm();
  }
  desk.keyIn = keyIn;
  for (const b of document.querySelectorAll("#keypad [data-key]")) b.onclick = () => void keyIn(b.dataset.key);
  document.addEventListener("keydown", (e) => {
    if ($("keypad").hidden) return;
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      void keyIn(e.key);
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      void keyIn("back");
    }
  }, true);
  var LEAVING = /\b(me voy|me marcho|me piro|me las piro|me pires|modo vigilancia|activa (la )?(vigilancia|alarma)|im leaving|i am leaving|im off|guard mode|watch the room|arm the alarm)\b/;
  var STAYING = /\b(me quedo|cancela( la)? (vigilancia|alarma)|no me voy|im staying|cancel guard)\b/;
  async function guardVoice(raw) {
    const text = normalize(raw).replace(/'/g, ""), es = settings.lang === "es";
    if (LEAVING.test(text) && !desk.guard.on) {
      setGuard(true, "voz");
      const noPin = !/^\d{4}$/.test(settings.guardPin || "");
      await talk(es ? `Vale, ${settings.name}. Vigilo la habitaci\xF3n en un minuto. Que vaya bien.${noPin ? " Por cierto, no hay c\xF3digo puesto: solo tu cara o tu m\xF3vil la desactivan." : ""}` : `Right, ${settings.name}. Guard mode in one minute. Off you go.${noPin ? " By the way, there's no code set, so only your face or your phone can switch it off." : ""}`);
      ears.resume();
      return true;
    }
    if (STAYING.test(text) && desk.guard.on && !guardArmed()) {
      setGuard(false, "cancelada");
      await talk(es ? "Cancelado. Me quedo tranquilo." : "Cancelled. Standing down.");
      ears.resume();
      return true;
    }
    return false;
  }
  desk.guardVoice = guardVoice;
  renderGuard();
  if (desk.guard.on && !guardArmed()) desk.guardArmTimer = setTimeout(() => {
    renderGuard();
    guardSend();
  }, desk.guard.armAt - Date.now() + 50);
  async function onHome(event) {
    const at = +event.at || Date.now();
    if (event.action === "wall") {
      desk.wallSeen = at;
      render();
      return;
    }
    if (event.action === "frame") {
      onFrame(event);
      return;
    }
    if (event.action === "remember" && event.fact) {
      addMemory(String(event.fact).slice(0, 200));
      return;
    }
    if (event.action === "remind" && event.text) {
      wakeUp();
      orb.flash("alert");
      chime("alert");
      const text = String(event.text).slice(0, 400);
      setTimeout(() => void loadReminders(), 1500);
      if (desk.voice.speaking || ears.mode === "direct") {
        toast(text);
        return;
      }
      await talk(text, event.lang === "es" ? "es" : event.lang === "en" ? "en" : settings.lang);
      ears.resume(true);
      return;
    }
    if (event.action === "guard") {
      if (!!event.on !== desk.guard.on) setGuard(!!event.on, "m\xF3vil");
      else guardSend();
      return;
    }
    if (event.action === "guard-ask") {
      guardSend();
      return;
    }
    if (event.action === "ears") {
      const was = wallListening();
      desk.wallEarsAt = Date.now();
      if (!was && desk.started && !ears.mode?.match?.(/direct|follow/)) {
        ears.pause();
        log("micro del ordenador apagado: escucha la pared");
        render();
      }
      return;
    }
    if (event.action === "ask-wake") {
      voice.stop();
      await talk(pick(t().yes));
      ears.pause();
      ears.resume();
      return;
    }
    if (event.action === "ask" && event.text) {
      const text = String(event.text).replace(/\s+/g, " ").trim().slice(0, 500);
      if (!text) return;
      voice.stop();
      ears.pause();
      desk.lastSaid = "";
      await respond(text);
      if (event.from === "wall") {
        ears.pause();
        ears.resume();
      }
      home?.send({ action: "reply", id: event.id || 0, text: desk.lastSaid || "" });
      return;
    }
    if (event.action === "guard-silence") {
      stopAlarm();
      desk.intruder = null;
      clearTimeout(desk.intruderTimer);
      closeKeypad();
      renderGuard();
      guardSend();
      return;
    }
    if (event.action === "arrival" || event.action === "test" || event.action === "unknown") {
      desk.wallSeen = Date.now();
      const p = event.person || { name: settings.lang === "es" ? "Desconocido" : "Unknown", role: "unknown" };
      if (event.action !== "test" && desk.guard.on) {
        if (!guardArmed() && p.role === "me" && event.action !== "unknown") return;
        if (guardArmed()) {
          desk.arrivals.push({ name: p.name, role: event.action === "unknown" ? "unknown" : p.role, at: Date.now() });
          store.set("jarvis-arrivals", desk.arrivals);
          render();
          orb.flash("alert");
          await guardIntruder(p, event.action);
          return;
        }
      }
      if (event.action !== "test") {
        desk.arrivals.push({ name: p.name, role: event.action === "unknown" ? "unknown" : p.role, at: Date.now() });
        while (desk.arrivals.length > 50) desk.arrivals.shift();
        store.set("jarvis-arrivals", desk.arrivals);
      }
      render();
      wakeUp();
      orb.flash(event.action === "unknown" ? "alert" : "arrival");
      if (!quietNow()) chime(event.action === "unknown" ? "alert" : "arrival");
      if (quietNow()) {
        toast((settings.lang === "es" ? "Ha entrado: " : "Came in: ") + p.name);
        return;
      }
      if (!settings.greet && event.action !== "test") return;
      const line = await greetingFor(p, event.action);
      if (desk.voice.speaking || ears.mode === "direct") {
        toast(line.text);
        return;
      }
      await talk(line.text, line.lang);
      ears.resume(p.role === "me");
    }
  }
  desk.onHome = onHome;
  async function greetingFor(p, action) {
    if (action === "unknown") return { text: t().stranger, lang: settings.lang };
    if (p.greeting) return { text: p.greeting, lang: p.role === "me" ? settings.lang : "en" };
    if (FAMILY[p.role]) return { text: pick(FAMILY[p.role]), lang: "en" };
    if (p.role !== "me") return { text: `Hello, ${p.name}. Welcome.`, lang: "en" };
    const today = (/* @__PURE__ */ new Date()).toDateString(), first = store.get("jarvis-briefing", "") !== today;
    if (!first) return { text: pick([greeting(settings.lang, settings.name), settings.lang === "es" ? `Bienvenido de nuevo, ${settings.name}.` : `Welcome back, ${settings.name}.`]), lang: settings.lang };
    if (settings.key) {
      setState("thinking");
      const hm = (/* @__PURE__ */ new Date()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      const prompt = `[Event] ${settings.name} just walked into the room at ${hm}, for the first time today. Welcome him with a short briefing: greeting, the weather, and anything you remember that matters today. Two or three sentences.`;
      const reply = await think(prompt, { remember: false, event: true });
      store.set("jarvis-briefing", today);
      if (reply && reply !== t().thinkDown) return { text: reply, lang: settings.lang };
    }
    return { text: greeting(settings.lang, settings.name), lang: settings.lang };
  }
  var bridgeId = 0;
  var pending = /* @__PURE__ */ new Map();
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.data?.source !== "jarvis-extension") return;
    desk.extension = true;
    render();
    if (e.data.agent) void onAgent(e.data.agent);
    if (e.data.id && pending.has(e.data.id)) {
      pending.get(e.data.id)(e.data.ok);
      pending.delete(e.data.id);
    }
  });
  function extension(action, extra = {}) {
    return new Promise((resolve) => {
      const id = ++bridgeId;
      pending.set(id, resolve);
      window.postMessage({ source: "jarvis-desk", id, action, ...extra }, "*");
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          resolve(false);
        }
      }, 1500);
    });
  }
  desk.extensionCall = extension;
  function renderAgent() {
    const a = desk.agent;
    $("agentCard").hidden = !a;
    if (!a) return;
    $("agentCard").classList.toggle("done", !!a.done);
    $("agentTask").textContent = a.task || "";
    $("agentSay").textContent = a.say || "";
    $("agentStep").textContent = a.done ? settings.lang === "es" ? "terminado" : "finished" : a.step ? settings.lang === "es" ? `paso ${a.step}` : `step ${a.step}` : "";
  }
  async function onAgent(m) {
    wakeUp();
    if (m.kind === "start") {
      desk.agent = { task: m.task, step: 0, say: settings.lang === "es" ? "Empezando\u2026" : "Starting\u2026" };
      renderAgent();
      return;
    }
    if (!desk.agent) desk.agent = { task: m.task || "", step: 0 };
    if (m.kind === "step") {
      Object.assign(desk.agent, { step: m.step, say: m.say });
      renderAgent();
      return;
    }
    if (m.kind === "ask") {
      desk.ask = m.id;
      desk.agent.say = m.question;
      renderAgent();
      orb.flash("arrival");
      chime();
      voice.stop();
      await talk(m.question);
      desk.ask = m.id;
      ears.direct();
      return;
    }
    if (m.kind === "done") {
      Object.assign(desk.agent, { done: true, say: m.stopped ? "" : m.summary });
      renderAgent();
      setTimeout(() => {
        if (desk.agent?.done) {
          desk.agent = null;
          renderAgent();
        }
      }, 9e4);
      if (m.summary && !m.stopped) {
        if (desk.voice.speaking || ears.mode === "direct") toast(m.summary);
        else {
          await talk(m.summary);
          ears.resume(true);
        }
      }
    }
  }
  desk.onAgent = onAgent;
  var playing = true;
  function duck(state) {
    try {
      if (state === "listening" && desk.music && playing && desk.extension && !desk.ducked) {
        desk.ducked = true;
        void extension("pause");
      } else if (state === "idle" && desk.ducked) {
        desk.ducked = false;
        void extension("resume");
      }
    } catch {
    }
  }
  async function media(action) {
    desk.ducked = false;
    if (action === "toggle") action = playing ? "pause" : "resume";
    if (action === "pause") playing = false;
    if (action === "resume") playing = true;
    $("mPlayIcon").innerHTML = ICONS[playing ? "pause" : "play"];
    const ok = await extension(action);
    toast(ok ? t().media[action] || action : settings.lang === "es" ? "Instala la extensi\xF3n de Jarvis en este ordenador" : "Install the Jarvis extension on this computer");
    return ok;
  }
  desk.media = media;
  $("mPrev").onclick = () => media("previous");
  $("mPlay").onclick = () => media("toggle");
  $("mNext").onclick = () => media("next");
  var home = null;
  var wallListening = () => Date.now() - (desk.wallEarsAt || 0) < 15e4;
  desk.wallListening = wallListening;
  setInterval(() => {
    if (desk.started && settings.wake && desk.wallEarsAt && !wallListening() && ears.paused && desk.state === "idle") {
      desk.wallEarsAt = 0;
      ears.resume();
      render();
    }
  }, 3e4);
  function connectDesk() {
    home?.stop();
    home = null;
    if (settings.key) home = connectHome({ key: settings.key, onEvent: (e) => void onHome(e), onStatus: (s) => {
      log("canal: " + s);
      if (s === "online") setTimeout(guardSend, 300);
    } });
  }
  desk.connectDesk = connectDesk;
  async function start() {
    if (desk.started) return;
    desk.started = true;
    $("wake").hidden = true;
    document.body.classList.add("live");
    voice.unlock();
    setState("thinking");
    say(t().waking);
    await ears.openMeter();
    if (!home) connectDesk();
    void restoreMemory();
    void loadReminders();
    void keepScreenOn();
    setTimeout(guardSend, 2500);
    void loadWeather();
    setInterval(loadWeather, 20 * 6e4);
    try {
      if (navigator.wakeLock) await navigator.wakeLock.request("screen");
    } catch {
    }
    if (!settings.key) {
      say(t().needKey);
      setState("idle");
      ears.background();
      return;
    }
    await talk(t().online(settings.name));
    ears.resume();
    const lines = [...FAMILY.mom, ...FAMILY.dad, settings.lang === "es" ? `Bienvenido de nuevo, ${settings.name}.` : `Welcome back, ${settings.name}.`, t().stranger];
    for (const line of lines) {
      await voice.prefetch(line, FAMILY.mom.includes(line) || FAMILY.dad.includes(line) ? "en" : settings.lang);
    }
  }
  desk.start = start;
  function chooseRole(role) {
    store.set("jarvis-role", role);
    if (role === "wall") {
      location.replace("pared.html");
      return;
    }
    $("chooser").hidden = true;
    $("wake").hidden = false;
  }
  $("asDesk").onclick = () => chooseRole("desk");
  $("asWall").onclick = () => chooseRole("wall");
  if (store.get("jarvis-role", "") !== "desk") $("chooser").hidden = false;
  else $("wake").hidden = false;
  $("wake").onclick = start;
  $("orb").onclick = () => {
    if (!desk.started) return start();
    if (voice.speaking) {
      voice.stop();
      ears.resume();
      return;
    }
    ears.direct();
  };
  document.addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, textarea, select") || !$("settings").hidden) return;
    if (e.code === "Space" && desk.sunrise) {
      e.preventDefault();
      $("sunriseStop").click();
      return;
    }
    if (e.code === "Space") {
      e.preventDefault();
      if (!desk.started) return void start();
      if (voice.speaking) {
        voice.stop();
        ears.resume();
      } else ears.direct();
    }
    if (e.code === "Escape") {
      voice.stop();
      ears.resume();
    }
  });
  $("typeForm").onsubmit = (e) => {
    e.preventDefault();
    const v = $("typeInput").value.trim();
    $("typeInput").value = "";
    if (v) void respond(v);
  };
  function openSettings() {
    for (const id of ["name", "lang", "hear", "city"]) $(id).value = settings[id];
    $("guardPin").value = settings.guardPin || "";
    $("wakeTime").value = desk.wake.time || "";
    $("voiceKey").value = settings.key;
    $("wakeOn").checked = settings.wake;
    $("greetOn").checked = settings.greet;
    $("quietFrom").value = settings.quietFrom;
    $("quietTo").value = settings.quietTo;
    $("memoryList").replaceChildren(...desk.memory.map((m, i) => {
      const li = document.createElement("li");
      li.textContent = m;
      const x = document.createElement("button");
      x.textContent = "\u2715";
      x.title = "Olvidar";
      x.onclick = () => {
        desk.memory.splice(i, 1);
        store.set("jarvis-memory", desk.memory);
        openSettings();
        render();
      };
      li.append(x);
      return li;
    }));
    $("micLog").textContent = desk.log.slice(-16).join("\n");
    $("settings").hidden = false;
    navigator.mediaDevices?.enumerateDevices?.().then((all) => {
      const mic = all.find((d) => d.kind === "audioinput" && d.deviceId === "default") || all.find((d) => d.kind === "audioinput");
      $("micName").textContent = mic?.label ? "Usando: " + mic.label.replace(/^Default - |^Predeterminado - /, "") : "No encuentro ning\xFAn micr\xF3fono.";
    }).catch(() => {
    });
    startPeek();
  }
  function startPeek() {
    clearInterval(desk.peekTimer);
    desk.lastFrame = 0;
    $("peekInfo").textContent = "Conectando con el m\xF3vil de la pared\u2026";
    const ask = () => {
      if ($("settings").hidden) {
        clearInterval(desk.peekTimer);
        return;
      }
      if (!home?.send({ action: "peek" })) $("peekInfo").textContent = settings.key ? "Sin conexi\xF3n. Pulsa para despertar a Jarvis primero." : "Falta la clave de Jarvis.";
      else if (Date.now() - desk.lastFrame > 4e3) {
        $("peekImg").hidden = !desk.lastFrame;
        if (!desk.lastFrame || Date.now() - desk.lastFrame > 6e3) $("peekInfo").textContent = "Sin imagen: abre la pared en el m\xF3vil, pulsa \xABEmpezar a vigilar\xBB y usa la misma clave.";
      }
    };
    ask();
    desk.peekTimer = setInterval(ask, 3e3);
  }
  function onFrame(e) {
    if ($("settings").hidden || !/^data:image\/jpeg;base64,/.test(String(e.img || ""))) return;
    desk.lastFrame = Date.now();
    $("peekImg").src = e.img;
    $("peekImg").hidden = false;
    const faces = Array.isArray(e.faces) ? e.faces : [];
    $("peekInfo").textContent = `En directo \xB7 c\xE1mara ${e.facing === "environment" ? "trasera" : "delantera"} \xB7 ` + (faces.length ? faces.join(", ") : "nadie");
    $("camFront").classList.toggle("on", e.facing === "user");
    $("camBack").classList.toggle("on", e.facing === "environment");
  }
  desk.onFrame = onFrame;
  function switchWallCamera(facing) {
    if (home?.send({ action: "camera", facing })) $("peekInfo").textContent = facing === "environment" ? "Cambiando a la c\xE1mara trasera\u2026" : "Cambiando a la c\xE1mara delantera\u2026";
  }
  $("camFront").onclick = () => switchWallCamera("user");
  $("camBack").onclick = () => switchWallCamera("environment");
  $("openSettings").onclick = openSettings;
  $("closeSettings").onclick = () => {
    $("settings").hidden = true;
  };
  var bind = (id, key, conv = (v) => v) => {
    $(id).onchange = () => {
      settings[key] = conv($(id).type === "checkbox" ? $(id).checked : $(id).value);
      settings.save();
      render();
    };
  };
  bind("name", "name", (v) => v.trim() || "Crew");
  bind("lang", "lang");
  bind("hear", "hear");
  bind("greetOn", "greet");
  bind("quietFrom", "quietFrom", Number);
  bind("quietTo", "quietTo", Number);
  $("guardPin").onchange = () => {
    const v = $("guardPin").value.replace(/\D/g, "").slice(0, 4);
    $("guardPin").value = v;
    if (v.length !== 4) return;
    settings.guardPin = v;
    settings.save();
    if (settings.key) void call("jarvis-call", { action: "pin", pin: v }, settings.key).catch(() => {
    });
  };
  $("voiceKey").onchange = () => {
    settings.key = $("voiceKey").value.trim();
    settings.save();
    connectDesk();
  };
  $("wakeOn").onchange = () => {
    settings.wake = $("wakeOn").checked;
    settings.save();
    if (settings.wake) ears.resume();
    else ears.pause();
    render();
  };
  $("city").onchange = async () => {
    const name = $("city").value.trim();
    if (!name) return;
    try {
      const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)).json();
      const place = r.results?.[0];
      if (!place) {
        toast("No encuentro esa ciudad");
        return;
      }
      Object.assign(settings, { city: place.name, lat: place.latitude, lon: place.longitude });
      settings.save();
      $("city").value = place.name;
      void loadWeather();
    } catch {
      toast("Sin conexi\xF3n");
    }
  };
  $("testVoice").onclick = async () => {
    voice.unlock();
    await talk(t().online(settings.name));
    $("voiceInfo").textContent = voice.error || "Voz funcionando.";
    ears.resume();
  };
  $("showType").onchange = () => {
    $("typeForm").hidden = !$("showType").checked;
  };
  $("toWall").onclick = (e) => {
    e.preventDefault();
    chooseRole("wall");
  };
  render();
  connectDesk();
})();
