// Supabase Edge Function: Jarvis's background jobs (no phone calls).
// - step=cron: called every minute by pg_cron; delivers due reminders, spoken
//   on the desk computer (or by email when Resend is set up).
// - POST {action: "state"} with the Jarvis key: what Jarvis remembers, so a
//   new computer running the desk gets its memory back.
// - POST {action: "pin", pin}: save the 4-digit guard code (kept private here).
// - POST {action: "subscribe", subscription} / {action: "notify", title, body}:
//   Web Push notifications to the phone remote (installed on the home screen).
// - POST {action: "reminders"} / {action: "forget", id}: the pending reminders
//   as saved in the database, for the desk's panel.
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
  const [state] = await rows("jarvis_state?id=eq.1&select=name,memory,guard_pin");
  return { name: clean(state?.name || "Crew", 30), memory: Array.isArray(state?.memory) ? state.memory.slice(-40) : [], guardPin: /^\d{4}$/.test(state?.guard_pin || "") ? state.guard_pin : "" };
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

// ---------- Web Push (notifications on the phone remote) ----------
// Standard Web Push: VAPID-signed (ES256 JWT) and aes128gcm-encrypted (RFC 8291),
// all with WebCrypto. The signing key lives in Vault (jarvis_vapid()).
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}
async function encryptPush(payload: Uint8Array, uaPublic: Uint8Array, authSecret: Uint8Array, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const ua = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ua }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65;
  return concat(header, asPublic, sealed);
}
async function vapidHeader(endpoint: string, jwk: JsonWebKey) {
  const key = await crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "mailto:jarvis@unevents.netlify.app" })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(head + "." + body)));
  const pub = concat(new Uint8Array([4]), unb64u(jwk.x as string), unb64u(jwk.y as string));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${b64u(pub)}`;
}
async function notifyAll(message: { title: string; body: string; tag?: string; url?: string }) {
  const vapid = await (await db("rpc/jarvis_vapid", { method: "POST", body: "{}" })).json().catch(() => null);
  if (!vapid?.d) return { sent: 0, error: "no key" };
  const subs = await rows("jarvis_push?select=endpoint,p256dh,auth");
  let sent = 0;
  for (const s of subs) {
    try {
      const body = await encryptPush(enc.encode(JSON.stringify(message)), unb64u(s.p256dh), unb64u(s.auth));
      const r = await fetch(s.endpoint, {
        method: "POST", body,
        headers: { Authorization: await vapidHeader(s.endpoint, vapid), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: "3600", Urgency: "high" },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) sent++;
      else if (r.status === 404 || r.status === 410) await db(`jarvis_push?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" });
      else console.log("jarvis-call push status", r.status);
    } catch (error) { console.log("jarvis-call push failed", String((error as Error).message).slice(0, 100)); }
  }
  return { sent };
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
    if (body.action === "state") { const who = await profile(); return json(200, { name: who.name, memory: who.memory, guardPin: who.guardPin }); }
    // The guard code lives here (private), not in the public site code.
    if (body.action === "pin" && /^\d{4}$/.test(String(body.pin || ""))) {
      await db("jarvis_state?id=eq.1", { method: "PATCH", body: JSON.stringify({ guard_pin: String(body.pin) }) });
      return json(200, { ok: true });
    }
    // Phone remote: register for notifications, and the desk sends alerts.
    if (body.action === "subscribe") {
      const s = body.subscription || {};
      const endpoint = String(s.endpoint || ""), p256dh = String(s.keys?.p256dh || ""), auth = String(s.keys?.auth || "");
      if (!/^https:\/\/[^\s]{10,900}$/.test(endpoint) || !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{16,30}$/.test(auth)) return json(400, { error: "Invalid subscription" });
      await db("jarvis_push", { method: "POST", headers: { Prefer: "return=minimal,resolution=merge-duplicates" }, body: JSON.stringify({ endpoint, p256dh, auth }) });
      return json(200, { ok: true });
    }
    if (body.action === "notify") {
      const title = clean(body.title, 80), text = clean(body.body, 200);
      if (!title) return json(400, { error: "Missing title" });
      return json(200, await notifyAll({ title, body: text, tag: clean(body.tag, 40) || "jarvis", url: "/mando" }));
    }
    // The desk shows what is really saved, straight from the database.
    if (body.action === "reminders") {
      const list = await rows("jarvis_reminders?done=eq.false&order=due_at.asc&limit=12&select=id,due_at,text,via");
      return json(200, { reminders: list });
    }
    if (body.action === "forget" && /^[0-9a-f-]{36}$/.test(String(body.id || ""))) {
      await db(`jarvis_reminders?id=eq.${body.id}&done=eq.false`, { method: "DELETE" });
      return json(200, { ok: true });
    }
    return json(400, { error: "Unknown action" });
  } catch (error) {
    console.log("jarvis-call error", step, String((error as Error).message).slice(0, 200));
    return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
});
