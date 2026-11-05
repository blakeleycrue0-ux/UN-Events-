// Supabase Edge Function: turns a short recording of what you said into text.
// Gemini (free tier) first when GEMINI_API_KEY is set, ElevenLabs Speech to Text
// as the backup (or the other way round if only one key exists). Safari's own recognizer gets no audio on
// iPhone while the camera is in use, so Jarvis records and sends the clip here.
// deno-lint-ignore no-explicit-any
async function geminiHear(key: string, audio: ArrayBuffer, type: string): Promise<any> {
  const models = (Deno.env.get("GEMINI_HEAR_MODEL") || "gemini-flash-lite-latest,gemini-2.5-flash-lite,gemini-flash-latest,gemini-2.5-flash").split(",").map((m) => m.trim()).filter(Boolean);
  const bytes = new Uint8Array(audio); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: type === "audio/x-m4a" ? "audio/mp4" : type, data: btoa(bin) } },
      { text: "Transcribe exactly what the person says in this recording (usually Spanish from Spain, sometimes English), word for word, in the language spoken. The assistant's name is Jarvis. If there is no clear human speech (silence, noise, music, TV), return an empty text. Never translate, summarise or add anything." },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 400, responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", properties: { text: { type: "STRING" }, language: { type: "STRING" } }, required: ["text"] } },
  });
  let last = "no model";
  for (const model of models) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body, signal: AbortSignal.timeout(7000),
    }).catch(() => null);
    if (!r) { last = model + " timeout"; break; }   // overloaded: don't make the user wait for another model
    // Each model has its own free quota: a 429 or 404 just moves to the next one.
    if (r.status === 404 || r.status === 429 || r.status >= 500) { last = model + " " + r.status; continue; }
    if (!r.ok) throw Error("gemini " + r.status);
    const data = await r.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
    try { const out = JSON.parse(raw); return { text: String(out?.text || ""), language: String(out?.language || "") }; }
    catch { return { text: raw, language: "" }; }
  }
  throw Error("gemini: " + last);
}

// Groq (free, very fast Whisper): usually under a second.
async function groqHear(key: string, audio: ArrayBuffer, type: string, lang: string) {
  const form = new FormData();
  form.append("file", new Blob([audio], { type }), "speech." + (type.split("/")[1] || "wav").replace("x-", ""));
  form.append("model", Deno.env.get("GROQ_HEAR_MODEL") || "whisper-large-v3-turbo");
  form.append("response_format", "json"); form.append("temperature", "0");
  if (lang) form.append("language", lang);
  form.append("prompt", "Jarvis.");   // helps it spell the name
  const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST", headers: { Authorization: "Bearer " + key }, body: form, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw Error("groq " + r.status);
  const data = await r.json();
  return { text: String(data?.text || ""), language: lang };
}

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
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (!origin || !allowed.includes(origin)) return json(403, { error: "Origin not allowed" });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return json(405, { error: "POST required" });

  const expected = (Deno.env.get("JARVIS_KEY") || "").trim();
  const apiKey = (Deno.env.get("ELEVENLABS_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
  const geminiKey = (Deno.env.get("GEMINI_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
  const groqKey = (Deno.env.get("GROQ_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
  if (expected.length < 6 || (!apiKey && !geminiKey && !groqKey)) return json(428, { error: "Hearing not configured" });
  const given = (request.headers.get("x-jarvis-key") || "").trim();
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  if (diff) return json(401, { error: "Wrong Jarvis key" });

  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^audio\/(mp4|webm|ogg|mpeg|wav|x-m4a|aac)$/.test(type)) return json(415, { error: "Unsupported audio" });
  const audio = await request.arrayBuffer();
  if (audio.byteLength < 200 || audio.byteLength > 5_000_000) return json(400, { error: "Audio size out of range" });
  const ext = type.split("/")[1].replace("x-", "");
  const clean = (t: string) => t.replace(/\s+/g, " ").trim().replace(/^["'«]+|["'»]+$/g, "").slice(0, 1000);
  if (groqKey) {
    const lang = (new URL(request.url).searchParams.get("lang") || "es").slice(0, 2);
    try { const r = await groqHear(groqKey, audio, type, /^(es|en)$/.test(lang) ? lang : "es"); return json(200, { text: clean(r.text), language: r.language, via: "groq" }); }
    catch (error) { console.log("jarvis-hear Groq fallback:", String((error as Error).message).slice(0, 120)); if (!geminiKey && !apiKey) return json(502, { error: "Groq unavailable" }); }
  }
  if (geminiKey) {
    try { const r = await geminiHear(geminiKey, audio, type); return json(200, { text: clean(r.text), language: r.language, via: "gemini" }); }
    catch (error) { console.log("jarvis-hear Gemini fallback:", String((error as Error).message).slice(0, 120)); if (!apiKey) return json(502, { error: "Gemini unavailable" }); }
  }

  const form = new FormData();
  form.append("model_id", Deno.env.get("ELEVENLABS_STT_MODEL") || "scribe_v1");
  form.append("file", new Blob([audio], { type }), "speech." + ext);
  form.append("tag_audio_events", "false");
  try {
    const upstream = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST", headers: { "xi-api-key": apiKey }, body: form, signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok) {
      let reason = "";
      try { const d = (await upstream.json())?.detail; reason = String(d?.status || d?.code || (typeof d === "string" ? d : "")).slice(0, 80); } catch { /* not JSON */ }
      console.log("jarvis-hear ElevenLabs status", upstream.status, reason);
      const error = /missing_permissions/.test(reason) ? "ElevenLabs key lacks speech to text permission"
        : /unusual_activity/.test(reason) ? "ElevenLabs blocked free tier"
        : upstream.status === 402 || upstream.status === 429 || /quota/.test(reason) ? "ElevenLabs quota reached"
        : upstream.status === 401 ? "ElevenLabs key rejected" : "ElevenLabs unavailable";
      return json(502, { error });
    }
    const result = await upstream.json();
    return json(200, { text: String(result?.text || "").trim().slice(0, 1000), language: String(result?.language_code || "") });
  } catch {
    return json(503, { error: "ElevenLabs unavailable" });
  }
});
