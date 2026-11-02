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
  $("earDot").classList.toggle("on", settings.wake && !ears.blocked && desk.started);
  // Ambient: after a few quiet minutes the side panels step back.
  document.body.classList.toggle("ambient", desk.started && Date.now() - desk.activeAt > 180000);
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
  desk.lastSaid = text;
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
  // Answer to a question from the browser agent ("Shall I hand it in?").
  if (desk.ask) { const id = desk.ask; desk.ask = 0; await extension("agent-answer", { ask: id, text: raw }); setState("idle"); ears.resume(); return; }
  if (await guardVoice(raw)) return;
  if (desk.agent && /^\s*(stop|para|parar|cancela|cancel|d[ée]jalo|basta)\b/i.test(raw)) {
    await extension("agent-stop"); desk.agent = null; renderAgent();
    await talk(settings.lang === "es" ? "Vale, lo dejo." : "Alright, I've stopped."); ears.resume(); return;
  }
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
    const off = -new Date().getTimezoneOffset(), tz = `UTC${off < 0 ? "-" : "+"}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
    const response = await call("jarvis-brain", { messages: history, lang: settings.lang, name: settings.name, now: `${now} (${tz}, ${new Date().getFullYear()})`, memory: desk.memory, context, hear: settings.hear }, settings.key);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(t().thinkErr[data.error] || t().thinkDown);
    const reply = data.refused || !data.reply ? t().refused : data.reply;
    history.push({ role: "assistant", content: reply });
    if (remember && Array.isArray(data.remember)) { for (const fact of data.remember) addMemory(fact); }
    if ((data.actions || []).some((a) => String(a).startsWith("reminder:"))) void loadReminders();
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

// New computer: bring back what Jarvis remembers from Supabase.
async function restoreMemory() {
  if (desk.memory.length || !settings.key) return;
  try {
    const response = await call("jarvis-call", { action: "state" }, settings.key);
    const data = await response.json().catch(() => ({}));
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

// ---------- Modo vigilancia ----------
// Armed when you leave ("Jarvis, me voy" or the phone remote). Whoever comes in
// that isn't you gets a cheeky question and 20 s to type the code; otherwise a
// gentle alarm sounds and your phone hears about it. Your own face disarms it.
desk.guard = store.get("jarvis-guard", { on: false, armAt: 0, log: [] });
desk.guardGraceMS = 20000; desk.guardExitMS = 60000;
const guardArmed = () => desk.guard.on && Date.now() >= (desk.guard.armAt || 0);
function guardLog(text) { desk.guard.log.push({ at: Date.now(), text }); while (desk.guard.log.length > 20) desk.guard.log.shift(); }
function guardSend(extra = {}) {
  home?.send({ action: "guard-state", on: desk.guard.on, armAt: desk.guard.armAt || 0, alarm: !!desk.alarm, intruder: desk.intruder?.who || "", log: desk.guard.log.slice(-8), ...extra });
}
function saveGuard(extra) { store.set("jarvis-guard", desk.guard); renderGuard(); guardSend(extra); }
function renderGuard() {
  const armed = guardArmed(), pending = desk.guard.on && !armed;
  $("guardDot").classList.toggle("armed", armed); $("guardDot").classList.toggle("pending", pending);
  $("guardLabel").textContent = desk.alarm ? "ALARM" : armed ? "Guard on" : pending ? "Guard soon" : "Guard";
}
desk.renderGuard = renderGuard;
function setGuard(on, why = "") {
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
  if (action !== "unknown" && p.role === "mom") return { text: `Hi, Mum. ${name} is out, so I'm in charge. What do you need? Pop the code in within twenty seconds, or things get loud.`, lang: "en" };
  if (action !== "unknown" && p.role === "dad") return { text: `Hello, Dad. ${name} isn't here, and yes, the air conditioning is off. Code in twenty seconds, please, or I start singing.`, lang: "en" };
  if (action !== "unknown") return es ? { text: `Hola, ${p.name}. ${name} no está. ¿Qué necesitas? Tienes veinte segundos para poner el código.`, lang: "es" } : { text: `Hello, ${p.name}. ${name} is out. What do you need? You've got twenty seconds to enter the code.`, lang: "en" };
  return es ? { text: `Vaya, hola. ${name} no está y a ti no te conozco. ¿Qué necesitas? Pon el código en veinte segundos o monto un escándalo.`, lang: "es" }
    : { text: `Well, hello there. ${name} isn't home, and I don't recognise you. What do you need? Enter the code in twenty seconds, or I raise the alarm.`, lang: "en" };
}
async function guardIntruder(p, action) {
  if (desk.intruder) return;
  desk.intruder = { who: action === "unknown" ? (settings.lang === "es" ? "Desconocido" : "Unknown") : p.name, at: Date.now() };
  guardLog("Ha entrado: " + desk.intruder.who); saveGuard({ alert: "entry" });
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
  const es = settings.lang === "es";
  await talk(es ? `Sin código. Alarma activada. ${settings.name} ya está avisado.` : `No code. Alarm on. ${settings.name} has been told.`, es ? "es" : "en");
  if (!desk.alarm) return;
  // A soft two-tone siren: noticeable, not ear-splitting. Stops by itself after a minute.
  const beep = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext; desk.chimeCtx ||= new Ctx();
      const ctx = desk.chimeCtx, t0 = ctx.currentTime;
      [880, 660].forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "triangle"; o.frequency.value = f;
        o.connect(g); g.connect(ctx.destination); const t = t0 + i * 0.4;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.03); g.gain.linearRampToValueAtTime(0, t + 0.38);
        o.start(t); o.stop(t + 0.4);
      });
    } catch { /* no audio */ }
  };
  beep(); desk.alarmTimer = setInterval(beep, 900);
  desk.alarmStop = setTimeout(stopAlarm, 60000);
}
desk.soundAlarm = soundAlarm;
function stopAlarm() {
  clearInterval(desk.alarmTimer); clearTimeout(desk.alarmStop);
  const was = desk.alarm; desk.alarm = false; document.body.classList.remove("alarm");
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
    voice.stop(); await talk(settings.lang === "es" ? "Código correcto. Todo tuyo." : "Code accepted. Carry on."); ears.resume();
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
    await talk(text, event.lang === "es" ? "es" : event.lang === "en" ? "en" : settings.lang); ears.resume(true); return;
  }
  // From the phone remote (/mando).
  if (event.action === "guard") { if (!!event.on !== desk.guard.on) setGuard(!!event.on, "móvil"); else guardSend(); return; }
  if (event.action === "guard-ask") { guardSend(); return; }
  // Your phone as a microphone: it sends what you said, Jarvis answers out loud here and on the phone.
  if (event.action === "ask" && event.text) {
    const text = String(event.text).replace(/\s+/g, " ").trim().slice(0, 500);
    if (!text) return;
    voice.stop(); ears.pause(); desk.lastSaid = "";
    await respond(text);
    home?.send({ action: "reply", id: event.id || 0, text: desk.lastSaid || "" });
    return;
  }
  if (event.action === "guard-silence") { stopAlarm(); return; }
  if (event.action === "arrival" || event.action === "test" || event.action === "unknown") {
    desk.wallSeen = Date.now();
    const p = event.person || { name: settings.lang === "es" ? "Desconocido" : "Unknown", role: "unknown" };
    // Guard mode first: you disarm it by walking in; anyone else gets the code question.
    if (event.action !== "test" && desk.guard.on) {
      if (p.role === "me" && event.action !== "unknown") {
        if (guardArmed()) {
          setGuard(false, "has vuelto");
          desk.arrivals.push({ name: p.name, role: "me", at: Date.now() }); store.set("jarvis-arrivals", desk.arrivals); render();
          await talk(settings.lang === "es" ? `Bienvenido, ${settings.name}. Vigilancia desactivada. Todo en orden.` : `Welcome back, ${settings.name}. Guard is off. All quiet while you were out.`);
          ears.resume(true);
        }
        return;   // still inside the exit minute: you're on your way out
      }
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
    if (m.summary && !m.stopped) { if (desk.voice.speaking || ears.mode === "direct") toast(m.summary); else { await talk(m.summary); ears.resume(true); } }
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
  void restoreMemory(); void loadReminders();
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
  if (e.code === "Space") { e.preventDefault(); if (!desk.started) return void start(); if (voice.speaking) { voice.stop(); ears.resume(); } else ears.direct(); }
  if (e.code === "Escape") { voice.stop(); ears.resume(); }
});
$("typeForm").onsubmit = (e) => { e.preventDefault(); const v = $("typeInput").value.trim(); $("typeInput").value = ""; if (v) void respond(v); };

// ---------- Ajustes ----------
function openSettings() {
  for (const id of ["name", "lang", "hear", "city"]) $(id).value = settings[id];
  $("guardPin").value = settings.guardPin || "";
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
bind("name", "name", (v) => v.trim() || "Crew"); bind("lang", "lang"); bind("hear", "hear"); bind("greetOn", "greet");
bind("quietFrom", "quietFrom", Number); bind("quietTo", "quietTo", Number);
$("guardPin").onchange = () => { const v = $("guardPin").value.replace(/\D/g, "").slice(0, 4); $("guardPin").value = v; settings.guardPin = v.length === 4 ? v : ""; settings.save(); };
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
$("testVoice").onclick = async () => { voice.unlock(); await talk(t().online(settings.name)); $("voiceInfo").textContent = voice.error || "Voz funcionando."; ears.resume(); };
$("showType").onchange = () => { $("typeForm").hidden = !$("showType").checked; };
$("toWall").onclick = (e) => { e.preventDefault(); chooseRole("wall"); };
render();
connectDesk();
