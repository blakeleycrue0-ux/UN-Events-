// Supabase Edge Function: Jarvis on the phone. Twilio rings the user's phone;
// each turn Twilio sends what the user said, Claude answers, and ElevenLabs
// (Jarvis's "Daniel" voice) speaks it back. Also delivers due reminders
// (called every minute by pg_cron) and answers when the user rings Jarvis.
//
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (Jarvis's number),
// JARVIS_PHONE_TO (the user's mobile), plus the existing
// JARVIS_KEY, ANTHROPIC_API_KEY and ELEVENLABS_API_KEY.
import Anthropic from "npm:@anthropic-ai/sdk";

const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];
const env = (name: string) => (Deno.env.get(name) || "").trim().replace(/^["']+|["']+$/g, "");
const enc = new TextEncoder();
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const base = () => env("SUPABASE_URL") + "/functions/v1/jarvis-call";

async function hmac(algorithm: "SHA-1" | "SHA-256", key: string, data: string) {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: algorithm }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
function same(a: string, b: string) {
  const x = enc.encode(a), y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < y.length; i++) diff |= (x[i] ?? 0) ^ y[i];
  return diff === 0;
}
const b64url = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));

// Signed, short-lived link to a spoken line (Twilio fetches it with <Play>).
async function voiceUrl(text: string, lang: string) {
  const payload = b64url(JSON.stringify({ x: text.slice(0, 400), l: lang, e: Date.now() + 15 * 60000 }));
  return `${base()}?step=voice&t=${payload}.${hex(await hmac("SHA-256", env("JARVIS_KEY"), "voice:" + payload))}`;
}
async function readToken(token: string) {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !same(sig, hex(await hmac("SHA-256", env("JARVIS_KEY"), "voice:" + payload)))) return null;
  try { const v = JSON.parse(unb64url(payload)); return v.e > Date.now() ? v : null; } catch { return null; }
}
// Twilio signs every webhook: HMAC-SHA1(auth token, URL + sorted POST params).
async function fromTwilio(request: Request, params: Record<string, string>) {
  const signature = request.headers.get("x-twilio-signature") || "";
  const url = base() + new URL(request.url).search;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  return !!signature && same(signature, b64(await hmac("SHA-1", env("TWILIO_AUTH_TOKEN"), data)));
}

async function db(path: string, init: RequestInit = {}) {
  const service = env("SUPABASE_SERVICE_ROLE_KEY");
  return fetch(env("SUPABASE_URL") + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json", Prefer: "return=representation,resolution=merge-duplicates", ...(init.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
}
async function rows(path: string, init: RequestInit = {}) {
  const response = await db(path, init);
  if (!response.ok) return [];
  try { return await response.json(); } catch { return []; }
}
async function profile() {
  const [state] = await rows("jarvis_state?id=eq.1&select=name,lang,hear,memory");
  return { name: clean(state?.name || "Crew", 30), lang: state?.lang === "es" ? "es" : "en", hear: state?.hear === "en-US" ? "en-US" : "es-ES", memory: Array.isArray(state?.memory) ? state.memory.slice(-40) : [] };
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
const callsReady = () => !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM") && env("JARVIS_PHONE_TO"));
async function twilio(path: string, form?: Record<string, string>) {
  const sid = env("TWILIO_ACCOUNT_SID");
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/${path}`, {
    method: form ? "POST" : "GET",
    headers: { Authorization: "Basic " + btoa(sid + ":" + env("TWILIO_AUTH_TOKEN")), "Content-Type": "application/x-www-form-urlencoded" },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(10000),
  });
}
async function placeCall(message: string, lang: string) {
  const payload = b64url(JSON.stringify({ x: message.slice(0, 400), l: lang, e: Date.now() + 15 * 60000 }));
  const token = payload + "." + hex(await hmac("SHA-256", env("JARVIS_KEY"), "voice:" + payload));
  const response = await twilio("Calls.json", { To: env("JARVIS_PHONE_TO"), From: env("TWILIO_FROM"), Url: `${base()}?step=answer&t=${token}`, Method: "POST", Timeout: "30" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) console.log("jarvis-call Twilio status", response.status, clean(data.message, 160));
  return response.ok ? String(data.sid || "") : "";
}
// Point the number's incoming calls at this function, so the user can ring Jarvis.
async function connectInbound() {
  const list = await (await twilio("IncomingPhoneNumbers.json?PhoneNumber=" + encodeURIComponent(env("TWILIO_FROM")))).json().catch(() => ({}));
  const number = list.incoming_phone_numbers?.[0];
  if (!number?.sid) return false;
  return (await twilio(`IncomingPhoneNumbers/${number.sid}.json`, { VoiceUrl: base() + "?step=inbound", VoiceMethod: "POST" })).ok;
}

// TwiML: say a line in Jarvis's voice, then listen for the answer.
async function speak(text: string, lang: string, hear: string, end = false) {
  const play = `<Play>${xml(await voiceUrl(text, lang))}</Play>`;
  if (end) return twiml(play + "<Hangup/>");
  const action = xml(base() + "?step=turn");
  return twiml(`${play}<Gather input="speech" language="${hear}" speechTimeout="auto" actionOnEmptyResult="true" method="POST" action="${action}"/>`);
}
const twiml = (body: string) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { headers: { "Content-Type": "text/xml" } });

const PHONE_TOOLS = [
  { name: "set_reminder", strict: true, description: "Remind the user later: by phone call, spoken on the Chromebook, or by email.",
    input_schema: { type: "object", additionalProperties: false, required: ["due", "text", "via"], properties: {
      due: { type: "string", description: "ISO 8601 with the user's UTC offset." }, text: { type: "string" },
      via: { type: "string", enum: ["call", "chromebook", "email"] } } } },
  { name: "browser_task", strict: true, description: "Start a multi-step job in the Chromebook's browser (Teams, Gmail, Drive, forms). The result is spoken on the Chromebook.",
    input_schema: { type: "object", additionalProperties: false, required: ["task"], properties: { task: { type: "string" } } } },
  { name: "remember", strict: true, description: "Save a short fact about the user to long-term memory.",
    input_schema: { type: "object", additionalProperties: false, required: ["fact"], properties: { fact: { type: "string" } } } },
  { name: "end_call", strict: true, description: "Hang up after saying goodbye, when the user is done.",
    input_schema: { type: "object", additionalProperties: false, required: ["goodbye"], properties: { goodbye: { type: "string" } } } },
];

async function reply(turns: { role: string; content: string }[], who: Awaited<ReturnType<typeof profile>>) {
  const lang = who.lang === "es" ? "Spanish (Spain)" : "English";
  const now = new Date().toLocaleString("en-GB", { timeZone: env("JARVIS_TIMEZONE") || "Europe/Madrid", dateStyle: "full", timeStyle: "short" });
  const system =
    `You are Jarvis, ${who.name}'s AI assistant, talking to ${who.name} on a phone call. Your words are spoken by a voice synthesizer: ` +
    `reply in ${lang} only, one or two short natural sentences, no markdown, lists, emoji or URLs. Be warm, witty and a little dry, like a loyal butler AI. ` +
    `${who.name} may speak Spanish or English; the speech recognition can mishear, so guess sensibly. ` +
    `You can set reminders, start browser jobs on the Chromebook, remember facts, and end the call with end_call when ${who.name} says goodbye or is done. ` +
    `Local time: ${now} (${env("JARVIS_TIMEZONE") || "Europe/Madrid"}). ` +
    (who.memory.length ? `What you remember about ${who.name}: ${who.memory.map((m: unknown) => clean(m, 200)).join(" | ")}.` : "");
  const messages = [{ role: "user", content: "[The phone call has connected.]" }, ...turns].slice(-30);
  if (messages[0].role !== "user") messages.unshift({ role: "user", content: "[Call in progress.]" });
  const model = env("CLAUDE_MODEL") || "claude-opus-5-5";
  const client = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 1, timeout: 12000 });
  const params: Record<string, unknown> = { model, max_tokens: 4000, output_config: { effort: "low" }, system, messages, tools: PHONE_TOOLS };
  if (FALLBACK_MODELS.includes(model)) Object.assign(params, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  // deno-lint-ignore no-explicit-any
  const response: any = await client.beta.messages.create(params as any);
  // deno-lint-ignore no-explicit-any
  let text = clean((response.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join(" "), 400);
  let end = false;
  for (const block of response.content || []) {
    if (block.type !== "tool_use") continue;
    const input = block.input || {};
    try {
      if (block.name === "end_call") { end = true; text = clean(input.goodbye, 300) || text; }
      if (block.name === "remember" && clean(input.fact, 200)) await broadcast({ action: "remember", fact: clean(input.fact, 200) });
      if (block.name === "browser_task" && clean(input.task, 600)) await broadcast({ action: "agent", task: clean(input.task, 600), lang: who.lang });
      if (block.name === "set_reminder") {
        const due = new Date(String(input.due || ""));
        if (!isNaN(+due) && clean(input.text, 400)) await db("jarvis_reminders", { method: "POST", body: JSON.stringify({ due_at: due.toISOString(), text: clean(input.text, 400), via: ["call", "chromebook", "email"].includes(input.via) ? input.via : "chromebook", lang: who.lang }) });
      }
    } catch (error) { console.log("jarvis-call tool failed", block.name, String((error as Error).message).slice(0, 100)); }
  }
  return { text: text || (who.lang === "es" ? "Hecho." : "Done."), end };
}

async function deliverDue() {
  const due = await rows(`jarvis_reminders?done=eq.false&due_at=lte.${encodeURIComponent(new Date().toISOString())}&order=due_at.asc&limit=10&select=id,text,via,lang`);
  const results: string[] = [];
  for (const r of due) {
    // Claim it first so two cron runs never deliver the same reminder twice.
    const claimed = await rows(`jarvis_reminders?id=eq.${encodeURIComponent(r.id)}&done=eq.false`, { method: "PATCH", body: JSON.stringify({ done: true, delivered_at: new Date().toISOString() }) });
    if (!claimed.length) continue;
    let via = r.via;
    if (via === "call" && !(callsReady() && await placeCall(r.text, r.lang))) via = "chromebook";
    if (via === "email") {
      const key = env("RESEND_API_KEY"), to = env("JARVIS_EMAIL_TO");
      const sent = key && to && (await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify({ from: "Jarvis <onboarding@resend.dev>", to: [to], subject: "Jarvis: " + clean(r.text, 80), text: r.text }),
        signal: AbortSignal.timeout(10000),
      })).ok;
      if (!sent) via = "chromebook";
    }
    if (via === "chromebook") await broadcast({ action: "remind", text: r.text, lang: r.lang }).catch(() => {});
    results.push(via);
  }
  return results;
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url), step = url.searchParams.get("step") || "";
  try {
    // ---- Twilio fetches a spoken line ----
    if (step === "voice") {
      const v = await readToken(url.searchParams.get("t") || "");
      if (!v) return new Response("Forbidden", { status: 403 });
      const voice = env("ELEVENLABS_VOICE_ID") || "onwK4e9ZLuTAKqWW03F9";
      const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_22050_32`, {
        method: "POST", headers: { "xi-api-key": env("ELEVENLABS_API_KEY"), "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text: v.x, model_id: env("ELEVENLABS_MODEL") || "eleven_flash_v2_5", language_code: v.l === "es" ? "es" : "en",
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true } }),
        signal: AbortSignal.timeout(15000),
      });
      if (!upstream.ok) { console.log("jarvis-call ElevenLabs status", upstream.status); return new Response("Voice unavailable", { status: 502 }); }
      return new Response(upstream.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=900" } });
    }

    // ---- Every minute from pg_cron ----
    if (step === "cron") {
      // The shared secret lives in Vault ('jarvis_cron'); the database checks it.
      const token = (request.headers.get("x-jarvis-cron") || "").slice(0, 200);
      const check = token.length >= 16 ? await db("rpc/jarvis_cron_check", { method: "POST", body: JSON.stringify({ token }) }) : null;
      if (!check?.ok || (await check.json().catch(() => false)) !== true) return new Response("Forbidden", { status: 403 });
      return Response.json({ delivered: await deliverDue() });
    }

    // ---- Webhooks from Twilio during a call ----
    if (step === "answer" || step === "turn" || step === "inbound") {
      if (request.method !== "POST" || !env("TWILIO_AUTH_TOKEN")) return new Response("Forbidden", { status: 403 });
      const params: Record<string, string> = {};
      for (const [k, v] of new URLSearchParams(await request.text())) params[k] = v;
      if (!(await fromTwilio(request, params))) return new Response("Forbidden", { status: 403 });
      const who = await profile(), sid = clean(params.CallSid, 64);
      if (step === "inbound") {
        // Only the owner's phone may talk to Jarvis.
        if (params.From !== env("JARVIS_PHONE_TO")) return twiml("<Reject/>");
        const hello = who.lang === "es" ? `Dime, ${who.name}.` : `Yes, ${who.name}?`;
        await db("jarvis_calls", { method: "POST", body: JSON.stringify({ sid, turns: [{ role: "assistant", content: hello }], misses: 0 }) });
        return await speak(hello, who.lang, who.hear);
      }
      if (step === "answer") {
        const v = await readToken(url.searchParams.get("t") || "");
        const opening = v?.x || (who.lang === "es" ? `Hola ${who.name}, soy Jarvis.` : `Hello ${who.name}, Jarvis here.`);
        await db("jarvis_calls", { method: "POST", body: JSON.stringify({ sid, turns: [{ role: "assistant", content: opening }], misses: 0 }) });
        return await speak(opening, v?.l || who.lang, who.hear);
      }
      // A turn: what the user said (empty if they said nothing).
      const [call] = await rows(`jarvis_calls?sid=eq.${encodeURIComponent(sid)}&select=turns,misses`);
      const turns: { role: string; content: string }[] = Array.isArray(call?.turns) ? call.turns : [];
      const heard = clean(params.SpeechResult, 500);
      if (!heard) {
        const misses = (call?.misses || 0) + 1;
        await db(`jarvis_calls?sid=eq.${encodeURIComponent(sid)}`, { method: "PATCH", body: JSON.stringify({ misses }) });
        if (misses >= 2) return await speak(who.lang === "es" ? "Te dejo. Hasta luego." : "I'll let you go. Speak soon.", who.lang, who.hear, true);
        return await speak(who.lang === "es" ? "¿Sigues ahí?" : "Are you still there?", who.lang, who.hear);
      }
      turns.push({ role: "user", content: heard });
      let answer;
      try { answer = await reply(turns, who); }
      catch (error) { console.log("jarvis-call Claude", String((error as Error).message).slice(0, 160)); answer = { text: who.lang === "es" ? "Perdona, no te he entendido. ¿Puedes repetirlo?" : "Sorry, I didn't catch that. Could you say it again?", end: false }; }
      turns.push({ role: "assistant", content: answer.text });
      await db(`jarvis_calls?sid=eq.${encodeURIComponent(sid)}`, { method: "PATCH", body: JSON.stringify({ turns: turns.slice(-40), misses: 0 }) });
      return await speak(answer.text, who.lang, who.hear, answer.end);
    }

    // ---- From the desk or the brain: ring the user now ----
    const normalize = (x: string) => x.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "").toLowerCase();
    const origin = normalize(request.headers.get("origin") || "");
    const allowed = env("APP_ORIGINS").split(/[,\s]+/).map(normalize).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "null",
      "Access-Control-Allow-Headers": "content-type, x-jarvis-key, authorization, apikey, x-client-info",
      "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin", "Cache-Control": "no-store",
    };
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
    // Browsers must come from the app; the brain function calls server-to-server (no Origin).
    if (origin && !allowed.includes(origin)) return json(403, { error: "Origin not allowed" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json(405, { error: "POST required" });
    const expected = env("JARVIS_KEY");
    if (expected.length < 6 || !same((request.headers.get("x-jarvis-key") || "").trim(), expected)) return json(401, { error: "Wrong Jarvis key" });
    // deno-lint-ignore no-explicit-any
    let body: any = {};
    try { body = await request.json(); } catch { /* defaults */ }
    // A new computer running the desk gets back what Jarvis remembers.
    if (body.action === "state") { const who = await profile(); return json(200, { name: who.name, memory: who.memory, calls: callsReady() }); }
    if (!callsReady()) return json(428, { error: "Calls not configured" });
    const who = await profile();
    const message = clean(body.message, 300) || (who.lang === "es" ? `Hola ${who.name}, soy Jarvis. Esto es una prueba: ya puedo llamarte.` : `Hello ${who.name}, Jarvis here. Just testing: I can call you now.`);
    if (body.action === "test") await connectInbound().catch(() => false);
    const sid = await placeCall(message, who.lang);
    return sid ? json(200, { ok: true, sid }) : json(502, { error: "Call failed" });
  } catch (error) {
    console.log("jarvis-call error", step, String((error as Error).message).slice(0, 200));
    if (step === "turn" || step === "answer" || step === "inbound") return twiml("<Say>Sorry, something went wrong.</Say><Hangup/>");
    return new Response(JSON.stringify({ error: "Unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }
});
