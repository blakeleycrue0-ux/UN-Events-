// Jarvis's voice: ElevenLabs through the jarvis-voice function, with a level
// meter so the orb can pulse with every word.
import { call } from "./common.js";

const MESSAGES = {
  401: "La clave de Jarvis no coincide con la de Supabase.",
  428: "Falta configurar la voz en Supabase.",
  "ElevenLabs key rejected": "ElevenLabs no acepta la clave.",
  "ElevenLabs key lacks text to speech permission": "A la clave de ElevenLabs le falta el permiso Text to Speech.",
  "ElevenLabs quota reached": "Se han acabado los créditos de ElevenLabs este mes.",
};

export function createVoice({ settings, onState = () => {} }) {
  const audio = new Audio();
  audio.preload = "auto";
  let id = 0, finish = null, ctx = null, analyser = null, data = null;
  const voice = { speaking: false, error: "", volume: 1 };

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
    if (!analyser || !voice.speaking) return 0;
    analyser.getByteFrequencyData(data);
    let sum = 0; for (const v of data) sum += v;
    return Math.min(1, sum / data.length / 110);
  };

  async function blob(text, lang) {
    const cacheable = !/\d/.test(text) && "caches" in window;
    const keyUrl = location.origin + "/__jarvis-voice?" + lang + "&" + encodeURIComponent(text);
    let cache;
    if (cacheable) {
      try { cache = await caches.open("jarvis-voice-v2"); const hit = await cache.match(keyUrl); if (hit) return await hit.blob(); } catch {}
    }
    if (!settings.key) throw Error("Falta la clave de Jarvis en ajustes.");
    const response = await call("jarvis-voice", { text, lang }, settings.key);
    if (!response.ok) {
      let error = ""; try { error = (await response.json()).error || ""; } catch {}
      throw Error(MESSAGES[response.status] || MESSAGES[error] || "La voz no está disponible ahora.");
    }
    const result = await response.blob();
    if (cache) { try { await cache.put(keyUrl, new Response(result, { headers: { "Content-Type": "audio/mpeg" } })); } catch {} }
    return result;
  }

  voice.stop = () => { id++; audio.pause(); finish?.(); voice.speaking = false; };
  voice.speak = async (text, lang = settings.lang) => {
    const mine = ++id;
    audio.pause();
    onState("thinking", text);
    let url;
    try { url = URL.createObjectURL(await blob(text, lang)); voice.error = ""; }
    catch (e) { voice.error = e.message; if (mine === id) onState("idle", text); return false; }
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
