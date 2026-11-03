// Jarvis · Mando: your own phone. Arms guard mode when you leave, shows who
// came in, and alerts you (sound + vibration while the page is open).
import { $, store, loadSettings, connectHome, call } from "./jarvis/common.js";

const settings = loadSettings();
const mando = window.mando = { state: null, lastSeen: 0, home: null, settings, alerts: 0 };
store.set("jarvis-role", "remote");

function connect() {
  mando.home?.stop();
  if (!settings.key) { $("setup").hidden = false; return; }
  $("setup").hidden = true;
  mando.home = connectHome({
    key: settings.key,
    onEvent: (e) => { if (e.action === "guard-state") onState(e); if (e.action === "ring") ring(); if (e.action === "snap") setTimeout(loadPhotos, 4000); if (e.action === "feed" && e.item) addFeed(e.item, true); },
    onStatus: (s) => { $("link").textContent = s === "online" ? "Conectado" : "Sin conexión"; $("link").classList.toggle("on", s === "online"); if (s === "online") ask(); },
  });
}
const ask = () => mando.home?.send({ action: "guard-ask" });
setInterval(() => { ask(); render(); }, 10000);
setInterval(render, 1000);

function onState(e) {
  mando.state = e; mando.lastSeen = Date.now();
  // The desk marks only the moment something happens (entry, alarm): sound and vibrate then.
  if (e.alert) { mando.alerts++; beep(e.alert === "alarm"); }
  render();
}
mando.onState = onState;

function render() {
  const s = mando.state, now = Date.now();
  const stale = !s || now - mando.lastSeen > 35000;
  let state = "unknown", title = "—", sub = mando.home && now - mando.started > 6000
    ? "El ordenador no contesta: recarga Jarvis en el Mac (⟳) y comprueba que la clave es la misma"
    : "Buscando el ordenador…";
  if (!stale) {
    if (s.alarm) { state = "alarm"; title = "¡Alarma!"; sub = s.intruder ? `Ha entrado: ${s.intruder}` : "Alguien ha entrado"; }
    else if (s.on && now < s.armAt) { state = "pending"; title = "Activando…"; sub = `En ${Math.ceil((s.armAt - now) / 1000)} s`; }
    else if (s.on) { state = "armed"; title = "Vigilando"; sub = s.intruder ? `Ha entrado: ${s.intruder}` : "Tu cuarto está vigilado"; }
    else { state = "off"; title = "Desactivada"; sub = "Estás en casa"; }
  }
  document.body.dataset.state = state;
  $("stateTitle").textContent = title; $("stateSub").textContent = sub;
  $("leave").disabled = stale || !!s?.on; $("home").disabled = stale || !s?.on;
  const showAlert = !stale && s.on && !!s.intruder;
  $("alert").hidden = !showAlert;
  if (showAlert) {
    $("alertTitle").textContent = s.alarm ? "Alarma sonando" : "Alguien ha entrado";
    $("alertSub").textContent = s.alarm ? `${s.intruder} no ha puesto el código.` : `${s.intruder} tiene 10 segundos para poner el código.`;
    $("silence").hidden = !s.alarm;
  }
  const log = (s?.log || []).slice().reverse();
  $("log").replaceChildren(...(log.length ? log.map((l) => {
    const li = document.createElement("li"), t = document.createElement("span"), w = document.createElement("time");
    t.textContent = l.text; w.textContent = new Date(l.at).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    li.append(t, w); return li;
  }) : [Object.assign(document.createElement("li"), { className: "muted", textContent: "Nada todavía." })]));
}
mando.render = render;

let audio = null;
function beep(loud) {
  try { navigator.vibrate?.(loud ? [400, 200, 400, 200, 400] : [200, 100, 200]); } catch {}
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const t0 = audio.currentTime;
    (loud ? [880, 660, 880, 660] : [660, 990]).forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = f; o.connect(g); g.connect(audio.destination);
      const t = t0 + i * 0.25; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.15, t + 0.02); g.gain.linearRampToValueAtTime(0, t + 0.22);
      o.start(t); o.stop(t + 0.25);
    });
  } catch { /* sound needs a first tap on iPhone */ }
}
const unlock = () => { try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume?.(); } catch {} };
document.addEventListener("pointerdown", unlock, { once: true });

$("leave").onclick = () => { mando.home?.send({ action: "guard", on: true }); $("stateSub").textContent = "Enviando…"; };
$("home").onclick = () => { mando.home?.send({ action: "guard", on: false }); $("stateSub").textContent = "Enviando…"; };
$("silence").onclick = () => mando.home?.send({ action: "guard-silence" });
$("saveKey").onclick = () => { settings.key = $("key").value.trim(); settings.save(); connect(); void loadPhotos(); void loadFeed(); };
$("link").onclick = () => { $("key").value = settings.key; $("setup").hidden = false; };

// ---------- Notificaciones (iPhone: con la web añadida a la pantalla de inicio) ----------
const VAPID_PUBLIC = "BEwF4C0OwXyxFx3JXcNVMxp1BG3am7wyuaDoA6ID1ydMILIazHAtqERjTFnjWxHd14qHvqvVVSXdYaGueHKGoD0";
const standalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function renderPush() {
  const box = $("pushBox"), info = $("pushInfo");
  if (!("serviceWorker" in navigator)) { box.hidden = true; return; }
  box.hidden = false;
  if (!("PushManager" in window) || !("Notification" in window)) {
    $("pushOn").hidden = true;
    info.textContent = standalone() ? "Este móvil no admite notificaciones (hace falta iOS 16.4 o más nuevo)." : "Para recibir avisos: Compartir → «Añadir a pantalla de inicio» y abre Jarvis desde ese icono.";
    return;
  }
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (Notification.permission === "granted" && sub) { $("pushOn").hidden = true; info.textContent = "Notificaciones activadas: te aviso si entra alguien o salta la alarma."; return; }
  if (Notification.permission === "denied") { $("pushOn").hidden = true; info.textContent = "Notificaciones bloqueadas. Actívalas en Ajustes → Notificaciones → Jarvis."; return; }
  $("pushOn").hidden = false; info.textContent = "Te avisa aunque tengas la app cerrada.";
}
mando.renderPush = renderPush;
$("pushOn").onclick = async () => {
  try {
    const permission = await Notification.requestPermission();   // must come straight from the tap
    if (permission !== "granted") { await renderPush(); return; }
    const reg = await navigator.serviceWorker.register("sw.js"); await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(VAPID_PUBLIC) });
    const response = await call("jarvis-call", { action: "subscribe", subscription: sub.toJSON() }, settings.key);
    $("pushInfo").textContent = response.ok ? "Notificaciones activadas." : "No se pudo registrar: revisa la clave.";
    if (response.ok) $("pushOn").hidden = true;
  } catch (e) { $("pushInfo").textContent = "No se pudo activar: " + e.message; }
};
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").then(() => renderPush()).catch(() => renderPush());

// ---------- Fotos de la puerta ----------
async function loadPhotos() {
  if (!settings.key) return;
  try {
    const response = await call("jarvis-call", { action: "photos" }, settings.key);
    const data = await response.json().catch(() => ({}));
    const list = Array.isArray(data.photos) ? data.photos : [];
    $("photosBox").hidden = !list.length;
    $("photos").replaceChildren(...list.map((p) => {
      const f = document.createElement("figure"); f.className = p.reason === "alarm" ? "alarm" : "";
      const img = document.createElement("img"); img.src = p.url; img.loading = "lazy"; img.alt = p.who || "";
      img.onclick = () => { $("viewerImg").src = p.url; $("viewer").hidden = false; };
      const cap = document.createElement("figcaption");
      cap.textContent = `${p.who || "Alguien"} · ${new Date(p.at).toLocaleString("es-ES", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`;
      f.append(img, cap); return f;
    }));
    if (location.hash === "#fotos") $("photosBox").scrollIntoView({ behavior: "smooth" });
  } catch { /* offline */ }
}
mando.loadPhotos = loadPhotos;
$("viewer").onclick = () => { $("viewer").hidden = true; };
window.addEventListener("hashchange", () => { if (location.hash === "#fotos") void loadPhotos(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadPhotos(); });
// ---------- Busca mi móvil ----------
function ring() {
  $("ringing").hidden = false; clearInterval(mando.ringTimer);
  let n = 0; beep(true);
  mando.ringTimer = setInterval(() => { beep(true); if (++n > 20) stopRing(); }, 1500);
}
function stopRing() { clearInterval(mando.ringTimer); $("ringing").hidden = true; }
mando.ring = ring;
$("found").onclick = stopRing;

mando.started = Date.now();
connect(); render(); void loadPhotos();

// ---------- En directo: lo que Jarvis vigila ----------
const SOURCE = { gmail: "Gmail", school: "Insti", teams: "Teams", instagram: "Insta", door: "Puerta", jarvis: "Jarvis" };
mando.feed = [];
function feedItem(f) {
  const li = document.createElement("li"); li.className = "item " + (f.level || "info");
  const src = document.createElement("span"); src.className = "src"; src.textContent = SOURCE[f.source] || f.source;
  const t = document.createElement(f.url ? "a" : "span"); t.className = "t"; t.textContent = (f.called ? "📞 " : "") + f.title;
  if (f.url) { t.href = f.url; t.target = "_blank"; t.rel = "noopener"; }
  const w = document.createElement("time"); w.textContent = new Date(f.created_at || Date.now()).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  const b = document.createElement("span"); b.className = "b"; b.textContent = f.body || f.say || "";
  li.append(src, t, w, b); return li;
}
function renderFeed() {
  if (!mando.feed.length) return;
  $("feed").replaceChildren(...mando.feed.slice(0, 40).map(feedItem));
}
function addFeed(item, live = false) {
  if (mando.feed.some((f) => f.id && f.id === item.id)) return;
  mando.feed.unshift(item); renderFeed();
  if (live && item.level !== "info") beep(item.level === "call");
}
mando.addFeed = addFeed;
async function loadFeed() {
  if (!settings.key) return;
  try {
    const data = await (await call("jarvis-call", { action: "feed" }, settings.key)).json();
    if (Array.isArray(data.feed)) { mando.feed = data.feed; renderFeed(); }
    if (location.hash === "#feed") $("feedBox").scrollIntoView({ behavior: "smooth" });
  } catch { /* offline */ }
}
mando.loadFeed = loadFeed;
document.addEventListener("visibilitychange", () => { if (!document.hidden) void loadFeed(); });
window.addEventListener("hashchange", () => { if (location.hash === "#feed") void loadFeed(); });
void loadFeed();

// ---------- Ajustes de vigilancia ----------
async function watchConfig(set) {
  const response = await call("jarvis-call", { action: "watch-config", ...(set ? { set } : {}) }, settings.key);
  return response.json();
}
function fillWatch(c) {
  $("wTeams").checked = !!c.teams; $("wSchool").checked = !!c.school; $("wInsta").checked = !!c.instagramOn;
  $("wInstagram").value = c.instagram || ""; $("wCalls").value = c.callsPerDay ?? 6;
  $("wQuietFrom").value = c.quietFrom || "23:00"; $("wQuietTo").value = c.quietTo || "07:30"; $("wRules").value = c.rules || "";
  $("watchStatus").textContent = [c.callsReady ? "Llamadas: listas ✓" : "Llamadas: falta configurar Twilio en Supabase",
    c.geminiReady ? "Cerebro gratis: listo ✓" : "Falta la clave de Gemini", c.quiet ? "Ahora es horario sin llamadas" : ""].filter(Boolean).join(" · ");
}
$("watchOpen").onclick = async () => {
  $("watchSheet").hidden = false; $("watchStatus").textContent = "Cargando…";
  try { fillWatch(await watchConfig()); } catch { $("watchStatus").textContent = "Sin conexión."; }
};
$("wClose").onclick = () => { $("watchSheet").hidden = true; };
$("wSave").onclick = async () => {
  $("watchStatus").textContent = "Guardando…";
  try {
    fillWatch(await watchConfig({ teams: $("wTeams").checked, school: $("wSchool").checked, instagramOn: $("wInsta").checked,
      instagram: $("wInstagram").value.trim(), callsPerDay: +$("wCalls").value, quietFrom: $("wQuietFrom").value, quietTo: $("wQuietTo").value, rules: $("wRules").value.trim() }));
    $("watchStatus").textContent = "Guardado ✓ · " + $("watchStatus").textContent;
  } catch { $("watchStatus").textContent = "No se pudo guardar."; }
};
$("wTest").onclick = async () => {
  $("watchStatus").textContent = "Llamando…";
  try { const r = await (await call("jarvis-call", { action: "call-test" }, settings.key)).json(); $("watchStatus").textContent = r.called ? "Te estoy llamando ✓" : "No se pudo llamar: " + (/not set up/.test(r.reason || "") ? "falta configurar Twilio en Supabase" : r.reason || "error"); }
  catch { $("watchStatus").textContent = "Sin conexión."; }
};
