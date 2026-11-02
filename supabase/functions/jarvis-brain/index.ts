// Supabase Edge Function: Jarvis's conversation brain, powered by Claude.
// The Anthropic API key stays in Supabase secrets; the browser sends only the
// short conversation plus the private JARVIS_KEY.
import Anthropic from "npm:@anthropic-ai/sdk";

const FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"];

// What Jarvis can do on the user's computer (through the Jarvis Chrome extension)
// and by email. The extension only accepts these fixed actions; it never opens
// an arbitrary URL from a message.
const SITES = ["youtube", "spotify", "teams", "gmail", "classroom", "netflix", "google", "calendar"];
const TOOLS = [
  {
    name: "play_music", strict: true,
    description: "Play music or a video on the user's computer. Use YouTube unless the user asks for Spotify.",
    input_schema: { type: "object", additionalProperties: false, required: ["query", "service"], properties: {
      query: { type: "string", description: "Song, artist, playlist, genre or video to search for." },
      service: { type: "string", enum: ["youtube", "spotify"] },
    } },
  },
  {
    name: "media_control", strict: true,
    description: "Pause, resume, skip, go back, or change the volume of the music or video playing on the computer.",
    input_schema: { type: "object", additionalProperties: false, required: ["action"], properties: {
      action: { type: "string", enum: ["pause", "resume", "next", "previous", "louder", "quieter"] },
    } },
  },
  {
    name: "open_site", strict: true,
    description: "Open a site on the computer. 'teams' is Microsoft Teams (school assignments), 'classroom' is Google Classroom.",
    input_schema: { type: "object", additionalProperties: false, required: ["site"], properties: {
      site: { type: "string", enum: SITES },
    } },
  },
  {
    name: "web_search", strict: true,
    description: "Search Google on the computer and show the results.",
    input_schema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string" } } },
  },
  {
    name: "remember", strict: true,
    description: "Save a short fact about the user to your long-term memory (plans, exams, likes, people, promises). Use it whenever they tell you something worth remembering later.",
    input_schema: { type: "object", additionalProperties: false, required: ["fact"], properties: { fact: { type: "string", description: "One short sentence, in English." } } },
  },
  {
    name: "email_me", strict: true,
    description: "Send an email to the user's own inbox, for reminders, notes, lists or anything they ask to receive by email.",
    input_schema: { type: "object", additionalProperties: false, required: ["subject", "body"], properties: {
      subject: { type: "string" }, body: { type: "string" },
    } },
  },
  {
    name: "browser_task", strict: true,
    description: "Do a multi-step job in the computer's web browser for the user: check Teams or Classroom assignments, read or search emails in Gmail, find, open or download files in Drive, fill in a form, hand in work. It runs in the background; the user is asked by voice before anything that can't be undone, and the result is spoken when it finishes.",
    input_schema: { type: "object", additionalProperties: false, required: ["task"], properties: {
      task: { type: "string", description: "Complete, self-contained instruction in English, with every detail the user gave (which subject, which file, what to check)." },
    } },
  },
  {
    name: "set_reminder", strict: true,
    description: "Remind the user of something at a given time: spoken aloud on the desk computer, or by email.",
    input_schema: { type: "object", additionalProperties: false, required: ["due", "text", "via"], properties: {
      due: { type: "string", description: "When, as ISO 8601 with the user's UTC offset, e.g. 2026-11-03T08:00:00+01:00." },
      text: { type: "string", description: "What Jarvis will say at that moment: one or two natural sentences addressed to the user, in the language of the conversation." },
      via: { type: "string", enum: ["desk", "email"], description: "desk = Jarvis says it out loud in the room (default); email = sent to their inbox." },
    } },
  },
];
async function sha256(text: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
// The computer's extension listens on a channel whose name is derived from the private Jarvis key.
async function sendToChromebook(key: string, command: Record<string, unknown>) {
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const topic = "jarvis-pc-" + (await sha256("jarvis-pc:" + key)).slice(0, 40);
  const response = await fetch(url + "/realtime/v1/api/broadcast", {
    method: "POST",
    headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic, event: "command", payload: { ...command, at: Date.now() }, private: false }] }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw Error("broadcast " + response.status);
}
// Small tables (service role only): reminders, and the user's name, language
// and memory so a new computer running the desk gets them back.
async function db(path: string, init: RequestInit = {}) {
  const url = Deno.env.get("SUPABASE_URL")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  return fetch(url + "/rest/v1/" + path, {
    ...init,
    headers: { apikey: service, Authorization: "Bearer " + service, "Content-Type": "application/json", Prefer: "return=minimal,resolution=merge-duplicates", ...(init.headers || {}) },
    signal: AbortSignal.timeout(8000),
  });
}
async function emailMe(subject: string, body: string) {
  const key = (Deno.env.get("RESEND_API_KEY") || "").trim(), to = (Deno.env.get("JARVIS_EMAIL_TO") || "").trim();
  if (!key || !to) return "not configured";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "Jarvis <onboarding@resend.dev>", to: [to], subject: subject.slice(0, 150), text: body.slice(0, 5000) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { console.log("jarvis-brain email status", response.status); return "failed"; }
  return "sent";
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
  const apiKey = (Deno.env.get("ANTHROPIC_API_KEY") || "").trim().replace(/^["']+|["']+$/g, "");
  if (expected.length < 6 || !apiKey) return json(428, { error: "Brain not configured" });
  const given = (request.headers.get("x-jarvis-key") || "").trim();
  const a = new TextEncoder().encode(given), b = new TextEncoder().encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
  if (diff) return json(401, { error: "Wrong Jarvis key" });

  // Validate the short conversation the page keeps.
  let body: { messages?: { role: string; content: string }[]; lang?: string; name?: string; now?: string; memory?: unknown; context?: string; hear?: string } = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const turns = Array.isArray(body.messages) ? body.messages : [];
  const valid = turns.length >= 1 && turns.length <= 20 && turns.every((m, i) =>
    m && typeof m.content === "string" && m.content.trim() && m.content.length <= 1000 &&
    m.role === (i % 2 === 0 ? "user" : "assistant")) && turns.length % 2 === 1;
  if (!valid) return json(400, { error: "Invalid conversation" });
  const lang = body.lang === "es" ? "Spanish (Spain)" : "English";
  const name = String(body.name || "Crew").slice(0, 30);
  const now = String(body.now || "").slice(0, 80);
  // Long-term memory and live context kept by the desk page.
  const memory = (Array.isArray(body.memory) ? body.memory : []).slice(-40).map((m) => String(m).replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean);
  const context = String(body.context || "").replace(/\s+/g, " ").slice(0, 300);
  // Save name, language and memory so another computer can get them back.
  await db("jarvis_state", { method: "POST", body: JSON.stringify({ id: 1, name, lang: body.lang === "es" ? "es" : "en", hear: body.hear === "en-US" ? "en-US" : "es-ES", memory, updated_at: new Date().toISOString() }) }).catch(() => {});

  const system =
    `You are Jarvis, the AI assistant of ${name}'s bedroom: you live on the computer on the desk, with a camera on the wall that tells you who comes through the door. ` +
    `Your replies are spoken aloud by a voice synthesizer, so: answer in ${lang} only, in one to three short natural sentences, ` +
    `with no markdown, lists, emoji or URLs. Be warm, witty and a little dry, like a loyal butler AI. ${name} may talk to you in Spanish or English; ` +
    `always reply in ${lang}. You can control ${name}'s Chrome browser with your tools (music on YouTube or Spotify, pause or skip, ` +
    `open sites, Google searches), send ${name} emails and set reminders. When you use a tool, say in a few words what you did. ` +
    `For anything that needs several steps in the browser (reading Teams or Classroom assignments, reading emails, finding, downloading or handing in files, forms) use browser_task and just say you're on it: the result is spoken when it's done. ` +
    `For reminders, work out the exact date and time from the local time given. You cannot make phone calls. Smart-home control (lights, air conditioning, fan, TV, PlayStation) ` +
    `is not connected yet; if asked, say it is coming soon rather than pretending. You cannot see news; offer a web search instead. ` +
    `Messages that start with [Event] come from the room's sensors, not from ${name}; respond to them as instructed, briefly. ` +
    (context ? `Live context: ${context}. ` : "") +
    (memory.length ? `What you remember about ${name} (use it naturally, never recite it): ${memory.join(" | ")}.` : "");
  const messages = turns.map((m, i) => ({
    role: m.role as "user" | "assistant",
    content: i === turns.length - 1 && now ? `[Local time: ${now}]\n${m.content.trim()}` : m.content.trim(),
  }));

  // Claude Haiku 5.5 by default: ~40x cheaper than Opus. Set CLAUDE_MODEL to change it.
  const model = (Deno.env.get("CLAUDE_MODEL") || "claude-haiku-5-5").trim();
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 45000 });
  try {
    const params: Record<string, unknown> = {
      model,
      max_tokens: 1024, // spoken replies are short
      output_config: { effort: "low" }, // quick conversational replies
      system,
      messages,
      tools: TOOLS,
    };
    // Server-side refusal fallback: another model answers if this one declines.
    if (FALLBACK_MODELS.includes(model)) Object.assign(params, { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    // deno-lint-ignore no-explicit-any
    const response: any = await client.beta.messages.create(params as any);
    if (response.stop_reason === "refusal") return json(200, { reply: "", refused: true });
    let reply = (response.content || [])
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text).join(" ").replace(/\s+/g, " ").trim();
    // Carry out the actions Claude chose. The reply already says what was done.
    const actions: string[] = [], remembered: string[] = [];
    for (const block of response.content || []) {
      if (block.type !== "tool_use") continue;
      const input = block.input || {};
      try {
        if (block.name === "remember") {
          const fact = String(input.fact || "").replace(/\s+/g, " ").trim().slice(0, 200);
          if (fact) { remembered.push(fact); actions.push("remember"); }
        } else if (block.name === "email_me") {
          const result = await emailMe(String(input.subject || "Jarvis"), String(input.body || ""));
          actions.push("email:" + result);
          if (result !== "sent") reply = lang === "English"
            ? (result === "not configured" ? "I can't send emails yet: email isn't set up." : "I couldn't send the email, sorry.")
            : (result === "not configured" ? "Todavía no puedo enviar emails: falta configurarlo." : "No he podido enviar el email, lo siento.");
        } else if (block.name === "browser_task") {
          const task = String(input.task || "").replace(/\s+/g, " ").trim().slice(0, 600);
          if (task) { await sendToChromebook(given, { action: "agent", task, lang: body.lang === "es" ? "es" : "en" }); actions.push("agent"); }
        } else if (block.name === "set_reminder") {
          const due = new Date(String(input.due || "")), text = String(input.text || "").replace(/\s+/g, " ").trim().slice(0, 400);
          const via = input.via === "email" ? "email" : "chromebook";
          const ok = !isNaN(+due) && due.getTime() > Date.now() - 60000 && !!text &&
            (await db("jarvis_reminders", { method: "POST", body: JSON.stringify({ due_at: due.toISOString(), text, via, lang: body.lang === "es" ? "es" : "en" }) })).ok;
          actions.push(ok ? "reminder:" + via : "reminder:failed");
          if (!ok) reply = lang === "English" ? "I couldn't save that reminder." : "No he podido guardar el recordatorio.";
        } else if (block.name === "play_music") {
          await sendToChromebook(given, { action: "play", service: input.service === "spotify" ? "spotify" : "youtube", query: String(input.query || "").slice(0, 200) });
          actions.push("play");
        } else if (block.name === "media_control" && ["pause", "resume", "next", "previous", "louder", "quieter"].includes(input.action)) {
          await sendToChromebook(given, { action: input.action });
          actions.push(input.action);
        } else if (block.name === "open_site" && SITES.includes(input.site)) {
          await sendToChromebook(given, { action: "open", site: input.site });
          actions.push("open:" + input.site);
        } else if (block.name === "web_search") {
          await sendToChromebook(given, { action: "search", query: String(input.query || "").slice(0, 200) });
          actions.push("search");
        }
      } catch (error) {
        console.log("jarvis-brain action failed", block.name, String((error as Error).message).slice(0, 120));
        reply = lang === "English" ? "I couldn't reach your computer." : "No he podido llegar a tu ordenador.";
      }
    }
    if (!reply) reply = lang === "English" ? "Done." : "Hecho.";
    return json(200, { reply: reply.slice(0, 600), actions, ...(remembered.length ? { remember: remembered } : {}) });
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
