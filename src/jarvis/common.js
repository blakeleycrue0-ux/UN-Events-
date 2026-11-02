// Shared pieces for the Jarvis desk (Chromebook) and the wall camera (phone).
export const $ = (id) => document.getElementById(id);

export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
};

// One settings object shared by both pages of this device (same origin).
export function loadSettings() {
  const settings = Object.assign({
    name: "Crew", key: "", lang: "en", hear: "es-ES", facing: "user", greet: true,
    crop: { cx: 0.5, cy: 0.5, zoom: 1 }, guardPin: "", listen: true, wake: true, quietFrom: 23, quietTo: 8,
    city: "Calvià", lat: 39.56, lon: 2.51,
  }, store.get("jarvis-settings", {}));
  settings.save = () => { const { save, ...plain } = settings; void save; store.set("jarvis-settings", plain); };
  return settings;
}

export const pick = (list) => list[Math.floor(Math.random() * list.length)];
export const normalize = (x) => x.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[¿?¡!.,]/g, " ").replace(/\s+/g, " ").trim();
export const has = (text, ...words) => words.some((w) => new RegExp(`(^| )${w}( |$)`).test(text));

export function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src; s.onload = resolve; s.onerror = () => reject(Error("No se pudo cargar " + src));
    document.head.append(s);
  });
}

export async function sha256hex(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
// The private home channel: its name comes from the Jarvis key, shared by the
// desk, the wall camera and the Chromebook extension.
export const homeTopic = async (key) => "jarvis-pc-" + (await sha256hex("jarvis-pc:" + key.trim())).slice(0, 40);

export const config = () => window.SECURITY_SUPABASE_PUBLIC || {};
export function call(name, body, key, init = {}) {
  const c = config();
  return fetch(`${c.url}/functions/v1/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jarvis-key": key, apikey: c.key || "", ...(init.headers || {}) },
    body: init.raw ?? JSON.stringify(body),
  });
}

// Minimal Supabase Realtime client (Phoenix protocol) for the home channel.
// Reconnects by itself; onEvent gets each broadcast payload.
export function connectHome({ key, onEvent, onStatus = () => {} }) {
  let ws = null, beat = null, ref = 0, topic = "", stopped = false, retry = null;
  const send = (m) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ ...m, ref: String(++ref) })); };
  async function open() {
    if (stopped) return;
    topic = "realtime:" + await homeTopic(key);
    const c = config();
    const socket = ws = new WebSocket(c.url.replace(/^http/, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(c.key) + "&vsn=1.0.0");
    socket.onopen = () => {
      send({ topic, event: "phx_join", join_ref: "1", payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false } } });
      beat = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {} }), 20000);
    };
    socket.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.topic !== topic) return;
      if (m.event === "phx_reply" && m.payload?.status) onStatus(m.payload.status === "ok" ? "online" : "error");
      if (m.event === "broadcast" && m.payload?.event === "command") onEvent(m.payload.payload || {});
    };
    socket.onclose = () => {
      clearInterval(beat);
      if (ws === socket && !stopped) { onStatus("offline"); retry = setTimeout(open, 4000); }
    };
  }
  void open();
  return {
    stop() { stopped = true; clearTimeout(retry); clearInterval(beat); try { ws?.close(); } catch {} },
    // Straight to the other devices on the same private channel (no server function).
    send(payload) { if (!topic || ws?.readyState !== 1) return false; send({ topic, event: "broadcast", payload: { type: "broadcast", event: "command", payload } }); return true; },
  };
}

export function clockParts(lang) {
  const now = new Date(), locale = lang === "es" ? "es-ES" : "en-GB";
  const date = now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  return { time: now.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }), date: date.charAt(0).toUpperCase() + date.slice(1) };
}
