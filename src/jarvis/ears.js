// Jarvis's ears on the Chromebook. Chrome's speech recognizer listens in the
// background and reacts only to "Jarvis…"; a direct session (Space, click,
// or right after a bare "Jarvis") takes anything you say. Every session has its own
// timers, so a recognizer that stalls can never freeze Jarvis.
import { call } from "./common.js";

export const WAKE = /\b(jarvis|yarvis|jarbis|yarbis|charvis|harvis|harbis|jervis|yervis|jarvi|yarvi|jarviz|jarvice|chavis|travis)\b/i;
export function afterWake(text) {
  const m = WAKE.exec(text);
  return m ? text.slice(m.index + m[0].length).replace(/^[\s,.:!¡¿?]+/, "").trim() : null;
}

export function createEars({ settings, onHeard, onState = () => {}, log = () => {} }) {
  const ears = { listening: false, mode: "", paused: false, limits: { silenceMS: 2200, directMS: 8000, followMS: 6000, maxMS: 45000 }, blocked: false };
  let session = null, restart = null, quickFails = 0, mic = null, analyser = null, data = null;
  const Recognition = () => window.SpeechRecognition || window.webkitSpeechRecognition;

  // Microphone level for the orb (separate, lightweight stream).
  ears.openMeter = async () => {
    if (mic) return;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx(); const src = ctx.createMediaStreamSource(mic);
      analyser = ctx.createAnalyser(); analyser.fftSize = 512; data = new Float32Array(analyser.fftSize); src.connect(analyser);
    } catch (e) { log("medidor: " + e.name); }
  };
  ears.level = () => {
    if (!analyser) return 0;
    analyser.getFloatTimeDomainData(data);
    let sum = 0; for (const x of data) sum += x * x;
    return Math.min(1, Math.sqrt(sum / data.length) * 8);
  };

  function stopSession() { const s = session; session = null; if (s) { clearInterval(s.watch); try { s.rec.abort(); } catch {} } }
  function scheduleBackground(delay = 400) {
    clearTimeout(restart);
    if (!settings.wake || ears.paused || ears.blocked || !Recognition()) return;
    restart = setTimeout(() => { if (!session && !ears.paused) run("wake"); }, delay);
  }

  // mode: "wake" (needs "Jarvis"), "direct" (anything), "follow" (anything, short window).
  function run(mode) {
    const R = Recognition();
    if (!R) return false;
    stopSession(); clearTimeout(restart);
    const rec = new R();
    rec.lang = settings.hear; rec.interimResults = true; rec.continuous = true; rec.maxAlternatives = 1;
    const s = session = { rec, mode, text: "", started: Date.now(), last: Date.now(), failure: "", done: false };
    ears.listening = true; ears.mode = mode;
    if (mode !== "wake") onState("listening", "");
    const finish = () => {
      if (s.done) return; s.done = true;
      clearInterval(s.watch); try { rec.abort(); } catch {}
      if (session === s) session = null;
      ears.listening = false; ears.mode = "";
      log(`fin ${mode}: ${s.failure || "«" + s.text + "»"}`);
      if (/not-allowed|service-not-allowed/.test(s.failure)) { ears.blocked = true; onState("blocked", ""); return; }
      quickFails = Date.now() - s.started < 700 && !s.text ? quickFails + 1 : 0;
      if (mode === "wake") {
        const command = afterWake(s.text);
        if (command !== null) { onHeard(command, "wake"); return; }
        scheduleBackground(quickFails > 4 ? 5000 : 300);
        return;
      }
      onState("idle", "");
      if (s.text) onHeard(s.text, mode);
      else { if (mode === "direct") onHeard("", "silence"); scheduleBackground(); }
    };
    s.finish = finish;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ").replace(/\s+/g, " ").trim();
      if (text !== s.text) { s.text = text; s.last = Date.now(); }
      if (mode === "wake" && WAKE.test(text)) onState("listening", afterWake(text) || "");
      else if (mode !== "wake") onState("listening", text);
    };
    rec.onerror = (e) => { s.failure = e.error || "error"; if (s.failure !== "no-speech" || mode !== "wake") finish(); };
    rec.onend = finish;
    const quiet = mode === "follow" ? ears.limits.followMS : mode === "direct" ? ears.limits.directMS : 60000;
    s.watch = setInterval(() => {
      const now = Date.now(), wakeHeard = mode !== "wake" || WAKE.test(s.text);
      if ((s.text && wakeHeard && now - s.last > ears.limits.silenceMS) || (!s.text && now - s.started > quiet) ||
          (mode !== "wake" && now - s.started > ears.limits.maxMS) || (mode === "wake" && s.text && !wakeHeard && now - s.last > 2500)) finish();
    }, 150);
    log(`escuchar ${mode} (${rec.lang})`);
    try { rec.start(); } catch (e) { s.failure = /not-allowed/i.test(e.name + e.message) ? "not-allowed" : e.message; finish(); }
    return true;
  }

  // ---------- Fallback: record and transcribe (no Chrome recognizer) ----------
  async function recordOnce(waitMS) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m)) || "";
    const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks = [];
    recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx(), an = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(an); an.fftSize = 1024;
    const buf = new Float32Array(1024), started = Date.now();
    let floor = 0, n = 0, speech = 0, loud = 0;
    recorder.start(250);
    await new Promise((resolve) => {
      const t = setInterval(() => {
        an.getFloatTimeDomainData(buf); let sum = 0; for (const x of buf) sum += x * x; const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (now - started < 300) { floor += rms; n++; return; }
        if (rms > Math.max(0.015, (floor / Math.max(1, n)) * 2.5)) { loud = now; speech ||= now; }
        if ((speech && now - loud > ears.limits.silenceMS) || (!speech && now - started > waitMS) || now - started > ears.limits.maxMS) { clearInterval(t); resolve(); }
      }, 50);
    });
    await new Promise((r) => { recorder.onstop = r; recorder.stop(); });
    stream.getTracks().forEach((t) => t.stop()); ctx.close?.();
    return speech ? new Blob(chunks, { type: (type || "audio/webm").split(";")[0] }) : null;
  }
  async function cloud(mode) {
    ears.listening = true; ears.mode = mode; onState("listening", "");
    try {
      const clip = await recordOnce(mode === "follow" ? ears.limits.followMS : ears.limits.directMS);
      if (!clip) { ears.listening = false; onState("idle", ""); if (mode === "direct") onHeard("", "silence"); return; }
      onState("thinking", "");
      const response = await call("jarvis-hear", null, settings.key, { raw: clip, headers: { "Content-Type": clip.type } });
      const data = await response.json().catch(() => ({}));
      ears.listening = false;
      onHeard(response.ok ? String(data.text || "").trim() : "", response.ok ? mode : "error");
    } catch (e) { ears.listening = false; onState(e.name === "NotAllowedError" ? "blocked" : "idle", ""); }
  }

  ears.direct = (mode = "direct") => {
    clearTimeout(restart);
    if (session && session.mode !== "wake") { session.finish(); return; }   // second press: stop
    ears.blocked = false;
    if (!run(mode)) void cloud(mode);
  };
  ears.background = () => scheduleBackground(200);
  ears.pause = () => { ears.paused = true; clearTimeout(restart); if (session) { session.done = true; stopSession(); ears.listening = false; ears.mode = ""; } };
  ears.resume = (follow = false) => { ears.paused = false; if (follow) ears.direct("follow"); else scheduleBackground(300); };
  return ears;
}
