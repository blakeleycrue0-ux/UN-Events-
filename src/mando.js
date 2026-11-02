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
    onEvent: (e) => { if (e.action === "guard-state") onState(e); if (e.action === "reply") onReply(e); },
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
$("saveKey").onclick = () => { settings.key = $("key").value.trim(); settings.save(); connect(); };
$("link").onclick = () => { $("key").value = settings.key; $("setup").hidden = false; };
// ---------- Hablar desde el móvil ----------
// The phone's microphone is far better than a closed laptop's. Tap, speak,
// tap again (or just stop talking): the text goes to the desk, which answers.
let rec = null, recText = "", lastAsk = 0, recorder = null;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function sendAsk(text) {
  text = text.replace(/\s+/g, " ").trim();
  if (!text) { $("heard").textContent = "No te he oído. Prueba otra vez."; return; }
  lastAsk = Date.now();
  $("heard").textContent = "«" + text + "»"; $("reply").hidden = true;
  if (!mando.home?.send({ action: "ask", text, id: lastAsk })) $("heard").textContent = "Sin conexión con el ordenador.";
}
function onReply(e) {
  if (e.id && e.id !== lastAsk) return;
  $("reply").textContent = e.text || "(Jarvis no ha dicho nada)"; $("reply").hidden = false;
}
mando.onReply = onReply;
function setTalking(on) { $("talk").classList.toggle("on", on); $("talkLabel").textContent = on ? "Te escucho… toca para enviar" : "Hablar"; }
function startTalk() {
  if (SR) {
    rec = new SR(); recText = "";
    rec.lang = settings.hear || "es-ES"; rec.interimResults = true; rec.continuous = true;
    let quiet = null;
    rec.onresult = (e) => {
      recText = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      $("heard").textContent = recText;
      clearTimeout(quiet); quiet = setTimeout(() => rec?.stop(), 2500);   // stop after a real pause
    };
    rec.onerror = (e) => { if (e.error === "not-allowed") $("heard").textContent = "Permite el micrófono para esta página."; };
    rec.onend = () => { clearTimeout(quiet); const t = recText; rec = null; setTalking(false); sendAsk(t); };
    try { rec.start(); setTalking(true); } catch { rec = null; }
    return;
  }
  void recordCloud();
}
// No recognizer in this browser: record and transcribe with Jarvis's cloud ears.
async function recordCloud() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = []; recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); setTalking(false); recorder = null;
      $("heard").textContent = "Transcribiendo…";
      const clip = new Blob(chunks, { type: chunks[0]?.type || "audio/mp4" });
      const response = await call("jarvis-hear", null, settings.key, { raw: clip, headers: { "Content-Type": clip.type } }).catch(() => null);
      const data = response ? await response.json().catch(() => ({})) : {};
      sendAsk(response?.ok ? String(data.text || "") : "");
    };
    recorder.start(); setTalking(true);
    setTimeout(() => { if (recorder?.state === "recording") recorder.stop(); }, 20000);
  } catch { $("heard").textContent = "Permite el micrófono para esta página."; }
}
$("talk").onclick = () => {
  if (rec) { rec.stop(); return; }
  if (recorder) { recorder.stop(); return; }
  startTalk();
};
mando.sendAsk = sendAsk;

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

mando.started = Date.now();
connect(); render();
