// Supabase Edge Function: the wall camera (phone) reports who came in; this
// relays it to the desk (Chromebook) on the private home channel.
async function sha256(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
const ROLES = ["me", "mom", "dad", "other"];
const clean = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

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
  if (expected.length < 6) return json(428, { error: "Not configured" });
  const given = (request.headers.get("x-jarvis-key") || "").trim();
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  if (diff) return json(401, { error: "Wrong Jarvis key" });

  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const kind = String(body.kind || "");
  let event: Record<string, unknown>;
  if (kind === "arrival" || kind === "test") {
    const p = body.person || {};
    const role = ROLES.includes(p.role) ? p.role : "other";
    const name = clean(p.name, 30);
    if (!name) return json(400, { error: "Missing person" });
    event = { action: kind, person: { name, role, greeting: clean(p.greeting, 300) } };
  } else if (kind === "unknown") {
    event = { action: "unknown", count: Math.max(1, Math.min(5, Math.floor(+body.count) || 1)) };
  } else if (kind === "status") {
    event = { action: "wall", camera: body.camera === true };
  } else return json(400, { error: "Unknown event" });

  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const topic = "jarvis-pc-" + (await sha256("jarvis-pc:" + given)).slice(0, 40);
  try {
    const response = await fetch(url + "/realtime/v1/api/broadcast", {
      method: "POST",
      headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic, event: "command", payload: { ...event, at: Date.now() }, private: false }] }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) { console.log("jarvis-event broadcast", response.status); return json(502, { error: "Relay failed" }); }
    return json(200, { ok: true });
  } catch {
    return json(503, { error: "Relay unavailable" });
  }
});
