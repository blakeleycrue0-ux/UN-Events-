// Supabase Edge Function: turns Jarvis replies into speech with ElevenLabs.
// The ElevenLabs API key never reaches the browser. A private JARVIS_KEY, typed
// once in Jarvis settings, stops strangers from spending your voice credits.
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

  const expected = Deno.env.get("JARVIS_KEY") || "";
  const apiKey = Deno.env.get("ELEVENLABS_API_KEY") || "";
  if (expected.length < 6 || !apiKey) return reply(428, "Voice not configured");
  const given = request.headers.get("x-jarvis-key") || "";
  // Length-independent comparison so timing does not reveal the key.
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  if (diff) return reply(401, "Wrong Jarvis key");

  let text = "";
  try { text = String((await request.json()).text || "").trim(); } catch { /* handled below */ }
  if (!text || text.length > 400) return reply(400, "Text must be 1-400 characters");

  const voice = Deno.env.get("ELEVENLABS_VOICE_ID") || "onwK4e9ZLuTAKqWW03F9"; // "Daniel": calm, deep, British.
  if (!/^[a-zA-Z0-9]{10,40}$/.test(voice)) return reply(428, "Invalid voice id");
  try {
    const upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_64`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({
          text,
          model_id: Deno.env.get("ELEVENLABS_MODEL") || "eleven_flash_v2_5",
          language_code: "es",
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!upstream.ok) {
      console.log("jarvis-voice ElevenLabs status", upstream.status);
      return reply(502, upstream.status === 401 ? "ElevenLabs key rejected" : upstream.status === 402 || upstream.status === 429 ? "ElevenLabs quota reached" : "ElevenLabs unavailable");
    }
    return new Response(upstream.body, { status: 200, headers: { ...cors, "Content-Type": "audio/mpeg" } });
  } catch {
    return reply(503, "ElevenLabs unavailable");
  }
});
