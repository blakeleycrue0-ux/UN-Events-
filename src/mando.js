// Jarvis · Mando: your own phone. Arms guard mode when you leave, shows who
// came in, and alerts you (sound + vibration while the page is open).
import { $, store, loadSettings, connectHome } from "./jarvis/common.js";

const settings = loadSettings();
const mando = window.mando = { state: null, lastSeen: 0, home: null, settings, alerts: 0 };
store.set("jarvis-role", "remote");

function connect() {
  mando.home?.stop();
  if (!settings.key) { $("setup").hidden = false; return; }
  $("setup").hidden = true;
  mando.home = connectHome({
    key: settings.key,
    onEvent: (e) => { if (e.action === "guard-state") onState(e); },
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
  let state = "unknown", title = "—", sub = "Abre Jarvis en el ordenador";
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
    $("alertSub").textContent = s.alarm ? `${s.intruder} no ha puesto el código.` : `${s.intruder} tiene 20 segundos para poner el código.`;
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
connect(); render();
