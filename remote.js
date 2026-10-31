"use strict";
let signalingSocket, remotePeer, remoteStream, remoteRenderTimer, remoteDeadline, remoteCandidates = [], remoteIce = [], remoteRoleValue = "", remoteActive = false;
function remoteStatus(message) {
  $("remoteStatus").textContent = message;
}
function updateRemoteRole() {
  const host = $("remoteRole").value === "camera";
  $("hostCredentials").hidden = !host;
  $("viewerCredentials").hidden = host;
}
$("remoteRole").onchange = () => {
  disconnectRemote();
  updateRemoteRole();
};
updateRemoteRole();
function remoteSend(data) {
  if ((signalingSocket == null ? void 0 : signalingSocket.readyState) === WebSocket.OPEN)
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
  remoteStream == null ? void 0 : remoteStream.getTracks().forEach((t) => t.stop());
  remoteStream = null;
  remoteCandidates = [];
  $("remoteVideo").srcObject = null;
  $("remoteVideoBox").hidden = true;
}
function disconnectRemote() {
  remoteActive = false;
  closeRemotePeer();
  if (signalingSocket) {
    signalingSocket.onclose = null;
    signalingSocket.close();
    signalingSocket = null;
  }
  $("pairingResult").hidden = true;
  $("createdPair").value = "";
  remoteStatus("Desconectado. No se est\xE1 publicando v\xEDdeo.");
}
$("disconnectRemote").onclick = disconnectRemote;
async function makeRemotePeer() {
  closeRemotePeer();
  remotePeer = new RTCPeerConnection({
    iceServers: remoteIce,
    iceTransportPolicy: remoteIce.some(
      (s) => [].concat(s.urls || []).some((u) => /^turns?:/.test(u))
    ) ? "relay" : "all"
  });
  const peer = remotePeer;
  peer.onicecandidate = (e) => {
    if (e.candidate)
      remoteSend({ type: "candidate", candidate: e.candidate.toJSON() });
  };
  peer.ontrack = (e) => {
    $("remoteVideoBox").hidden = false;
    $("remoteVideo").srcObject = e.streams[0] || new MediaStream([e.track]);
    $("remoteVideo").play().catch(
      () => remoteStatus("Toca Reproducir en el v\xEDdeo para iniciar el directo.")
    );
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      clearTimeout(remoteDeadline);
      remoteStatus(
        remoteRoleValue === "camera" ? "Visor conectado mediante WebRTC cifrado. Grabaci\xF3n local independiente." : "V\xEDdeo conectado mediante WebRTC cifrado. Las grabaciones se guardan en el otro m\xF3vil."
      );
    } else if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
      remoteStatus(
        "La conexi\xF3n se ha interrumpido. Reconecta; para otras redes puede ser necesario TURN."
      );
      closeRemotePeer();
    }
  };
  remoteDeadline = setTimeout(() => {
    remoteStatus(
      "No se pudo establecer v\xEDdeo. Revisa TURN y la conectividad de ambos m\xF3viles."
    );
    closeRemotePeer();
  }, 3e4);
  return peer;
}
async function publishRemoteVideo() {
  if (!state.stream)
    throw Error("Inicia primero la c\xE1mara en la secci\xF3n Vigilancia.");
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
        "Este Safari no permite transmitir imagen procesada con m\xE1scara o zoom."
      );
    remoteStream = new MediaStream(
      state.stream.getVideoTracks().map((t) => t.clone())
    );
    remoteRenderTimer = setInterval(() => {
      if (!state.stream || document.hidden || state.mask || +$("zoom").value !== 100) {
        disconnectRemote();
        remoteStatus(
          "Conexi\xF3n detenida para proteger la privacidad o porque la c\xE1mara se ha detenido."
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
      "C\xE1mara preparada. Comparte la clave privada con tu otro m\xF3vil. No hay visor conectado."
    );
    $("pairingResult").hidden = false;
  } else if (message.type === "joined") {
    remoteIce = message.iceServers || [];
    await makeRemotePeer();
    remoteStatus("Emparejamiento autorizado. Esperando v\xEDdeo\u2026");
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
    if (remotePeer == null ? void 0 : remotePeer.remoteDescription)
      await remotePeer.addIceCandidate(message.candidate);
    else remoteCandidates.push(message.candidate);
  } else if (message.type === "viewer-left") {
    closeRemotePeer();
    remoteStatus(
      "El visor se ha desconectado. La c\xE1mara sigue grabando localmente."
    );
  } else if (message.type === "closed") disconnectRemote();
}
$("connectRemote").onclick = () => {
  disconnectRemote();
  try {
    if (!window.RTCPeerConnection)
      throw Error("WebRTC no est\xE1 disponible en este navegador.");
    const endpoint = new URL($("signalUrl").value);
    const local = ["localhost", "127.0.0.1"].includes(endpoint.hostname) && ["localhost", "127.0.0.1"].includes(location.hostname);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== "/" || !local && endpoint.protocol !== "wss:" || local && !["ws:", "wss:"].includes(endpoint.protocol))
      throw Error(
        "Usa una direcci\xF3n WSS sin claves en la URL. WS solo se admite en desarrollo local."
      );
    remoteRoleValue = $("remoteRole").value;
    if (remoteRoleValue === "camera" && !state.stream)
      throw Error("Inicia primero la c\xE1mara en Vigilancia y vuelve aqu\xED.");
    const key = remoteRoleValue === "camera" ? Array.from(crypto.getRandomValues(new Uint8Array(24))).map((b) => b.toString(16).padStart(2, "0")).join("") : $("pairKey").value.trim();
    if (!/^[a-f0-9]{48}$/.test(key))
      throw Error("La clave privada de emparejamiento no es v\xE1lida.");
    if (remoteRoleValue === "camera" && $("hostAccess").value.length < 32)
      throw Error(
        "Introduce la clave de instalaci\xF3n del servicio (al menos 32 caracteres)."
      );
    signalingSocket = new WebSocket(endpoint.href);
    const ws = signalingSocket;
    remoteActive = true;
    remoteStatus("Conectando con el servicio autenticado\u2026");
    ws.onopen = () => {
      ws.send(
        JSON.stringify(
          remoteRoleValue === "camera" ? {
            type: "create",
            secret: key,
            accessToken: $("hostAccess").value
          } : { type: "join", secret: key }
        )
      );
      $("hostAccess").value = "";
      if (remoteRoleValue === "camera") $("createdPair").value = key;
    };
    let messages = Promise.resolve();
    ws.onmessage = (e) => {
      messages = messages.then(() => handleRemoteMessage(JSON.parse(e.data))).catch((err) => {
        disconnectRemote();
        remoteStatus("Error de conexi\xF3n: " + err.message);
      });
    };
    ws.onerror = () => remoteStatus(
      "No se puede contactar con el servicio. Comprueba WSS, certificado y configuraci\xF3n."
    );
    ws.onclose = () => {
      remoteActive = false;
      closeRemotePeer();
      $("pairingResult").hidden = true;
      $("createdPair").value = "";
      remoteStatus(
        "Servicio desconectado o acceso rechazado. La vigilancia local contin\xFAa."
      );
    };
  } catch (e) {
    remoteStatus(e.message);
  }
};
$("copyPair").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("createdPair").value);
    remoteStatus("Clave copiada. Comp\xE1rtela solo con tu m\xF3vil de confianza.");
  } catch {
    $("createdPair").type = "text";
    $("createdPair").select();
    remoteStatus(
      "Selecciona y copia la clave. Vuelve a ocultarla al terminar."
    );
  }
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && remoteActive) disconnectRemote();
});
window.addEventListener("pagehide", disconnectRemote);
