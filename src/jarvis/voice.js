// Jarvis's voice: ElevenLabs (or Gemini) through the jarvis-voice function, with
// a level meter so the orb can pulse with every word. If the cloud voice fails,
// the computer's own voice speaks instead: Jarvis is never silent.
import { call } from "./common.js";

const MESSAGES = {
  401: "La clave de Jarvis no coincide con la de Supabase.",
  428: "Falta configurar la voz en Supabase.",
  "ElevenLabs key rejected": "ElevenLabs no acepta la clave.",
  "ElevenLabs key lacks text to speech permission": "A la clave de ElevenLabs le falta el permiso Text to Speech.",
  "ElevenLabs quota reached": "Se han acabado los créditos de ElevenLabs este mes.",
};

// The best built-in voice for a language. The Mac's classic voices (Jorge,
// Mónica…) sound robotic; Chrome's "Google" voices and the Mac's downloadable
// Premium/Enhanced voices sound natural, so those come first. A voice chosen
// in settings always wins.
export function voicesFor(lang) {
  const all = window.speechSynthesis?.getVoices?.() || [];
  const code = lang === "es" ? "es" : "en";
  const rank = (v) => {
    const n = v.name, l = (v.lang || "").toLowerCase().replace("_", "-");
    let r = 0;
    if (/premium|mejorad|enhanced|neural|natural/i.test(n)) r += 40;
    if (/^google/i.test(n)) r += 30;
    if (l === (code === "es" ? "es-es" : "en-gb")) r += 10;
    if (/daniel|jorge|alvaro|álvaro/i.test(n)) r += 3;   // male butler voices
    if (/eloquence|bad news|bells|boing|bubbles|cellos|whisper|zarvox|trinoids|organ|albert|jester|superstar|wobble|grandma|grandpa|rocko|shelley|flo|reed|sandy/i.test(n)) r -= 100;   // novelty voices
    return r;
  };
  return all.filter((v) => (v.lang || "").toLowerCase().startsWith(code)).sort((a, b) => rank(b) - rank(a));
}
function localVoice(lang, wanted = "") {
  const list = voicesFor(lang);
  return (wanted && list.find((v) => v.name === wanted)) || list[0] || null;
}
// Long text in short pieces: Chrome's Google voices stop after ~15 seconds otherwise.
function pieces(text) {
  const out = [];
  for (const s of text.match(/[^.!?¡¿;:]+[.!?;:]*\s*/g) || [text]) {
    const last = out[out.length - 1];
    if (last && (last + s).length < 160) out[out.length - 1] = last + s; else out.push(s);
  }
  return out.map((x) => x.trim()).filter(Boolean);
}

export function createVoice({ settings, onState = () => {} }) {
  const audio = new Audio();
  audio.preload = "auto";
  let id = 0, finish = null, ctx = null, analyser = null, data = null;
  const voice = { speaking: false, error: "", volume: 1, local: false, maxWaitMS: 6000 };
  let cloudDownUntil = 0;   // after a cloud failure, use the built-in voice for a while (no waiting)
  try { window.speechSynthesis?.getVoices?.(); } catch {}

  // Inside the first click: lets the page play sound and measure it.
  voice.unlock = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !ctx) {
        ctx = new Ctx();
        const source = ctx.createMediaElementSource(audio);
        analyser = ctx.createAnalyser(); analyser.fftSize = 256; data = new Uint8Array(analyser.frequencyBinCount);
        source.connect(analyser); analyser.connect(ctx.destination);
      }
      ctx?.resume?.();
    } catch { /* level meter is optional */ }
  };
  voice.level = () => {
    if (voice.speaking && voice.local) return 0.35 + 0.3 * Math.abs(Math.sin(Date.now() / 90));
    if (!analyser || !voice.speaking) return 0;
    analyser.getByteFrequencyData(data);
    let sum = 0; for (const v of data) sum += v;
    return Math.min(1, sum / data.length / 110);
  };

  async function blob(text, lang, extra = {}) {
    const cacheable = !/\d/.test(text) && !!window.caches;
    const keyUrl = location.origin + "/__jarvis-voice?" + lang + "&" + encodeURIComponent(text);
    let cache;
    if (cacheable) {
      try { cache = await caches.open("jarvis-voice-v2"); const hit = await cache.match(keyUrl); if (hit) return await hit.blob(); } catch {}
    }
    if (!settings.key) throw Error("Falta la clave de Jarvis en ajustes.");
    const response = await call("jarvis-voice", { text, lang, ...extra }, settings.key);
    if (!response.ok) {
      let error = ""; try { error = (await response.json()).error || ""; } catch {}
      throw Error(MESSAGES[response.status] || MESSAGES[error] || "La voz no está disponible ahora.");
    }
    const result = await response.blob();
    if (cache) { try { await cache.put(keyUrl, new Response(result, { headers: { "Content-Type": result.type || "audio/mpeg" } })); } catch {} }
    return result;
  }

  // Fetch and cache a fixed line without playing it (greetings then start instantly).
  voice.prefetch = async (text, lang = settings.lang) => { try { if (!/\d/.test(text) && !!window.caches) await blob(text, lang, { prefetch: true }); } catch {} };
  voice.stop = () => { id++; audio.pause(); try { window.speechSynthesis?.cancel(); } catch {} finish?.(); voice.speaking = false; };
  // The computer's own voice (free, offline).
  function speakLocal(text, lang, mine) {
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) return Promise.resolve(false);
    return new Promise((resolve) => {
      if (mine !== id) { resolve(false); return; }
      const v = localVoice(lang, settings.localVoice), parts = pieces(text);
      let i = 0, ended = false;
      const done = () => { if (ended) return; ended = true; clearTimeout(guard); finish = null; voice.local = false; resolve(true); };
      const guard = setTimeout(() => { synth.cancel(); done(); }, 60000);
      finish = () => { synth.cancel(); done(); };
      const next = () => {
        if (ended || mine !== id) { done(); return; }
        if (i >= parts.length) { done(); return; }
        const u = new SpeechSynthesisUtterance(parts[i++]);
        u.lang = v?.lang || (lang === "es" ? "es-ES" : "en-GB"); if (v) u.voice = v;
        u.rate = 1; u.pitch = /^google/i.test(v?.name || "") ? 1 : 0.95; u.volume = voice.volume;
        u.onend = next; u.onerror = done;
        synth.speak(u);
      };
      voice.local = true; voice.speaking = true; onState("speaking", text);
      synth.cancel(); next();
    });
  }
  voice.voicesFor = voicesFor;
  voice.speak = async (text, lang = settings.lang) => {
    const mine = ++id;
    audio.pause();
    onState("thinking", text);
    let url;
    try {
      if (settings.voiceMode === "local" && !voice.forceCloud) throw Error("cloud voice resting");   // chosen in settings: always instant
      if (Date.now() < cloudDownUntil && !voice.forceCloud) throw Error("cloud voice resting");
      // Don't keep the room waiting: if the cloud voice is slow, the computer speaks.
      const slow = new Promise((_, reject) => setTimeout(() => reject(Error("cloud voice slow")), voice.maxWaitMS));
      url = URL.createObjectURL(await Promise.race([blob(text, lang), slow])); voice.error = "";
    } catch (e) {
      if (e.message === "cloud voice slow") cloudDownUntil = Date.now() + 2 * 60000;
      else if (e.message !== "cloud voice resting") { voice.error = e.message; cloudDownUntil = Date.now() + 10 * 60000; }
      // Never silent: say it with the computer's own voice.
      const spoken = await speakLocal(text, lang, mine);
      if (mine === id) { voice.speaking = false; onState("idle", text); }
      return spoken;
    }
    if (mine !== id) { URL.revokeObjectURL(url); return false; }
    voice.speaking = true; onState("speaking", text);
    await new Promise((resolve) => {
      const done = () => { clearTimeout(guard); audio.onended = audio.onerror = null; finish = null; resolve(); };
      const guard = setTimeout(done, 45000);
      audio.onended = audio.onerror = finish = done;
      audio.src = url; audio.volume = voice.volume;
      audio.play().catch(done);
    });
    URL.revokeObjectURL(url);
    if (mine === id) { voice.speaking = false; onState("idle", text); }
    return true;
  };
  return voice;
}
