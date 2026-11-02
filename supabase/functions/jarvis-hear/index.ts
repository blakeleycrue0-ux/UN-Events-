// Supabase Edge Function: turns a short recording of what you said into text
// with ElevenLabs Speech to Text. Safari's own recognizer gets no audio on
// iPhone while the camera is in use, so Jarvis records and sends the clip here.
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
  if (expected.length < 6 || !apiKey) return json(428, { error: "Hearing not configured" });
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
        : upstream.status === 401 ? "ElevenLabs key rejected"
        : upstream.status === 402 || upstream.status === 429 || /quota/.test(reason) ? "ElevenLabs quota reached" : "ElevenLabs unavailable";
      return json(502, { error });
    }
    const result = await upstream.json();
    return json(200, { text: String(result?.text || "").trim().slice(0, 1000), language: String(result?.language_code || "") });
  } catch {
    return json(503, { error: "ElevenLabs unavailable" });
  }
});
