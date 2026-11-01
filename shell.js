"use strict";
let currentPage = "home", profileData = {}, lastActivitySignature = "", lastCloudSignature = null;
try {
  profileData = JSON.parse(localStorage.getItem("security-profile") || "{}");
} catch {
}
const pageIDs = {
  home: "landingPage",
  cameras: "camerasPage",
  camera: "cameraPage",
  activity: "activityPage",
  profile: "profilePage",
  remote: "remotePage",
  account: "accountPage",
  welcome: "welcomePage"
};
function showPage(name) {
  if (!pageIDs[name])
    name = localStorage.getItem("security-app-started") ? "home" : "welcome";
  currentPage = name;
  const viewport = $("videoViewport");
  if ((name !== "camera" || document.body.classList.contains("auth-pending")) && state.stream)
    $("captureDock").append(viewport);
  else if (name === "camera") $("stage").insertBefore(viewport, $("overlay"));
  for (const [key, id] of Object.entries(pageIDs)) $(id).hidden = key !== name;
  document.body.dataset.page = name;
  $("backHome").hidden = ["home", "welcome"].includes(name);
  $("unlock").hidden = name === "welcome";
  document.querySelector(".app-navigation").hidden = [
    "welcome",
    "account"
  ].includes(name);
  for (const button of document.querySelectorAll("[data-tab]"))
    button.classList.toggle(
      "active",
      button.dataset.tab === (name === "camera" || name === "remote" ? "cameras" : name)
    );
  if (name === "camera") requestAnimationFrame(draw);
  if (name === "cameras" && cloudUser)
    refreshCloudCameras().catch(
      (e) => $("devicesStatus").textContent = e.message
    );
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
function accountPage() {
  goPage("account");
}
function openLocalCamera() {
  localStorage.setItem("security-app-started", "1");
  localStorage.setItem("security-device-configured", "1");
  goPage("camera");
}
function openMonitor() {
  if (!cloudUser) {
    accountPage();
    return;
  }
  goPage("remote");
  $("remoteRole").value = "viewer";
  updateRemoteRole();
  refreshCloudCameras().catch((e) => remoteStatus(e.message));
}
$("backHome").onclick = () => goPage("home");
$("welcomeLocal").onclick = startApp;
$("welcomeLogin").onclick = accountPage;
$("accountLocal").onclick = startApp;
$("openCamera").onclick = openLocalCamera;
$("openViewer").onclick = openMonitor;
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
$("accountOpen").onclick = accountPage;
$("remoteLogin").onclick = accountPage;
$("profileLock").onclick = lockApplication;
$("shareCamera").onclick = () => {
  if (!cloudUser) {
    accountPage();
    return;
  }
  goPage("remote");
  $("remoteRole").value = "camera";
  updateRemoteRole();
};
function openAdd() {
  $("addSheet").hidden = false;
  $("useThisPhone").focus();
}
$("openAdd").onclick = openAdd;
$("addFromCameras").onclick = openAdd;
$("closeAdd").onclick = () => $("addSheet").hidden = true;
$("useThisPhone").onclick = () => {
  $("addSheet").hidden = true;
  openLocalCamera();
};
$("linkOtherPhone").onclick = () => {
  $("addSheet").hidden = true;
  openMonitor();
};
$("editProfile").onclick = () => {
  $("profileNameInput").value = profileData.name || "";
  $("profileHomeInput").value = profileData.home || "";
  $("profileCameraInput").value = profileData.camera || "";
  $("profileSheet").hidden = false;
  $("profileNameInput").focus();
};
$("closeProfile").onclick = () => $("profileSheet").hidden = true;
$("profileForm").onsubmit = (event) => {
  event.preventDefault();
  const nextProfile = {
    name: $("profileNameInput").value.trim().slice(0, 40),
    home: $("profileHomeInput").value.trim().slice(0, 40),
    camera: $("profileCameraInput").value.trim().slice(0, 40)
  };
  try {
    localStorage.setItem("security-profile", JSON.stringify(nextProfile));
    profileData = nextProfile;
    $("profileSheet").hidden = true;
    if (profileData.camera) $("supabaseCameraName").value = profileData.camera;
    renderApp();
  } catch (e) {
    $("profileForm").querySelector(".fine-print").textContent = "No se pudo guardar: " + e.message;
  }
};
$("globalSilence").onclick = stopSounds;
$("refreshDevices").onclick = async () => {
  if (!cloudUser) {
    accountPage();
    return;
  }
  try {
    await refreshCloudCameras();
    $("devicesStatus").textContent = "Lista actualizada.";
    lastCloudSignature = "";
    renderApp();
  } catch (e) {
    $("devicesStatus").textContent = e.message;
  }
};
function deviceRow(name, status, action) {
  const button = document.createElement("button");
  button.className = "device-row";
  const icon = document.createElement("span");
  icon.className = "device-row-icon";
  icon.textContent = "\u25C9";
  const text = document.createElement("span"), title = document.createElement("strong"), subtitle = document.createElement("small");
  title.textContent = name;
  subtitle.textContent = status;
  text.append(title, subtitle);
  const arrow = document.createElement("span");
  arrow.className = "row-arrow";
  arrow.textContent = "\u203A";
  button.append(icon, text, arrow);
  button.onclick = action;
  return button;
}
function emptyState(target, title, detail) {
  const box = document.createElement("div");
  box.className = "empty-state";
  const heading = document.createElement("strong"), p = document.createElement("p");
  heading.textContent = title;
  p.textContent = detail;
  box.append(heading, p);
  target.replaceChildren(box);
}
function renderApp() {
  var _a;
  const name = profileData.name || ((_a = cloudUser == null ? void 0 : cloudUser.user_metadata) == null ? void 0 : _a.full_name) || "Mi perfil";
  $("greeting").textContent = profileData.name ? "HOLA, " + profileData.name.toUpperCase() : "TU ESPACIO";
  $("homeTitle").textContent = profileData.home || "Mi hogar";
  $("profileDisplayName").textContent = name;
  $("profileAvatar").textContent = Array.from(name)[0].toUpperCase();
  $("profileAccountLabel").textContent = (cloudUser == null ? void 0 : cloudUser.email) || "Perfil de este dispositivo";
  $("accountCTATitle").textContent = cloudUser ? "Mi cuenta" : "Accede a tu cuenta";
  $("accountCTAHint").textContent = cloudUser ? "Gestionar sesi\xF3n y conexi\xF3n" : "Conecta tus m\xF3viles de forma privada";
  $("deviceCardName").textContent = $("cameraTitle").textContent = profileData.camera || "Entrada";
  const status = state.stream ? state.armed ? "Vigilancia activa" : "C\xE1mara encendida" : "Sin c\xE1mara activa";
  $("deviceCardState").textContent = state.stream ? status : "Preparar como c\xE1mara";
  $("cameraStateBadge").textContent = state.recording ? "GRABANDO" : state.stream ? "EN DIRECTO" : "SIN C\xC1MARA";
  $("deviceBadge").textContent = state.stream ? "En este dispositivo" : "Configurar";
  $("deviceBadge").classList.toggle("online", !!state.stream);
  $("homeLocalState").textContent = state.alarm ? "Alarma activada" : state.warningPending ? "Aviso de seguridad" : state.armed ? "Sistema armado" : "Sistema desarmado";
  $("homeLocalDetail").textContent = state.recording ? "Grabaci\xF3n en curso en este dispositivo." : state.armed ? "Detecci\xF3n y respuesta activadas." : "La vigilancia se activa desde tu c\xE1mara.";
  $("homeStatusDot").classList.toggle("on", state.armed);
  const clips = $("clips").querySelectorAll(".clip").length;
  const pending = $("clips").querySelectorAll(".pending-evidence").length;
  $("clipCount").textContent = pending ? pending + " pendiente de guardar" : clips + " " + (clips === 1 ? "clip" : "clips");
  $("cloudHomeState").textContent = cloudUser ? "Cuenta conectada" : "Vincular cuenta";
  $("globalAlert").hidden = !state.alarm && !state.warningPending && !(activeAudio && !mediaAudio.paused);
  $("globalAlertText").textContent = state.alarm ? "Alarma activada en este dispositivo" : state.warningPending ? "Aviso de seguridad en curso" : "Reproduciendo sonido";
  $("remoteAccountNeeded").hidden = !!cloudUser;
  $("remoteControls").hidden = !cloudUser;
  if (currentPage === "cameras") {
    const label = profileData.camera || "Entrada";
    const signature = label + status;
    if ($("cameraList").dataset.signature !== signature) {
      $("cameraList").replaceChildren(
        deviceRow(label, status, openLocalCamera)
      );
      $("cameraList").dataset.signature = signature;
    }
  }
  const activitySignature = JSON.stringify(events.slice(0, 3));
  if (activitySignature !== lastActivitySignature) {
    lastActivitySignature = activitySignature;
    const entries = events.filter((e) => !e.message.includes("PIN")).slice(0, 3);
    $("recentActivity").replaceChildren();
    if (!entries.length)
      emptyState(
        $("recentActivity"),
        "Sin actividad todav\xEDa",
        "Aqu\xED aparecer\xE1n los eventos de tus c\xE1maras."
      );
    for (const e of entries) {
      const row = document.createElement("div");
      row.className = "activity-row";
      const dot = document.createElement("span");
      dot.className = "activity-dot";
      const copy = document.createElement("div"), title = document.createElement("strong"), time = document.createElement("small");
      title.textContent = e.message;
      time.textContent = new Date(e.time).toLocaleString("es-ES", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "short"
      });
      copy.append(title, time);
      row.append(dot, copy);
      $("recentActivity").append(row);
    }
  }
  const options = [...$("supabaseCameraList").options].filter((o) => o.value);
  const cloudSignature = ((cloudUser == null ? void 0 : cloudUser.id) || "") + options.map((o) => o.value + o.textContent).join();
  if (cloudSignature !== lastCloudSignature) {
    lastCloudSignature = cloudSignature;
    const target = $("cloudCameraCards");
    target.replaceChildren();
    if (!cloudUser)
      emptyState(
        target,
        "Tu cuenta, tus c\xE1maras",
        "Accede a tu cuenta para vincular otro m\xF3vil."
      );
    else if (!options.length)
      emptyState(
        target,
        "No hay c\xE1maras anunciadas",
        "Activa Compartir en el otro dispositivo y actualiza la lista."
      );
    else
      for (const option of options)
        target.append(
          deviceRow(option.textContent, "Anunciada por tu cuenta", () => {
            goPage("remote");
            $("remoteRole").value = "viewer";
            updateRemoteRole();
            $("supabaseCameraList").value = option.value;
          })
        );
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
let lastAccountSeen = null;
document.addEventListener("security:cloud", () => {
  const account = (cloudUser == null ? void 0 : cloudUser.id) || null;
  const newLogin = account && account !== lastAccountSeen;
  lastAccountSeen = account;
  if (newLogin && currentPage === "account") {
    localStorage.setItem("security-app-started", "1");
    goPage("home");
  } else renderApp();
});
showPage(location.hash.slice(1));
$("systemOpen").onclick = openLocalCamera;
let toastTimer;
document.addEventListener("security:event", (event) => {
  if (/fallo|error|no se puede|no se ha|bloque|interrump/i.test(
    event.detail.message
  )) {
    clearTimeout(toastTimer);
    $("appToast").textContent = event.detail.message;
    $("appToast").hidden = false;
    toastTimer = setTimeout(() => $("appToast").hidden = true, 6e3);
  }
});
const homePreview = document.createElement("img");
homePreview.id = "homePreview";
homePreview.alt = "\xDAltima imagen de la c\xE1mara de este dispositivo";
homePreview.hidden = true;
document.querySelector(".device-art").prepend(homePreview);
const previewCanvas = document.createElement("canvas"), previewContext = previewCanvas.getContext("2d");
let previewAt = 0;
function updateDevicePreview() {
  if (!state.stream || state.cameraMuted) {
    homePreview.hidden = true;
    homePreview.removeAttribute("src");
    return;
  }
  if (currentPage !== "home" || document.body.classList.contains("auth-pending") || Date.now() - previewAt < 4e3)
    return;
  previewAt = Date.now();
  previewCanvas.width = 320;
  previewCanvas.height = Math.round(320 * frame.height / frame.width);
  try {
    processed(previewCanvas, previewContext);
    homePreview.src = previewCanvas.toDataURL("image/jpeg", 0.6);
    homePreview.hidden = false;
  } catch {
    homePreview.hidden = true;
  }
}
setInterval(updateDevicePreview, 1e3);
