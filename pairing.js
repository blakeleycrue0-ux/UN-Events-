"use strict";
(() => {
  const columns = "id,viewer_id,camera_id,name,invite_expires,revoked,lease,last_seen,created_at";
  let client, user, initializing, links = [], session = null, epoch = 0;
  let invitation = null, pendingToken = null, busy = false;
  try {
    const saved = JSON.parse(sessionStorage.getItem("security-pending-invite") || "null");
    if (saved && /^[a-f0-9]{64}$/.test(saved.token) && Date.now() - saved.at < 6e5)
      pendingToken = saved.token;
    else sessionStorage.removeItem("security-pending-invite");
  } catch {
  }
  function rememberPending(token) {
    pendingToken = token;
    try {
      if (token) sessionStorage.setItem("security-pending-invite", JSON.stringify({ token, at: Date.now() }));
      else sessionStorage.removeItem("security-pending-invite");
    } catch {
    }
  }
  const received = /invite=([a-f0-9]{64})/i.exec(location.hash);
  if (received) {
    rememberPending(received[1].toLowerCase());
    history.replaceState(null, "", location.pathname + location.search + "#pairing");
  }
  function status(message) {
    $("pairStatus").textContent = message;
  }
  function online(link) {
    return !!link.lease && Date.now() - Date.parse(link.last_seen || "") < 45e3;
  }
  function fail(err) {
    const code = (err == null ? void 0 : err.code) || "";
    let message = (err == null ? void 0 : err.message) || "No se pudo conectar con el servicio.";
    if (["PGRST202", "PGRST205", "42P01", "42883"].includes(code))
      message = "Falta instalar la conexi\xF3n entre m\xF3viles en Supabase. Ejecuta la migraci\xF3n de emparejamiento indicada en la gu\xEDa de instalaci\xF3n.";
    if (code === "anonymous_provider_disabled")
      message = "Activa Anonymous Sign-Ins en Supabase \u2192 Authentication \u2192 Sign In / Providers. No necesitas crear cuentas con email.";
    if (/Invitation expired/.test(message))
      message = "La invitaci\xF3n ha caducado, ya se us\xF3 o la has abierto en el m\xF3vil que la cre\xF3. Genera otra y \xE1brela en el otro iPhone.";
    if (/Failed to fetch|NetworkError|fetch failed/i.test(message))
      message = "No se puede contactar con Supabase. Revisa la conexi\xF3n y que el proyecto est\xE9 activo.";
    status(message);
  }
  async function run(action) {
    if (busy || !securityUnlocked) return;
    busy = true;
    render();
    try {
      await action();
    } catch (e) {
      fail(e);
    } finally {
      busy = false;
      render();
    }
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
      if (!(config == null ? void 0 : config.url) || !(config == null ? void 0 : config.key)) throw Error("Falta la configuraci\xF3n p\xFAblica de Supabase.");
      if (!window.createSecuritySupabase) await loadScript("vendor/supabase.js");
      if (!client) {
        client = window.createSecuritySupabase(config.url, config.key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            storageKey: "security-paired-device"
          },
          realtime: { params: { eventsPerSecond: 10 } }
        });
        client.auth.onAuthStateChange((event, authSession2) => {
          if (event === "SIGNED_OUT") {
            user = null;
            links = [];
            void stop("Sesi\xF3n del dispositivo cerrada. Vuelve a vincularlo.");
            render();
          } else if (authSession2 == null ? void 0 : authSession2.user) user = authSession2.user;
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
      if (!(authSession == null ? void 0 : authSession.user)) throw Error("No se ha podido identificar este dispositivo.");
      user = authSession.user;
      localStorage.setItem("security-paired-installed", "1");
    })();
    try {
      await initializing;
    } finally {
      initializing = null;
    }
  }
  async function refresh() {
    var _a;
    await initialize();
    const { data, error } = await client.from("camera_links").select(columns).eq("revoked", false).order("created_at", { ascending: false });
    if (error) throw error;
    links = data || [];
    if (invitation && ((_a = links.find((l) => l.id === invitation.id)) == null ? void 0 : _a.camera_id)) {
      invitation = null;
      status("El otro iPhone ha aceptado. Activa Compartir en \xE9l y despu\xE9s pulsa Ver directo aqu\xED.");
    }
    if (session) {
      const current2 = links.find((l) => l.id === session.link.id);
      if (!current2 || session.role === "viewer" && (!online(current2) || current2.lease !== session.link.lease))
        await stop("La c\xE1mara se ha desconectado o el v\xEDnculo se ha revocado.");
    }
    render();
  }
  function render() {
    for (const id of ["createInvite", "acceptInvite", "refreshPairs", "cancelInvite", "usePastedInvite"])
      $(id).disabled = busy;
    $("acceptInvitePanel").hidden = !pendingToken;
    $("createInvitePanel").hidden = !!pendingToken;
    $("inviteResult").hidden = !invitation;
    if (invitation) {
      $("inviteLink").value = invitation.url;
      const seconds = Math.max(0, Math.ceil((invitation.expires - Date.now()) / 1e3));
      $("inviteExpiry").textContent = seconds ? "Caduca en ".concat(Math.ceil(seconds / 60), " min. \xC1brelo en el otro m\xF3vil. No publiques este enlace.") : "Invitaci\xF3n caducada. Crea una nueva.";
    }
    const target = $("pairedDevices");
    target.replaceChildren();
    const summary = $("remoteCameraList");
    summary.replaceChildren();
    const visible = links.filter((l) => l.camera_id || Date.parse(l.invite_expires) > Date.now());
    if (!visible.length) {
      const text = document.createElement("p");
      text.className = "fine-print";
      text.textContent = "Todav\xEDa no hay otro m\xF3vil vinculado.";
      target.append(text);
    }
    for (const link of visible) {
      const host = link.camera_id === (user == null ? void 0 : user.id);
      const row = document.createElement("div");
      row.className = "paired-device";
      const copy = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("p");
      title.textContent = link.name;
      detail.textContent = !link.camera_id ? "Esperando que el otro m\xF3vil acepte" : host ? "Este iPhone es la c\xE1mara \xB7 " + (online(link) ? "Compartiendo" : "Sin compartir") : online(link) ? "C\xE1mara disponible \xB7 pulsa Ver directo" : "C\xE1mara sin compartir";
      copy.append(title, detail);
      row.append(copy);
      const actions = document.createElement("div");
      actions.className = "pair-actions";
      if (link.camera_id) {
        const open2 = document.createElement("button");
        open2.className = "small-button";
        open2.textContent = host ? "Activar c\xE1mara y compartir" : "Ver directo";
        open2.disabled = busy || !host && !online(link);
        open2.onclick = () => authorizeLocalAction(
          host ? "Compartir esta c\xE1mara" : "Ver c\xE1mara vinculada",
          () => run(() => connect(link, host ? "camera" : "viewer"))
        );
        actions.append(open2);
      }
      const remove = document.createElement("button");
      remove.className = "text-button";
      remove.textContent = link.camera_id ? "Desvincular" : "Cancelar";
      remove.disabled = busy;
      remove.onclick = () => authorizeLocalAction("Desvincular c\xE1mara", () => run(() => revoke(link.id)));
      actions.append(remove);
      row.append(actions);
      target.append(row);
      if (!host && link.camera_id) {
        const button = document.createElement("button");
        button.className = "sheet-option";
        const name = document.createElement("strong"), note = document.createElement("span");
        name.textContent = link.name;
        note.textContent = online(link) ? "Disponible \xB7 abrir conexi\xF3n" : "Otro m\xF3vil \xB7 sin compartir";
        button.append(name, note);
        button.onclick = open;
        summary.append(button);
      }
    }
    $("pairedVideoPanel").hidden = !session;
    renderRemote();
  }
  function randomToken() {
    return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function digest(token) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  async function createInvitation() {
    await initialize();
    if (invitation) await revoke(invitation.id);
    const name = $("pairName").value.trim();
    if (!name) throw Error("Pon un nombre a la c\xE1mara.");
    const token = randomToken();
    const id = await rpc("pair_camera_create", { token_hash: await digest(token), camera_name: name });
    const url = new URL(location.href);
    url.hash = "invite=" + token;
    url.search = "";
    invitation = { id, url: url.href, expires: Date.now() + 6e5 };
    status("Invitaci\xF3n creada. \xC1brela en Safari en el iPhone c\xE1mara y acepta all\xED.");
    await refresh();
  }
  async function acceptInvitation() {
    if (!pendingToken) return;
    await initialize();
    await rpc("pair_camera_claim", { token_hash: await digest(pendingToken) });
    rememberPending(null);
    status("iPhone vinculado. Pulsa Activar c\xE1mara y compartir para permitir el directo. Arma la vigilancia en este iPhone si quieres clips por personas.");
    await refresh();
  }
  async function revoke(id) {
    if ((session == null ? void 0 : session.link.id) === id) await stop("Conexi\xF3n detenida.");
    await rpc("pair_camera_revoke", { link_id: id });
    if ((invitation == null ? void 0 : invitation.id) === id) invitation = null;
    status("V\xEDnculo revocado. El otro m\xF3vil ya no tiene permiso para conectar.");
    await refresh();
  }
  async function iceConfiguration(link) {
    var _a;
    const { data, error } = await client.functions.invoke("ice-config", { body: { pairId: link.id } });
    if (error) {
      let response;
      try {
        response = await ((_a = error.context) == null ? void 0 : _a.json());
      } catch {
      }
      if (/TURN/.test((response == null ? void 0 : response.error) || ""))
        throw Error("Falta configurar el relay de v\xEDdeo TURN en Supabase. El v\xEDnculo est\xE1 guardado, pero todav\xEDa no puede transmitir entre redes.");
      throw Error("No se pudo obtener la conexi\xF3n de v\xEDdeo. Revisa que la funci\xF3n ice-config est\xE9 desplegada, sus or\xEDgenes y los permisos del v\xEDnculo." + ((response == null ? void 0 : response.error) ? " " + response.error : ""));
    }
    if (!Array.isArray(data == null ? void 0 : data.iceServers) || !data.iceServers.length || !data.iceServers.every((s) => s.username && s.credential && [].concat(s.urls || []).length && [].concat(s.urls).every((u) => /^turns?:/.test(u))) || data.expiresAt * 1e3 < Date.now() + 6e4)
      throw Error("El servicio no ha devuelto un relay TURN autenticado y vigente. No se iniciar\xE1 el v\xEDdeo.");
    return data;
  }
  function current(s) {
    return session === s && s.epoch === epoch;
  }
  function send(s, message) {
    if (!current(s)) return;
    return s.channel.send({ type: "broadcast", event: "signal", payload: {
      ...message,
      role: s.role,
      connection: s.connection
    } }).then((result) => {
      if (result !== "ok" && current(s)) void stop("Se perdi\xF3 la se\xF1alizaci\xF3n. Vuelve a conectar.");
    }).catch(() => {
      if (current(s)) void stop("Se perdi\xF3 la se\xF1alizaci\xF3n. Vuelve a conectar.");
    });
  }
  function closePeer(s) {
    var _a, _b;
    clearTimeout(s.deadline);
    clearInterval(s.paint);
    s.native = false;
    if (s.peer) {
      s.peer.onconnectionstatechange = null;
      s.peer.onicecandidate = null;
      s.peer.ontrack = null;
      s.peer.close();
      s.peer = null;
    }
    (_a = s.outgoing) == null ? void 0 : _a.getTracks().forEach((t) => t.stop());
    s.outgoing = null;
    (_b = s.incoming) == null ? void 0 : _b.getTracks().forEach((t) => t.stop());
    s.incoming = null;
    s.candidates = [];
    $("pairedVideo").srcObject = null;
    $("pairedLive").textContent = "CONECTANDO";
  }
  async function stop(message = "Directo desconectado. La vigilancia local contin\xFAa.") {
    var _a;
    const old = session;
    session = null;
    epoch++;
    if (old) {
      clearInterval(old.heartbeat);
      clearInterval(old.paint);
      clearInterval(old.watch);
      clearTimeout(old.expiry);
      clearInterval(old.stateTimer);
      clearTimeout((_a = old.pendingCommand) == null ? void 0 : _a.timer);
      closePeer(old);
      if (old.channel) void client.removeChannel(old.channel);
      if (old.role === "camera") {
        try {
          await rpc("pair_camera_publish", { link_id: old.link.id, session_id: old.link.lease, sharing: false });
        } catch {
        }
      }
    }
    status(message);
    render();
  }
  async function makePeer(s) {
    closePeer(s);
    const peer = s.peer = new RTCPeerConnection({ iceServers: s.ice.iceServers, iceTransportPolicy: "relay" });
    peer.onicecandidate = (e) => {
      if (e.candidate) void send(s, { type: "candidate", candidate: e.candidate.toJSON() });
    };
    peer.ontrack = (e) => {
      if (!current(s)) return;
      s.incoming = e.streams[0] || new MediaStream([e.track]);
      $("pairedVideo").srcObject = s.incoming;
      $("pairedVideo").play().catch(() => status("Toca Reproducir en el v\xEDdeo para iniciar el directo."));
    };
    peer.onconnectionstatechange = () => {
      if (!current(s)) return;
      if (["failed", "closed", "disconnected"].includes(peer.connectionState))
        void stop("Se ha interrumpido el directo. Vuelve a conectar.");
      else if (peer.connectionState === "connected" && s.role === "camera") {
        clearTimeout(s.deadline);
        $("pairedLive").textContent = "VISOR CONECTADO";
        status("Visor conectado por WebRTC cifrado. El micr\xF3fono no se comparte.");
      }
    };
    s.deadline = setTimeout(() => {
      if (current(s)) void stop("No llegaron fotogramas en 30 segundos. Comprueba el relay y ambos m\xF3viles.");
    }, 3e4);
    return peer;
  }
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
      at: Date.now()
    };
  }
  function pushState(s) {
    if (current(s) && s.role === "camera" && s.connection) void send(s, { type: "state", state: cameraSnapshot() });
  }
  async function executeCommand(action, mode) {
    if (action === "silence") {
      stopSounds();
      log("alarma", "Silenciada desde el m\xF3vil vinculado");
      return "Sonido silenciado en la c\xE1mara.";
    }
    if (action === "disarm") {
      if (state.armed) {
        $("mode").value = "disarmed";
        setMode();
        renderProtection();
      }
      log("modo", "Desarmado desde el m\xF3vil vinculado");
      return "Vigilancia desarmada.";
    }
    if (action !== "arm" || !remoteModes[mode]) throw Error("Orden no v\xE1lida.");
    if (!state.stream) throw Error("La c\xE1mara est\xE1 apagada en el iPhone c\xE1mara.");
    if (protecting) throw Error("La c\xE1mara est\xE1 ocupada armando. Int\xE9ntalo de nuevo.");
    $("surveillanceMode").value = mode;
    if (state.armed) {
      $("mode").value = mode;
      setMode();
      renderProtection();
    } else await armProtection();
    if (!state.armed) throw Error($("error").textContent || "La c\xE1mara no pudo armarse.");
    log("modo", "Armado desde el m\xF3vil vinculado: " + remoteModes[mode]);
    const audio = mode !== "silent" && !audioReady ? " Aviso: el sonido no est\xE1 habilitado en el iPhone c\xE1mara; toca Probar sonido all\xED para que suene." : "";
    return "Armado en modo " + remoteModes[mode] + "." + audio;
  }
  function renderRemote() {
    const panel = $("remoteControls");
    const s = session, info = s == null ? void 0 : s.remote;
    panel.hidden = !s || s.role !== "viewer";
    if (panel.hidden) return;
    const fresh = info && Date.now() - info.received < 8e3;
    const text = !fresh ? "Esperando estado de la c\xE1mara\u2026" : !info.camera ? "C\xE1mara apagada" : (info.armed ? "ARMADA \xB7 " + (remoteModes[info.mode] || info.mode) : "DESARMADA") + (info.alarm ? " \xB7 ALARMA SONANDO" : "") + (info.recording ? " \xB7 GRABANDO" : "") + (info.people === "error" ? " \xB7 error de IA" : info.detected ? " \xB7 persona detectada" : "");
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
      var _a;
      if (current(s) && ((_a = s.pendingCommand) == null ? void 0 : _a.id) === id) {
        s.pendingCommand = null;
        status("La c\xE1mara no respondi\xF3 a la orden. Comprueba que siga compartiendo.");
        renderRemote();
      }
    }, 15e3) };
    status("Enviando orden a la c\xE1mara\u2026");
    renderRemote();
    void send(s, { type: "command", id, action, mode: $("remoteMode").value });
  }
  async function handle(s, data) {
    var _a;
    if (!current(s) || !data || data.role === s.role || !["viewer", "camera"].includes(data.role)) return;
    if (s.role === "viewer" && data.connection === s.connection) {
      if (data.type === "state" && data.state && typeof data.state === "object") {
        s.remote = { ...data.state, received: Date.now() };
        renderRemote();
        return;
      }
      if (data.type === "result" && ((_a = s.pendingCommand) == null ? void 0 : _a.id) === data.id) {
        clearTimeout(s.pendingCommand.timer);
        s.pendingCommand = null;
        status((data.ok ? "" : "La c\xE1mara rechaz\xF3 la orden: ") + String(data.message || "").slice(0, 300));
        renderRemote();
        return;
      }
    }
    if (s.role === "camera" && data.type === "command") {
      if (data.connection !== s.connection || typeof data.id !== "string" || data.id.length > 40) return;
      let ok = true, message;
      try {
        message = await executeCommand(data.action, data.mode);
      } catch (e) {
        ok = false;
        message = e.message;
      }
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
        processed();
        s.outgoing = frame.captureStream(6);
        s.paint = setInterval(() => {
          if (current(s)) processed();
        }, 166);
      } else {
        if (state.mask || +$("zoom").value !== 100) throw Error("Este Safari no puede compartir v\xEDdeo con m\xE1scara o zoom de forma segura.");
        s.native = true;
        s.outgoing = new MediaStream(state.stream.getVideoTracks().map((t) => t.clone()));
      }
      s.outgoing.getVideoTracks().forEach((t) => peer.addTrack(t, s.outgoing));
      const offer = await peer.createOffer();
      if (!current(s)) return;
      await peer.setLocalDescription(offer);
      await send(s, { type: "offer", sdp: offer.sdp });
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
        await peer.setLocalDescription(answer);
        await send(s, { type: "answer", sdp: answer.sdp });
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
    link = links.find((l) => l.id === link.id);
    if (!(link == null ? void 0 : link.camera_id) || role === "viewer" && !online(link)) throw Error("La c\xE1mara no est\xE1 compartiendo. Act\xEDvala en el otro iPhone.");
    const s = session = { link: { ...link }, role, epoch: ++epoch, candidates: [], connection: crypto.randomUUID() };
    status("Preparando conexi\xF3n privada\u2026");
    render();
    try {
      s.ice = await iceConfiguration(link);
      if (!current(s)) return;
      if (role === "camera") {
        if (!state.stream) await startCamera();
        if (!current(s)) return;
        if (!state.stream || state.cameraMuted) throw Error("No se pudo iniciar la c\xE1mara. Comprueba los permisos de Safari.");
        s.source = state.stream;
        s.link.lease = crypto.randomUUID();
        const ok = await rpc("pair_camera_publish", { link_id: link.id, session_id: s.link.lease, sharing: true });
        if (!ok) throw Error("La c\xE1mara ya est\xE1 compartiendo en otra pesta\xF1a, o el v\xEDnculo se revoc\xF3. Cierra la otra pesta\xF1a y espera 45 segundos.");
      }
      if (!current(s)) {
        if (role === "camera") await rpc("pair_camera_publish", { link_id: link.id, session_id: s.link.lease, sharing: false });
        return;
      }
      const { data } = await client.auth.getSession();
      await client.realtime.setAuth(data.session.access_token);
      if (!current(s)) return;
      s.channel = client.channel("security-pair:".concat(link.id, ":").concat(s.link.lease), {
        config: { private: true, broadcast: { self: false, ack: true } }
      });
      s.channel.on("broadcast", { event: "signal" }, ({ payload }) => {
        s.queue = (s.queue || Promise.resolve()).then(() => handle(s, payload)).catch((e) => {
          if (current(s)) void stop("Error de conexi\xF3n: " + e.message);
        });
      });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error("El canal privado no respondi\xF3. Revisa las pol\xEDticas Realtime de Supabase.")), 12e3);
        s.channel.subscribe((state2) => {
          if (state2 === "SUBSCRIBED") {
            clearTimeout(timer);
            resolve();
          } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(state2)) {
            clearTimeout(timer);
            reject(Error("No se pudo autorizar el canal privado."));
            if (current(s)) void stop("El canal privado se ha cerrado. Vuelve a conectar.");
          }
        });
      });
      if (!current(s)) return;
      s.heartbeat = setInterval(async () => {
        if (!current(s)) return;
        try {
          if (role === "camera" && !await rpc("pair_camera_publish", { link_id: link.id, session_id: s.link.lease, sharing: true }))
            throw Error("V\xEDnculo revocado o sesi\xF3n reemplazada.");
          await refresh();
        } catch {
          if (current(s)) await stop("Se perdi\xF3 el permiso o la conexi\xF3n con Supabase. Vuelve a conectar.");
        }
      }, 12e3);
      s.stateTimer = setInterval(() => {
        pushState(s);
        if (current(s)) renderRemote();
      }, 2e3);
      s.watch = setInterval(() => {
        if (!current(s)) return;
        if (role === "camera" && (!state.stream || state.stream !== s.source || state.cameraMuted || s.native && (state.mask || +$("zoom").value !== 100)))
          void stop("La c\xE1mara cambi\xF3 o dej\xF3 de estar disponible. El directo se ha detenido para proteger la privacidad.");
      }, 250);
      s.expiry = setTimeout(
        () => {
          if (current(s)) void stop("La autorizaci\xF3n de v\xEDdeo ha caducado. Pulsa conectar para renovarla.");
        },
        Math.min(55 * 6e4, s.ice.expiresAt * 1e3 - Date.now() - 1e4)
      );
      $("pairedVideoTitle").textContent = link.name;
      $("pairedVideo").hidden = role === "camera";
      if (role === "viewer") {
        await makePeer(s);
        await send(s, { type: "ready" });
        status("Conectando con la c\xE1mara. Esperando fotogramas\u2026");
      } else {
        $("pairedLive").textContent = "ESPERANDO VISOR";
        status("C\xE1mara compartida. En el otro m\xF3vil pulsa Actualizar conexiones \u2192 Ver directo. Los clips requieren armar la vigilancia aqu\xED.");
      }
      await refresh();
    } catch (e) {
      if (current(s)) {
        await stop();
        throw e;
      }
    }
  }
  async function open() {
    $("addSheet").hidden = true;
    goPage("pairing");
    await run(async () => {
      await refresh();
      status(pendingToken ? "Invitaci\xF3n recibida. Acepta para vincular este iPhone como c\xE1mara." : "Crea una invitaci\xF3n y \xE1brela en el otro m\xF3vil, o conecta una c\xE1mara vinculada.");
    });
  }
  setInterval(() => {
    if (securityUnlocked && user && !busy && !session && !document.hidden && ["pairing", "cameras"].includes(currentPage)) void refresh().catch(fail);
  }, 1e4);
  $("pairedVideo").addEventListener("playing", () => {
    if ((session == null ? void 0 : session.role) !== "viewer" || !$("pairedVideo").videoWidth) return;
    clearTimeout(session.deadline);
    $("pairedLive").textContent = "LIVE";
    status("Recibiendo v\xEDdeo en directo. Sin micr\xF3fono. Las grabaciones permanecen en el iPhone c\xE1mara.");
  });
  $("useOtherPhone").onclick = open;
  $("managePairing").onclick = open;
  $("createInvite").onclick = () => authorizeLocalAction("Invitar otro m\xF3vil", () => run(createInvitation));
  $("acceptInvite").onclick = () => authorizeLocalAction("Vincular este iPhone", () => run(acceptInvitation));
  $("rejectInvite").onclick = () => {
    rememberPending(null);
    status("Invitaci\xF3n descartada.");
    render();
  };
  $("cancelInvite").onclick = () => authorizeLocalAction("Cancelar invitaci\xF3n", () => run(() => revoke(invitation.id)));
  $("refreshPairs").onclick = () => run(refresh);
  $("remoteArm").onclick = () => authorizeLocalAction("Armar la c\xE1mara vinculada", () => sendCommand("arm"));
  $("remoteDisarm").onclick = () => authorizeLocalAction("Desarmar la c\xE1mara vinculada", () => sendCommand("disarm"));
  $("remoteSilence").onclick = () => sendCommand("silence");
  $("stopPair").onclick = () => authorizeLocalAction("Desconectar el directo", () => stop());
  $("copyInvite").onclick = async () => {
    try {
      await navigator.clipboard.writeText(invitation.url);
      status("Enlace copiado. Env\xEDalo de forma privada al otro m\xF3vil.");
    } catch {
      $("inviteLink").select();
      status("No se pudo copiar autom\xE1ticamente. Mant\xE9n pulsado el enlace y elige Copiar.");
    }
  };
  $("shareInvite").onclick = async () => {
    if (!navigator.share) return $("copyInvite").click();
    try {
      await navigator.share({ title: "Vincular c\xE1mara \xB7 SECURITY CAM", url: invitation.url });
    } catch (e) {
      if (e.name !== "AbortError") fail(e);
    }
  };
  document.addEventListener("security:lock", () => {
    void stop("Aplicaci\xF3n bloqueada. El directo remoto se ha detenido.");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && session) void stop("Safari dej\xF3 de estar visible. Vuelve a conectar el directo.");
  });
  window.addEventListener("pagehide", () => {
    if (session) void stop();
  });
  window.addEventListener("hashchange", () => {
    const match = /invite=([a-f0-9]{64})/i.exec(location.hash);
    if (match) {
      rememberPending(match[1].toLowerCase());
      history.replaceState(null, "", "#pairing");
      if (securityUnlocked) void open();
    }
  });
  document.addEventListener("security:unlock", () => {
    if (pendingToken) void open();
  });
  $("usePastedInvite").onclick = () => {
    const match = /invite=([a-f0-9]{64})/i.exec($("pasteInvite").value);
    if (!match) return status("Ese texto no contiene una invitaci\xF3n v\xE1lida. Copia el enlace completo que te enviaron.");
    $("pasteInvite").value = "";
    rememberPending(match[1].toLowerCase());
    render();
    status("Invitaci\xF3n recibida. Pulsa Aceptar y vincular este iPhone.");
    $("acceptInvitePanel").scrollIntoView({ block: "start" });
  };
  window.securityReady.then(() => {
    render();
    if (pendingToken || location.hash === "#pairing") void open();
    else if (localStorage.getItem("security-paired-installed")) void refresh().catch(fail);
  });
})();
