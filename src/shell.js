"use strict";
let currentPage = "home",
  profileData = {},
  lastActivitySignature = "";
try {
  profileData = JSON.parse(localStorage.getItem("security-profile") || "{}");
} catch {}
const pageIDs = {
  home: "landingPage",
  cameras: "camerasPage",
  camera: "cameraPage",
  activity: "activityPage",
  profile: "profilePage",
  welcome: "welcomePage",
};
function showPage(name) {
  if (["account", "remote"].includes(name)) name = "home";
  if (!pageIDs[name])
    name = localStorage.getItem("security-app-started") ? "home" : "welcome";
  currentPage = name;
  const viewport = $("videoViewport");
  if (
    (name !== "camera" || document.body.classList.contains("auth-pending")) &&
    state.stream
  )
    $("captureDock").append(viewport);
  else if (name === "camera") $("stage").insertBefore(viewport, $("overlay"));
  for (const [key, id] of Object.entries(pageIDs)) $(id).hidden = key !== name;
  document.body.dataset.page = name;
  $("backHome").hidden = ["home", "welcome"].includes(name);
  $("unlock").hidden = name === "welcome";
  document.querySelector(".app-navigation").hidden = name === "welcome";
  for (const button of document.querySelectorAll("[data-tab]"))
    button.classList.toggle(
      "active",
      button.dataset.tab ===
        (name === "camera" ? "cameras" : name),
    );
  if (name === "camera") requestAnimationFrame(draw);
  window.scrollTo(0, 0);
  renderApp();
}
function goPage(name) {
  showPage(name);
  if (location.hash !== "#" + name) location.hash = name;
}
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
function startApp() {
  localStorage.setItem("security-app-started", "1");
  goPage("home");
}
function openLocalCamera() {
  localStorage.setItem("security-app-started", "1");
  localStorage.setItem("security-device-configured", "1");
  goPage("camera");
}
$("backHome").onclick = () => goPage("home");
$("welcomeLocal").onclick = startApp;
$("openCamera").onclick = openLocalCamera;
$("quickCamera").onclick = openLocalCamera;
$("navHome").onclick = () => goPage("home");
$("navCameras").onclick = () => goPage("cameras");
$("navClips").onclick = () => {
  goPage("activity");
  selectActivity("clips");
};
$("navSettings").onclick = () => goPage("profile");
$("homeClips").onclick = $("navClips").onclick;
$("viewEvents").onclick = () => {
  goPage("activity");
  selectActivity("events");
};
$("seeDevices").onclick = () => goPage("cameras");
function selectActivity(tab) {
  document.querySelector(".evidence").hidden = tab !== "clips";
  $("eventsGroup").hidden = tab !== "events";
  $("showClips").classList.toggle("selected", tab === "clips");
  $("showEvents").classList.toggle("selected", tab === "events");
}
$("showClips").onclick = () => selectActivity("clips");
$("showEvents").onclick = () => selectActivity("events");
$("profileLock").onclick = lockApplication;
function openAdd() {
  $("addSheet").hidden = false;
  $("useThisPhone").focus();
}
$("openAdd").onclick = openAdd;
$("addFromCameras").onclick = openAdd;
$("closeAdd").onclick = () => ($("addSheet").hidden = true);
$("useThisPhone").onclick = () => {
  $("addSheet").hidden = true;
  openLocalCamera();
};
$("editProfile").onclick = () => {
  $("profileNameInput").value = profileData.name || "";
  $("profileHomeInput").value = profileData.home || "";
  $("profileCameraInput").value = profileData.camera || "";
  $("profileSheet").hidden = false;
  $("profileNameInput").focus();
};
$("closeProfile").onclick = () => ($("profileSheet").hidden = true);
$("profileForm").onsubmit = (event) => {
  event.preventDefault();
  const nextProfile = {
    name: $("profileNameInput").value.trim().slice(0, 40),
    home: $("profileHomeInput").value.trim().slice(0, 40),
    camera: $("profileCameraInput").value.trim().slice(0, 40),
  };
  try {
    localStorage.setItem("security-profile", JSON.stringify(nextProfile));
    profileData = nextProfile;
    $("profileSheet").hidden = true;
    renderApp();
  } catch (e) {
    $("profileForm").querySelector(".fine-print").textContent =
      "No se pudo guardar: " + e.message;
  }
};
$("globalSilence").onclick = stopSounds;
function deviceRow(name, status, action) {
  const button = document.createElement("button");
  button.className = "device-row";
  const icon = document.createElement("span");
  icon.className = "device-row-icon";
  icon.textContent = "◉";
  const text = document.createElement("span"),
    title = document.createElement("strong"),
    subtitle = document.createElement("small");
  title.textContent = name;
  subtitle.textContent = status;
  text.append(title, subtitle);
  const arrow = document.createElement("span");
  arrow.className = "row-arrow";
  arrow.textContent = "›";
  button.append(icon, text, arrow);
  button.onclick = action;
  return button;
}
function emptyState(target, title, detail) {
  const box = document.createElement("div");
  box.className = "empty-state";
  const heading = document.createElement("strong"),
    p = document.createElement("p");
  heading.textContent = title;
  p.textContent = detail;
  box.append(heading, p);
  target.replaceChildren(box);
}
function renderApp() {
  const name =
    profileData.name || "Mi perfil";
  $("greeting").textContent = profileData.name
    ? "HOLA, " + profileData.name.toUpperCase()
    : "TU ESPACIO";
  $("homeTitle").textContent = profileData.home || "Mi hogar";
  $("profileDisplayName").textContent = name;
  $("profileAvatar").textContent = Array.from(name)[0].toUpperCase();
  $("profileAccountLabel").textContent = "Perfil de este dispositivo";
  $("deviceCardName").textContent = $("cameraTitle").textContent =
    profileData.camera || "Entrada";
  const status = state.stream
    ? state.armed
      ? "Vigilancia activa"
      : "Cámara encendida"
    : "Sin cámara activa";
  $("deviceCardState").textContent = state.stream
    ? status
    : "Preparar como cámara";
  $("cameraStateBadge").textContent = state.recording
    ? "GRABANDO"
    : state.stream
      ? "EN DIRECTO"
      : "SIN CÁMARA";
  $("deviceBadge").textContent = state.stream
    ? "En este dispositivo"
    : "Configurar";
  $("deviceBadge").classList.toggle("online", !!state.stream);
  $("homeLocalState").textContent = state.alarm
    ? "Alarma activada"
    : state.warningPending
      ? "Aviso de seguridad"
      : state.armed
        ? "Sistema armado"
        : "Sistema desarmado";
  $("homeLocalDetail").textContent = state.recording
    ? "Grabación en curso en este dispositivo."
    : state.armed
      ? "Detección y respuesta activadas."
      : "La vigilancia se activa desde tu cámara.";
  $("homeStatusDot").classList.toggle("on", state.armed);
  const clips = $("clips").querySelectorAll(".clip").length;
  const pending = $("clips").querySelectorAll(".pending-evidence").length;
  $("clipCount").textContent = pending
    ? pending + " pendiente de guardar"
    : clips + " " + (clips === 1 ? "clip" : "clips");
  $("globalAlert").hidden =
    !state.alarm &&
    !state.warningPending &&
    !(activeAudio && !mediaAudio.paused);
  $("globalAlertText").textContent = state.alarm
    ? "Alarma activada en este dispositivo"
    : state.warningPending
      ? "Aviso de seguridad en curso"
      : "Reproduciendo sonido";
  if (currentPage === "cameras") {
    const label = profileData.camera || "Entrada";
    const signature = label + status;
    if ($("cameraList").dataset.signature !== signature) {
      $("cameraList").replaceChildren(
        deviceRow(label, status, openLocalCamera),
      );
      $("cameraList").dataset.signature = signature;
    }
  }
  const activitySignature = JSON.stringify(events.slice(0, 3));
  if (activitySignature !== lastActivitySignature) {
    lastActivitySignature = activitySignature;
    const entries = events
      .filter((e) => !e.message.includes("PIN"))
      .slice(0, 3);
    $("recentActivity").replaceChildren();
    if (!entries.length)
      emptyState(
        $("recentActivity"),
        "Sin actividad todavía",
        "Aquí aparecerán los eventos de tus cámaras.",
      );
    for (const e of entries) {
      const row = document.createElement("div");
      row.className = "activity-row";
      const dot = document.createElement("span");
      dot.className = "activity-dot";
      const copy = document.createElement("div"),
        title = document.createElement("strong"),
        time = document.createElement("small");
      title.textContent = e.message;
      time.textContent = new Date(e.time).toLocaleString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short",
      });
      copy.append(title, time);
      row.append(dot, copy);
      $("recentActivity").append(row);
    }
  }

}
for (const sheet of [$("addSheet"), $("profileSheet")])
  sheet.addEventListener("click", (e) => {
    if (e.target === sheet) sheet.hidden = true;
  });
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    $("addSheet").hidden = true;
    $("profileSheet").hidden = true;
  }
});
setInterval(renderApp, 700);
showPage(location.hash.slice(1));

$("systemOpen").onclick = openLocalCamera;
let toastTimer;
document.addEventListener("security:event", (event) => {
  if (
    /fallo|error|no se puede|no se ha|bloque|interrump/i.test(
      event.detail.message,
    )
  ) {
    clearTimeout(toastTimer);
    $("appToast").textContent = event.detail.message;
    $("appToast").hidden = false;
    toastTimer = setTimeout(() => ($("appToast").hidden = true), 6000);
  }
});

const homePreview = document.createElement("img");
homePreview.id = "homePreview";
homePreview.alt = "Última imagen de la cámara de este dispositivo";
homePreview.hidden = true;
document.querySelector(".device-art").prepend(homePreview);
const previewCanvas = document.createElement("canvas"),
  previewContext = previewCanvas.getContext("2d");
let previewAt = 0;
function updateDevicePreview() {
  if (!state.stream || state.cameraMuted) {
    homePreview.hidden = true;
    homePreview.removeAttribute("src");
    return;
  }
  if (
    currentPage !== "home" ||
    document.body.classList.contains("auth-pending") ||
    Date.now() - previewAt < 4000
  )
    return;
  previewAt = Date.now();
  previewCanvas.width = 320;
  previewCanvas.height = Math.round((320 * frame.height) / frame.width);
  try {
    processed(previewCanvas, previewContext);
    homePreview.src = previewCanvas.toDataURL("image/jpeg", 0.6);
    homePreview.hidden = false;
  } catch {
    homePreview.hidden = true;
  }
}
setInterval(updateDevicePreview, 1000);
