// Jarvis para Chromebook: listens on Jarvis's private channel (Supabase Realtime)
// and carries out the fixed actions in commands.js.
importScripts("config.js", "commands.js");

let socket = null, heartbeat = null, ref = 0, topic = "", lastAt = 0;
let lastStatus = "";
const status = (state, detail = "") => { lastStatus = state; chrome.storage.local.set({ status: { state, detail, at: Date.now() } }); };

async function connect() {
  const { key } = await chrome.storage.local.get("key");
  if (!key) { status("sin-clave"); return; }
  const wanted = await jarvisTopic(key);
  if (socket && socket.readyState <= 1 && topic === wanted) return;
  disconnect();
  topic = wanted;
  const url = JARVIS_CONFIG.url.replace(/^http/, "ws") + "/realtime/v1/websocket?apikey=" + encodeURIComponent(JARVIS_CONFIG.anonKey) + "&vsn=1.0.0";
  const ws = socket = new WebSocket(url);
  const send = (message) => { if (ws.readyState === 1) ws.send(JSON.stringify({ ...message, ref: String(++ref) })); };
  ws.onopen = () => {
    send({ topic: "realtime:" + topic, event: "phx_join", join_ref: "1", payload: { config: { broadcast: { self: false, ack: false }, presence: { key: "" }, private: false } } });
    // Regular traffic also keeps this service worker alive while connected.
    heartbeat = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {} }), 20000);
  };
  ws.onmessage = (event) => {
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.event === "phx_reply" && message.topic === "realtime:" + topic)
      status(message.payload?.status === "ok" ? "conectado" : "error", message.payload?.response?.reason || "");
    if (message.event === "broadcast" && message.topic === "realtime:" + topic && message.payload?.event === "command")
      void run(message.payload.payload);
  };
  ws.onclose = () => { if (socket === ws) { clearInterval(heartbeat); socket = null; status("desconectado"); setTimeout(connect, 5000); } };
  ws.onerror = () => status("error", "No se puede conectar con Supabase");
}
function disconnect() {
  clearInterval(heartbeat);
  if (socket) { const old = socket; socket = null; try { old.close(); } catch {} }
}

async function run(command) {
  // Ignore stale or repeated messages.
  const at = +command?.at || 0;
  if (!at || at <= lastAt || Math.abs(Date.now() - at) > 120000) return;
  lastAt = at;
  const plan = jarvisPlan(command);
  if (!plan) return;
  chrome.storage.local.set({ last: { command: { ...command }, at: Date.now() } });
  if (plan.kind === "open") await chrome.tabs.create({ url: plan.url });
  if (plan.kind === "play") { await media("pause"); await chrome.tabs.create({ url: plan.url }); }
  if (plan.kind === "media") await media(plan.action);
}

// Pause / resume / next on YouTube and Spotify tabs.
async function media(action) {
  const tabs = await chrome.tabs.query({ url: ["https://www.youtube.com/*", "https://open.spotify.com/*"] });
  const targets = action === "resume" ? tabs.slice(-1) : tabs.filter((t) => t.audible || action === "pause" || action === "previous");
  for (const tab of targets) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [action],
        func: (what) => {
          const click = (selector) => { const b = document.querySelector(selector); if (b) b.click(); return !!b; };
          if (location.host === "open.spotify.com") {
            const playing = !!document.querySelector('[data-testid="control-button-playpause"][aria-label*="ause"]');
            if (what === "next") click('[data-testid="control-button-skip-forward"]');
            else if (what === "previous") click('[data-testid="control-button-skip-back"]');
            else if (what === "louder" || what === "quieter") return;
            else if ((what === "pause") === playing) click('[data-testid="control-button-playpause"]');
            return;
          }
          const video = document.querySelector("video");
          if (what === "next") click(".ytp-next-button");
          else if (what === "previous") history.back();
          else if (video && (what === "louder" || what === "quieter")) video.volume = Math.max(0, Math.min(1, video.volume + (what === "louder" ? 0.15 : -0.15)));
          else if (video) what === "pause" ? video.pause() : video.play();
        },
      });
    } catch { /* tab not scriptable */ }
  }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create("jarvis", { periodInMinutes: 1 }); connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.alarms.onAlarm.addListener(connect);
chrome.storage.onChanged.addListener((changes) => { if (changes.key) { topic = ""; connect(); } });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message === "reconnect") { topic = ""; connect(); return; }
  // From the Jarvis desk page on this Chromebook (bridge.js): instant, no internet.
  if (message?.bridge) {
    if (message.action === "ping") { reply({ ok: true, state: lastStatus }); return; }
    const plan = jarvisPlan({ action: message.action, query: message.query, site: message.site, service: message.service });
    if (plan?.kind === "media") void media(plan.action).then(() => reply({ ok: true }));
    else if (plan) void chrome.tabs.create({ url: plan.url }).then(() => reply({ ok: true }));
    else reply({ ok: false });
    return true;
  }
});
connect();
