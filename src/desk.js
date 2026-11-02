// Jarvis · Escritorio: the Chromebook is the brain and the voice. It listens,
// talks, plays music, reacts to hand gestures, and greets whoever the wall
// camera (the phone) sees coming in.
import { $, store, loadSettings, call, connectHome, clockParts, pick, normalize } from "./jarvis/common.js";
import { T, FAMILY, greeting, quick, offline } from "./jarvis/words.js";
import { createVoice } from "./jarvis/voice.js";
import { createEars, afterWake } from "./jarvis/ears.js";
import { createGestureReader, createHandDetector } from "./jarvis/hands.js";
import { createOrb } from "./jarvis/orb.js";

// Old pairing links pointed at the home page; the camera app lives at /camara.
const toCamera = () => { if (/invite=[a-f0-9]{64}/i.test(location.hash)) location.replace("camara.html" + location.hash); };
toCamera(); window.addEventListener("hashchange", toCamera);
if (store.get("jarvis-role", "") === "wall") location.replace("pared.html");

const settings = loadSettings();
const t = () => T[settings.lang] || T.en;
const desk = window.desk = {
  started: false, state: "off", history: [], lastTalk: 0, memory: store.get("jarvis-memory", []),
  arrivals: store.get("jarvis-arrivals", []), timers: [], weather: null, wallSeen: 0,
  extension: false, music: store.get("jarvis-music", null), gestures: [], settings, log: [],
};
const log = (m) => {
  const d = new Date();
  desk.log.push(`${d.toLocaleTimeString("es-ES")} ${m}`); while (desk.log.length > 60) desk.log.shift();
  if (!$("settings").hidden) $("micLog").textContent = desk.log.slice(-16).join("\n");
};

// ---------- Estado visual ----------
const orb = createOrb($("orb"));
function setState(state, text) {
  desk.state = state; document.body.dataset.state = state; orb.setState(state);
  if (state === "listening") $("heard").textContent = text || "";
}
function say(text) { $("say").textContent = text; $("say").classList.remove("pop"); void $("say").offsetWidth; $("say").classList.add("pop"); }
function toast(text) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = text;
  $("toasts").append(el); setTimeout(() => el.classList.add("out"), 2200); setTimeout(() => el.remove(), 2800);
}
function quietNow(h = new Date().getHours()) {
  const { quietFrom: a, quietTo: b } = settings;
  return a === b ? false : a < b ? h >= a && h < b : h >= a || h < b;
}
desk.quietNow = quietNow;

// ---------- Reloj, tiempo y paneles ----------
const WMO = { 0: ["Clear", "Despejado", "☀️"], 1: ["Mostly clear", "Casi despejado", "🌤️"], 2: ["Partly cloudy", "Parcialmente nublado", "⛅"], 3: ["Cloudy", "Nublado", "☁️"],
  45: ["Fog", "Niebla", "🌫️"], 48: ["Fog", "Niebla", "🌫️"], 51: ["Drizzle", "Llovizna", "🌦️"], 53: ["Drizzle", "Llovizna", "🌦️"], 55: ["Drizzle", "Llovizna", "🌦️"],
  61: ["Light rain", "Lluvia débil", "🌧️"], 63: ["Rain", "Lluvia", "🌧️"], 65: ["Heavy rain", "Lluvia fuerte", "🌧️"], 80: ["Showers", "Chubascos", "🌦️"], 81: ["Showers", "Chubascos", "🌦️"],
  82: ["Heavy showers", "Chubascos fuertes", "⛈️"], 95: ["Thunderstorm", "Tormenta", "⛈️"], 96: ["Thunderstorm", "Tormenta", "⛈️"], 99: ["Thunderstorm", "Tormenta", "⛈️"] };
const wmo = (code) => WMO[code] || WMO[Math.floor(code / 10) * 10] || ["", "", "🌡️"];
function weatherText() {
  const w = desk.weather; if (!w) return "";
  const [en, es] = wmo(w.code);
  return `${settings.city}: ${Math.round(w.temp)}°C, ${settings.lang === "es" ? es : en}, high ${Math.round(w.max)}°, low ${Math.round(w.min)}°${w.rain ? `, ${w.rain}% chance of rain` : ""}`;
}
desk.weatherText = weatherText;
async function loadWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${settings.lat}&longitude=${settings.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`;
    const data = await (await fetch(url)).json();
    desk.weather = { temp: data.current.temperature_2m, code: data.current.weather_code, max: data.daily.temperature_2m_max[0], min: data.daily.temperature_2m_min[0], rain: data.daily.precipitation_probability_max?.[0] || 0 };
  } catch { log("tiempo: sin conexión"); }
  render();
}
desk.loadWeather = loadWeather;
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000), es = settings.lang === "es";
  return m < 1 ? (es ? "ahora" : "now") : m < 60 ? (es ? `hace ${m} min` : `${m} min ago`) : new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
const ROLE_ICON = { me: "★", mom: "♥", dad: "◆", other: "●", unknown: "?" };
function render() {
  const { time, date } = clockParts(settings.lang);
  $("clock").textContent = time; $("date").textContent = date;
  document.body.classList.toggle("night", quietNow());
  $("quiet").hidden = !quietNow();
  const w = desk.weather;
  if (w) {
    const [en, es, icon] = wmo(w.code);
    $("wxIcon").textContent = icon; $("wxTemp").textContent = Math.round(w.temp) + "°";
    $("wxText").textContent = `${settings.lang === "es" ? es : en} · ${Math.round(w.max)}° / ${Math.round(w.min)}°`;
    $("wxCity").textContent = settings.city + (w.rain ? ` · ☂ ${w.rain}%` : "");
  }
  const online = Date.now() - desk.wallSeen < 6 * 60000;
  $("wallDot").classList.toggle("on", online);
  $("wallText").textContent = online ? (settings.lang === "es" ? "Cámara de la puerta en línea" : "Door camera online") : (settings.lang === "es" ? "Cámara de la puerta sin señal" : "Door camera offline");
  const list = $("arrivals"), shown = desk.arrivals.slice(-6).reverse();
  // Rebuild only when someone new came in (keeps the entrance animation clean);
  // otherwise just refresh the "x min ago" labels.
  const signature = settings.lang + shown.map((a) => a.at).join(",");
  if (list.dataset.sig === signature) { list.querySelectorAll("time").forEach((el, i) => { el.textContent = ago(shown[i].at); }); }
  else { list.dataset.sig = signature; list.replaceChildren();
  for (const a of shown) {
    const li = document.createElement("li"); li.className = "arrival " + a.role;
    const icon = document.createElement("span"); icon.className = "badge"; icon.textContent = ROLE_ICON[a.role] || "●";
    const name = document.createElement("strong"); name.textContent = a.name;
    const when = document.createElement("time"); when.textContent = ago(a.at);
    li.append(icon, name, when); list.append(li);
  }
  if (!desk.arrivals.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = settings.lang === "es" ? "Nadie ha entrado todavía" : "Nobody yet today"; list.append(li); } }
  $("musicNow").textContent = desk.music ? desk.music.query : (settings.lang === "es" ? "Di «Jarvis, pon música»" : "Say “Jarvis, play some music”");
  $("musicSvc").textContent = desk.music ? (desk.music.service === "spotify" ? "Spotify" : "YouTube") : "";
  const timers = $("timers"); timers.replaceChildren();
  for (const tm of desk.timers) {
    const li = document.createElement("li"); const left = Math.max(0, tm.end - Date.now());
    li.innerHTML = `<span></span><b></b>`; li.firstChild.textContent = tm.label;
    li.lastChild.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`; timers.append(li);
  }
  $("timersCard").hidden = !desk.timers.length;
  const mem = $("memory"); mem.replaceChildren();
  for (const m of desk.memory.slice(-4).reverse()) { const li = document.createElement("li"); li.textContent = m; mem.append(li); }
  $("memoryCard").hidden = !desk.memory.length;
  $("extDot").classList.toggle("on", desk.extension);
  $("handDot").classList.toggle("on", !!desk.handsOn);
  $("earDot").classList.toggle("on", settings.wake && !ears.blocked && desk.started);
}
desk.render = render;
setInterval(render, 1000);

// ---------- Voz y oído ----------
const voice = desk.voice = createVoice({ settings, onState: (state, text) => { if (state !== "idle") setState(state === "speaking" ? "speaking" : "thinking"); else setState("idle"); if (text) say(text); } });
const ears = desk.ears = createEars({ settings, log, onHeard: (text, via) => void heard(text, via), onState: (state, text) => {
  if (state === "listening") setState("listening", text);
  else if (state === "blocked") { say(t().micDenied); setState("idle"); }
  else if (state === "thinking") setState("thinking");
  else if (desk.state === "listening") setState("idle");
} });
orb.levelSource = () => desk.state === "speaking" ? voice.level() : desk.state === "listening" ? ears.level() : 0;
async function talk(text, lang) {
  ears.pause();
  say(text);
  if (!settings.key) { setState("idle"); ears.resume(); return; }
  await voice.speak(text, lang);
}
desk.talk = talk;
async function heard(text, via) {
  if (via === "silence") { say(t().notHeard); setState("idle"); ears.resume(); return; }
  if (via === "error") { say(t().notHeard); setState("idle"); ears.resume(); return; }
  if (via === "wake" && !text) { await talk(pick(t().yes)); ears.resume(true); return; }
  if (!text) { setState("idle"); ears.resume(); return; }
  await respond(text);
}
async function respond(raw) {
  $("heard").textContent = "«" + raw + "»";
  const local = quick(raw, settings.lang, settings.name);
  if (local) {
    if (local.timer) addTimer(local.timer.ms, local.timer.label);
    await talk(local.say); ears.resume(true); return;
  }
  setState("thinking");
  const reply = await think(raw);
  await talk(reply); ears.resume(true);
}
desk.respond = respond;

// ---------- Cerebro ----------
// event: true for sensor events (someone came in): a one-off exchange that never
// touches the ongoing conversation.
async function think(raw, { remember = true, event = false } = {}) {
  if (!event && Date.now() - desk.lastTalk > 6 * 60000) desk.history = [];
  if (!event) desk.lastTalk = Date.now();
  const history = event ? [] : desk.history;
  history.push({ role: "user", content: raw.slice(0, 1000) });
  while (history.length > 19 || history[0]?.role !== "user") history.shift();
  const locale = settings.lang === "es" ? "es-ES" : "en-GB";
  try {
    if (!settings.key) throw Error(t().needKey);
    const now = new Date().toLocaleString(locale, { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
    const timers = desk.timers.map((tm) => `${tm.label} timer, ${Math.ceil((tm.end - Date.now()) / 60000)} min left`).join("; ");
    const context = [weatherText(), timers, desk.music ? `Last music: ${desk.music.query}` : ""].filter(Boolean).join(". ");
    const response = await call("jarvis-brain", { messages: history, lang: settings.lang, name: settings.name, now, memory: desk.memory, context }, settings.key);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(t().thinkErr[data.error] || t().thinkDown);
    const reply = data.refused || !data.reply ? t().refused : data.reply;
    history.push({ role: "assistant", content: reply });
    if (remember && Array.isArray(data.remember)) { for (const fact of data.remember) addMemory(fact); }
    const play = (data.actions || []).includes("play");
    if (play) { const m = /play(?:ing)? (.+?)(?: on (?:youtube|spotify))?[.!]?$/i.exec(reply); desk.music = { query: m ? m[1] : raw, service: /spotify/i.test(reply + raw) ? "spotify" : "youtube" }; store.set("jarvis-music", desk.music); }
    render();
    return reply;
  } catch (e) {
    history.pop();
    return offline(raw, settings.lang, settings.name) || e.message || t().thinkDown;
  }
}
desk.think = think;
function addMemory(fact) {
  if (!fact || desk.memory.includes(fact)) return;
  desk.memory.push(fact); while (desk.memory.length > 40) desk.memory.shift();
  store.set("jarvis-memory", desk.memory); render(); toast((settings.lang === "es" ? "Recordado: " : "Remembered: ") + fact);
}

// ---------- Temporizadores ----------
function addTimer(ms, label) {
  const tm = { end: Date.now() + ms, label };
  tm.handle = setTimeout(async () => {
    desk.timers = desk.timers.filter((x) => x !== tm); render();
    orb.flash("alert"); await talk(t().timerUp(settings.name)); ears.resume();
  }, ms);
  desk.timers.push(tm); render();
}
desk.addTimer = addTimer;

// ---------- La puerta (eventos del móvil) ----------
async function onHome(event) {
  const at = +event.at || Date.now();
  if (event.action === "wall") { desk.wallSeen = at; render(); return; }
  if (event.action === "arrival" || event.action === "test" || event.action === "unknown") {
    desk.wallSeen = Date.now();
    const p = event.person || { name: settings.lang === "es" ? "Desconocido" : "Unknown", role: "unknown" };
    if (event.action !== "test") {
      desk.arrivals.push({ name: p.name, role: event.action === "unknown" ? "unknown" : p.role, at: Date.now() });
      while (desk.arrivals.length > 50) desk.arrivals.shift();
      store.set("jarvis-arrivals", desk.arrivals);
    }
    render();
    orb.flash(event.action === "unknown" ? "alert" : "arrival");
    if (quietNow()) { toast((settings.lang === "es" ? "Ha entrado: " : "Came in: ") + p.name); return; }
    if (!settings.greet && event.action !== "test") return;
    const line = await greetingFor(p, event.action);
    if (desk.voice.speaking || ears.mode === "direct") { toast(line.text); return; }
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
  // You: a short briefing the first time today, a quick hello otherwise.
  const today = new Date().toDateString(), first = store.get("jarvis-briefing", "") !== today;
  if (settings.key) {
    setState("thinking");
    const hm = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const prompt = first
      ? `[Event] ${settings.name} just walked into the room at ${hm}, for the first time today. Welcome him with a short briefing: greeting, the weather, and anything you remember that matters today. Two or three sentences.`
      : `[Event] ${settings.name} just came back into the room at ${hm}. Welcome him back in one short, witty sentence.`;
    const reply = await think(prompt, { remember: false, event: true });
    if (first) store.set("jarvis-briefing", today);
    if (reply && reply !== t().thinkDown) return { text: reply, lang: settings.lang };
  }
  return { text: greeting(settings.lang, settings.name), lang: settings.lang };
}

// ---------- Extensión del Chromebook (música, webs) ----------
let bridgeId = 0;
const pending = new Map();
window.addEventListener("message", (e) => {
  if (e.source !== window || e.data?.source !== "jarvis-extension") return;
  desk.extension = true; render();
  if (e.data.id && pending.has(e.data.id)) { pending.get(e.data.id)(e.data.ok); pending.delete(e.data.id); }
});
function extension(action, extra = {}) {
  return new Promise((resolve) => {
    const id = ++bridgeId; pending.set(id, resolve);
    window.postMessage({ source: "jarvis-desk", id, action, ...extra }, "*");
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve(false); } }, 1500);
  });
}
desk.extensionCall = extension;
let playing = true;
async function media(action) {
  if (action === "toggle") action = playing ? "pause" : "resume";
  if (action === "pause") playing = false; if (action === "resume") playing = true;
  const ok = await extension(action);
  toast(ok ? t().gesture[action] || action : (settings.lang === "es" ? "Instala la extensión de Jarvis en este Chromebook" : "Install the Jarvis extension on this Chromebook"));
  return ok;
}
desk.media = media;
$("mPrev").onclick = () => media("previous"); $("mPlay").onclick = () => media("toggle"); $("mNext").onclick = () => media("next");

// ---------- Gestos ----------
const reader = createGestureReader();
desk.handPose = "";
async function startHands() {
  if (!settings.gestures || desk.handsOn) return;
  try {
    const cam = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } });
    $("handVideo").srcObject = cam; await $("handVideo").play().catch(() => {});
    desk.handDetector = desk.handDetector || await (desk.createHandDetector || createHandDetector)();
    desk.handsOn = true; render(); handLoop();
  } catch (e) { log("manos: " + e.message); toast(settings.lang === "es" ? "Gestos no disponibles: " + e.message : "Gestures unavailable: " + e.message); }
}
desk.startHands = startHands;
async function handLoop() {
  if (!desk.handsOn) return;
  if (!document.hidden && $("handVideo").readyState >= 2) {
    try {
      const hand = await desk.handDetector.detect($("handVideo"));
      desk.handPose = hand?.pose || "";
      $("hand").hidden = !hand; if (hand) { $("hand").style.left = (hand.x * 100) + "%"; $("hand").style.top = (hand.y * 100) + "%"; $("hand").dataset.pose = hand.pose; }
      const action = reader(hand?.pose || "", hand ? hand.x : null, Date.now());
      if (action) { desk.gestures.push(action); log("gesto: " + action); onGesture(action); }
    } catch (e) { log("manos: " + e.message); }
  }
  setTimeout(handLoop, 110);
}
function onGesture(action) {
  orb.flash("gesture");
  if (action === "talk") { voice.stop(); ears.direct(); return; }
  void media(action);
}
desk.onGesture = onGesture;

// ---------- Arranque ----------
let home = null;
async function start() {
  if (desk.started) return;
  desk.started = true; $("wake").hidden = true; document.body.classList.add("live");
  voice.unlock();
  setState("thinking"); say(t().waking);
  await ears.openMeter();
  if (settings.key) home = connectHome({ key: settings.key, onEvent: (e) => void onHome(e), onStatus: (s) => log("canal: " + s) });
  void loadWeather(); setInterval(loadWeather, 20 * 60000);
  void startHands();
  try { if (navigator.wakeLock) await navigator.wakeLock.request("screen"); } catch {}
  if (!settings.key) { say(t().needKey); setState("idle"); ears.background(); return; }
  await talk(t().online(settings.name)); ears.resume();
}
desk.start = start;
function chooseRole(role) {
  store.set("jarvis-role", role);
  if (role === "wall") { location.replace("pared.html"); return; }
  $("chooser").hidden = true; $("wake").hidden = false;
}
$("asDesk").onclick = () => chooseRole("desk");
$("asWall").onclick = () => chooseRole("wall");
if (store.get("jarvis-role", "") !== "desk") $("chooser").hidden = false; else $("wake").hidden = false;
$("wake").onclick = start;
$("orb").onclick = () => { if (!desk.started) return start(); if (voice.speaking) { voice.stop(); ears.resume(); return; } ears.direct(); };
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, select") || !$("settings").hidden) return;
  if (e.code === "Space") { e.preventDefault(); if (!desk.started) return void start(); if (voice.speaking) { voice.stop(); ears.resume(); } else ears.direct(); }
  if (e.code === "Escape") { voice.stop(); ears.resume(); }
});
$("typeForm").onsubmit = (e) => { e.preventDefault(); const v = $("typeInput").value.trim(); $("typeInput").value = ""; if (v) void respond(v); };

// ---------- Ajustes ----------
function openSettings() {
  for (const id of ["name", "lang", "hear", "city"]) $(id).value = settings[id];
  $("voiceKey").value = settings.key; $("wakeOn").checked = settings.wake; $("gesturesOn").checked = settings.gestures; $("greetOn").checked = settings.greet;
  $("quietFrom").value = settings.quietFrom; $("quietTo").value = settings.quietTo;
  $("memoryList").replaceChildren(...desk.memory.map((m, i) => {
    const li = document.createElement("li"); li.textContent = m;
    const x = document.createElement("button"); x.textContent = "✕"; x.title = "Olvidar";
    x.onclick = () => { desk.memory.splice(i, 1); store.set("jarvis-memory", desk.memory); openSettings(); render(); };
    li.append(x); return li;
  }));
  $("micLog").textContent = desk.log.slice(-16).join("\n");
  $("settings").hidden = false;
}
$("openSettings").onclick = openSettings;
$("closeSettings").onclick = () => { $("settings").hidden = true; };
const bind = (id, key, conv = (v) => v) => { $(id).onchange = () => { settings[key] = conv($(id).type === "checkbox" ? $(id).checked : $(id).value); settings.save(); render(); }; };
bind("name", "name", (v) => v.trim() || "Crew"); bind("lang", "lang"); bind("hear", "hear"); bind("greetOn", "greet");
bind("quietFrom", "quietFrom", Number); bind("quietTo", "quietTo", Number);
$("voiceKey").onchange = () => { settings.key = $("voiceKey").value.trim(); settings.save(); home?.stop(); if (desk.started && settings.key) home = connectHome({ key: settings.key, onEvent: (e) => void onHome(e), onStatus: (s) => log("canal: " + s) }); };
$("wakeOn").onchange = () => { settings.wake = $("wakeOn").checked; settings.save(); if (settings.wake) ears.resume(); else ears.pause(); render(); };
$("gesturesOn").onchange = () => { settings.gestures = $("gesturesOn").checked; settings.save(); if (settings.gestures) void startHands(); else { desk.handsOn = false; $("handVideo").srcObject?.getTracks().forEach((t) => t.stop()); $("hand").hidden = true; render(); } };
$("city").onchange = async () => {
  const name = $("city").value.trim(); if (!name) return;
  try {
    const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)).json();
    const place = r.results?.[0]; if (!place) { toast("No encuentro esa ciudad"); return; }
    Object.assign(settings, { city: place.name, lat: place.latitude, lon: place.longitude }); settings.save(); $("city").value = place.name; void loadWeather();
  } catch { toast("Sin conexión"); }
};
$("testVoice").onclick = async () => { voice.unlock(); await talk(t().online(settings.name)); $("voiceInfo").textContent = voice.error || "Voz funcionando."; ears.resume(); };
$("showType").onchange = () => { $("typeForm").hidden = !$("showType").checked; };
$("toWall").onclick = (e) => { e.preventDefault(); chooseRole("wall"); };
render();
