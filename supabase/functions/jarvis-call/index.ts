// Supabase Edge Function: Jarvis's background jobs (no phone calls).
// - step=cron: called every minute by pg_cron; delivers due reminders, spoken
//   on the desk computer (or by email when Resend is set up).
// - POST {action: "state"} with the Jarvis key: what Jarvis remembers, so a
//   new computer running the desk gets its memory back.
// (The name is historical: it once handled phone calls too.)

const env = (name: string) => (Deno.env.get(name) || "").trim().replace(/^["']+|["']+$/g, "");
const enc = new TextEncoder();
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
function same(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}

async function db(path: string, init: RequestInit = {}) {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  return fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
}
async function rows(path: string, init: RequestInit = {}) {
  const response = await db(path, init);
  if (!response.ok) return [];
  try { return await response.json(); } catch { return []; }
}
async function profile() {
  const [state] = await rows("jarvis_state?id=eq.1&select=name,memory");
  return { name: clean(state?.name || "Crew", 30), memory: Array.isArray(state?.memory) ? state.memory.slice(-40) : [] };
}
async function broadcast(command: Record<string, unknown>) {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode("jarvis-pc:" + env("JARVIS_KEY")))));
  await fetch(env("SUPABASE_URL") + "/realtime/v1/api/broadcast", {
    method: "POST", headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: "jarvis-pc-" + digest.slice(0, 40), event: "command", payload: { ...command, at: Date.now() }, private: false }] }),
    signal: AbortSignal.timeout(8000),
  });
}

async function deliverDue() {
  const due = await rows(`jarvis_reminders?done=eq.false&due_at=lte.${encodeURIComponent(new Date().toISOString())}&order=due_at.asc&limit=10&select=id,text,via,lang`);
  const results: string[] = [];
  for (const r of due) {
    // Claim it first so two cron runs never deliver the same reminder twice.
    const claimed = await rows(`jarvis_reminders?id=eq.${encodeURIComponent(r.id)}&done=eq.false`, { method: "PATCH", body: JSON.stringify({ done: true, delivered_at: new Date().toISOString() }) });
    if (!claimed.length) continue;
    let via = r.via === "email" ? "email" : "desk";
    if (via === "email") {
      const key = env("RESEND_API_KEY"), to = env("JARVIS_EMAIL_TO");
      const sent = key && to && (await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Jarvis <onboarding@resend.dev>", to: [to], subject: "Jarvis: " + clean(r.text, 80), text: r.text }),
        signal: AbortSignal.timeout(10000),
      })).ok;
      if (!sent) via = "desk";
    }
    if (via === "desk") await broadcast({ action: "remind", text: r.text, lang: r.lang }).catch(() => {});
    results.push(via);
  }
  return results;
}

Deno.serve(async (request: Request) => {
  const step = new URL(request.url).searchParams.get("step") || "";
  try {
    // ---- Every minute from pg_cron ----
    if (step === "cron") {
      // The shared secret lives in Vault ('jarvis_cron'); the database checks it.
      const token = (request.headers.get("x-jarvis-cron") || "").slice(0, 200);
      const check = token.length >= 16 ? await db("rpc/jarvis_cron_check", { method: "POST", body: JSON.stringify({ token }) }) : null;
      if (!check?.ok || (await check.json().catch(() => false)) !== true) return new Response("Forbidden", { status: 403 });
      return Response.json({ delivered: await deliverDue() });
    }

    // ---- From the desk: what Jarvis remembers ----
    const normalize = (x: string) => x.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "").toLowerCase();
    const origin = normalize(request.headers.get("origin") || "");
    const allowed = env("APP_ORIGINS").split(/[,\s]+/).map(normalize).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "null",
      "Access-Control-Allow-Headers": "content-type, x-jarvis-key, authorization, apikey, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin", "Cache-Control": "no-store",
    };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
    if (!allowed.includes(origin)) return json(403, { error: "Origin not allowed" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { error: "POST required" });
    const expected = env("JARVIS_KEY");
    if (expected.length < 6 || !same((request.headers.get("x-jarvis-key") || "").trim(), expected)) return json(401, { error: "Wrong Jarvis key" });
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try { body = await request.json(); } catch { /* defaults */ }
    if (body.action === "state") { const who = await profile(); return json(200, { name: who.name, memory: who.memory }); }
    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.log("jarvis-call error", step, String((error as Error).message).slice(0, 200));
    return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
});
