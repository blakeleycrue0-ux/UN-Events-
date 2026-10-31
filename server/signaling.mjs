import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import crypto from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";

export function startSignaling(config = {}) {
  const development = config.development === true;
  const accessToken = config.accessToken;
  if (!accessToken || accessToken.length < 32)
    throw Error(
      "Configure an installation access token of at least 32 characters",
    );
  const origins = new Set(config.origins || []);
  if (!origins.size) throw Error("Configure allowed browser origins");
  if (!development && !config.tls && !config.trustProxy)
    throw Error("Production requires TLS or a trusted local TLS proxy");
  if (
    !development &&
    !(config.iceServers || []).some(
      (s) =>
        [].concat(s.urls || []).some((u) => /^turns?:/.test(u)) &&
        s.username &&
        s.credential,
    )
  )
    throw Error("Production requires authenticated TURN relay configuration");
  const host =
    !development && config.trustProxy
      ? "127.0.0.1"
      : config.host || "127.0.0.1";
  const ttl = Math.min(config.ttl || 3600000, 3600000);
  const rooms = new Map();
  const server = (config.tls ? https : http).createServer(
    config.tls || {},
    (req, res) => {
      res.writeHead(req.url === "/health" ? 200 : 404, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(req.url === "/health" ? '{"ok":true}' : "{}");
    },
  );
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    const secure =
      req.socket.encrypted ||
      (config.trustProxy && req.headers["x-forwarded-proto"] === "https");
    if (
      (!development && !secure) ||
      !origins.has(req.headers.origin) ||
      req.url !== "/" ||
      wss.clients.size >= 64
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  const send = (ws, data) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  const same = (a, b) => {
    const x = Buffer.from(a || ""),
      y = Buffer.from(b || "");
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  };
  const identity = (secret) =>
    crypto.createHash("sha256").update(secret).digest("hex");
  function remove(ws) {
    clearTimeout(ws.authTimer);
    const room = rooms.get(ws.room);
    if (!room) return;
    if (ws.role === "camera" && room.camera === ws) {
      clearTimeout(room.timer);
      rooms.delete(ws.room);
      send(room.viewer, { type: "closed" });
      room.viewer?.close(1000, "Camera disconnected");
    } else if (room.viewer === ws) {
      room.viewer = null;
      send(room.camera, { type: "viewer-left" });
    }
  }
  wss.on("connection", (ws) => {
    ws.alive = true;
    ws.on("pong", () => (ws.alive = true));
    ws.authTimer = setTimeout(
      () => ws.close(1008, "Authentication required"),
      10000,
    );
    let budget = 0,
      windowStart = Date.now();
    ws.on("error", () => {});
    ws.on("close", () => remove(ws));
    ws.on("message", (raw) => {
      if (Date.now() - windowStart > 10000) {
        budget = 0;
        windowStart = Date.now();
      }
      if (++budget > 100) {
        ws.close(1008, "Message limit");
        return;
      }
      try {
        const m = JSON.parse(raw.toString());
        if (!ws.room) {
          if (
            !["create", "join"].includes(m.type) ||
            typeof m.secret !== "string" ||
            !/^[a-f0-9]{48}$/.test(m.secret)
          ) {
            ws.close(1008, "Invalid authentication");
            return;
          }
          const id = identity(m.secret);
          if (m.type === "create") {
            if (
              !same(m.accessToken, accessToken) ||
              rooms.size >= 16 ||
              rooms.has(id)
            ) {
              ws.close(1008, "Not authorized");
              return;
            }
            const room = { camera: ws, viewer: null };
            rooms.set(id, room);
            ws.role = "camera";
            ws.room = id;
            room.timer = setTimeout(() => {
              ws.close(1000, "Pairing expired");
              remove(ws);
            }, ttl);
            send(ws, {
              type: "created",
              iceServers: config.iceServers || [],
              expiresIn: ttl,
            });
          } else {
            const room = rooms.get(id);
            if (!room || room.viewer) {
              ws.close(1008, "Not authorized");
              return;
            }
            ws.role = "viewer";
            ws.room = id;
            room.viewer = ws;
            send(ws, { type: "joined", iceServers: config.iceServers || [] });
            send(room.camera, { type: "viewer-ready" });
          }
          clearTimeout(ws.authTimer);
          return;
        }
        const room = rooms.get(ws.room);
        if (!room) return;
        if (
          m.type === "candidate" &&
          m.candidate &&
          typeof m.candidate === "object"
        )
          send(ws.role === "camera" ? room.viewer : room.camera, {
            type: "candidate",
            candidate: m.candidate,
          });
        else if (
          m.type === "offer" &&
          ws.role === "camera" &&
          typeof m.sdp === "string"
        )
          send(room.viewer, { type: "offer", sdp: m.sdp });
        else if (
          m.type === "answer" &&
          ws.role === "viewer" &&
          typeof m.sdp === "string"
        )
          send(room.camera, { type: "answer", sdp: m.sdp });
        else if (m.type === "stop") ws.close(1000, "Disconnected");
        else ws.close(1008, "Invalid message");
      } catch {
        ws.close(1008, "Invalid message");
      }
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate();
        continue;
      }
      ws.alive = false;
      ws.ping();
    }
  }, 30000);
  server.listen(config.port ?? 8787, host);
  return {
    server,
    close() {
      clearInterval(heartbeat);
      for (const room of rooms.values()) clearTimeout(room.timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  const tls =
    process.env.TLS_CERT_FILE && process.env.TLS_KEY_FILE
      ? {
          cert: fs.readFileSync(process.env.TLS_CERT_FILE),
          key: fs.readFileSync(process.env.TLS_KEY_FILE),
        }
      : undefined;
  startSignaling({
    accessToken: process.env.SIGNALING_ACCESS_TOKEN,
    origins: (process.env.ALLOWED_ORIGINS || "").split(",").filter(Boolean),
    iceServers: JSON.parse(process.env.ICE_SERVERS_JSON || "[]"),
    port: Number(process.env.PORT || 8787),
    development: process.env.DEVELOPMENT_LOCAL === "1",
    trustProxy: process.env.TRUST_LOCAL_PROXY === "1",
    tls,
  });
  process.stdout.write(
    "Signaling service started. No video or credentials are logged.\n",
  );
}
