// The wall phone's ears. iPhone Safari can't run its speech recognizer while
// the camera is on, so the wall listens itself: it notices when someone
// speaks (energy above the room's noise floor), keeps that bit of audio (with
// a short lead-in so "Jarvis" isn't clipped), and only then asks jarvis-hear
// to turn it into text. Phrases that start with "Jarvis" go to the desk.
// To keep the bill small: long continuous sound (music, TV) is skipped, it is
// deaf while Jarvis talks, and there's a daily cap.
import { call } from "./common.js";
import { afterWake } from "./ears.js";

const RATE = 16000;

export function encodeWav(samples, rate = RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2), view = new DataView(buffer);
  const text = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buffer], { type: "audio/wav" });
}

export function createWallEars({ settings, onCommand, onStatus = () => {}, store }) {
  const e = {
    on: false, muted: false, mutedUntil: 0, followUntil: 0, busy: false, level: 0,
    limits: { minMS: 350, endMS: 800, maxMS: 7000, preMS: 600, perDay: 400, gapMS: 1200 },
    heardToday: 0, day: "", last: "", failures: 0,
  };
  let ctx = null, stream = null, proc = null, ring = [], seg = null, floor = 0.008, lastLoud = 0, segStart = 0, coolUntil = 0;
  const today = () => new Date().toDateString();
  const loadCount = () => { const c = store?.get("jarvis-wall-ears", null); e.day = c?.day || today(); e.heardToday = e.day === today() ? c?.n || 0 : 0; };
  const saveCount = () => store?.set("jarvis-wall-ears", { day: today(), n: e.heardToday });
  loadCount();

  // iPhone only lets audio run if it starts inside a tap: call prime() first thing on the tap.
  e.prime = () => {
    try { const Ctx = window.AudioContext || window.webkitAudioContext; ctx ||= new Ctx(); ctx.resume?.(); } catch { /* checked in start */ }
  };
  e.start = async () => {
    if (e.on) return true;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!ctx || ctx.state === "closed") ctx = new Ctx();
    await ctx.resume?.();
    const source = ctx.createMediaStreamSource(stream);
    proc = ctx.createScriptProcessor(4096, 1, 1);
    const step = ctx.sampleRate / RATE;
    proc.onaudioprocess = (ev) => {
      const input = ev.inputBuffer.getChannelData(0), out = new Float32Array(Math.floor(input.length / step));
      let sum = 0;
      for (let i = 0; i < out.length; i++) { const v = input[Math.floor(i * step)]; out[i] = v; sum += v * v; }
      e.feed(out, Math.sqrt(sum / Math.max(1, out.length)));
    };
    source.connect(proc); proc.connect(ctx.destination);
    e.on = true; onStatus("listening");
    return true;
  };
  e.stop = () => {
    e.on = false; seg = null; ring = [];
    try { proc?.disconnect(); } catch {} try { stream?.getTracks().forEach((t) => t.stop()); } catch {} try { ctx?.close(); } catch {}
    proc = stream = ctx = null; onStatus("off");
  };
  // One block of 16 kHz audio and its loudness.
  e.feed = (block, rms, now = Date.now()) => {
    e.level = rms;
    const deaf = e.muted || now < e.mutedUntil;
    const threshold = Math.max(0.012, floor * 3);
    if (!seg) {
      ring.push(block);
      let kept = ring.reduce((n, b) => n + b.length, 0);
      while (ring.length > 1 && kept - ring[0].length > RATE * e.limits.preMS / 1000) { kept -= ring[0].length; ring.shift(); }
      if (rms < threshold) floor = floor * 0.95 + rms * 0.05;
      if (!deaf && now >= coolUntil && rms > threshold) { seg = ring.slice(); ring = []; segStart = now; lastLoud = now; }
      return;
    }
    seg.push(block);
    if (rms > threshold) lastLoud = now;
    if (deaf) { seg = null; return; }
    if (now - segStart > e.limits.maxMS) { seg = null; coolUntil = now + 4000; return; }   // music/TV: skip it
    if (now - lastLoud > e.limits.endMS) {
      const parts = seg; seg = null;
      if (lastLoud - segStart >= e.limits.minMS) void e.finish(parts);
    }
  };
  e.finish = async (parts) => {
    if (e.busy || e.heardToday >= e.limits.perDay || !settings.key) return;
    const total = parts.reduce((n, b) => n + b.length, 0), samples = new Float32Array(total);
    let o = 0; for (const b of parts) { samples.set(b, o); o += b.length; }
    e.busy = true; e.heardToday++; saveCount();
    try {
      const clip = encodeWav(samples);
      const response = await call("jarvis-hear", null, settings.key, { raw: clip, headers: { "Content-Type": "audio/wav" } });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) { e.failures++; onStatus("error", data.error || "hear " + response.status); return; }
      e.failures = 0;
      e.handle(String(data.text || ""));
    } catch { e.failures++; onStatus("error", "sin conexión"); }
    finally { e.busy = false; coolUntil = Date.now() + e.limits.gapMS / 4; }
  };
  // What to do with a transcribed phrase.
  e.handle = (text, now = Date.now()) => {
    text = text.replace(/\s+/g, " ").trim();
    if (!text) return;
    e.last = text;
    const command = afterWake(text);
    if (command !== null) { e.followUntil = command ? 0 : now + 8000; onCommand(command, command ? "wake" : "wake-only"); return; }
    if (now < e.followUntil) { e.followUntil = 0; onCommand(text, "follow"); }
  };
  // The desk is talking: don't transcribe its own voice. Afterwards, a short
  // window where a follow-up doesn't need "Jarvis".
  e.setDeskSpeaking = (speaking, follow = false) => {
    e.muted = speaking; seg = null;
    if (!speaking) { e.mutedUntil = Date.now() + 400; if (follow) e.followUntil = Date.now() + 7000; }
  };
  return e;
}
