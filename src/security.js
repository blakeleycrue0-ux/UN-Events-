"use strict";
let pinPromptOpen = false,
  securityUnlocked = false,
  pinFailures = 0,
  pinBlockedUntil = 0;
function pinStored() {
  return localStorage.getItem("security-pin");
}
async function createLocalPin({ required = true } = {}) {
  let hint = "Elige de 6 a 12 cifras. Tendrás que repetirlas para confirmar.";
  while (true) {
    const first = await requestPin("Crea tu PIN", { required, hint });
    if (first === null) return false;
    const second = await requestPin("Repite tu PIN", {
      required,
      hint: "Introduce de nuevo el mismo PIN.",
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
async function verifyLocalPin(
  title,
  { required = false, warmAudio = false } = {},
) {
  let hint =
    "Introduce tu PIN para confirmar. Cancelar mantiene la vigilancia como está.";
  while (true) {
    if (pinBlockedUntil > Date.now()) {
      const seconds = Math.ceil((pinBlockedUntil - Date.now()) / 1000);
      const entered = await requestPin("Espera " + seconds + " segundos", {
        required,
        hint: "Demasiados intentos. Espera antes de volver a confirmar.",
      });
      if (entered === null) return false;
      if (pinBlockedUntil > Date.now()) continue;
    }
    let preparation;
    const value = await requestPin(title, {
      required,
      hint,
      onGesture: warmAudio
        ? () => {
            preparation = enableAudio();
          }
        : null,
    });
    if (value === null) return false;
    if ((await hash(value)) === pinStored()) {
      pinFailures = 0;
      if (preparation) await preparation;
      return true;
    }
    if (++pinFailures >= 5) {
      pinBlockedUntil = Date.now() + 30000;
      pinFailures = 0;
    }
    hint = "PIN incorrecto. No se ha realizado ningún cambio.";
  }
}
async function lockApplication() {
  if (pinPromptOpen) return;
  pinPromptOpen = true;
  securityUnlocked = false;
  document.dispatchEvent(new Event("security:lock"));
  document.body.classList.add("auth-pending");
  if (state.stream) $("captureDock").append($("videoViewport"));
  for (const el of document.querySelectorAll(
    ".app-header,#landingPage,#cameraPage,#profilePage,#activityPage,#camerasPage,#welcomePage,#pairingPage",
  ))
    el.inert = true;
  try {
    if (!pinStored()) await createLocalPin();
    else await verifyLocalPin("Desbloquear SECURITY CAM", { required: true });
    updatePreview();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    securityUnlocked = true;
    document.body.classList.remove("auth-pending", "locked", "hidden-controls");
    for (const el of document.querySelectorAll(
      ".app-header,#landingPage,#cameraPage,#profilePage,#activityPage,#camerasPage,#welcomePage,#pairingPage",
    ))
      el.inert = false;
    $("unlock").textContent = "Bloquear";
    if (typeof showPage === "function") showPage(location.hash.slice(1));
  } catch (e) {
    const panel = document.createElement("div");
    panel.className = "pin-screen";
    const text = document.createElement("p");
    text.textContent =
      "No se puede guardar o comprobar el PIN en este navegador. Activa almacenamiento local y recarga. " +
      e.message;
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
    if (!when()) return original?.(event);
    return authorizeLocalAction(
      typeof title === "function" ? title() : title,
      () => original?.(event),
      typeof warm === "function" ? warm() : warm,
    );
  };
}
protectHandler(
  "protect",
  () => (state.armed ? "Desactivar vigilancia" : "Activar vigilancia"),
  { warm: () => !state.armed && $("surveillanceMode").value !== "silent" && ($("autoVoice").checked || $("autoAlarm").checked) },
);
protectHandler(
  "arm",
  () => (state.armed ? "Desactivar vigilancia" : "Activar vigilancia"),
  { warm: () => !state.armed },
);
protectHandler("camera", "Detener la cámara", { when: () => !!state.stream });
protectHandler("restart", "Reiniciar la cámara", { when: () => state.armed });
protectHandler("alarm", "Activar sirena manual", { warm: true });
for (const id of ["zone", "mask", "clearZones", "fullZone"])
  protectHandler(id, "Cambiar zona de vigilancia", { when: () => state.armed });
const previousCameraChange = $("device").onchange;
$("device").onchange = async (event) => {
  if (state.armed) {
    const old =
      state.stream?.getVideoTracks()[0]?.getSettings?.().deviceId || "";
    const result = await authorizeLocalAction("Cambiar cámara", async () => {
      await previousCameraChange(event);
      return true;
    });
    if (!result) $("device").value = old;
  } else previousCameraChange(event);
};
$("unlock").onclick = lockApplication;
$("pin").onclick = () =>
  authorizeLocalAction("Cambiar el PIN", () =>
    createLocalPin({ required: false }),
  );
// Emergency silence remains immediate; it does not disarm surveillance.
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
  true,
);


let previousSurveillanceMode = $("surveillanceMode").value;
$("surveillanceMode").addEventListener("change", async () => {
  const selected = $("surveillanceMode").value;
  if (state.armed) {
    const ok = await authorizeLocalAction("Cambiar modo de vigilancia", () => {
      $("mode").value = selected; setMode(); return true;
    });
    if (!ok) $("surveillanceMode").value = previousSurveillanceMode;
    else previousSurveillanceMode = selected;
  } else previousSurveillanceMode = selected;
  save();
});
