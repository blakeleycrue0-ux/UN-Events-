// Supabase Edge Function: Jarvis's conversation brain, powered by Claude.
// The Anthropic API key stays in Supabase secrets; the browser sends only the
// short conversation plus the private JARVIS_KEY.
import Anthropic from "npm:@anthropic-ai/sdk";

const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

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
  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
  if (expected.length < 6 || !apiKey) return json(428, { error: "Brain not configured" });
  const given = (request.headers.get("x-jarvis-key") || "").trim();
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  if (diff) return json(401, { error: "Wrong Jarvis key" });

  // Validate the short conversation the page keeps.
  let body: { messages?: { role: string; content: string }[]; lang?: string; name?: string; now?: string } = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const turns = Array.isArray(body.messages) ? body.messages : [];
  const valid = turns.length >= 1 && turns.length <= 20 && turns.every((m, i) =>
    m && typeof m.content === "string" && m.content.trim() && m.content.length <= 1000 &&
    m.role === (i % 2 === 0 ? "user" : "assistant")) && turns.length % 2 === 1;
  if (!valid) return json(400, { error: "Invalid conversation" });
  const lang = body.lang === "es" ? "Spanish (Spain)" : "English";
  const name = String(body.name || "Crew").slice(0, 30);
  const now = String(body.now || "").slice(0, 80);

  const system =
    `You are Jarvis, the AI assistant that lives in ${name}'s bedroom, shown on a phone mounted on the wall facing the door. ` +
    `Your replies are spoken aloud by a voice synthesizer, so: answer in ${lang} only, in one to three short natural sentences, ` +
    `with no markdown, lists, emoji or URLs. Be warm, witty and a little dry, like a loyal butler AI. ${name} may talk to you in Spanish or English; ` +
    `always reply in ${lang}. Smart-home control (lights, air conditioning, fan, TV, PlayStation) is not connected yet; ` +
    `if asked, say it is coming soon rather than pretending. You cannot browse the web or see live data such as weather or news; say so briefly if asked.`;
  const messages = turns.map((m, i) => ({
    role: m.role as "user" | "assistant",
    content: i === turns.length - 1 && now ? `[Local time: ${now}]\n${m.content.trim()}` : m.content.trim(),
  }));

  const model = (Deno.env.get("CLAUDE_MODEL") || "claude-opus-5-5").trim();
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45000 });
  try {
    const params: Record<string, unknown> = {
      model,
      max_tokens: 16000,
      output_config: { effort: "low" }, // quick conversational replies
      system,
      messages,
    };
    // Server-side refusal fallback: another model answers if this one declines.
    if (FALLBACK_MODELS.includes(model)) Object.assign(params, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    // deno-lint-ignore no-explicit-any
    const response: any = await client.beta.messages.create(params as any);
    if (response.stop_reason === "refusal") return json(200, { reply: "", refused: true });
    const reply = (response.content || [])
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text).join(" ").replace(/\s+/g, " ").trim();
    return json(200, { reply: reply.slice(0, 600) });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError)
      return json(502, { error: "Claude key rejected" });
    if (error instanceof Anthropic.RateLimitError) return json(502, { error: "Claude busy" });
    if (error instanceof Anthropic.BadRequestError) {
      console.log("jarvis-brain bad request", String((error as Error).message).slice(0, 200));
      return json(502, { error: /credit|billing/i.test(String((error as Error).message)) ? "Claude credit exhausted" : "Claude request rejected" });
    }
    if (error instanceof Anthropic.APIError) {
      console.log("jarvis-brain Claude status", (error as { status?: number }).status);
      return json(502, { error: "Claude unavailable" });
    }
    return json(503, { error: "Claude unavailable" });
  }
});
