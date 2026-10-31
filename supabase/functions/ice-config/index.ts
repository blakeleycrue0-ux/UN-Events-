// Supabase Edge Function. TURN_SHARED_SECRET stays on the server, never in the web app.
Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin") || "";
  const allowed = (Deno.env.get("APP_ORIGINS") || "")
    .split(",")
    .map((x) => x.trim());
  const headers = {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Cache-Control": "no-store",
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  if (!allowed.includes(origin))
    return reply(403, { error: "Origin not allowed" });
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply(405, { error: "POST required" });
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer "))
    return reply(401, { error: "Authentication required" });
  const url = Deno.env.get("SUPABASE_URL")!,
    key = Deno.env.get("SUPABASE_ANON_KEY")!;
  const upstreamHeaders = { authorization, apikey: key };
  try {
    const userResponse = await fetch(url + "/auth/v1/user", {
      headers: upstreamHeaders,
    });
    if (!userResponse.ok) return reply(401, { error: "Invalid session" });
    const { id } = await userResponse.json();
    if (typeof id !== "string" || !/^[a-f0-9-]{36}$/i.test(id))
      return reply(401, { error: "Invalid user" });
    const membership = await fetch(
      url +
        "/rest/v1/remote_memberships?select=user_id&enabled=eq.true&user_id=eq." +
        id,
      { headers: upstreamHeaders },
    );
    if (!membership.ok || (await membership.json()).length !== 1)
      return reply(403, {
        error: "Remote access not enabled for this account",
      });
    const secret = Deno.env.get("TURN_SHARED_SECRET");
    const urls = JSON.parse(Deno.env.get("TURN_URLS_JSON") || "[]");
    if (
      !secret ||
      secret.length < 32 ||
      !Array.isArray(urls) ||
      !urls.length ||
      !urls.every((u) => typeof u === "string" && /^turns?:/.test(u))
    )
      return reply(428, {
        error: "Authenticated TURN relay is not configured",
      });
    const expires = Math.floor(Date.now() / 1000) + 3600,
      username = expires + ":" + id;
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"],
    );
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(username),
      ),
    );
    const credential = btoa(String.fromCharCode(...signature));
    return reply(200, {
      iceServers: [{ urls, username, credential }],
      expiresAt: expires,
    });
  } catch {
    return reply(503, { error: "Connection configuration unavailable" });
  }
});
