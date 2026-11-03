// Jarvis · Escritorio: the Chromebook is the brain and the voice. It listens,
// talks, plays music, runs browser jobs, and greets whoever the wall
// camera (the phone) sees coming in.
import { $, store, loadSettings, call, connectHome, clockParts, pick, normalize } from "./jarvis/common.js";
import { T, FAMILY, greeting, quick, offline } from "./jarvis/words.js";
import { createVoice } from "./jarvis/voice.js";
import { createEars, afterWake } from "./jarvis/ears.js";
import { createOrb } from "./jarvis/orb.js";
import { ICONS, weatherKind } from "./jarvis/icons.js";

// Old pairing links pointed at the home page; the camera app lives at /camara.
const toCamera = () => { if (/invite=[a-f0-9]{64}/i.test(location.hash)) location.replace("camara.html" + location.hash); };
toCamera(); window.addEventListener("hashchange", toCamera);
if (store.get("jarvis-role", "") === "wall") location.replace("pared.html");
if (store.get("jarvis-role", "") === "remote") location.replace("mando.html");

const settings = loadSettings();
const t = () => T[settings.lang] || T.en;
const desk = window.desk = {
  started: false, state: "off", history: [], lastTalk: 0, memory: store.get("jarvis-memory", []),
  arrivals: store.get("jarvis-arrivals", []), timers: [], weather: null, wallSeen: 0, activeAt: Date.now(),
  extension: false, music: store.get("jarvis-music", null), settings, log: [],
};
const log = (m) => {
  const d = new Date();
  desk.log.push(`${d.toLocaleTimeString("es-ES")} ${m}`); while (desk.log.length > 60) desk.log.shift();
  if (!$("settings").hidden) $("micLog").textContent = desk.log.slice(-16).join("\n");
};

// ---------- Estado visual ----------
const orb = createOrb($("orb"));
const STATE_LABEL = { off: "OFFLINE", idle: "STANDBY", listening: "LISTENING", thinking: "THINKING", speaking: "SPEAKING", blocked: "MIC BLOCKED" };
function setState(state, text) {
  desk.state = state; document.body.dataset.state = state; orb.setState(state);
  $("stateLabel").textContent = STATE_LABEL[state] || "STANDBY";
  duck(state);
  // Tell the wall's ears so they don't transcribe Jarvis's own voice.
  const talking = state === "speaking";
  if (talking !== !!desk.talkingSent) { desk.talkingSent = talking; try { home?.send({ action: "speaking", on: talking }); } catch {} }
  if (state !== "idle") wakeUp();
  if (state === "listening") $("heard").textContent = text || "";
}
function wakeUp() { desk.activeAt = Date.now(); document.body.classList.remove("ambient"); }
document.addEventListener("pointermove", wakeUp); document.addEventListener("keydown", wakeUp);
// A soft two-note chime the instant someone comes in (before any voice).
function chime(kind = "arrival") {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; desk.chimeCtx ||= new Ctx();
    const ctx = desk.chimeCtx, t0 = ctx.currentTime;
    const notes = kind === "alert" ? [523.25, 415.3] : [659.25, 987.77];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = t0 + i * 0.16; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.08, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.start(t); o.stop(t + 1);
    });
  } catch { /* sound is optional */ }
}
desk.chime = chime;
function say(text) { $("say").textContent = text; $("say").classList.remove("pop"); void $("say").offsetWidth; $("say").classList.add("pop"); }
function toast(text) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = text;
  $("toasts").append(el); setTimeout(() => el.classList.add("out"), 2200); setTimeout(() => el.remove(), 2800);
}
function quietNow(h = new Date().getHours()) {
  if (desk.sleep) return true;   // asleep: greetings stay silent
  const { quietFrom: a, quietTo: b } = settings;
  return a === b ? false : a < b ? h >= a && h < b : h >= a || h < b;
}
desk.quietNow = quietNow;

// ---------- Reloj, tiempo y paneles ----------
for (const el of document.querySelectorAll("[data-icon]")) el.innerHTML = ICONS[el.dataset.icon] || "";
const isNight = (h = new Date().getHours()) => h < 7 || h >= 21;
function weatherText() {
  const w = desk.weather; if (!w) return "";
  const [en] = weatherKind(w.code);
  return `${settings.city}: ${Math.round(w.temp)}°C, ${en.toLowerCase()}, high ${Math.round(w.max)}°, low ${Math.round(w.min)}°${w.rain ? `, ${w.rain}% chance of rain` : ""}`;
}
desk.weatherText = weatherText;
async function loadWeather() {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${settings.lat}&longitude=${settings.lon}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`;
    const data = await (await fetch(url)).json();
    const now = Date.now(), times = (data.hourly?.time || []).map((t) => new Date(t).getTime());
    const start = Math.max(0, times.findIndex((t) => t > now));
    const hours = times.slice(start, start + 5).map((t, i) => ({ t, temp: data.hourly.temperature_2m[start + i], code: data.hourly.weather_code[start + i] }));
    desk.weather = { temp: data.current.temperature_2m, code: data.current.weather_code, max: data.daily.temperature_2m_max[0], min: data.daily.temperature_2m_min[0], rain: data.daily.precipitation_probability_max?.[0] || 0, hours };
  } catch { log("tiempo: sin conexión"); }
  renderWeather(); render();
}
desk.loadWeather = loadWeather;
function renderWeather() {
  const w = desk.weather; if (!w) return;
  const [en, es, kind] = weatherKind(w.code, isNight());
  $("wxIcon").innerHTML = ICONS[kind]; $("wxTemp").textContent = Math.round(w.temp) + "°";
  $("wxText").textContent = `${settings.lang === "es" ? es : en} · H ${Math.round(w.max)}°  L ${Math.round(w.min)}°${w.rain ? ` · ${w.rain}% rain` : ""}`;
  $("wxCity").textContent = settings.city;
  $("wxHours").replaceChildren(...(w.hours || []).map((h) => {
    const li = document.createElement("li"), d = new Date(h.t);
    const time = document.createElement("span"); time.textContent = String(d.getHours()).padStart(2, "0");
    const icon = document.createElement("span"); icon.className = "ico"; icon.innerHTML = ICONS[weatherKind(h.code, isNight(d.getHours()))[2]];
    const temp = document.createElement("b"); temp.textContent = Math.round(h.temp) + "°";
    li.append(time, icon, temp); return li;
  }));
}
function ago(ms) {
  const m = Math.round((Date.now() - ms) / 60000), es = settings.lang === "es";
  return m < 1 ? (es ? "ahora" : "now") : m < 60 ? `${m} min` : new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
const ROLE_LABEL = { me: ["You", "Tú"], mom: ["Mother", "Madre"], dad: ["Father", "Padre"], other: ["Guest", "Invitado"], unknown: ["Unrecognised", "Desconocido"] };
const initials = (name) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
function render() {
  const { time, date } = clockParts(settings.lang);
  $("clock").textContent = time; $("date").textContent = date;
  document.body.classList.toggle("night", quietNow());
  $("quiet").hidden = !quietNow();
  const online = Date.now() - desk.wallSeen < 6 * 60000, es = settings.lang === "es";
  $("wallDot").classList.toggle("on", online);
  $("wallText").textContent = online ? (es ? "cámara en línea" : "camera online") : (es ? "cámara sin señal" : "camera offline");
  const list = $("arrivals"), shown = desk.arrivals.slice(-5).reverse();
  // Rebuild only when someone new came in; otherwise just refresh the times.
  const signature = settings.lang + shown.map((a) => a.at).join(",");
  if (list.dataset.sig === signature) list.querySelectorAll("time").forEach((el, i) => { el.textContent = ago(shown[i].at); });
  else {
    list.dataset.sig = signature; list.replaceChildren();
    for (const a of shown) {
      const li = document.createElement("li"); li.className = "arrival " + a.role;
      const av = document.createElement("span"); av.className = "avatar"; av.textContent = a.role === "unknown" ? "?" : initials(a.name);
      const who = document.createElement("span"); who.className = "who";
      const name = document.createElement("strong"); name.textContent = a.name;
      const role = document.createElement("span"); role.textContent = (ROLE_LABEL[a.role] || ROLE_LABEL.other)[es ? 1 : 0];
      who.append(name, role);
      const when = document.createElement("time"); when.textContent = ago(a.at);
      li.append(av, who, when); list.append(li);
    }
    if (!shown.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = es ? "Nadie ha entrado todavía" : "No one has come in yet"; list.append(li); }
  }
  $("musicNow").textContent = desk.music ? desk.music.query : (es ? "Di «Jarvis, pon música»" : "Say “Jarvis, play some music”");
  $("musicNow").classList.toggle("idle", !desk.music);
  $("musicSvc").textContent = desk.music ? (desk.music.service === "spotify" ? "Spotify" : "YouTube") : "";
  const timers = $("timers"); timers.replaceChildren();
  for (const tm of desk.timers) {
    const li = document.createElement("li"), left = Math.max(0, tm.end - Date.now());
    const label = document.createElement("span"); label.textContent = tm.label;
    const rest = document.createElement("b"); rest.textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, "0")}`;
    li.append(label, rest); timers.append(li);
  }
  $("timersCard").hidden = !desk.timers.length;
  const mem = $("memory"); mem.replaceChildren();
  for (const m of desk.memory.slice(-4).reverse()) { const li = document.createElement("li"); li.textContent = m; mem.append(li); }
  $("memoryCard").hidden = !desk.memory.length;
  $("extDot").classList.toggle("on", desk.extension);
  $("earDot").classList.toggle("on", (settings.wake && !ears.blocked && desk.started) || wallListening());
  // Ambient: after a few quiet minutes the side panels step back.
  document.body.classList.toggle("ambient", desk.started && Date.now() - desk.activeAt > 180000);
}
desk.render = render;
setInterval(render, 1000);

// ---------- Voz y oído ----------
const voice = desk.voice = createVoice({ settings, onState: (state, text) => { if (state !== "idle") setState(state === "speaking" ? "speaking" : "thinking"); else setState("idle"); if (text) say(text); } });
const ears = desk.ears = createEars({ settings, log, onHeard: (text, via) => void heard(text, via), onState: (state, text) => {
  if (state === "listening") setState("listening", text);
  else if (state === "blocked") { if (!wallListening()) say(t().micDenied); setState("idle"); }
  else if (state === "thinking") setState("thinking");
  else if (desk.state === "listening") setState("idle");
} });
// While the wall phone listens, this computer never opens its own microphone in the background.
{ const resume = ears.resume; ears.resume = (follow = false) => { if (wallListening()) { ears.paused = true; return; } resume(follow); }; }
orb.levelSource = () => desk.state === "speaking" ? voice.level() : desk.state === "listening" ? ears.level() : 0;
async function talk(text, lang) {
  ears.pause();
  desk.lastSaid = text;
  say(text);
  if (!settings.key) { setState("idle"); ears.resume(); return; }
  await voice.speak(text, lang);
}
desk.talk = talk;
async function heard(text, via) {
  if (via === "silence") { say(t().notHeard); setState("idle"); ears.resume(); return; }
  if (via === "error") { say(t().notHeard); setState("idle"); ears.resume(); return; }
  // While the wall phone listens, it handles "Jarvis…" (avoids answering twice).
  if (via === "wake" && wallListening()) { ears.resume(); return; }
  if (via === "wake" && !text) { await talk(pick(t().yes)); ears.resume(true)   /* you said only "Jarvis": now listen to what follows */; return; }
  if (!text) { setState("idle"); ears.resume(); return; }
  await respond(text);
}
async function respond(raw) {
  $("heard").textContent = "«" + raw + "»";
  // Answer to a question from the browser agent ("Shall I hand it in?").
  if (desk.ask) { const id = desk.ask; desk.ask = 0; await extension("agent-answer", { ask: id, text: raw }); setState("idle"); ears.resume(); return; }
  if (await wakeVoice(raw)) return;
  if (await freeVoice(raw)) return;
  if (await guardVoice(raw)) return;
  if (desk.agent && /^\s*(stop|para|parar|cancela|cancel|d[ée]jalo|basta)\b/i.test(raw)) {
    await extension("agent-stop"); desk.agent = null; renderAgent();
    await talk(settings.lang === "es" ? "Vale, lo dejo." : "Alright, I've stopped."); ears.resume(); return;
  }
  const local = quick(raw, settings.lang, settings.name);
  if (local) {
    if (local.timer) addTimer(local.timer.ms, local.timer.label);
    await talk(local.say); ears.resume(); return;
  }
  setState("thinking");
  const reply = await think(raw);
  await talk(reply); ears.resume();
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
    const off = -new Date().getTimezoneOffset(), tz = `UTC${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
    const response = await call("jarvis-brain", { messages: history, lang: settings.lang, name: settings.name, now: `${now} (${tz}, ${ymd()})`, memory: desk.memory, context, hear: settings.hear, lists: { homework: desk.lists.homework, countdowns: desk.lists.countdowns } }, settings.key);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(t().thinkErr[data.error] || t().thinkDown);
    const reply = data.refused || !data.reply ? t().refused : data.reply;
    history.push({ role: "assistant", content: reply });
    if (remember && Array.isArray(data.remember)) { for (const fact of data.remember) addMemory(fact); }
    if ((data.actions || []).some((a) => String(a).startsWith("reminder:"))) void loadReminders();
    if (data.lists) applyLists(data.lists);
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
// ---------- Deberes y cuentas atrás ----------
// Kept on this computer; Claude edits them by voice ("apunta el trabajo de
// historia para el jueves", "cuenta atrás para el examen del 20").
const ymd = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
desk.ymd = ymd;
desk.lists = store.get("jarvis-lists", { homework: [], countdowns: [] });
const daysTo = (date) => Math.round((new Date(date + "T00:00:00") - new Date(ymd() + "T00:00:00")) / 86400000);
const same = (a, b) => a.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, "") === b.toLowerCase().replace(/[^a-z0-9áéíóúñü]/g, "");
function applyLists(l) {
  const L = desk.lists;
  for (const h of l.homeworkAdd || []) if (!L.homework.some((x) => same(x.title, h.title))) L.homework.push({ title: h.title, due: h.due });
  for (const t of l.homeworkDone || []) L.homework = L.homework.filter((x) => !same(x.title, t) && !x.title.toLowerCase().includes(t.toLowerCase()));
  for (const c of l.countdownAdd || []) { L.countdowns = L.countdowns.filter((x) => !same(x.title, c.title)); L.countdowns.push({ title: c.title, date: c.date }); }
  for (const t of l.countdownRemove || []) L.countdowns = L.countdowns.filter((x) => !same(x.title, t) && !x.title.toLowerCase().includes(t.toLowerCase()));
  saveLists();
}
desk.applyLists = applyLists;
function saveLists() { store.set("jarvis-lists", desk.lists); renderLists(); }
function renderLists() {
  const es = settings.lang === "es", L = desk.lists;
  L.countdowns = L.countdowns.filter((c) => daysTo(c.date) >= 0);   // past events disappear
  const hw = [...L.homework].sort((a, b) => a.due.localeCompare(b.due));
  $("homeworkCard").hidden = !hw.length; $("homeworkSub").textContent = hw.length ? String(hw.length) : "";
  $("homework").replaceChildren(...hw.map((h) => {
    const n = daysTo(h.due), li = document.createElement("li");
    li.className = n < 0 ? "late" : n <= 1 ? "soon" : "";
    const t = document.createElement("span"); t.textContent = h.title;
    const d = document.createElement("b");
    d.textContent = n < 0 ? (es ? "atrasado" : "overdue") : n === 0 ? (es ? "hoy" : "today") : n === 1 ? (es ? "mañana" : "tomorrow")
      : new Date(h.due + "T12:00:00").toLocaleDateString(es ? "es-ES" : "en-GB", { weekday: "short", day: "numeric" });
    const x = document.createElement("button"); x.textContent = "✓"; x.title = es ? "Hecho" : "Done";
    x.onclick = () => { desk.lists.homework = desk.lists.homework.filter((y) => y !== h); saveLists(); };
    li.append(t, d, x); return li;
  }));
  const cd = [...L.countdowns].sort((a, b) => a.date.localeCompare(b.date));
  $("countdownCard").hidden = !cd.length;
  $("countdowns").replaceChildren(...cd.map((c) => {
    const n = daysTo(c.date), li = document.createElement("li");
    const t = document.createElement("span"); t.textContent = c.title;
    const d = document.createElement("b"); d.textContent = n === 0 ? (es ? "¡hoy!" : "today!") : n === 1 ? (es ? "mañana" : "tomorrow") : `${n} ${es ? "días" : "days"}`;
    const x = document.createElement("button"); x.textContent = "✕";
    x.onclick = () => { desk.lists.countdowns = desk.lists.countdowns.filter((y) => y !== c); saveLists(); };
    li.append(t, d, x); return li;
  }));
}
desk.renderLists = renderLists;
// Evening heads-up (19:00) for homework due tomorrow, once a day.
setInterval(async () => {
  const now = new Date();
  if (!desk.started || now.getHours() < 19 || quietNow() || store.get("jarvis-hw-told", "") === ymd()) return;
  const due = desk.lists.homework.filter((h) => daysTo(h.due) === 1);
  store.set("jarvis-hw-told", ymd());
  if (!due.length || desk.voice.speaking) return;
  const es = settings.lang === "es", list = due.map((h) => h.title).join(es ? " y " : " and ");
  orb.flash("alert"); chime("alert");
  await talk(es ? `Recordatorio: mañana tienes que entregar ${list}.` : `Heads up: ${list} ${due.length === 1 ? "is" : "are"} due tomorrow.`); ears.resume();
}, 60000);

// ---------- ¿Quién ha entrado? ----------
function whoCameIn(since) {
  const es = settings.lang === "es";
  const list = desk.arrivals.filter((a) => a.at >= since && a.role !== "me");
  const hm = (t) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  if (!list.length) return es ? "No ha entrado nadie." : "Nobody came in.";
  const parts = list.slice(-5).map((a) => `${a.role === "unknown" ? (es ? "alguien que no conozco" : "someone I don't know") : a.name} ${es ? "a las" : "at"} ${hm(a.at)}`);
  const more = list.length > 5 ? (es ? ` y ${list.length - 5} más` : ` and ${list.length - 5} more`) : "";
  return (es ? "Entró " : "In came ") + parts.join(", ") + more + ".";
}
desk.whoCameIn = whoCameIn;

// Free local voice commands (no Claude): who came in, find my phone.
async function freeVoice(raw) {
  const text = normalize(raw).replace(/'/g, ""), es = settings.lang === "es";
  if (/(quien|alguien) (ha )?entrad|ha entrado alguien|quien ha venido|who came in|anyone (come|came) in|did anyone come/.test(text)) {
    const since = desk.guard.leftAt && desk.guard.backAt >= desk.guard.leftAt && Date.now() - desk.guard.backAt < 6 * 3600000 ? desk.guard.leftAt : new Date().setHours(0, 0, 0, 0);
    const label = since === desk.guard.leftAt ? (es ? "Mientras no estabas: " : "While you were out: ") : (es ? "Hoy: " : "Today: ");
    await talk(label + whoCameIn(since)); ears.resume(); return true;
  }
  if (/donde (esta|estara|he dejado) (mi|el) (movil|telefono)|encuentra (mi|el) (movil|telefono)|busca (mi|el) (movil|telefono)|find my phone|where is my phone|wheres my phone/.test(text)) {
    notifyPhone(es ? "📍 ¡Estoy aquí!" : "📍 Here I am!", es ? "Jarvis te está buscando" : "Jarvis is looking for you", "find");
    home?.send({ action: "ring" });
    await talk(es ? "Hago sonar tu móvil. Escucha." : "Ringing your phone. Listen."); ears.resume(); return true;
  }
  return false;
}
desk.freeVoice = freeVoice;

// ---------- Recordatorios guardados ----------
// Read straight from the database, so what you see is what will happen.
function whenLabel(iso) {
  const d = new Date(iso), now = new Date(), es = settings.lang === "es";
  const hm = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  if (diff === 0) return hm;
  if (diff === 1) return (es ? "Mañana " : "Tomorrow ") + hm;
  return d.toLocaleDateString(es ? "es-ES" : "en-GB", { weekday: "short", day: "numeric", month: "short" }) + " " + hm;
}
async function loadReminders() {
  if (!settings.key) return;
  try {
    const response = await call("jarvis-call", { action: "reminders" }, settings.key);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.reminders)) return;
    desk.reminders = data.reminders; renderReminders();
  } catch { /* offline: keep the last list */ }
}
desk.loadReminders = loadReminders;
function renderReminders() {
  const list = desk.reminders || [];
  $("remindersCard").hidden = !list.length;
  $("remindersSub").textContent = list.length ? String(list.length) : "";
  $("reminders").replaceChildren(...list.map((r) => {
    const li = document.createElement("li");
    const when = document.createElement("time"); when.textContent = whenLabel(r.due_at);
    const text = document.createElement("span"); text.textContent = r.text + (r.via === "email" ? " (email)" : "");
    const x = document.createElement("button"); x.textContent = "✕"; x.title = settings.lang === "es" ? "Borrar" : "Delete";
    x.onclick = async () => { await call("jarvis-call", { action: "forget", id: r.id }, settings.key).catch(() => {}); void loadReminders(); };
    li.append(when, text, x); return li;
  }));
}
setInterval(() => { if (desk.started) void loadReminders(); }, 60000);

// New computer: bring back what Jarvis remembers from Supabase (and the guard code).
async function restoreMemory() {
  if (!settings.key) return;
  try {
    const response = await call("jarvis-call", { action: "state" }, settings.key);
    const data = await response.json().catch(() => ({}));
    if (response.ok && /^\d{4}$/.test(data.guardPin || "") && data.guardPin !== settings.guardPin) { settings.guardPin = data.guardPin; settings.save(); }
    if (desk.memory.length) return;
    const facts = Array.isArray(data.memory) ? data.memory.map((m) => String(m).slice(0, 200)).filter(Boolean) : [];
    if (!response.ok || !facts.length || desk.memory.length) return;
    desk.memory = facts.slice(-40); store.set("jarvis-memory", desk.memory); render();
    toast(settings.lang === "es" ? `He recuperado ${facts.length} recuerdos.` : `Restored ${facts.length} memories.`);
  } catch { /* offline: start fresh */ }
}
desk.restoreMemory = restoreMemory;
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

// ---------- Despertador amanecer ----------
// Like a sunrise lamp: 15 min before the time the screen goes from black to deep
// red, orange and warm light, with nature sounds rising; at the time, Jarvis says
// good morning. "Ya estoy despierto" stops it; "cinco minutos más" snoozes 9 min.
desk.wake = store.get("jarvis-wake", { time: "", done: "" });
desk.sunriseLeadMS = 15 * 60000; desk.sunriseRingMS = 30 * 60000; desk.snoozeMS = 9 * 60000;
function wakeTarget(now = Date.now()) {
  if (desk.wakeOverride) return desk.wakeOverride;
  if (!/^\d{2}:\d{2}$/.test(desk.wake.time || "")) return 0;
  const [h, m] = desk.wake.time.split(":").map(Number), d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (now > d.getTime() + desk.sunriseRingMS) d.setDate(d.getDate() + 1);
  return d.getTime();
}
desk.wakeTarget = wakeTarget;
function saveWake() { store.set("jarvis-wake", desk.wake); renderWake(); }
function renderWake() {
  const on = /^\d{2}:\d{2}$/.test(desk.wake.time || "");
  $("alarmInfo").hidden = !on;
  if (on) $("alarmText").textContent = (settings.lang === "es" ? "Despertador " : "Alarm ") + desk.wake.time;
}
function setWake(time) { desk.wake.time = time; desk.wake.done = ""; desk.wakeOverride = 0; saveWake(); }
desk.setWake = setWake;
// ---------- Cielo: estrellas de noche y amanecer de verdad ----------
// One canvas does both: at night a starry sky (twinkling, the odd shooting
// star) over dark hills; at dawn the horizon turns violet, red and orange, the
// sun rises from behind the hills, the stars fade and the sky ends up blue.
const SKYK = [ // progress, zenith, horizon, sun
  [0, [2, 3, 12], [9, 12, 30], [120, 20, 10]],
  [0.25, [6, 9, 30], [56, 26, 66], [170, 40, 20]],
  [0.5, [24, 32, 78], [205, 86, 50], [255, 110, 40]],
  [0.75, [64, 104, 168], [252, 168, 88], [255, 196, 110]],
  [1, [128, 186, 236], [255, 228, 186], [255, 248, 225]],
];
const lerp = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
function skyColors(p) {
  let i = 0; while (i < SKYK.length - 2 && p > SKYK[i + 1][0]) i++;
  const [a, b] = [SKYK[i], SKYK[i + 1]], k = Math.min(1, Math.max(0, (p - a[0]) / (b[0] - a[0])));
  return { zen: lerp(a[1], b[1], k), hor: lerp(a[2], b[2], k), sun: lerp(a[3], b[3], k) };
}
desk.skyColors = skyColors;
const stars = Array.from({ length: 340 }, () => ({ x: Math.random(), y: Math.pow(Math.random(), 1.4) * 0.8, r: Math.random() * 1.3 + 0.25, a: Math.random() * 0.7 + 0.3, s: Math.random() * 2 + 0.5, ph: Math.random() * 6.3 }));
let meteor = null;
function drawSky(p, t) {
  const c = $("sky"), dpr = Math.min(2, window.devicePixelRatio || 1), W = innerWidth, H = innerHeight;
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const { zen, hor, sun } = skyColors(p), horizon = H * 0.78;
  const grd = g.createLinearGradient(0, 0, 0, horizon);
  grd.addColorStop(0, `rgb(${zen})`); grd.addColorStop(0.55, `rgb(${lerp(zen, hor, 0.45)})`); grd.addColorStop(1, `rgb(${hor})`);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  // Stars fade out as the light comes.
  const starAlpha = Math.max(0, 1 - p * 2.4);
  if (starAlpha > 0) {
    for (const s of stars) {
      const a = s.a * starAlpha * (0.55 + 0.45 * Math.sin(t / 1000 * s.s + s.ph));
      g.fillStyle = `rgba(235,240,255,${a.toFixed(3)})`; g.beginPath(); g.arc(s.x * W, s.y * horizon, s.r, 0, 6.283); g.fill();
    }
    if (!meteor && p < 0.15 && Math.random() < 0.004) meteor = { x: Math.random() * W * 0.8, y: Math.random() * H * 0.3, t };
    if (meteor) {
      const k = (t - meteor.t) / 900;
      if (k > 1) meteor = null;
      else {
        const x = meteor.x + k * 320, y = meteor.y + k * 140, tail = g.createLinearGradient(x - 120, y - 52, x, y);
        tail.addColorStop(0, "rgba(255,255,255,0)"); tail.addColorStop(1, `rgba(255,255,255,${(0.9 * (1 - k) * starAlpha).toFixed(3)})`);
        g.strokeStyle = tail; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x - 120, y - 52); g.lineTo(x, y); g.stroke();
      }
    }
  }
  // Warm glow along the horizon, growing with the dawn.
  if (p > 0.05) {
    const glow = g.createRadialGradient(W / 2, horizon, 0, W / 2, horizon, W * (0.35 + p * 0.5));
    glow.addColorStop(0, `rgba(${sun},${Math.min(0.85, p * 1.1).toFixed(3)})`); glow.addColorStop(1, `rgba(${sun},0)`);
    g.fillStyle = glow; g.fillRect(0, 0, W, H);
  }
  // The sun rises from behind the hills.
  if (p > 0.32) {
    const k = (p - 0.32) / 0.68, R = H * 0.065, sy = horizon + R * 1.2 - k * H * 0.42;
    const halo = g.createRadialGradient(W / 2, sy, R * 0.5, W / 2, sy, R * 7);
    halo.addColorStop(0, `rgba(${sun},0.75)`); halo.addColorStop(1, `rgba(${sun},0)`);
    g.fillStyle = halo; g.fillRect(0, 0, W, H);
    g.fillStyle = `rgb(${lerp(sun, [255, 252, 240], 0.5)})`; g.beginPath(); g.arc(W / 2, sy, R, 0, 6.283); g.fill();
  }
  // Hills in silhouette, lit a little as the morning comes.
  const hill = (base, amp, freq, phase, shade) => {
    g.fillStyle = `rgb(${lerp([3, 4, 9], lerp(hor, [20, 30, 20], 0.6), Math.min(1, p * 0.55 + shade))})`;
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, base + Math.sin(x / W * freq + phase) * amp + Math.sin(x / W * freq * 2.7 + phase * 2) * amp * 0.35);
    g.lineTo(W, H); g.closePath(); g.fill();
  };
  hill(horizon + H * 0.03, H * 0.035, 5.5, 1.2, 0.05); hill(horizon + H * 0.09, H * 0.045, 3.4, 4, 0);
}
desk.drawSky = drawSky;
function skyLoop(t) {
  if ($("sunrise").hidden) { desk.skyLoop = 0; return; }
  drawSky(desk.skyP || 0, t);
  $("sunriseClock").textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
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
  $("sunriseClock").textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
desk.paintSunrise = paintSunrise;
// "Me voy a dormir": stars until the alarm (or until you wake up).
function enterSleep() {
  desk.sleep = true; desk.skyP = 0; $("sunrise").classList.remove("ring", "bright");
  $("sunriseMsg").textContent = /^\d{2}:\d{2}$/.test(desk.wake.time || "") ? (settings.lang === "es" ? `Despertador ${desk.wake.time} · Buenas noches` : `Alarm ${desk.wake.time} · Good night`) : (settings.lang === "es" ? "Buenas noches" : "Good night");
  showSky();
}
function exitSleep() { desk.sleep = false; showSky(); }
desk.enterSleep = enterSleep; desk.exitSleep = exitSleep;
$("nightExit").onclick = () => { exitSleep(); };
const SLEEP = /(me voy a (dormir|la cama|acostar|sobar)|me voy a dormir|buenas noches|a dormir|modo (noche|dormir)|good ?night|going to (sleep|bed)|im going to bed)/;

// Nature: a soft stream (filtered brown noise) and birds, all generated (no files).
function startNature() {
  if (desk.nature) return desk.nature;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; desk.chimeCtx ||= new Ctx();
    const ctx = desk.chimeCtx, master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), data = buf.getChannelData(0);
    let last = 0; for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
    const water = ctx.createGain(); water.gain.value = 0.55;
    noise.connect(lp); lp.connect(water); water.connect(master); noise.start();
    const chirp = () => {
      if (!desk.nature) return;
      const t0 = ctx.currentTime, notes = 2 + Math.floor(Math.random() * 4), base = 2600 + Math.random() * 1800;
      for (let n = 0; n < notes; n++) {
        const o = ctx.createOscillator(), g = ctx.createGain(), t = t0 + n * (0.09 + Math.random() * 0.06), f = base * (0.9 + Math.random() * 0.25);
        o.type = "sine"; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (1.15 + Math.random() * 0.3), t + 0.05); o.frequency.exponentialRampToValueAtTime(f * 0.9, t + 0.1);
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t + 0.015); g.gain.linearRampToValueAtTime(0, t + 0.1);
        o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.12);
      }
      desk.birdTimer = setTimeout(chirp, 600 + Math.random() * 2600);
    };
    desk.nature = { master, noise, ctx };
    chirp();
  } catch { /* no audio */ }
  return desk.nature;
}
function stopNature() { clearTimeout(desk.birdTimer); try { desk.nature?.noise.stop(); desk.nature?.master.disconnect(); } catch {} desk.nature = null; }
function endSunrise(dismissed) {
  const target = wakeTarget();
  $("sunrise").classList.remove("ring", "bright"); stopNature(); desk.sunrise = false; desk.snoozeUntil = 0;
  if (dismissed) desk.sleep = false;
  showSky();
  if (dismissed && target) { desk.wake.done = String(target); desk.wakeOverride = 0; saveWake(); }
}
desk.endSunrise = endSunrise;
async function ringSunrise(target) {
  if (desk.wakeRang === target) return;
  desk.wakeRang = target; $("sunrise").classList.add("ring");
  const es = settings.lang === "es", hm = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString(), due = (desk.reminders || []).filter((r) => new Date(r.due_at).toDateString() === today).length;
  const w = weatherText(), hwToday = desk.lists.homework.filter((h) => daysTo(h.due) <= 0).map((h) => h.title);
  const hwLine = hwToday.length ? (es ? ` Hoy entregas: ${hwToday.join(", ")}.` : ` Due today: ${hwToday.join(", ")}.`) : "";
  $("sunriseMsg").textContent = es ? `Buenos días, ${settings.name}` : `Good morning, ${settings.name}`;
  const text = es
    ? `Buenos días, ${settings.name}. Son las ${hm}. ${w ? w + "." : ""} ${due ? `Hoy tienes ${due} ${due === 1 ? "recordatorio" : "recordatorios"}.` : "Hoy no tienes nada apuntado."} Arriba, que el día no se conquista solo.${hwLine}`
    : `Good morning, ${settings.name}. It's ${hm}. ${w ? w + "." : ""} ${due ? `You have ${due} ${due === 1 ? "reminder" : "reminders"} today.` : "Nothing on the list today."} Up you get, the day won't conquer itself.${hwLine}`;
  await talk(text.replace(/\s+/g, " ").trim(), es ? "es" : "en"); ears.resume();
}
function sunriseTick() {
  const now = Date.now(), target = wakeTarget(now);
  if (!target || desk.wake.done === String(target)) { if (desk.sunrise) endSunrise(false); return; }
  const start = target - desk.sunriseLeadMS;
  if (now < start || now > target + desk.sunriseRingMS) { if (desk.sunrise) endSunrise(false); return; }
  if (desk.snoozeUntil > now) return;
  if (desk.snoozeUntil) { desk.snoozeUntil = 0; desk.wakeRang = 0; }
  if (!desk.sunrise) { desk.sunrise = true; showSky(); wakeUp(); }
  const p = Math.min(1, (now - start) / desk.sunriseLeadMS);
  paintSunrise(p);
  // Nature sounds rise over the last third, then stay gentle.
  const vol = p < 0.65 ? 0 : Math.min(0.9, (p - 0.65) / 0.35 * 0.9);
  if (vol > 0) { const n = startNature(); if (n) n.master.gain.setTargetAtTime(vol, n.ctx.currentTime, 1.5); }
  if (now >= target) void ringSunrise(target);
}
desk.sunriseTick = sunriseTick;
setInterval(sunriseTick, 1000);
function snooze() {
  desk.snoozeUntil = Date.now() + desk.snoozeMS; desk.wakeRang = 0;
  $("sunrise").classList.remove("ring"); stopNature(); desk.sunrise = false; desk.sleep = true; desk.skyP = 0; showSky();
}
desk.snooze = snooze;
$("sunriseStop").onclick = async () => { endSunrise(true); voice.stop(); await talk(settings.lang === "es" ? "Perfecto. Que tengas un gran día." : "Splendid. Have a great day."); ears.resume(); };
$("sunriseSnooze").onclick = () => { voice.stop(); snooze(); };
const NUM = { una: 1, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9, diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12 };
// Voice: "despiértame a las 7 y media", "wake me up at 6:45", "quita el despertador", "ya estoy despierto".
function parseWake(text) {
  const m = /(despiertame|despertador|wake me|alarm clock|alarma (?:a|para) las?)\D*?(\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:[:.h ](\d{2}))?(?: ?(y media|y cuarto|menos cuarto|pm|de la tarde|de la noche|am|de la manana))?/.exec(text);
  if (!m) return null;
  let h = /^\d+$/.test(m[2]) ? +m[2] : NUM[m[2]], min = m[3] ? +m[3] : 0;
  if (m[4] === "y media") min = 30; else if (m[4] === "y cuarto") min = 15; else if (m[4] === "menos cuarto") { h -= 1; min = 45; }
  if (/pm|tarde|noche/.test(m[4] || "") && h < 12) h += 12;
  if (h > 23 || min > 59 || h < 0) return null;
  return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
}
desk.parseWake = parseWake;
async function wakeVoice(raw) {
  const text = normalize(raw).replace(/'/g, ""), es = settings.lang === "es";
  // "Me voy a dormir (despiértame a las 7)": stars now, sunrise in the morning.
  if (SLEEP.test(text)) {
    const time = parseWake(text);
    if (time) setWake(time);
    enterSleep();
    const at = /^\d{2}:\d{2}$/.test(desk.wake.time || "") ? desk.wake.time : "";
    await talk(es ? (at ? `Buenas noches, ${settings.name}. Te despierto a las ${at} con el amanecer.` : `Buenas noches, ${settings.name}. No tienes despertador puesto; dime «despiértame a las…» si quieres uno.`)
      : (at ? `Good night, ${settings.name}. I'll wake you at ${at} with the sunrise.` : `Good night, ${settings.name}. No alarm is set; say "wake me at…" if you want one.`), es ? "es" : "en");
    ears.resume(); return true;
  }
  if (desk.sleep && !desk.sunrise && /(ya )?estoy despierto|me levanto|im up|im awake|buenos dias|good morning/.test(text)) {
    exitSleep(); await talk(es ? "Buenos días. Encendiendo las luces, por así decirlo." : "Good morning. Lights on, so to speak."); ears.resume(); return true;
  }
  if (desk.sunrise && /(ya )?estoy despierto|me levanto|im up|im awake|apaga(r)? (la )?alarma|para(r)? (la )?alarma|stop (the )?alarm/.test(text)) { $("sunriseStop").click(); return true; }
  if (desk.sunrise && /cinco minutos|5 minutos|snooze|five more minutes|un rato mas/.test(text)) {
    snooze(); await talk(es ? "Nueve minutos más. Ni uno más." : "Nine more minutes. Not one more."); ears.resume(); return true;
  }
  if (/(quita|cancela|apaga|borra)( el)? despertador|no me despiertes|cancel (the )?(wake|alarm clock)/.test(text)) {
    setWake(""); await talk(es ? "Despertador quitado. Duerme lo que quieras." : "Alarm clock off. Sleep as long as you like."); ears.resume(); return true;
  }
  const time = parseWake(text);
  if (!time) return false;
  setWake(time);
  const [h, m] = time.split(":").map(Number), early = new Date(0, 0, 0, h, m - 15);
  const from = `${String(early.getHours()).padStart(2, "0")}:${String(early.getMinutes()).padStart(2, "0")}`;
  await talk(es ? `Hecho. Te despierto a las ${time}, con el amanecer empezando a las ${from}.` : `Done. I'll wake you at ${time}, with the sunrise starting at ${from}.`);
  ears.resume(); return true;
}
desk.wakeVoice = wakeVoice;
$("wakeTime").onchange = () => { if (/^\d{2}:\d{2}$/.test($("wakeTime").value)) setWake($("wakeTime").value); };
$("wakeClear").onclick = () => { setWake(""); $("wakeTime").value = ""; };
$("testSunrise").onclick = () => {
  $("settings").hidden = true;
  desk.sunriseLeadMS = 60000; desk.wakeOverride = Date.now() + 60000; desk.wake.done = "";
  setTimeout(() => { desk.sunriseLeadMS = 15 * 60000; }, 15 * 60000);
};
renderWake();
// Keep the screen on (for the sunrise and the door) while the desk page is open.
async function keepScreenOn() { try { if (document.visibilityState === "visible") desk.wakeLock = await navigator.wakeLock?.request("screen"); } catch { /* not allowed */ } }
document.addEventListener("visibilitychange", () => void keepScreenOn());

// ---------- Modo vigilancia ----------
// Armed when you leave ("Jarvis, me voy" or the phone remote). Whoever comes in
// that isn't you gets a cheeky question and 20 s to type the code; otherwise a
// gentle alarm sounds and your phone hears about it. Your own face disarms it.
desk.guard = store.get("jarvis-guard", { on: false, armAt: 0, log: [] });
desk.guardGraceMS = 10000; desk.guardExitMS = 60000;
const guardArmed = () => desk.guard.on && Date.now() >= (desk.guard.armAt || 0);
function guardLog(text) { desk.guard.log.push({ at: Date.now(), text }); while (desk.guard.log.length > 20) desk.guard.log.shift(); }
function guardSend(extra = {}) {
  home?.send({ action: "guard-state", on: desk.guard.on, armAt: desk.guard.armAt || 0, alarm: !!desk.alarm, intruder: desk.intruder?.who || "", log: desk.guard.log.slice(-8), ...extra });
}
function saveGuard(extra) { store.set("jarvis-guard", desk.guard); renderGuard(); guardSend(extra); }
// Phone notifications (the remote installed on the home screen).
function notifyPhone(title, body, tag = "guard") {
  if (settings.key) void call("jarvis-call", { action: "notify", title, body, tag }, settings.key).catch(() => {});
}
desk.notifyPhone = notifyPhone;
// While armed, the screen becomes a pair of watching eyes.
function lookAround() {
  clearTimeout(desk.eyesTimer);
  if ($("guardScreen").hidden) return;
  const eyes = $("eyes"), focused = !!(desk.intruder || desk.alarm);
  const x = focused ? 0 : (Math.random() * 2 - 1) * 2.2, y = focused ? 0 : (Math.random() * 2 - 1) * 1.1;
  eyes.style.setProperty("--lx", x.toFixed(2) + "vw"); eyes.style.setProperty("--ly", y.toFixed(2) + "vw");
  if (Math.random() < 0.35) { eyes.classList.add("blink"); setTimeout(() => eyes.classList.remove("blink"), 140); }
  desk.eyesTimer = setTimeout(lookAround, focused ? 900 : 1200 + Math.random() * 2200);
}
function renderGuardScreen() {
  const show = guardArmed() || !!desk.intruder || !!desk.alarm, es = settings.lang === "es";
  const el = $("guardScreen"), was = !el.hidden;
  el.hidden = !show;
  el.classList.toggle("intruder", !!desk.intruder && !desk.alarm); el.classList.toggle("alarm", !!desk.alarm);
  $("guardTitle").textContent = desk.alarm ? (es ? "INTRUSO" : "INTRUDER") : desk.intruder ? (es ? "IDENTIFÍCATE" : "IDENTIFY YOURSELF") : (es ? "VIGILANDO" : "WATCHING");
  $("guardSub").textContent = desk.intruder ? `${desk.intruder.who} · ${es ? "pon el código" : "enter the code"}` : (es ? `${settings.name} no está` : `${settings.name} is out`);
  if (show && !was) lookAround();
}
desk.renderGuardScreen = renderGuardScreen;
function renderGuard() {
  renderGuardScreen();
  const armed = guardArmed(), pending = desk.guard.on && !armed;
  $("guardDot").classList.toggle("armed", armed); $("guardDot").classList.toggle("pending", pending);
  $("guardLabel").textContent = desk.alarm ? "ALARM" : armed ? "Guard on" : pending ? "Guard soon" : "Guard";
}
desk.renderGuard = renderGuard;
function setGuard(on, why = "") {
  if (on) desk.guard.leftAt = Date.now(); else if (desk.guard.on) desk.guard.backAt = Date.now();
  stopAlarm(); closeKeypad(); desk.intruder = null; clearTimeout(desk.intruderTimer);
  desk.guard.on = on; desk.guard.armAt = on ? Date.now() + desk.guardExitMS : 0;
  guardLog((on ? "Activada" : "Desactivada") + (why ? " · " + why : ""));
  saveGuard();
  clearTimeout(desk.guardArmTimer);
  if (on) desk.guardArmTimer = setTimeout(() => { renderGuard(); guardSend(); }, desk.guardExitMS + 50);
}
desk.setGuard = setGuard;
function guardLine(p, action) {
  const es = settings.lang === "es", name = settings.name;
  if (action !== "unknown" && p.role === "me") return es ? { text: `Bienvenido, ${name}. Pon el código, por si acaso no eres tú. Diez segundos.`, lang: "es" }
    : { text: `Welcome back, ${name}. Code, please, just in case you're not really you. Ten seconds.`, lang: "en" };
  if (action !== "unknown" && p.role === "mom") return { text: `Hi, Mum. ${name} is out, so I'm in charge. What do you need? Pop the code in within ten seconds, or things get very loud.`, lang: "en" };
  if (action !== "unknown" && p.role === "dad") return { text: `Hello, Dad. ${name} isn't here, and yes, the air conditioning is off. Code in ten seconds, please, or I start singing.`, lang: "en" };
  if (action !== "unknown") return es ? { text: `Hola, ${p.name}. ${name} no está. ¿Qué necesitas? Tienes diez segundos para poner el código.`, lang: "es" } : { text: `Hello, ${p.name}. ${name} is out. What do you need? You've got ten seconds to enter the code.`, lang: "en" };
  return es ? { text: `Vaya, hola. ${name} no está y a ti no te conozco. ¿Qué necesitas? Pon el código en diez segundos o monto un escándalo.`, lang: "es" }
    : { text: `Well, hello there. ${name} isn't home, and I don't recognise you. What do you need? Enter the code in ten seconds, or I raise the alarm.`, lang: "en" };
}
async function guardIntruder(p, action) {
  if (desk.intruder) return;
  desk.intruder = { who: action === "unknown" ? (settings.lang === "es" ? "Desconocido" : "Unknown") : p.name, at: Date.now() };
  guardLog("Ha entrado: " + desk.intruder.who); saveGuard({ alert: "entry" });
  home?.send({ action: "snap", reason: "entry", who: desk.intruder.who });   // the wall takes a photo
  notifyPhone(settings.lang === "es" ? "Alguien ha entrado" : "Someone came in", settings.lang === "es" ? `${desk.intruder.who} tiene 10 segundos para poner el código.` : `${desk.intruder.who} has 10 seconds to enter the code.`);
  openKeypad();
  const line = guardLine(p, action);
  voice.stop(); await talk(line.text, line.lang);
  if (!desk.intruder) return;   // the code was typed while talking
  desk.intruderEnds = Date.now() + desk.guardGraceMS;
  desk.intruderTimer = setTimeout(() => { if (desk.intruder) void soundAlarm(); }, desk.guardGraceMS);
}
desk.guardIntruder = guardIntruder;
async function soundAlarm() {
  if (desk.alarm) return;
  guardLog("Alarma" + (desk.intruder ? " · " + desk.intruder.who : ""));
  desk.alarm = true; document.body.classList.add("alarm"); saveGuard({ alert: "alarm" });
  home?.send({ action: "snap", reason: "alarm", who: desk.intruder?.who || "" });
  notifyPhone(settings.lang === "es" ? "¡ALARMA!" : "ALARM!", settings.lang === "es" ? `${desk.intruder?.who || "Alguien"} no ha puesto el código.` : `${desk.intruder?.who || "Someone"} didn't enter the code.`);
  // Like the butler of the mansion: a real phone call (when Twilio is set up).
  if (settings.key) {
    const who = desk.intruder?.who && desk.intruder.who !== "Unknown" && desk.intruder.who !== "Desconocido" ? desk.intruder.who : "alguien";
    void call("jarvis-call", { action: "alert", title: "Alarma: ha entrado " + who, say: `${settings.name}, soy Jarvis. Ha entrado ${who} en su habitación y no ha puesto el código. La alarma está sonando. Le sugiero volver cuanto antes.` }, settings.key).catch(() => {});
  }
  const es = settings.lang === "es";
  $("intruderBanner").hidden = false;
  // Over the top on purpose: a sweeping siren, red pulsing screen and a dramatic butler.
  const siren = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; desk.chimeCtx ||= new Ctx();
      const ctx = desk.chimeCtx, t0 = ctx.currentTime;
      for (const [type, gain, detune] of [["sawtooth", 0.16, 0], ["square", 0.07, 7]]) {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = type; o.detune.value = detune * 100;
        o.frequency.setValueAtTime(600, t0); o.frequency.linearRampToValueAtTime(1500, t0 + 0.9); o.frequency.linearRampToValueAtTime(600, t0 + 1.8);
        o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.05); g.gain.setValueAtTime(gain, t0 + 1.75); g.gain.linearRampToValueAtTime(0, t0 + 1.8);
        o.start(t0); o.stop(t0 + 1.82);
      }
    } catch { /* no audio */ }
  };
  siren(); desk.alarmTimer = setInterval(siren, 1800);
  desk.alarmStop = setTimeout(stopAlarm, 60000);
  const lines = es
    ? [`¡Alerta de intruso! ¡Alerta de intruso! Protocolo de bloqueo activado.`, `${settings.name} ya ha sido avisado. La policía todavía no, pero no me tientes.`, `Repito: esto no es un simulacro. Bueno, un poco sí.`]
    : [`Intruder alert! Intruder alert! Lockdown protocol engaged.`, `${settings.name} has been notified. The police have not. Yet. Don't tempt me.`, `I repeat: this is not a drill. Well, slightly a drill.`];
  for (const line of lines) { if (!desk.alarm) break; await talk(line, es ? "es" : "en"); }
}
desk.soundAlarm = soundAlarm;
function stopAlarm() {
  clearInterval(desk.alarmTimer); clearTimeout(desk.alarmStop);
  const was = desk.alarm; desk.alarm = false; document.body.classList.remove("alarm"); $("intruderBanner").hidden = true;
  if (was) { renderGuard(); guardSend(); }
}
desk.stopAlarm = stopAlarm;
// Keypad on the desk screen (mouse or keyboard digits).
let typed = "", wrong = 0;
function openKeypad() {
  typed = ""; wrong = 0; drawKeypad(); $("keypad").hidden = false;
  clearInterval(desk.keypadClock);
  desk.keypadClock = setInterval(() => {
    const left = desk.intruderEnds ? Math.max(0, Math.ceil((desk.intruderEnds - Date.now()) / 1000)) : null;
    $("keypadTime").textContent = desk.alarm ? (settings.lang === "es" ? "Alarma activada" : "Alarm on") : left === null ? "" : `${left} s`;
  }, 250);
}
function closeKeypad() { $("keypad").hidden = true; clearInterval(desk.keypadClock); typed = ""; }
function drawKeypad() { [...$("keypadDots").children].forEach((d, i) => d.classList.toggle("on", i < typed.length)); }
async function keyIn(k) {
  if ($("keypad").hidden) return;
  if (k === "clear") typed = ""; else if (k === "back") typed = typed.slice(0, -1); else if (/^\d$/.test(k) && typed.length < 4) typed += k;
  drawKeypad();
  if (typed.length < 4) return;
  const ok = /^\d{4}$/.test(settings.guardPin || "") && typed === settings.guardPin;
  typed = ""; drawKeypad();
  if (ok) {
    const who = desk.intruder?.who || "";
    setGuard(false, "código" + (who ? " · " + who : ""));
    const since = desk.guard.leftAt || 0, summary = since ? whoCameIn(since) : "";
    voice.stop(); await talk((settings.lang === "es" ? "Código correcto. Todo tuyo. " : "Code accepted. Carry on. ") + (summary ? (settings.lang === "es" ? "Mientras no estabas: " : "While you were out: ") + summary : "")); ears.resume();
    return;
  }
  wrong++; $("keypadDots").classList.remove("bad"); void $("keypadDots").offsetWidth; $("keypadDots").classList.add("bad");
  if (wrong >= 3) void soundAlarm();
}
desk.keyIn = keyIn;
for (const b of document.querySelectorAll("#keypad [data-key]")) b.onclick = () => void keyIn(b.dataset.key);
document.addEventListener("keydown", (e) => {
  if ($("keypad").hidden) return;
  if (/^\d$/.test(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); void keyIn(e.key); }
  if (e.key === "Backspace") { e.preventDefault(); void keyIn("back"); }
}, true);
// Voice: arm when leaving; while not yet armed, "me quedo" cancels. Never disarms by voice once armed.
const LEAVING = /\b(me voy|me marcho|me piro|me las piro|me pires|modo vigilancia|activa (la )?(vigilancia|alarma)|im leaving|i am leaving|im off|guard mode|watch the room|arm the alarm)\b/;
const STAYING = /\b(me quedo|cancela( la)? (vigilancia|alarma)|no me voy|im staying|cancel guard)\b/;
async function guardVoice(raw) {
  const text = normalize(raw).replace(/'/g, ""), es = settings.lang === "es";
  if (LEAVING.test(text) && !desk.guard.on) {
    setGuard(true, "voz");
    const noPin = !/^\d{4}$/.test(settings.guardPin || "");
    await talk(es ? `Vale, ${settings.name}. Vigilo la habitación en un minuto. Que vaya bien.${noPin ? " Por cierto, no hay código puesto: solo tu cara o tu móvil la desactivan." : ""}`
      : `Right, ${settings.name}. Guard mode in one minute. Off you go.${noPin ? " By the way, there's no code set, so only your face or your phone can switch it off." : ""}`);
    ears.resume(); return true;
  }
  if (STAYING.test(text) && desk.guard.on && !guardArmed()) {
    setGuard(false, "cancelada");
    await talk(es ? "Cancelado. Me quedo tranquilo." : "Cancelled. Standing down."); ears.resume(); return true;
  }
  return false;
}
desk.guardVoice = guardVoice;
renderGuard();
if (desk.guard.on && !guardArmed()) desk.guardArmTimer = setTimeout(() => { renderGuard(); guardSend(); }, desk.guard.armAt - Date.now() + 50);

// ---------- La puerta (eventos del móvil) ----------
async function onHome(event) {
  const at = +event.at || Date.now();
  if (event.action === "wall") { desk.wallSeen = at; render(); return; }
  if (event.action === "frame") { onFrame(event); return; }
  // A memory saved elsewhere, or a reminder that came due.
  if (event.action === "remember" && event.fact) { addMemory(String(event.fact).slice(0, 200)); return; }
  if (event.action === "remind" && event.text) {
    wakeUp(); orb.flash("alert"); chime("alert");
    const text = String(event.text).slice(0, 400);
    setTimeout(() => void loadReminders(), 1500);
    if (desk.voice.speaking || ears.mode === "direct") { toast(text); return; }
    await talk(text, event.lang === "es" ? "es" : event.lang === "en" ? "en" : settings.lang); ears.resume(); return;
  }
  // Something Jarvis is watching (email, Teams, Instagram): important things are said out loud.
  if (event.action === "feed" && event.item) {
    const f = event.item;
    desk.feed = [f, ...(desk.feed || [])].slice(0, 20);
    if (f.level === "info" || desk.sleep || desk.guard.on) return;
    wakeUp(); orb.flash(f.level === "call" ? "alert" : "arrival"); chime(f.level === "call" ? "alert" : undefined);
    const line = String(f.say || f.title).slice(0, 400);
    if (desk.voice.speaking || ears.mode === "direct") { toast(line); return; }
    await talk(line, "es"); ears.resume(); return;
  }
  // From the phone remote (/mando).
  if (event.action === "guard") { if (!!event.on !== desk.guard.on) setGuard(!!event.on, "móvil"); else guardSend(); return; }
  if (event.action === "guard-ask") { guardSend(); return; }
  // The wall phone is listening for "Jarvis…" (it hears you better than this computer).
  if (event.action === "ears") {
    // The wall can't transcribe right now: this computer listens again.
    if (event.on === false) {
      if (wallListening()) { desk.wallEarsAt = 0; if (desk.started && settings.wake) ears.resume(); log("la pared no puede escuchar: escucha el ordenador"); render(); }
      return;
    }
    const was = wallListening(); desk.wallEarsAt = Date.now();
    // The wall phone is the microphone now: switch this computer's off.
    if (!was && desk.started && !ears.mode?.match?.(/direct|follow/)) { ears.pause(); log("micro del ordenador apagado: escucha la pared"); render(); }
    return;
  }
  if (event.action === "ask-wake") { voice.stop(); await talk(pick(t().yes)); ears.pause(); ears.resume(); return; }
  // Your phone as a microphone: it sends what you said, Jarvis answers out loud here and on the phone.
  if (event.action === "ask" && event.text) {
    const text = String(event.text).replace(/\s+/g, " ").trim().slice(0, 500);
    if (!text) return;
    voice.stop(); ears.pause(); desk.lastSaid = "";
    await respond(text);
    if (event.from === "wall") { ears.pause(); ears.resume(); }   // the wall does the follow-up listening
    home?.send({ action: "reply", id: event.id || 0, text: desk.lastSaid || "" });
    return;
  }
  // Silenced from the phone: that entry is dealt with; stay armed for the next one.
  if (event.action === "guard-silence") { stopAlarm(); desk.intruder = null; clearTimeout(desk.intruderTimer); closeKeypad(); renderGuard(); guardSend(); return; }
  if (event.action === "arrival" || event.action === "test" || event.action === "unknown") {
    desk.wallSeen = Date.now();
    const p = event.person || { name: settings.lang === "es" ? "Desconocido" : "Unknown", role: "unknown" };
    // Guard mode first: EVERYONE who comes in (you too: faces can be mistaken) must type the code.
    if (event.action !== "test" && desk.guard.on) {
      if (!guardArmed() && p.role === "me" && event.action !== "unknown") return;   // you, on your way out
      if (guardArmed()) {
        desk.arrivals.push({ name: p.name, role: event.action === "unknown" ? "unknown" : p.role, at: Date.now() });
        store.set("jarvis-arrivals", desk.arrivals); render(); orb.flash("alert");
        await guardIntruder(p, event.action); return;
      }
    }
    if (event.action !== "test") {
      desk.arrivals.push({ name: p.name, role: event.action === "unknown" ? "unknown" : p.role, at: Date.now() });
      while (desk.arrivals.length > 50) desk.arrivals.shift();
      store.set("jarvis-arrivals", desk.arrivals);
    }
    render(); wakeUp();
    orb.flash(event.action === "unknown" ? "alert" : "arrival");
    if (!quietNow()) chime(event.action === "unknown" ? "alert" : "arrival");
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
  // You: a briefing from Claude the first time today; afterwards an instant hello.
  const today = new Date().toDateString(), first = store.get("jarvis-briefing", "") !== today;
  if (!first) return { text: pick([greeting(settings.lang, settings.name), settings.lang === "es" ? `Bienvenido de nuevo, ${settings.name}.` : `Welcome back, ${settings.name}.`]), lang: settings.lang };
  if (settings.key) {
    setState("thinking");
    const hm = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    const prompt = `[Event] ${settings.name} just walked into the room at ${hm}, for the first time today. Welcome him with a short briefing: greeting, the weather, and anything you remember that matters today. Two or three sentences.`;
    const reply = await think(prompt, { remember: false, event: true });
    store.set("jarvis-briefing", today);
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
  if (e.data.agent) void onAgent(e.data.agent);
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

// ---------- Modo agente (tareas de varios pasos en el navegador) ----------
function renderAgent() {
  const a = desk.agent;
  $("agentCard").hidden = !a; if (!a) return;
  $("agentCard").classList.toggle("done", !!a.done);
  $("agentTask").textContent = a.task || "";
  $("agentSay").textContent = a.say || "";
  $("agentStep").textContent = a.done ? (settings.lang === "es" ? "terminado" : "finished") : a.step ? (settings.lang === "es" ? `paso ${a.step}` : `step ${a.step}`) : "";
}
async function onAgent(m) {
  wakeUp();
  if (m.kind === "start") { desk.agent = { task: m.task, step: 0, say: settings.lang === "es" ? "Empezando…" : "Starting…" }; renderAgent(); return; }
  if (!desk.agent) desk.agent = { task: m.task || "", step: 0 };
  if (m.kind === "step") { Object.assign(desk.agent, { step: m.step, say: m.say }); renderAgent(); return; }
  if (m.kind === "ask") {
    // Speak the question, then the next thing heard is the answer.
    desk.ask = m.id; desk.agent.say = m.question; renderAgent();
    orb.flash("arrival"); chime();
    voice.stop(); await talk(m.question); desk.ask = m.id; ears.direct();
    return;
  }
  if (m.kind === "done") {
    Object.assign(desk.agent, { done: true, say: m.stopped ? "" : m.summary }); renderAgent();
    setTimeout(() => { if (desk.agent?.done) { desk.agent = null; renderAgent(); } }, 90000);
    if (m.summary && !m.stopped) { if (desk.voice.speaking || ears.mode === "direct") toast(m.summary); else { await talk(m.summary); ears.resume(); } }
  }
}
desk.onAgent = onAgent;
let playing = true;
// Music pauses while Jarvis listens and comes back afterwards (only if we paused it).
function duck(state) {
  try {
    if (state === "listening" && desk.music && playing && desk.extension && !desk.ducked) { desk.ducked = true; void extension("pause"); }
    else if (state === "idle" && desk.ducked) { desk.ducked = false; void extension("resume"); }
  } catch { /* during start-up */ }
}
async function media(action) {
  desk.ducked = false;   // an explicit command wins over the auto-resume
  if (action === "toggle") action = playing ? "pause" : "resume";
  if (action === "pause") playing = false; if (action === "resume") playing = true;
  $("mPlayIcon").innerHTML = ICONS[playing ? "pause" : "play"];
  const ok = await extension(action);
  toast(ok ? t().media[action] || action : (settings.lang === "es" ? "Instala la extensión de Jarvis en este ordenador" : "Install the Jarvis extension on this computer"));
  return ok;
}
desk.media = media;
$("mPrev").onclick = () => media("previous"); $("mPlay").onclick = () => media("toggle"); $("mNext").onclick = () => media("next");

// ---------- Arranque ----------
let home = null;
const wallListening = () => Date.now() - (desk.wallEarsAt || 0) < 150000;
desk.wallListening = wallListening;
// If the wall stops listening, this computer's microphone takes over again.
setInterval(() => { if (desk.started && settings.wake && desk.wallEarsAt && !wallListening() && ears.paused && desk.state === "idle") { desk.wallEarsAt = 0; ears.resume(); render(); } }, 30000);
// The private channel opens as soon as the page loads (before waking Jarvis),
// so the wall camera and your phone remote always get an answer.
function connectDesk() {
  home?.stop(); home = null;
  if (settings.key) home = connectHome({ key: settings.key, onEvent: (e) => void onHome(e), onStatus: (s) => { log("canal: " + s); if (s === "online") setTimeout(guardSend, 300); } });
}
desk.connectDesk = connectDesk;
async function start() {
  if (desk.started) return;
  desk.started = true; $("wake").hidden = true; document.body.classList.add("live");
  voice.unlock();
  setState("thinking"); say(t().waking);
  await ears.openMeter();
  if (!home) connectDesk();
  void restoreMemory(); void loadReminders(); void keepScreenOn();
  setTimeout(guardSend, 2500);
  void loadWeather(); setInterval(loadWeather, 20 * 60000);
  try { if (navigator.wakeLock) await navigator.wakeLock.request("screen"); } catch {}
  if (!settings.key) { say(t().needKey); setState("idle"); ears.background(); return; }
  await talk(t().online(settings.name)); ears.resume();
  // Warm the voice cache so greetings play instantly later (fixed lines only).
  const lines = [...FAMILY.mom, ...FAMILY.dad, settings.lang === "es" ? `Bienvenido de nuevo, ${settings.name}.` : `Welcome back, ${settings.name}.`, t().stranger];
  for (const line of lines) { await voice.prefetch(line, FAMILY.mom.includes(line) || FAMILY.dad.includes(line) ? "en" : settings.lang); }
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
  if (e.code === "Space" && desk.sunrise) { e.preventDefault(); $("sunriseStop").click(); return; }
  if (e.code === "Space") { e.preventDefault(); if (!desk.started) return void start(); if (voice.speaking) { voice.stop(); ears.resume(); } else ears.direct(); }
  if (e.code === "Escape") { voice.stop(); ears.resume(); }
});
$("typeForm").onsubmit = (e) => { e.preventDefault(); const v = $("typeInput").value.trim(); $("typeInput").value = ""; if (v) void respond(v); };

// ---------- Ajustes ----------
function openSettings() {
  for (const id of ["name", "lang", "hear", "city"]) $(id).value = settings[id];
  $("guardPin").value = settings.guardPin || ""; $("wakeTime").value = desk.wake.time || "";
  fillVoices();
  $("voiceKey").value = settings.key; $("wakeOn").checked = settings.wake; $("greetOn").checked = settings.greet;
  $("quietFrom").value = settings.quietFrom; $("quietTo").value = settings.quietTo;
  $("memoryList").replaceChildren(...desk.memory.map((m, i) => {
    const li = document.createElement("li"); li.textContent = m;
    const x = document.createElement("button"); x.textContent = "✕"; x.title = "Olvidar";
    x.onclick = () => { desk.memory.splice(i, 1); store.set("jarvis-memory", desk.memory); openSettings(); render(); };
    li.append(x); return li;
  }));
  $("micLog").textContent = desk.log.slice(-16).join("\n");
  $("settings").hidden = false;
  navigator.mediaDevices?.enumerateDevices?.().then((all) => {
    const mic = all.find((d) => d.kind === "audioinput" && d.deviceId === "default") || all.find((d) => d.kind === "audioinput");
    $("micName").textContent = mic?.label ? "Usando: " + mic.label.replace(/^Default - |^Predeterminado - /, "") : "No encuentro ningún micrófono.";
  }).catch(() => {});
  startPeek();
}
// ---------- Ver la cámara de la pared ----------
// While settings are open, ask the wall phone for snapshots every few seconds.
function startPeek() {
  clearInterval(desk.peekTimer); desk.lastFrame = 0;
  $("peekInfo").textContent = "Conectando con el móvil de la pared…";
  const ask = () => {
    if ($("settings").hidden) { clearInterval(desk.peekTimer); return; }
    if (!home?.send({ action: "peek" })) $("peekInfo").textContent = settings.key ? "Sin conexión. Pulsa para despertar a Jarvis primero." : "Falta la clave de Jarvis.";
    else if (Date.now() - desk.lastFrame > 4000) { $("peekImg").hidden = !desk.lastFrame; if (!desk.lastFrame || Date.now() - desk.lastFrame > 6000) $("peekInfo").textContent = "Sin imagen: abre la pared en el móvil, pulsa «Empezar a vigilar» y usa la misma clave."; }
  };
  ask(); desk.peekTimer = setInterval(ask, 3000);
}
function onFrame(e) {
  if ($("settings").hidden || !/^data:image\/jpeg;base64,/.test(String(e.img || ""))) return;
  desk.lastFrame = Date.now();
  $("peekImg").src = e.img; $("peekImg").hidden = false;
  const faces = Array.isArray(e.faces) ? e.faces : [];
  $("peekInfo").textContent = `En directo · cámara ${e.facing === "environment" ? "trasera" : "delantera"} · ` + (faces.length ? faces.join(", ") : "nadie");
  $("camFront").classList.toggle("on", e.facing === "user"); $("camBack").classList.toggle("on", e.facing === "environment");
}
desk.onFrame = onFrame;
function switchWallCamera(facing) {
  if (home?.send({ action: "camera", facing })) $("peekInfo").textContent = facing === "environment" ? "Cambiando a la cámara trasera…" : "Cambiando a la cámara delantera…";
}
$("camFront").onclick = () => switchWallCamera("user");
$("camBack").onclick = () => switchWallCamera("environment");
$("openSettings").onclick = openSettings;
$("closeSettings").onclick = () => { $("settings").hidden = true; };
const bind = (id, key, conv = (v) => v) => { $(id).onchange = () => { settings[key] = conv($(id).type === "checkbox" ? $(id).checked : $(id).value); settings.save(); render(); }; };
bind("name", "name", (v) => v.trim() || "Crew"); bind("lang", "lang"); $("lang").addEventListener("change", () => setTimeout(fillVoices, 0)); bind("hear", "hear"); bind("greetOn", "greet");
bind("quietFrom", "quietFrom", Number); bind("quietTo", "quietTo", Number);
$("guardPin").onchange = () => {
  const v = $("guardPin").value.replace(/\D/g, "").slice(0, 4); $("guardPin").value = v;
  if (v.length !== 4) return;
  settings.guardPin = v; settings.save();
  if (settings.key) void call("jarvis-call", { action: "pin", pin: v }, settings.key).catch(() => {});
};
$("voiceKey").onchange = () => { settings.key = $("voiceKey").value.trim(); settings.save(); connectDesk(); };
$("wakeOn").onchange = () => { settings.wake = $("wakeOn").checked; settings.save(); if (settings.wake) ears.resume(); else ears.pause(); render(); };
$("city").onchange = async () => {
  const name = $("city").value.trim(); if (!name) return;
  try {
    const r = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`)).json();
    const place = r.results?.[0]; if (!place) { toast("No encuentro esa ciudad"); return; }
    Object.assign(settings, { city: place.name, lat: place.latitude, lon: place.longitude }); settings.save(); $("city").value = place.name; void loadWeather();
  } catch { toast("Sin conexión"); }
};
// The computer's voice: a list of what this Mac/Chrome offers, best first.
function fillVoices() {
  const lang = settings.lang === "es" ? "es" : "en", list = voice.voicesFor(lang);
  const sel = $("localVoice"); if (!sel) return;
  sel.replaceChildren(...list.map((v, i) => Object.assign(document.createElement("option"), { value: v.name, textContent: v.name + (i === 0 ? " (recomendada)" : "") })));
  if (!list.length) sel.append(Object.assign(document.createElement("option"), { value: "", textContent: "Ninguna disponible" }));
  if (settings.localVoice && list.some((v) => v.name === settings.localVoice)) sel.value = settings.localVoice;
  $("voiceMode").value = settings.voiceMode === "local" ? "local" : "auto";
}
try { window.speechSynthesis?.addEventListener?.("voiceschanged", fillVoices); } catch {}
desk.fillVoices = fillVoices;
$("voiceMode").onchange = () => { settings.voiceMode = $("voiceMode").value; settings.save(); };
$("localVoice").onchange = () => { settings.localVoice = $("localVoice").value; settings.save(); };
$("testLocal").onclick = async () => { const keep = settings.voiceMode; settings.voiceMode = "local"; await talk(t().online(settings.name)); settings.voiceMode = keep; };
$("testVoice").onclick = async () => { voice.unlock(); voice.forceCloud = true; await talk(t().online(settings.name)); voice.forceCloud = false; $("voiceInfo").textContent = voice.error ? voice.error + " Mientras tanto hablo con la voz del ordenador." : "Voz funcionando."; ears.resume(); };
$("showType").onchange = () => { $("typeForm").hidden = !$("showType").checked; };
$("toWall").onclick = (e) => { e.preventDefault(); chooseRole("wall"); };
render();
connectDesk();
renderLists();
