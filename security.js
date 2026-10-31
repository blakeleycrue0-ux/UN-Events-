"use strict";
let pinPromptOpen = false, securityUnlocked = false, pinFailures = 0, pinBlockedUntil = 0;
function pinStored() {
  return localStorage.getItem("security-pin");
}
async function createLocalPin({ required = true } = {}) {
  let hint = "Elige de 6 a 12 cifras. Tendr\xE1s que repetirlas para confirmar.";
  while (true) {
    const first = await requestPin("Crea tu PIN", { required, hint });
    if (first === null) return false;
    const second = await requestPin("Repite tu PIN", {
      required,
      hint: "Introduce de nuevo el mismo PIN."
    });
    if (second === null) return false;
    if (first !== second) {
      hint = "Los PIN no coinciden. Vamos a intentarlo otra vez.";
      continue;
    }
    localStorage.setItem("security-pin", await hash(first));
    log("modo", "PIN local creado y confirmado");
    return;
  }
}
async function verifyLocalPin(title, { required = false, warmAudio = false } = {}) {
  let hint = "Introduce tu PIN para confirmar. Cancelar mantiene la vigilancia como est\xE1.";
  while (true) {
    if (pinBlockedUntil > Date.now()) {
      const seconds = Math.ceil((pinBlockedUntil - Date.now()) / 1e3);
      const entered = await requestPin("Espera " + seconds + " segundos", {
        required,
        hint: "Demasiados intentos. Espera antes de volver a confirmar."
      });
      if (entered === null) return false;
      if (pinBlockedUntil > Date.now()) continue;
    }
    let preparation;
    const value = await requestPin(title, {
      required,
      hint,
      onGesture: warmAudio ? () => {
        preparation = enableAudio();
      } : null
    });
    if (value === null) return false;
    if (await hash(value) === pinStored()) {
      pinFailures = 0;
      if (preparation && !await preparation) return false;
      return true;
    }
    if (++pinFailures >= 5) {
      pinBlockedUntil = Date.now() + 3e4;
      pinFailures = 0;
    }
    hint = "PIN incorrecto. No se ha realizado ning\xFAn cambio.";
  }
}
async function lockApplication() {
  if (pinPromptOpen) return;
  pinPromptOpen = true;
  securityUnlocked = false;
  document.body.classList.add("auth-pending");
  if (state.stream) $("captureDock").append($("videoViewport"));
  for (const el of document.querySelectorAll(
    ".app-header,#landingPage,#cameraPage,#remotePage"
  ))
    el.inert = true;
  try {
    if (!pinStored()) await createLocalPin();
    else await verifyLocalPin("Desbloquear SECURITY CAM", { required: true });
    if (!state.stream) {
      for (const [id, value] of Object.entries({
        nightMode: "auto",
        brightness: "100",
        contrast: "100",
        gamma: "100",
        sensitivity: "60",
        confidence: "60",
        aiInterval: "3",
        nightSensitivity: "75",
        torchLimit: "30"
      }))
        $(id).value = value;
      $("lowPower").checked = true;
      updatePreview();
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
    securityUnlocked = true;
    document.body.classList.remove("auth-pending", "locked", "hidden-controls");
    for (const el of document.querySelectorAll(
      ".app-header,#landingPage,#cameraPage,#remotePage"
    ))
      el.inert = false;
    $("unlock").textContent = "Bloquear";
    if (typeof showPage === "function") showPage(location.hash.slice(1));
  } catch (e) {
    const panel = document.createElement("div");
    panel.className = "pin-screen";
    const text = document.createElement("p");
    text.textContent = "No se puede guardar o comprobar el PIN en este navegador. Activa almacenamiento local y recarga. " + e.message;
    panel.append(text);
    document.body.append(panel);
  } finally {
    pinPromptOpen = false;
  }
}
async function authorizeLocalAction(title, action, warmAudio = false) {
  if (!securityUnlocked || pinPromptOpen) return;
  pinPromptOpen = true;
  try {
    if (await verifyLocalPin(title, { warmAudio })) return await action();
  } catch (e) {
    error("No se pudo confirmar el PIN: " + e.message, "modo");
  } finally {
    pinPromptOpen = false;
  }
}
function protectHandler(id, title, { when = () => true, warm = false } = {}) {
  const original = $(id).onclick;
  $(id).onclick = (event) => {
    if (!securityUnlocked) return;
    if (!when()) return original == null ? void 0 : original(event);
    return authorizeLocalAction(
      typeof title === "function" ? title() : title,
      () => original == null ? void 0 : original(event),
      typeof warm === "function" ? warm() : warm
    );
  };
}
protectHandler(
  "protect",
  () => state.armed ? "Desactivar vigilancia" : "Activar vigilancia",
  { when: () => !(state.armed && !audioReady), warm: () => !state.armed }
);
protectHandler(
  "arm",
  () => state.armed ? "Desactivar vigilancia" : "Activar vigilancia",
  { warm: () => !state.armed }
);
protectHandler("camera", "Detener la c\xE1mara", { when: () => !!state.stream });
protectHandler("restart", "Reiniciar la c\xE1mara", { when: () => state.armed });
protectHandler("alarm", "Activar sirena manual", { warm: true });
for (const id of ["zone", "mask", "clearZones"])
  protectHandler(id, "Cambiar zona de vigilancia", { when: () => state.armed });
const previousCameraChange = $("device").onchange;
$("device").onchange = async (event) => {
  var _a, _b, _c;
  if (state.armed) {
    const old = ((_c = (_b = (_a = state.stream) == null ? void 0 : _a.getVideoTracks()[0]) == null ? void 0 : _b.getSettings) == null ? void 0 : _c.call(_b).deviceId) || "";
    const result = await authorizeLocalAction("Cambiar c\xE1mara", async () => {
      await previousCameraChange(event);
      return true;
    });
    if (!result) $("device").value = old;
  } else previousCameraChange(event);
};
$("unlock").onclick = lockApplication;
$("pin").onclick = () => authorizeLocalAction(
  "Cambiar el PIN",
  () => createLocalPin({ required: false })
);
window.securityReady = lockApplication();
let previousAlarmSource = $("alarmSource").value;
$("alarmSource").addEventListener(
  "change",
  (event) => {
    const selected = $("alarmSource").value;
    if (!state.armed) {
      previousAlarmSource = selected;
      return;
    }
    event.stopImmediatePropagation();
    authorizeLocalAction("Cambiar detector", () => {
      prepareDetection();
      previousAlarmSource = selected;
      return true;
    }).then((accepted) => {
      if (!accepted) $("alarmSource").value = previousAlarmSource;
    });
  },
  true
);
protectHandler("connectRemote", "Compartir la c\xE1mara", {
  when: () => $("remoteRole").value === "camera"
});
