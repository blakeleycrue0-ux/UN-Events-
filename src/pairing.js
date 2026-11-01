"use strict";
// PIN unlocks this browser. Supabase authenticates each installation separately;
// private-channel authorization is enforced by SQL, never by knowing a topic ID.
(() => {
  const columns = "id,viewer_id,camera_id,name,invite_expires,revoked,lease,last_seen,created_at";
  let client, user, initializing, links = [], session = null, epoch = 0;
  let invitation = null, pendingToken = null, busy = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem("security-pending-invite") || "null");
    if (saved && /^[a-f0-9]{64}$/.test(saved.token) && Date.now() - saved.at < 600000)
      pendingToken = saved.token;
    else sessionStorage.removeItem("security-pending-invite");
  } catch { /* A new link can still be accepted without session storage. */ }
  function rememberPending(token) {
    pendingToken = token;
    try {
      if (token) sessionStorage.setItem("security-pending-invite", JSON.stringify({ token, at: Date.now() }));
      else sessionStorage.removeItem("security-pending-invite");
    } catch { /* Token remains in memory for this page only. */ }
  }
  const received = /^#invite=([a-f0-9]{64})$/i.exec(location.hash);
  if (received) {
    rememberPending(received[1].toLowerCase());
    // Remove the capability from navigation history before shell routing starts.
    history.replaceState(null, "", location.pathname + location.search + "#pairing");
  }
  function status(message) { $("pairStatus").textContent = message; }
  function online(link) {
    return !!link.lease && Date.now() - Date.parse(link.last_seen || "") < 45000;
  }
  function fail(err) {
    const code = err?.code || "";
    let message = err?.message || "No se pudo conectar con el servicio.";
    if (["PGRST202", "PGRST205", "42P01", "42883"].includes(code))
      message = "Falta instalar la conexión entre móviles en Supabase. Ejecuta la migración de emparejamiento indicada en la guía de instalación.";
    if (code === "anonymous_provider_disabled")
      message = "Activa Anonymous Sign-Ins en Supabase → Authentication → Sign In / Providers. No necesitas crear cuentas con email.";
    if (/Invitation expired/.test(message))
      message = "La invitación ha caducado, ya se usó o la has abierto en el móvil que la creó. Genera otra y ábrela en el otro iPhone.";
    if (/Failed to fetch|NetworkError|fetch failed/i.test(message))
      message = "No se puede contactar con Supabase. Revisa la conexión y que el proyecto esté activo.";
    status(message);
  }
  async function run(action) {
    if (busy || !securityUnlocked) return;
    busy = true; render();
    try { await action(); } catch (e) { fail(e); }
    finally { busy = false; render(); }
  }
  async function rpc(name, args) {
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return data;
  }
  async function initialize() {
    if (client && user) return;
    if (initializing) return initializing;
    initializing = (async () => {
      const config = window.SECURITY_SUPABASE_PUBLIC;
      if (!config?.url || !config?.key) throw Error("Falta la configuración pública de Supabase.");
      if (!window.createSecuritySupabase) await loadScript("vendor/supabase.js");
      if (!client) {
        client = window.createSecuritySupabase(config.url, config.key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false,
            storageKey: "security-paired-device" },
          realtime: { params: { eventsPerSecond: 10 } },
        });
        client.auth.onAuthStateChange((event, authSession) => {
          if (event === "SIGNED_OUT") {
            user = null; links = [];
            void stop("Sesión del dispositivo cerrada. Vuelve a vincularlo."); render();
          } else if (authSession?.user) user = authSession.user;
        });
      }
      const existing = await client.auth.getSession();
      if (existing.error) throw existing.error;
      let authSession = existing.data.session;
      if (!authSession) {
        const result = await client.auth.signInAnonymously();
        if (result.error) throw result.error;
        authSession = result.data.session;
      }
      if (!authSession?.user) throw Error("No se ha podido identificar este dispositivo.");
      user = authSession.user;
      localStorage.setItem("security-paired-installed", "1");
    })();
    try { await initializing; } finally { initializing = null; }
  }
  async function refresh() {
    await initialize();
    const { data, error } = await client.from("camera_links").select(columns)
      .eq("revoked", false).order("created_at", { ascending: false });
    if (error) throw error;
    links = data || [];
    if (invitation && links.find(l => l.id === invitation.id)?.camera_id) {
      invitation = null;
      status("El otro iPhone ha aceptado. Activa Compartir en él y después pulsa Ver directo aquí.");
    }
    if (session) {
      const current = links.find(l => l.id === session.link.id);
      if (!current || (session.role === "viewer" &&
          (!online(current) || current.lease !== session.link.lease)))
        await stop("La cámara se ha desconectado o el vínculo se ha revocado.");
    }
    render();
  }
  function render() {
    for (const id of ["createInvite", "acceptInvite", "refreshPairs", "cancelInvite"])
      $(id).disabled = busy;
    $("acceptInvitePanel").hidden = !pendingToken;
    $("createInvitePanel").hidden = !!pendingToken;
    $("inviteResult").hidden = !invitation;
    if (invitation) {
      $("inviteLink").value = invitation.url;
      const seconds = Math.max(0, Math.ceil((invitation.expires - Date.now()) / 1000));
      $("inviteExpiry").textContent = seconds
        ? `Caduca en ${Math.ceil(seconds / 60)} min. Ábrelo en el otro móvil. No publiques este enlace.`
        : "Invitación caducada. Crea una nueva.";
    }
    const target = $("pairedDevices"); target.replaceChildren();
    const summary = $("remoteCameraList"); summary.replaceChildren();
    const visible = links.filter(l => l.camera_id || Date.parse(l.invite_expires) > Date.now());
    if (!visible.length) {
      const text = document.createElement("p"); text.className = "fine-print";
      text.textContent = "Todavía no hay otro móvil vinculado."; target.append(text);
    }
    for (const link of visible) {
      const host = link.camera_id === user?.id;
      const row = document.createElement("div"); row.className = "paired-device";
      const copy = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("p");
      title.textContent = link.name;
      detail.textContent = !link.camera_id ? "Esperando que el otro móvil acepte"
        : host ? "Este iPhone es la cámara · " + (online(link) ? "Compartiendo" : "Sin compartir")
        : online(link) ? "Cámara disponible · pulsa Ver directo" : "Cámara sin compartir";
      copy.append(title, detail); row.append(copy);
      const actions = document.createElement("div"); actions.className = "pair-actions";
      if (link.camera_id) {
        const open = document.createElement("button"); open.className = "small-button";
        open.textContent = host ? "Activar cámara y compartir" : "Ver directo";
        open.disabled = busy || (!host && !online(link));
        open.onclick = () => authorizeLocalAction(host ? "Compartir esta cámara" : "Ver cámara vinculada",
          () => run(() => connect(link, host ? "camera" : "viewer")));
        actions.append(open);
      }
      const remove = document.createElement("button"); remove.className = "text-button";
      remove.textContent = link.camera_id ? "Desvincular" : "Cancelar"; remove.disabled = busy;
      remove.onclick = () => authorizeLocalAction("Desvincular cámara", () => run(() => revoke(link.id)));
      actions.append(remove); row.append(actions); target.append(row);
      if (!host && link.camera_id) {
        const button = document.createElement("button"); button.className = "sheet-option";
        const name = document.createElement("strong"), note = document.createElement("span");
        name.textContent = link.name; note.textContent = online(link) ? "Disponible · abrir conexión" : "Otro móvil · sin compartir";
        button.append(name, note); button.onclick = open; summary.append(button);
      }
    }
    $("pairedVideoPanel").hidden = !session;
    renderRemote();
  }
  function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, "0")).join("");
  }
  async function digest(token) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  }
  async function createInvitation() {
    await initialize();
    if (invitation) await revoke(invitation.id);
    const name = $("pairName").value.trim();
    if (!name) throw Error("Pon un nombre a la cámara.");
    const token = randomToken();
    const id = await rpc("pair_camera_create", { token_hash: await digest(token), camera_name: name });
    const url = new URL(location.href); url.hash = "invite=" + token; url.search = "";
    invitation = { id, url: url.href, expires: Date.now() + 600000 };
    status("Invitación creada. Ábrela en Safari en el iPhone cámara y acepta allí.");
    await refresh();
  }
  async function acceptInvitation() {
    if (!pendingToken) return;
    await initialize();
    await rpc("pair_camera_claim", { token_hash: await digest(pendingToken) });
    rememberPending(null);
    status("iPhone vinculado. Pulsa Activar cámara y compartir para permitir el directo. Arma la vigilancia en este iPhone si quieres clips por personas.");
    await refresh();
  }
  async function revoke(id) {
    if (session?.link.id === id) await stop("Conexión detenida.");
    await rpc("pair_camera_revoke", { link_id: id });
    if (invitation?.id === id) invitation = null;
    status("Vínculo revocado. El otro móvil ya no tiene permiso para conectar.");
    await refresh();
  }
  async function iceConfiguration(link) {
    const { data, error } = await client.functions.invoke("ice-config", { body: { pairId: link.id } });
    if (error) {
      let response;
      try { response = await error.context?.json(); } catch {}
      if (/TURN/.test(response?.error || ""))
        throw Error("Falta configurar el relay de vídeo TURN en Supabase. El vínculo está guardado, pero todavía no puede transmitir entre redes.");
      throw Error("No se pudo obtener la conexión de vídeo. Revisa que la función ice-config esté desplegada, sus orígenes y los permisos del vínculo." + (response?.error ? " " + response.error : ""));
    }
    if (!Array.isArray(data?.iceServers) || !data.iceServers.length ||
        !data.iceServers.every(s => s.username && s.credential && [].concat(s.urls || []).length &&
          [].concat(s.urls).every(u => /^turns?:/.test(u))) || data.expiresAt * 1000 < Date.now() + 60000)
      throw Error("El servicio no ha devuelto un relay TURN autenticado y vigente. No se iniciará el vídeo.");
    return data;
  }
  function current(s) { return session === s && s.epoch === epoch; }
  function send(s, message) {
    if (!current(s)) return;
    return s.channel.send({ type: "broadcast", event: "signal", payload: {
      ...message, role: s.role, connection: s.connection,
    } }).then(result => { if (result !== "ok" && current(s)) void stop("Se perdió la señalización. Vuelve a conectar."); })
      .catch(() => { if (current(s)) void stop("Se perdió la señalización. Vuelve a conectar."); });
  }
  function closePeer(s) {
    clearTimeout(s.deadline);
    clearInterval(s.paint); s.native = false;
    if (s.peer) { s.peer.onconnectionstatechange = null; s.peer.onicecandidate = null; s.peer.ontrack = null; s.peer.close(); s.peer = null; }
    s.outgoing?.getTracks().forEach(t => t.stop()); s.outgoing = null;
    s.incoming?.getTracks().forEach(t => t.stop()); s.incoming = null;
    s.candidates = [];
    $("pairedVideo").srcObject = null;
    $("pairedLive").textContent = "CONECTANDO";
  }
  async function stop(message = "Directo desconectado. La vigilancia local continúa.") {
    const old = session; session = null; epoch++;
    if (old) {
      clearInterval(old.heartbeat); clearInterval(old.paint); clearInterval(old.watch); clearTimeout(old.expiry);
      clearInterval(old.stateTimer); clearTimeout(old.pendingCommand?.timer);
      closePeer(old);
      if (old.channel) void client.removeChannel(old.channel);
      if (old.role === "camera") {
        // Only the lease we own can be released; late closes cannot stop another session.
        try { await rpc("pair_camera_publish", { link_id: old.link.id, session_id: old.link.lease, sharing: false }); }
        catch { /* The server lease still expires after 45 seconds. */ }
      }
    }
    status(message); render();
  }
  async function makePeer(s) {
    closePeer(s);
    const peer = s.peer = new RTCPeerConnection({ iceServers: s.ice.iceServers, iceTransportPolicy: "relay" });
    peer.onicecandidate = e => { if (e.candidate) void send(s, { type: "candidate", candidate: e.candidate.toJSON() }); };
    peer.ontrack = e => {
      if (!current(s)) return;
      s.incoming = e.streams[0] || new MediaStream([e.track]);
      $("pairedVideo").srcObject = s.incoming;
      $("pairedVideo").play().catch(() => status("Toca Reproducir en el vídeo para iniciar el directo."));
    };
    peer.onconnectionstatechange = () => {
      if (!current(s)) return;
      if (["failed", "closed", "disconnected"].includes(peer.connectionState))
        void stop("Se ha interrumpido el directo. Vuelve a conectar.");
      else if (peer.connectionState === "connected" && s.role === "camera") {
        clearTimeout(s.deadline);
        $("pairedLive").textContent = "VISOR CONECTADO";
        status("Visor conectado por WebRTC cifrado. El micrófono no se comparte.");
      }
    };
    s.deadline = setTimeout(() => { if (current(s)) void stop("No llegaron fotogramas en 30 segundos. Comprueba el relay y ambos móviles."); }, 30000);
    return peer;
  }
  // Remote control travels over the same private, RLS-authorized channel as the
  // video signalling. The viewer confirms its own PIN locally; the camera PIN is
  // never transmitted. Only these three actions exist: no remote siren or clips.
  const remoteModes = { silent: "Silenciosa", deter: "Disuasoria", alarm: "Alarma" };
  function cameraSnapshot() {
    return {
      camera: !!state.stream && !state.cameraMuted,
      armed: !!state.armed,
      mode: state.armed ? $("mode").value : "disarmed",
      alarm: !!state.alarm,
      recording: !!state.recording,
      people: state.peopleError ? "error" : state.model ? "ok" : "loading",
      detected: (state.persons || []).length,
      at: Date.now(),
    };
  }
  function pushState(s) {
    if (current(s) && s.role === "camera" && s.connection) void send(s, { type: "state", state: cameraSnapshot() });
  }
  async function executeCommand(action, mode) {
    if (action === "silence") { stopSounds(); log("alarma", "Silenciada desde el móvil vinculado"); return "Sonido silenciado en la cámara."; }
    if (action === "disarm") {
      if (state.armed) { $("mode").value = "disarmed"; setMode(); renderProtection(); }
      log("modo", "Desarmado desde el móvil vinculado");
      return "Vigilancia desarmada.";
    }
    if (action !== "arm" || !remoteModes[mode]) throw Error("Orden no válida.");
    if (!state.stream) throw Error("La cámara está apagada en el iPhone cámara.");
    if (protecting) throw Error("La cámara está ocupada armando. Inténtalo de nuevo.");
    $("surveillanceMode").value = mode;
    if (state.armed) { $("mode").value = mode; setMode(); renderProtection(); }
    else await armProtection();
    if (!state.armed) throw Error($("error").textContent || "La cámara no pudo armarse.");
    log("modo", "Armado desde el móvil vinculado: " + remoteModes[mode]);
    const audio = mode !== "silent" && !audioReady
      ? " Aviso: el sonido no está habilitado en el iPhone cámara; toca Probar sonido allí para que suene." : "";
    return "Armado en modo " + remoteModes[mode] + "." + audio;
  }
  function renderRemote() {
    const panel = $("remoteControls");
    const s = session, info = s?.remote;
    panel.hidden = !s || s.role !== "viewer";
    if (panel.hidden) return;
    const fresh = info && Date.now() - info.received < 8000;
    const text = !fresh ? "Esperando estado de la cámara…"
      : !info.camera ? "Cámara apagada"
      : (info.armed ? "ARMADA · " + (remoteModes[info.mode] || info.mode) : "DESARMADA") +
        (info.alarm ? " · ALARMA SONANDO" : "") + (info.recording ? " · GRABANDO" : "") +
        (info.people === "error" ? " · error de IA" : info.detected ? " · persona detectada" : "");
    $("remoteState").textContent = text;
    $("remoteState").className = "small-state" + (fresh && info.alarm ? " alert" : "");
    const waiting = !fresh || !!s.pendingCommand;
    $("remoteArm").disabled = waiting || !info.camera;
    $("remoteArm").textContent = fresh && info.armed ? "Cambiar modo" : "Armar";
    $("remoteDisarm").disabled = waiting || !info.armed;
    $("remoteSilence").disabled = !fresh || !!s.pendingCommand;
  }
  function sendCommand(action) {
    const s = session;
    if (!s || s.role !== "viewer" || s.pendingCommand) return;
    const id = crypto.randomUUID();
    s.pendingCommand = { id, timer: setTimeout(() => {
      if (current(s) && s.pendingCommand?.id === id) {
        s.pendingCommand = null; status("La cámara no respondió a la orden. Comprueba que siga compartiendo."); renderRemote();
      }
    }, 15000) };
    status("Enviando orden a la cámara…"); renderRemote();
    void send(s, { type: "command", id, action, mode: $("remoteMode").value });
  }
  async function handle(s, data) {
    if (!current(s) || !data || data.role === s.role || !["viewer", "camera"].includes(data.role)) return;
    if (s.role === "viewer" && data.connection === s.connection) {
      if (data.type === "state" && data.state && typeof data.state === "object") {
        s.remote = { ...data.state, received: Date.now() }; renderRemote(); return;
      }
      if (data.type === "result" && s.pendingCommand?.id === data.id) {
        clearTimeout(s.pendingCommand.timer); s.pendingCommand = null;
        status((data.ok ? "" : "La cámara rechazó la orden: ") + String(data.message || "").slice(0, 300));
        renderRemote(); return;
      }
    }
    if (s.role === "camera" && data.type === "command") {
      if (data.connection !== s.connection || typeof data.id !== "string" || data.id.length > 40) return;
      let ok = true, message;
      try { message = await executeCommand(data.action, data.mode); }
      catch (e) { ok = false; message = e.message; }
      if (!current(s)) return;
      status("Orden remota: " + message);
      await send(s, { type: "result", id: data.id, ok, message });
      pushState(s);
      return;
    }
    if (s.role === "camera" && data.type === "ready") {
      if (typeof data.connection !== "string" || !/^[a-f0-9-]{36}$/i.test(data.connection)) return;
      s.connection = data.connection;
      const peer = await makePeer(s);
      if (!current(s)) return;
      if (frame.captureStream) {
        processed(); s.outgoing = frame.captureStream(6);
        s.paint = setInterval(() => { if (current(s)) processed(); }, 166);
      } else {
        if (state.mask || +$("zoom").value !== 100) throw Error("Este Safari no puede compartir vídeo con máscara o zoom de forma segura.");
        s.native = true;
        s.outgoing = new MediaStream(state.stream.getVideoTracks().map(t => t.clone()));
      }
      s.outgoing.getVideoTracks().forEach(t => peer.addTrack(t, s.outgoing));
      const offer = await peer.createOffer();
      if (!current(s)) return;
      await peer.setLocalDescription(offer); await send(s, { type: "offer", sdp: offer.sdp });
      pushState(s);
    } else {
      if (data.connection !== s.connection) return;
      const peer = s.peer;
      if (!peer) return;
      if (data.type === "offer" && s.role === "viewer" && typeof data.sdp === "string") {
        await peer.setRemoteDescription({ type: "offer", sdp: data.sdp });
        for (const candidate of s.candidates.splice(0)) await peer.addIceCandidate(candidate);
        const answer = await peer.createAnswer();
        if (!current(s)) return;
        await peer.setLocalDescription(answer); await send(s, { type: "answer", sdp: answer.sdp });
      } else if (data.type === "answer" && s.role === "camera" && typeof data.sdp === "string") {
        await peer.setRemoteDescription({ type: "answer", sdp: data.sdp });
        for (const candidate of s.candidates.splice(0)) await peer.addIceCandidate(candidate);
      } else if (data.type === "candidate" && data.candidate) {
        if (peer.remoteDescription) await peer.addIceCandidate(data.candidate);
        else if (s.candidates.length < 128) s.candidates.push(data.candidate);
      }
    }
  }
  async function connect(link, role) {
    await stop();
    await refresh();
    link = links.find(l => l.id === link.id);
    if (!link?.camera_id || (role === "viewer" && !online(link))) throw Error("La cámara no está compartiendo. Actívala en el otro iPhone.");
    const s = session = { link: { ...link }, role, epoch: ++epoch, candidates: [], connection: crypto.randomUUID() };
    status("Preparando conexión privada…"); render();
    try {
      s.ice = await iceConfiguration(link);
      if (!current(s)) return;
      if (role === "camera") {
        if (!state.stream) await startCamera();
        if (!current(s)) return;
        if (!state.stream || state.cameraMuted) throw Error("No se pudo iniciar la cámara. Comprueba los permisos de Safari.");
        s.source = state.stream;
        s.link.lease = crypto.randomUUID();
        const ok = await rpc("pair_camera_publish", { link_id: link.id, session_id: s.link.lease, sharing: true });
        if (!ok) throw Error("La cámara ya está compartiendo en otra pestaña, o el vínculo se revocó. Cierra la otra pestaña y espera 45 segundos.");
      }
      if (!current(s)) {
        if (role === "camera") await rpc("pair_camera_publish", { link_id: link.id, session_id: s.link.lease, sharing: false });
        return;
      }
      const { data } = await client.auth.getSession();
      await client.realtime.setAuth(data.session.access_token);
      if (!current(s)) return;
      s.channel = client.channel(`security-pair:${link.id}:${s.link.lease}`, {
        config: { private: true, broadcast: { self: false, ack: true } },
      });
      s.channel.on("broadcast", { event: "signal" }, ({ payload }) => {
        s.queue = (s.queue || Promise.resolve()).then(() => handle(s, payload)).catch(e => {
          if (current(s)) void stop("Error de conexión: " + e.message);
        });
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("El canal privado no respondió. Revisa las políticas Realtime de Supabase.")), 12000);
        s.channel.subscribe(state => {
          if (state === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
          else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state)) {
            clearTimeout(timer); reject(Error("No se pudo autorizar el canal privado."));
            if (current(s)) void stop("El canal privado se ha cerrado. Vuelve a conectar.");
          }
        });
      });
      if (!current(s)) return;
      s.heartbeat = setInterval(async () => {
        if (!current(s)) return;
        try {
          if (role === "camera" && !await rpc("pair_camera_publish", { link_id: link.id, session_id: s.link.lease, sharing: true }))
            throw Error("Vínculo revocado o sesión reemplazada.");
          await refresh();
        } catch { if (current(s)) await stop("Se perdió el permiso o la conexión con Supabase. Vuelve a conectar."); }
      }, 12000);
      s.stateTimer = setInterval(() => { pushState(s); if (current(s)) renderRemote(); }, 2000);
      s.watch = setInterval(() => {
        if (!current(s)) return;
        if (role === "camera" && (!state.stream || state.stream !== s.source || state.cameraMuted ||
            (s.native && (state.mask || +$("zoom").value !== 100))))
          void stop("La cámara cambió o dejó de estar disponible. El directo se ha detenido para proteger la privacidad.");
      }, 250);
      s.expiry = setTimeout(() => { if (current(s)) void stop("La autorización de vídeo ha caducado. Pulsa conectar para renovarla."); },
        Math.min(55 * 60000, s.ice.expiresAt * 1000 - Date.now() - 10000));
      $("pairedVideoTitle").textContent = link.name;
      $("pairedVideo").hidden = role === "camera";
      if (role === "viewer") {
        await makePeer(s);
        await send(s, { type: "ready" });
        status("Conectando con la cámara. Esperando fotogramas…");
      } else {
        $("pairedLive").textContent = "ESPERANDO VISOR";
        status("Cámara compartida. En el otro móvil pulsa Actualizar conexiones → Ver directo. Los clips requieren armar la vigilancia aquí.");
      }
      await refresh();
    } catch (e) { if (current(s)) { await stop(); throw e; } }
  }
  async function open() {
    $("addSheet").hidden = true;
    goPage("pairing");
    await run(async () => {
      await refresh();
      status(pendingToken ? "Invitación recibida. Acepta para vincular este iPhone como cámara."
        : "Crea una invitación y ábrela en el otro móvil, o conecta una cámara vinculada.");
    });
  }
  setInterval(() => {
    if (securityUnlocked && user && !busy && !session && !document.hidden &&
        ["pairing", "cameras"].includes(currentPage)) void refresh().catch(fail);
  }, 10000);
  $("pairedVideo").addEventListener("playing", () => {
    if (session?.role !== "viewer" || !$("pairedVideo").videoWidth) return;
    clearTimeout(session.deadline); $("pairedLive").textContent = "LIVE";
    status("Recibiendo vídeo en directo. Sin micrófono. Las grabaciones permanecen en el iPhone cámara.");
  });
  $("useOtherPhone").onclick = open;
  $("managePairing").onclick = open;
  $("createInvite").onclick = () => authorizeLocalAction("Invitar otro móvil", () => run(createInvitation));
  $("acceptInvite").onclick = () => authorizeLocalAction("Vincular este iPhone", () => run(acceptInvitation));
  $("rejectInvite").onclick = () => { rememberPending(null); status("Invitación descartada."); render(); };
  $("cancelInvite").onclick = () => authorizeLocalAction("Cancelar invitación", () => run(() => revoke(invitation.id)));
  $("refreshPairs").onclick = () => run(refresh);
  $("remoteArm").onclick = () => authorizeLocalAction("Armar la cámara vinculada", () => sendCommand("arm"));
  $("remoteDisarm").onclick = () => authorizeLocalAction("Desarmar la cámara vinculada", () => sendCommand("disarm"));
  // Like the local control, silencing never needs the PIN and never disarms.
  $("remoteSilence").onclick = () => sendCommand("silence");
  $("stopPair").onclick =() => authorizeLocalAction("Desconectar el directo", () => stop());
  $("copyInvite").onclick = async () => {
    try { await navigator.clipboard.writeText(invitation.url); status("Enlace copiado. Envíalo de forma privada al otro móvil."); }
    catch { $("inviteLink").select(); status("No se pudo copiar automáticamente. Mantén pulsado el enlace y elige Copiar."); }
  };
  $("shareInvite").onclick = async () => {
    if (!navigator.share) return $("copyInvite").click();
    try { await navigator.share({ title: "Vincular cámara · SECURITY CAM", url: invitation.url }); }
    catch (e) { if (e.name !== "AbortError") fail(e); }
  };
  document.addEventListener("security:lock", () => { void stop("Aplicación bloqueada. El directo remoto se ha detenido."); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && session) void stop("Safari dejó de estar visible. Vuelve a conectar el directo."); });
  window.addEventListener("pagehide", () => { if (session) void stop(); });
  window.addEventListener("hashchange", () => {
    const match = /^#invite=([a-f0-9]{64})$/i.exec(location.hash);
    if (match) {
      rememberPending(match[1].toLowerCase()); history.replaceState(null, "", "#pairing");
      if (securityUnlocked) void open();
    }
  });
  window.securityReady.then(() => {
    render();
    if (pendingToken || location.hash === "#pairing") void open();
    else if (localStorage.getItem("security-paired-installed")) void refresh().catch(fail);
  });
})();
