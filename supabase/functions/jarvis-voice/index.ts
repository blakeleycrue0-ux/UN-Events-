// Supabase Edge Function: turns Jarvis replies into speech with ElevenLabs,
// and with Gemini's free voice when ElevenLabs is out of credit (or not set).
// The ElevenLabs API key never reaches the browser. A private JARVIS_KEY, typed
// once in Jarvis settings, stops strangers from spending your voice credits.
// Gemini answers raw 16-bit PCM; wrap it in a WAV header so any browser plays it.
function wav(pcm: Uint8Array, rate: number) {
  const out = new Uint8Array(44 + pcm.length), v = new DataView(out.buffer);
  const str = (o: number, t: string) => { for (let i = 0; i < t.length; i++) out[o + i] = t.charCodeAt(i); };
  str(0, "RIFF"); v.setUint32(4, 36 + pcm.length, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}
async function geminiVoice(key: string, text: string, lang: string) {
  const models = (Deno.env.get("GEMINI_TTS_MODEL") || "gemini-2.5-flash-preview-tts,gemini-2.5-pro-preview-tts").split(",").map((m) => m.trim()).filter(Boolean);
  const style = lang === "es" ? "Lee con voz de mayordomo, grave, tranquila y elegante, en español de España: " : "Say in a calm, deep, elegant British butler voice: ";
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: style + text }] }],
    generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: Deno.env.get("GEMINI_VOICE") || "Charon" } } } },
  });
  let last = "no model";
  for (const model of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(25000),
    });
    if (r.status === 404 || r.status === 429 || r.status >= 500) { last = model + " " + r.status; continue; }
    if (!r.ok) throw Error("gemini " + r.status);
    const data = await r.json();
    const part = (data?.candidates?.[0]?.content?.parts || []).find((p: { inlineData?: unknown }) => p.inlineData)?.inlineData;
    if (!part?.data) throw Error("gemini no audio");
    const bin = atob(part.data), pcm = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) pcm[i] = bin.charCodeAt(i);
    const rate = Number(/rate=(\d+)/.exec(String(part.mimeType || ""))?.[1]) || 24000;
    return wav(pcm, rate);
  }
  throw Error("gemini: " + last);
}

// While ElevenLabs is out of credit, don't ask it on every reply (saves time).
let elevenDownUntil = 0;

Deno.serve(async (request: Request) => {
  const normalize = (x: string) => x.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "").toLowerCase();
  const origin = normalize(request.headers.get("origin") || "");
  const allowed = (Deno.env.get("APP_ORIGINS") || "").split(/[,\s]+/).map(normalize).filter(Boolean);
  const cors = {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "content-type, x-jarvis-key, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const reply = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (!origin || !allowed.includes(origin)) return reply(403, "Origin not allowed");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply(405, "POST required");

  const expected = (Deno.env.get("JARVIS_KEY") || "").trim();
  const apiKey = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
  const geminiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
  if (expected.length < 6 || (!apiKey && !geminiKey)) return reply(428, "Voice not configured");
  const given = (request.headers.get("x-jarvis-key") || "").trim();
  // Length-independent comparison so timing does not reveal the key.
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  if (diff) return reply(401, "Wrong Jarvis key");

  let text = "", lang = "en";
  try { const body = await request.json(); text = String(body.text || "").trim(); lang = body.lang === "es" ? "es" : "en"; } catch { /* handled below */ }
  if (!text || text.length > 400) return reply(400, "Text must be 1-400 characters");

  // Free voice (Gemini) for when ElevenLabs can't.
  const viaGemini = async (why: string) => {
    if (!geminiKey) return reply(502, why);
    try { return new Response(await geminiVoice(geminiKey, text, lang), { status: 200, headers: { ...cors, "Content-Type": "audio/wav", "x-jarvis-voice": "gemini" } }); }
    catch (error) { console.log("jarvis-voice Gemini failed:", String((error as Error).message).slice(0, 120)); return reply(502, why === "ElevenLabs not set" ? "Gemini voice unavailable" : why); }
  };
  if (!apiKey) return await viaGemini("ElevenLabs not set");
  if (geminiKey && Date.now() < elevenDownUntil) return await viaGemini("ElevenLabs quota reached");
  const voice = Deno.env.get("ELEVENLABS_VOICE_ID") || "onwK4e9ZLuTAKqWW03F9"; // "Daniel": calm, deep, British.
  if (!/^[a-zA-Z0-9]{10,40}$/.test(voice)) return await viaGemini("Invalid voice id");
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: Deno.env.get("ELEVENLABS_MODEL") || "eleven_flash_v2_5",
          language_code: lang,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!upstream.ok) {
      // ElevenLabs explains refusals in detail.status (never contains the key).
      let reason = "";
      try { const d = (await upstream.json())?.detail; reason = String(d?.status || d?.code || (typeof d === "string" ? d : "")).slice(0, 80); } catch { /* not JSON */ }
      console.log("jarvis-voice ElevenLabs status", upstream.status, reason, "key length", apiKey.length);
      const message = /unusual_activity/.test(reason) ? "ElevenLabs blocked free tier"
        : /missing_permissions/.test(reason) ? "ElevenLabs key lacks text to speech permission"
        : upstream.status === 402 || upstream.status === 429 || /quota/.test(reason) ? "ElevenLabs quota reached"
        : upstream.status === 401 ? "ElevenLabs key rejected" : "ElevenLabs unavailable";
      if (message === "ElevenLabs quota reached" || message === "ElevenLabs blocked free tier") elevenDownUntil = Date.now() + 60 * 60000;
      return await viaGemini(message);
    }
    return new Response(upstream.body, { status: 200, headers: { ...cors, "Content-Type": "audio/mpeg" } });
  } catch {
    return await viaGemini("ElevenLabs unavailable");
  }
});
