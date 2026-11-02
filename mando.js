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

  // src/mando.js
  var settings = loadSettings();
  var mando = window.mando = { state: null, lastSeen: 0, home: null, settings, alerts: 0 };
  store.set("jarvis-role", "remote");
  function connect() {
    mando.home?.stop();
    if (!settings.key) {
      $("setup").hidden = false;
      return;
    }
    $("setup").hidden = true;
    mando.home = connectHome({
      key: settings.key,
      onEvent: (e) => {
        if (e.action === "guard-state") onState(e);
        if (e.action === "ring") ring();
        if (e.action === "snap") setTimeout(loadPhotos, 4e3);
      },
      onStatus: (s) => {
        $("link").textContent = s === "online" ? "Conectado" : "Sin conexi\xF3n";
        $("link").classList.toggle("on", s === "online");
        if (s === "online") ask();
      }
    });
  }
  var ask = () => mando.home?.send({ action: "guard-ask" });
  setInterval(() => {
    ask();
    render();
  }, 1e4);
  setInterval(render, 1e3);
  function onState(e) {
    mando.state = e;
    mando.lastSeen = Date.now();
    if (e.alert) {
      mando.alerts++;
      beep(e.alert === "alarm");
    }
    render();
  }
  mando.onState = onState;
  function render() {
    const s = mando.state, now = Date.now();
    const stale = !s || now - mando.lastSeen > 35e3;
    let state = "unknown", title = "\u2014", sub = mando.home && now - mando.started > 6e3 ? "El ordenador no contesta: recarga Jarvis en el Mac (\u27F3) y comprueba que la clave es la misma" : "Buscando el ordenador\u2026";
    if (!stale) {
      if (s.alarm) {
        state = "alarm";
        title = "\xA1Alarma!";
        sub = s.intruder ? `Ha entrado: ${s.intruder}` : "Alguien ha entrado";
      } else if (s.on && now < s.armAt) {
        state = "pending";
        title = "Activando\u2026";
        sub = `En ${Math.ceil((s.armAt - now) / 1e3)} s`;
      } else if (s.on) {
        state = "armed";
        title = "Vigilando";
        sub = s.intruder ? `Ha entrado: ${s.intruder}` : "Tu cuarto est\xE1 vigilado";
      } else {
        state = "off";
        title = "Desactivada";
        sub = "Est\xE1s en casa";
      }
    }
    document.body.dataset.state = state;
    $("stateTitle").textContent = title;
    $("stateSub").textContent = sub;
    $("leave").disabled = stale || !!s?.on;
    $("home").disabled = stale || !s?.on;
    const showAlert = !stale && s.on && !!s.intruder;
    $("alert").hidden = !showAlert;
    if (showAlert) {
      $("alertTitle").textContent = s.alarm ? "Alarma sonando" : "Alguien ha entrado";
      $("alertSub").textContent = s.alarm ? `${s.intruder} no ha puesto el c\xF3digo.` : `${s.intruder} tiene 10 segundos para poner el c\xF3digo.`;
      $("silence").hidden = !s.alarm;
    }
    const log = (s?.log || []).slice().reverse();
    $("log").replaceChildren(...log.length ? log.map((l) => {
      const li = document.createElement("li"), t = document.createElement("span"), w = document.createElement("time");
      t.textContent = l.text;
      w.textContent = new Date(l.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      li.append(t, w);
      return li;
    }) : [Object.assign(document.createElement("li"), { className: "muted", textContent: "Nada todav\xEDa." })]);
  }
  mando.render = render;
  var audio = null;
  function beep(loud) {
    try {
      navigator.vibrate?.(loud ? [400, 200, 400, 200, 400] : [200, 100, 200]);
    } catch {
    }
    try {
      audio || (audio = new (window.AudioContext || window.webkitAudioContext)());
      const t0 = audio.currentTime;
      (loud ? [880, 660, 880, 660] : [660, 990]).forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = f;
        o.connect(g);
        g.connect(audio.destination);
        const t = t0 + i * 0.25;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.15, t + 0.02);
        g.gain.linearRampToValueAtTime(0, t + 0.22);
        o.start(t);
        o.stop(t + 0.25);
      });
    } catch {
    }
  }
  var unlock = () => {
    try {
      audio || (audio = new (window.AudioContext || window.webkitAudioContext)());
      audio.resume?.();
    } catch {
    }
  };
  document.addEventListener("pointerdown", unlock, { once: true });
  $("leave").onclick = () => {
    mando.home?.send({ action: "guard", on: true });
    $("stateSub").textContent = "Enviando\u2026";
  };
  $("home").onclick = () => {
    mando.home?.send({ action: "guard", on: false });
    $("stateSub").textContent = "Enviando\u2026";
  };
  $("silence").onclick = () => mando.home?.send({ action: "guard-silence" });
  $("saveKey").onclick = () => {
    settings.key = $("key").value.trim();
    settings.save();
    connect();
    void loadPhotos();
  };
  $("link").onclick = () => {
    $("key").value = settings.key;
    $("setup").hidden = false;
  };
  var VAPID_PUBLIC = "BEwF4C0OwXyxFx3JXcNVMxp1BG3am7wyuaDoA6ID1ydMILIazHAtqERjTFnjWxHd14qHvqvVVSXdYaGueHKGoD0";
  var standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
  var fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
  async function renderPush() {
    const box = $("pushBox"), info = $("pushInfo");
    if (!("serviceWorker" in navigator)) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    if (!("PushManager" in window) || !("Notification" in window)) {
      $("pushOn").hidden = true;
      info.textContent = standalone() ? "Este m\xF3vil no admite notificaciones (hace falta iOS 16.4 o m\xE1s nuevo)." : "Para recibir avisos: Compartir \u2192 \xABA\xF1adir a pantalla de inicio\xBB y abre Jarvis desde ese icono.";
      return;
    }
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (Notification.permission === "granted" && sub) {
      $("pushOn").hidden = true;
      info.textContent = "Notificaciones activadas: te aviso si entra alguien o salta la alarma.";
      return;
    }
    if (Notification.permission === "denied") {
      $("pushOn").hidden = true;
      info.textContent = "Notificaciones bloqueadas. Act\xEDvalas en Ajustes \u2192 Notificaciones \u2192 Jarvis.";
      return;
    }
    $("pushOn").hidden = false;
    info.textContent = "Te avisa aunque tengas la app cerrada.";
  }
  mando.renderPush = renderPush;
  $("pushOn").onclick = async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        await renderPush();
        return;
      }
      const reg = await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(VAPID_PUBLIC) });
      const response = await call("jarvis-call", { action: "subscribe", subscription: sub.toJSON() }, settings.key);
      $("pushInfo").textContent = response.ok ? "Notificaciones activadas." : "No se pudo registrar: revisa la clave.";
      if (response.ok) $("pushOn").hidden = true;
    } catch (e) {
      $("pushInfo").textContent = "No se pudo activar: " + e.message;
    }
  };
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(() => renderPush()).catch(() => renderPush());
  async function loadPhotos() {
    if (!settings.key) return;
    try {
      const response = await call("jarvis-call", { action: "photos" }, settings.key);
      const data = await response.json().catch(() => ({}));
      const list = Array.isArray(data.photos) ? data.photos : [];
      $("photosBox").hidden = !list.length;
      $("photos").replaceChildren(...list.map((p) => {
        const f = document.createElement("figure");
        f.className = p.reason === "alarm" ? "alarm" : "";
        const img = document.createElement("img");
        img.src = p.url;
        img.loading = "lazy";
        img.alt = p.who || "";
        img.onclick = () => {
          $("viewerImg").src = p.url;
          $("viewer").hidden = false;
        };
        const cap = document.createElement("figcaption");
        cap.textContent = `${p.who || "Alguien"} \xB7 ${new Date(p.at).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
        f.append(img, cap);
        return f;
      }));
      if (location.hash === "#fotos") $("photosBox").scrollIntoView({ behavior: "smooth" });
    } catch {
    }
  }
  mando.loadPhotos = loadPhotos;
  $("viewer").onclick = () => {
    $("viewer").hidden = true;
  };
  window.addEventListener("hashchange", () => {
    if (location.hash === "#fotos") void loadPhotos();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void loadPhotos();
  });
  function ring() {
    $("ringing").hidden = false;
    clearInterval(mando.ringTimer);
    let n = 0;
    beep(true);
    mando.ringTimer = setInterval(() => {
      beep(true);
      if (++n > 20) stopRing();
    }, 1500);
  }
  function stopRing() {
    clearInterval(mando.ringTimer);
    $("ringing").hidden = true;
  }
  mando.ring = ring;
  $("found").onclick = stopRing;
  mando.started = Date.now();
  connect();
  render();
  void loadPhotos();
})();
