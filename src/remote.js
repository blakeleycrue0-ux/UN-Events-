"use strict";
let signalingSocket,
  remotePeer,
  remoteStream,
  remoteRenderTimer,
  remoteDeadline,
  remoteCandidates = [],
  remoteIce = [],
  remoteRoleValue = "",
  remoteActive = false;
function remoteStatus(message) {
  $("remoteStatus").textContent = message;
}
function updateRemoteRole() {
  const cloud = $("remoteProvider")?.value === "supabase";
  const host = $("remoteRole").value === "camera";
  $("hostCredentials").hidden = cloud || !host;
  $("viewerCredentials").hidden = cloud || host;
  if (typeof updateSupabaseUI === "function") updateSupabaseUI();
}
$("remoteRole").onchange = () => {
  disconnectRemote();
  updateRemoteRole();
};
updateRemoteRole();
let remoteProviderTransport = null;
let remoteAttempt = 0;
function remoteSend(data) {
  if (remoteProviderTransport) {
    remoteProviderTransport.send(data);
    return;
  }
  if (signalingSocket?.readyState === WebSocket.OPEN)
    signalingSocket.send(JSON.stringify(data));
}
function closeRemotePeer() {
  clearInterval(remoteRenderTimer);
  clearTimeout(remoteDeadline);
  if (remotePeer) {
    remotePeer.onconnectionstatechange = null;
    remotePeer.close();
    remotePeer = null;
  }
  remoteStream?.getTracks().forEach((t) => t.stop());
  remoteStream = null;
  remoteCandidates = [];
  $("remoteVideo").srcObject = null;
  $("remoteVideoBox").hidden = true;
}
function disconnectRemote() {
  remoteAttempt++;
  const provider = remoteProviderTransport;
  remoteProviderTransport = null;
  provider?.close();
  remoteActive = false;
  closeRemotePeer();
  if (signalingSocket) {
    signalingSocket.onclose = null;
    signalingSocket.close();
    signalingSocket = null;
  }
  $("pairingResult").hidden = true;
  $("createdPair").value = "";
  remoteStatus("Desconectado. No se está publicando vídeo.");
}
$("disconnectRemote").onclick = disconnectRemote;
async function makeRemotePeer() {
  closeRemotePeer();
  remotePeer = new RTCPeerConnection({
    iceServers: remoteIce,
    iceTransportPolicy: remoteIce.some((s) =>
      [].concat(s.urls || []).some((u) => /^turns?:/.test(u)),
    )
      ? "relay"
      : "all",
  });
  const peer = remotePeer;
  peer.onicecandidate = (e) => {
    if (e.candidate)
      remoteSend({ type: "candidate", candidate: e.candidate.toJSON() });
  };
  peer.ontrack = (e) => {
    $("remoteVideoBox").hidden = false;
    $("remoteVideo").srcObject = e.streams[0] || new MediaStream([e.track]);
    $("remoteVideo")
      .play()
      .catch(() =>
        remoteStatus("Toca Reproducir en el vídeo para iniciar el directo."),
      );
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      clearTimeout(remoteDeadline);
      remoteStatus(
        remoteRoleValue === "camera"
          ? "Visor conectado mediante WebRTC cifrado. Grabación local independiente."
          : "Vídeo conectado mediante WebRTC cifrado. Las grabaciones se guardan en el otro móvil.",
      );
    } else if (
      ["failed", "disconnected", "closed"].includes(peer.connectionState)
    ) {
      remoteStatus(
        "La conexión se ha interrumpido. Reconecta; para otras redes puede ser necesario TURN.",
      );
      closeRemotePeer();
    }
  };
  remoteDeadline = setTimeout(() => {
    remoteStatus(
      "No se pudo establecer vídeo. Revisa TURN y la conectividad de ambos móviles.",
    );
    closeRemotePeer();
  }, 30000);
  return peer;
}
async function publishRemoteVideo() {
  if (!state.stream)
    throw Error("Inicia primero la cámara en la sección Vigilancia.");
  const peer = await makeRemotePeer();
  if (frame.captureStream) {
    processed();
    remoteStream = frame.captureStream(6);
    remoteRenderTimer = setInterval(() => {
      if (!state.stream || document.hidden) {
        disconnectRemote();
        return;
      }
      processed();
    }, 160);
  } else {
    if (state.mask || +$("zoom").value !== 100)
      throw Error(
        "Este Safari no permite transmitir imagen procesada con máscara o zoom.",
      );
    remoteStream = new MediaStream(
      state.stream.getVideoTracks().map((t) => t.clone()),
    );
    remoteRenderTimer = setInterval(() => {
      if (
        !state.stream ||
        document.hidden ||
        state.mask ||
        +$("zoom").value !== 100
      ) {
        disconnectRemote();
        remoteStatus(
          "Conexión detenida para proteger la privacidad o porque la cámara se ha detenido.",
        );
      }
    }, 200);
  }
  remoteStream.getVideoTracks().forEach((t) => peer.addTrack(t, remoteStream));
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  remoteSend({ type: "offer", sdp: offer.sdp });
}
async function handleRemoteMessage(message) {
  if (message.type === "created") {
    remoteIce = message.iceServers || [];
    remoteStatus(
      "Cámara preparada. Comparte la clave privada con tu otro móvil. No hay visor conectado.",
    );
    $("pairingResult").hidden = false;
  } else if (message.type === "joined") {
    remoteIce = message.iceServers || [];
    await makeRemotePeer();
    remoteStatus("Emparejamiento autorizado. Esperando vídeo…");
  } else if (message.type === "viewer-ready") await publishRemoteVideo();
  else if (message.type === "offer") {
    if (!remotePeer) await makeRemotePeer();
    await remotePeer.setRemoteDescription({ type: "offer", sdp: message.sdp });
    for (const c of remoteCandidates) await remotePeer.addIceCandidate(c);
    remoteCandidates = [];
    const answer = await remotePeer.createAnswer();
    await remotePeer.setLocalDescription(answer);
    remoteSend({ type: "answer", sdp: answer.sdp });
  } else if (message.type === "answer") {
    await remotePeer.setRemoteDescription({ type: "answer", sdp: message.sdp });
    for (const c of remoteCandidates) await remotePeer.addIceCandidate(c);
    remoteCandidates = [];
  } else if (message.type === "candidate") {
    if (remotePeer?.remoteDescription)
      await remotePeer.addIceCandidate(message.candidate);
    else remoteCandidates.push(message.candidate);
  } else if (message.type === "viewer-left") {
    closeRemotePeer();
    remoteStatus(
      "El visor se ha desconectado. La cámara sigue grabando localmente.",
    );
  } else if (message.type === "closed") disconnectRemote();
}
$("connectRemote").onclick = async () => {
  disconnectRemote();
  try {
    if (!window.RTCPeerConnection)
      throw Error("WebRTC no está disponible en este navegador.");
    if ($("remoteProvider")?.value === "supabase") {
      await connectSupabaseRemote(remoteAttempt);
      return;
    }
    const endpoint = new URL($("signalUrl").value);
    const local =
      ["localhost", "127.0.0.1"].includes(endpoint.hostname) &&
      ["localhost", "127.0.0.1"].includes(location.hostname);
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/" ||
      (!local && endpoint.protocol !== "wss:") ||
      (local && !["ws:", "wss:"].includes(endpoint.protocol))
    )
      throw Error(
        "Usa una dirección WSS sin claves en la URL. WS solo se admite en desarrollo local.",
      );
    remoteRoleValue = $("remoteRole").value;
    if (remoteRoleValue === "camera" && !state.stream)
      throw Error("Inicia primero la cámara en Vigilancia y vuelve aquí.");
    const key =
      remoteRoleValue === "camera"
        ? Array.from(crypto.getRandomValues(new Uint8Array(24)))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
        : $("pairKey").value.trim();
    if (!/^[a-f0-9]{48}$/.test(key))
      throw Error("La clave privada de emparejamiento no es válida.");
    if (remoteRoleValue === "camera" && $("hostAccess").value.length < 32)
      throw Error(
        "Introduce la clave de instalación del servicio (al menos 32 caracteres).",
      );
    signalingSocket = new WebSocket(endpoint.href);
    const ws = signalingSocket;
    remoteActive = true;
    remoteStatus("Conectando con el servicio autenticado…");
    ws.onopen = () => {
      ws.send(
        JSON.stringify(
          remoteRoleValue === "camera"
            ? {
                type: "create",
                secret: key,
                accessToken: $("hostAccess").value,
              }
            : { type: "join", secret: key },
        ),
      );
      $("hostAccess").value = "";
      if (remoteRoleValue === "camera") $("createdPair").value = key;
    };
    // Serialize signaling so ICE messages cannot race SDP setup.
    let messages = Promise.resolve();
    ws.onmessage = (e) => {
      messages = messages
        .then(() => handleRemoteMessage(JSON.parse(e.data)))
        .catch((err) => {
          disconnectRemote();
          remoteStatus("Error de conexión: " + err.message);
        });
    };
    ws.onerror = () =>
      remoteStatus(
        "No se puede contactar con el servicio. Comprueba WSS, certificado y configuración.",
      );
    ws.onclose = () => {
      remoteActive = false;
      closeRemotePeer();
      $("pairingResult").hidden = true;
      $("createdPair").value = "";
      remoteStatus(
        "Servicio desconectado o acceso rechazado. La vigilancia local continúa.",
      );
    };
  } catch (e) {
    remoteStatus(e.message);
  }
};
$("copyPair").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("createdPair").value);
    remoteStatus("Clave copiada. Compártela solo con tu móvil de confianza.");
  } catch {
    $("createdPair").type = "text";
    $("createdPair").select();
    remoteStatus(
      "Selecciona y copia la clave. Vuelve a ocultarla al terminar.",
    );
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && remoteActive) disconnectRemote();
});
window.addEventListener("pagehide", disconnectRemote);
