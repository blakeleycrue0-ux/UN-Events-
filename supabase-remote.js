"use strict";
let cloudClient = null, cloudUser = null, cloudSDKPromise = null;
let cloudVisibleUser = null;
function cloudStatus(text) {
  $("supabaseStatus").textContent = text;
}
function updateSupabaseUI() {
  const current = (cloudUser == null ? void 0 : cloudUser.id) || null;
  if (current !== cloudVisibleUser) {
    $("supabaseCameraList").replaceChildren(
      new Option("Busca tus c\xE1maras", "")
    );
    cloudVisibleUser = current;
  }
  $("supabaseUrl").disabled = !!cloudUser;
  $("supabasePublicKey").disabled = !!cloudUser;
  const cloud = $("remoteProvider").value === "supabase", host = $("remoteRole").value === "camera";
  $("supabasePanel").hidden = !cloud;
  $("signalUrl").closest("label").hidden = cloud;
  $("hostCredentials").hidden = cloud || !host;
  $("viewerCredentials").hidden = cloud || host;
  $("supabaseLoginFields").hidden = !!cloudUser;
  $("supabaseAccount").hidden = !cloudUser;
  $("supabaseCameraFields").hidden = !host;
  $("supabaseViewerFields").hidden = host;
  $("supabaseAccountStatus").textContent = cloudUser ? "Sesi\xF3n iniciada con tu cuenta." : "";
}
function publicSupabaseConfig() {
  const url = new URL($("supabaseUrl").value.trim());
  if (url.protocol !== "https:" || !/^[-a-z0-9]+\.supabase\.co$/i.test(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw Error("Usa la URL HTTPS p\xFAblica del proyecto Supabase.");
  const key = $("supabasePublicKey").value.trim();
  let anon = false;
  if (key.startsWith("sb_publishable_")) anon = key.length > 25;
  else {
    try {
      const part = key.split(".")[1];
      const decoded = JSON.parse(
        atob(part.replace(/-/g, "+").replace(/_/g, "/"))
      );
      anon = decoded.role === "anon";
    } catch {
    }
  }
  if (!anon) {
    $("supabasePublicKey").value = "";
    throw Error(
      "Introduce solo una clave p\xFAblica publishable o anon. Nunca secret ni service_role."
    );
  }
  return { url: url.origin, key };
}
async function loadCloudSDK() {
  if (window.createSecuritySupabase) return;
  if (!cloudSDKPromise)
    cloudSDKPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "vendor/supabase.js";
      s.onload = resolve;
      s.onerror = () => {
        cloudSDKPromise = null;
        reject(Error("No se puede cargar el cliente local de Supabase"));
      };
      document.head.append(s);
    });
  await cloudSDKPromise;
}
$("remoteProvider").onchange = () => {
  disconnectRemote();
  updateRemoteRole();
};
$("supabasePanel").before($("remoteRole").closest("label"));
try {
  const config = JSON.parse(
    localStorage.getItem("supabase-public-config") || "null"
  );
  if (config) {
    $("supabaseUrl").value = config.url;
    $("supabasePublicKey").value = config.key;
    $("supabaseSetup").open = false;
  }
} catch {
}
$("supabaseLogin").onclick = async () => {
  var _a;
  $("supabaseLogin").disabled = true;
  try {
    const config = publicSupabaseConfig();
    await loadCloudSDK();
    if (cloudClient) await cloudClient.auth.signOut({ scope: "local" });
    cloudClient = window.createSecuritySupabase(config.url, config.key, {
      auth: {
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false
      },
      realtime: { params: { eventsPerSecond: 10 } }
    });
    const password = $("supabasePassword").value;
    $("supabasePassword").value = "";
    const { data, error: err } = await cloudClient.auth.signInWithPassword({
      email: $("supabaseEmail").value.trim(),
      password
    });
    if (err || !data.user)
      throw Error((err == null ? void 0 : err.message) || "No se pudo iniciar sesi\xF3n");
    const membership = await cloudClient.from("remote_memberships").select("enabled").eq("user_id", data.user.id).single();
    if (membership.error || !((_a = membership.data) == null ? void 0 : _a.enabled)) {
      await cloudClient.auth.signOut({ scope: "local" });
      throw Error(
        "La cuenta a\xFAn no tiene acceso remoto habilitado. Aplica el SQL y autoriza tu usuario en Supabase."
      );
    }
    cloudUser = data.user;
    localStorage.setItem("supabase-public-config", JSON.stringify(config));
    $("supabaseSetup").open = false;
    cloudClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session && cloudUser) {
        disconnectRemote();
        cloudUser = null;
        updateSupabaseUI();
        cloudStatus("Sesi\xF3n cerrada. La vigilancia local contin\xFAa.");
      }
    });
    updateSupabaseUI();
    cloudStatus("Cuenta verificada. Usa esta misma cuenta en los dos m\xF3viles.");
    if ($("remoteRole").value === "viewer") await refreshCloudCameras();
  } catch (e) {
    cloudUser = null;
    $("supabasePassword").value = "";
    updateSupabaseUI();
    cloudStatus("No se ha conectado: " + e.message);
  } finally {
    $("supabaseLogin").disabled = false;
  }
};
$("supabaseLogout").onclick = async () => {
  disconnectRemote();
  if (cloudClient) await cloudClient.auth.signOut({ scope: "local" });
  cloudUser = null;
  updateSupabaseUI();
  cloudStatus("Sesi\xF3n cerrada.");
};
async function refreshCloudCameras() {
  if (!cloudClient || !cloudUser) throw Error("Inicia sesi\xF3n con tu cuenta.");
  const { data, error: err } = await cloudClient.from("remote_cameras").select("id,name,last_seen").eq("owner_id", cloudUser.id).eq("is_sharing", true).gte("last_seen", new Date(Date.now() - 45e3).toISOString()).order("last_seen", { ascending: false });
  if (err) throw Error("No se pudieron consultar tus c\xE1maras: " + err.message);
  $("supabaseCameraList").replaceChildren(
    new Option("Selecciona tu c\xE1mara", "")
  );
  for (const camera of data || [])
    $("supabaseCameraList").add(new Option(camera.name, camera.id));
  cloudStatus(
    (data == null ? void 0 : data.length) ? "C\xE1maras anunciadas por tu cuenta. El v\xEDdeo se comprobar\xE1 al conectar." : "No hay c\xE1maras anunciadas recientemente. Inicia Compartir en el m\xF3vil c\xE1mara."
  );
}
$("supabaseRefresh").onclick = () => refreshCloudCameras().catch((e) => cloudStatus(e.message));
function cloudUUID() {
  return crypto.randomUUID ? crypto.randomUUID() : ("10000000-1000-4000-8000" + -1e11).replace(
    /[018]/g,
    (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
  );
}
async function connectSupabaseRemote(attempt = remoteAttempt) {
  var _a, _b, _c, _d;
  if (!cloudClient || !cloudUser)
    throw Error("Inicia sesi\xF3n en Supabase antes de conectar.");
  const client = cloudClient;
  const validAttempt = () => attempt === remoteAttempt;
  remoteStatus("Preparando conexi\xF3n privada y relay TURN\u2026");
  remoteRoleValue = $("remoteRole").value;
  if (remoteRoleValue === "camera" && !state.stream)
    throw Error("Inicia la c\xE1mara en Vigilancia antes de compartirla.");
  const { data: ice, error: iceError } = await client.functions.invoke(
    "ice-config",
    { body: {} }
  );
  if (((_a = iceError == null ? void 0 : iceError.context) == null ? void 0 : _a.status) === 401)
    throw Error("La sesi\xF3n de tu cuenta ha caducado. Vuelve a iniciar sesi\xF3n.");
  if (((_b = iceError == null ? void 0 : iceError.context) == null ? void 0 : _b.status) === 403)
    throw Error(
      "La cuenta o el origen no tienen permiso para conexi\xF3n remota. Revisa la autorizaci\xF3n en Supabase."
    );
  if (iceError || !((_c = ice == null ? void 0 : ice.iceServers) == null ? void 0 : _c.some(
    (s) => [].concat(s.urls || []).some((u) => /^turns?:/.test(u)) && s.username && s.credential
  )))
    throw Error(
      "Falta configurar la funci\xF3n ice-config y el relay TURN autenticado. Todav\xEDa no hay acceso exterior."
    );
  if (!validAttempt()) return;
  await client.realtime.setAuth();
  if (!validAttempt()) return;
  remoteIce = ice.iceServers;
  const owner = cloudUser.id, clientId = cloudUUID(), host = remoteRoleValue === "camera";
  let id;
  if (host) {
    const storageKey = "supabase-camera:" + owner;
    id = localStorage.getItem(storageKey) || cloudUUID();
    localStorage.setItem(storageKey, id);
    const name = $("supabaseCameraName").value.trim().slice(0, 60) || "Entrada";
    const { error: err } = await client.from("remote_cameras").upsert({
      id,
      owner_id: owner,
      name,
      session_id: clientId,
      is_sharing: true,
      last_seen: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (err) throw Error("No se puede registrar esta c\xE1mara: " + err.message);
  } else {
    id = $("supabaseCameraList").value;
    if (!id) throw Error("Selecciona una de tus c\xE1maras.");
    const result = await client.from("remote_cameras").select("id,last_seen,is_sharing").eq("id", id).eq("owner_id", owner).single();
    if (result.error || !((_d = result.data) == null ? void 0 : _d.is_sharing) || Date.now() - Date.parse(result.data.last_seen) > 45e3)
      throw Error("La c\xE1mara no est\xE1 anunciada. Enci\xE9ndela y vuelve a buscar.");
  }
  if (!validAttempt()) {
    if (host)
      await client.from("remote_cameras").update({ is_sharing: false }).eq("id", id).eq("session_id", clientId);
    return;
  }
  const channel = client.channel("security-cam:" + owner + ":" + id, {
    config: { private: true, broadcast: { self: false, ack: true } }
  });
  let closed = false, activeViewer = null, heartbeat, expiry, retry, messages = Promise.resolve();
  const transport = {
    send(payload, target = host ? activeViewer : "camera") {
      if (closed) return;
      channel.send({
        type: "broadcast",
        event: "signal",
        payload: { ...payload, from: clientId, target }
      }).then((status) => {
        if (status !== "ok" && !closed) {
          disconnectRemote();
          remoteStatus("No se pudo enviar la se\xF1al privada. Reconecta.");
        }
      }).catch(() => {
        if (!closed) {
          disconnectRemote();
          remoteStatus("La se\xF1alizaci\xF3n privada se ha interrumpido.");
        }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      clearInterval(retry);
      clearTimeout(expiry);
      channel.send({
        type: "broadcast",
        event: "signal",
        payload: {
          type: host ? "closed" : "viewer-left",
          from: clientId,
          target: host ? activeViewer : "camera"
        }
      }).finally(() => client.removeChannel(channel)).catch(() => {
      });
      if (host)
        client.from("remote_cameras").update({ is_sharing: false, last_seen: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).eq("owner_id", owner).eq("session_id", clientId).then(() => {
        }).catch(() => {
        });
    }
  };
  remoteProviderTransport = transport;
  remoteActive = true;
  channel.on("broadcast", { event: "signal" }, ({ payload: m }) => {
    if (closed || !m || m.from === clientId || m.target !== (host ? "camera" : clientId) && m.target !== "all")
      return;
    messages = messages.then(async () => {
      if (m.type === "viewer-ready" && host) {
        if (activeViewer && activeViewer !== m.from) {
          transport.send({ type: "busy" }, m.from);
          return;
        }
        if (remotePeer) return;
        activeViewer = m.from;
        await handleRemoteMessage(m);
      } else if (m.type === "camera-ready" && !host && !(remotePeer == null ? void 0 : remotePeer.remoteDescription))
        transport.send({ type: "viewer-ready" });
      else if (m.type === "busy") {
        disconnectRemote();
        remoteStatus("La c\xE1mara ya tiene otro visor conectado.");
      } else if (!host || m.from === activeViewer) {
        if (m.type === "viewer-left") activeViewer = null;
        await handleRemoteMessage(m);
      }
    }).catch((e) => {
      disconnectRemote();
      remoteStatus("Error de se\xF1alizaci\xF3n: " + e.message);
    });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(
        Error(
          "El canal privado no respondi\xF3. Revisa las pol\xEDticas de Realtime."
        )
      ),
      12e3
    );
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timer);
        resolve();
      } else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) {
        clearTimeout(timer);
        if (!closed)
          reject(Error("Acceso al canal privado rechazado o interrumpido."));
        if (remoteActive && !closed) {
          disconnectRemote();
          remoteStatus("Canal privado desconectado.");
        }
      }
    });
  }).catch((e) => {
    disconnectRemote();
    throw e;
  });
  if (closed || !validAttempt()) {
    transport.close();
    return;
  }
  expiry = setTimeout(
    () => {
      disconnectRemote();
      remoteStatus("La sesi\xF3n de v\xEDdeo ha caducado. Vuelve a conectar.");
    },
    Math.min(36e5, Math.max(1e3, ice.expiresAt * 1e3 - Date.now()))
  );
  if (host) {
    heartbeat = setInterval(async () => {
      const { error: err } = await client.from("remote_cameras").update({ last_seen: (/* @__PURE__ */ new Date()).toISOString() }).eq("id", id).eq("owner_id", owner).eq("session_id", clientId);
      if (err && !closed) {
        disconnectRemote();
        remoteStatus("No se puede renovar la c\xE1mara en tu cuenta.");
      }
    }, 15e3);
    remoteStatus(
      "C\xE1mara anunciada en tu cuenta. Abre la misma cuenta en el otro m\xF3vil. A\xFAn no hay v\xEDdeo remoto conectado."
    );
    transport.send({ type: "camera-ready" }, "all");
  } else {
    await makeRemotePeer();
    transport.send({ type: "viewer-ready" });
    retry = setInterval(() => {
      if (!(remotePeer == null ? void 0 : remotePeer.remoteDescription))
        transport.send({ type: "viewer-ready" });
      else clearInterval(retry);
    }, 2e3);
    remoteStatus(
      "Cuenta y c\xE1mara autorizadas. Estableciendo v\xEDdeo mediante TURN\u2026"
    );
  }
}
updateSupabaseUI();
