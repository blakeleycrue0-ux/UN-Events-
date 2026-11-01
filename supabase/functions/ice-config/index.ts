// Supabase Edge Function. TURN_SHARED_SECRET stays on the server, never in the web app.
Deno.serve(async (request: Request) => {
  // Tolerate common typing slips in the secret: spaces, quotes, trailing slashes, case.
  const normalize = (x: string) => x.trim().replace(/^["']+|["']+$/g, "").replace(/\/+$/, "").toLowerCase();
  const origin = normalize(request.headers.get("origin") || "");
  const allowed = (Deno.env.get("APP_ORIGINS") || "")
    .split(/[,\s]+/)
    .map(normalize)
    .filter(Boolean);
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
  if (!origin || !allowed.includes(origin)) {
    console.log("ice-config rejected origin", JSON.stringify(origin), "allowed", JSON.stringify(allowed));
    return reply(403, { error: "Origin not allowed" });
  }
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
    let body: { pairId?: string } = {};
    try { body = await request.json(); } catch { /* Legacy client sends no body. */ }
    if (body.pairId !== undefined &&
      (typeof body.pairId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.pairId)))
      return reply(400, { error: "Invalid paired camera" });
    const membership = await fetch(
      url +
        (body.pairId
          ? "/rest/v1/camera_links?select=id,camera_id,viewer_id&id=eq." + body.pairId + "&revoked=eq.false&camera_id=not.is.null"
          : "/rest/v1/remote_memberships?select=user_id&enabled=eq.true&user_id=eq." + id),
      { headers: upstreamHeaders },
    );
    if (!membership.ok || (await membership.json()).length !== 1)
      return reply(403, {
        error: "Remote access not enabled for this device or account",
      });
    // Optional hosted TURN avoids having to run a Coturn server. Only ephemeral
    // credentials reach the browser; the API token remains an Edge secret.
    const turnKey = Deno.env.get("CLOUDFLARE_TURN_KEY_ID");
    const turnToken = Deno.env.get("CLOUDFLARE_TURN_API_TOKEN");
    if (turnKey || turnToken) {
      if (!turnKey || !/^[a-zA-Z0-9_-]+$/.test(turnKey) || !turnToken)
        return reply(428, { error: "Hosted TURN configuration is incomplete" });
      const result = await fetch(
        "https://rtc.live.cloudflare.com/v1/turn/keys/" + turnKey + "/credentials/generate",
        { method: "POST", headers: { Authorization: "Bearer " + turnToken, "Content-Type": "application/json" },
          body: JSON.stringify({ ttl: 3600 }), signal: AbortSignal.timeout(10000) },
      );
      if (!result.ok) {
        console.log("ice-config Cloudflare TURN status", result.status);
        return reply(503, { error: "Hosted TURN is unavailable" });
      }
      const payload = await result.json();
      const servers = [].concat(payload.iceServers || []).map(server => ({
        urls: [].concat(server.urls || []).filter(u => typeof u === "string" && /^turns?:/.test(u)),
        username: server.username, credential: server.credential,
      }));
      if (!servers.length || !servers.every(server => server.urls.length &&
          typeof server.username === "string" && typeof server.credential === "string" &&
          server.username && server.credential))
        return reply(503, { error: "Hosted TURN returned no usable relay" });
      return reply(200, { iceServers: servers, expiresAt: Math.floor(Date.now() / 1000) + 3600 });
    }
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
