"use strict";
let currentPage = "home", profileData = {}, lastActivitySignature = "";
let activityTab = "clips", homeActionBusy = false, searchTimer;
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
  welcome: "welcomePage"
};
function showPage(name) {
  const requestedActivity = name === "events" ? "events" : name === "activity" ? "clips" : null;
  if (name === "events") name = "activity";
  if (document.body.classList.contains("video-expanded")) exitExpandedVideo();
  if (["account", "remote"].includes(name)) name = "home";
  if (!pageIDs[name])
    name = localStorage.getItem("security-app-started") ? "home" : "welcome";
  currentPage = name;
  const viewport = $("videoViewport"), livePage = name === "home" || name === "camera";
  $(name === "home" ? "homeLiveHost" : "cameraLiveHost").append($("cameraLiveModule"));
  if ((!livePage || document.body.classList.contains("auth-pending")) && state.stream) $("captureDock").append(viewport);
  else if (livePage) $("stage").insertBefore(viewport, $("overlay"));
  for (const [key, id] of Object.entries(pageIDs)) $(id).hidden = key !== name;
  document.body.dataset.page = name;
  $("backHome").hidden = ["home", "welcome"].includes(name);
  $("unlock").hidden = name === "welcome";
  $("profileOpen").hidden = name === "welcome";
  document.querySelector(".app-navigation").hidden = name === "welcome";
  for (const button of document.querySelectorAll("[data-tab]"))
    button.classList.toggle(
      "active",
      button.dataset.tab === (name === "activity" && activityTab === "events" ? "events" : name === "camera" ? "cameras" : name)
    );
  if (livePage) requestAnimationFrame(draw);
  if (requestedActivity) selectActivity(requestedActivity);
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
$("profileOpen").onclick = () => goPage("profile");
$("navEvents").onclick = () => goPage("events");
$("homeStorage").onclick = () => $("navClips").click();
$("configureCamera").onclick = () => {
  openLocalCamera();
  const panel = document.querySelector(".surveillance-panel");
  panel.open = true;
  panel.scrollIntoView({ block: "start" });
};
async function homeCameraAction() {
  if (homeActionBusy) return;
  homeActionBusy = true;
  renderApp();
  try {
    await $("camera").onclick();
  } finally {
    homeActionBusy = false;
    renderApp();
  }
}
$("cameraPower").onclick = homeCameraAction;
$("homeStartCamera").onclick = homeCameraAction;
$("homeProtect").onclick = async () => {
  if (homeActionBusy) return;
  homeActionBusy = true;
  renderApp();
  try {
    await $("protect").onclick();
  } finally {
    homeActionBusy = false;
    renderApp();
  }
};
$("homeClips").onclick = $("navClips").onclick;
$("viewEvents").onclick = () => goPage("events");
$("seeDevices").onclick = () => goPage("cameras");
function selectActivity(tab) {
  activityTab = tab;
  $("activityTitle").textContent = tab === "events" ? "Eventos" : "Grabaciones";
  for (const button of document.querySelectorAll("[data-tab]")) button.classList.toggle("active", currentPage === "activity" && button.dataset.tab === (tab === "events" ? "events" : "activity"));
  document.querySelector(".evidence").hidden = tab !== "clips";
  $("eventsGroup").hidden = tab !== "events";
  $("showClips").classList.toggle("selected", tab === "clips");
  $("showEvents").classList.toggle("selected", tab === "events");
}
$("showClips").onclick = () => goPage("activity");
$("showEvents").onclick = () => goPage("events");
$("profileLock").onclick = lockApplication;
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
    renderApp();
  } catch (e) {
    $("profileForm").querySelector(".fine-print").textContent = "No se pudo guardar: " + e.message;
  }
};
$("globalSilence").onclick = stopSounds;
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
  const name = profileData.name || "Mi perfil";
  $("greeting").textContent = profileData.name ? "HOLA, " + profileData.name.toUpperCase() : "TU ESPACIO";
  $("homeTitle").textContent = profileData.home || "Mi hogar";
  $("profileDisplayName").textContent = name;
  $("profileAvatar").textContent = Array.from(name)[0].toUpperCase();
  $("profileAccountLabel").textContent = "Perfil de este dispositivo";
  $("deviceCardName").textContent = $("cameraTitle").textContent = profileData.camera || "Entrada";
  $("heroCameraName").textContent = profileData.camera || "Entrada";
  const status = state.stream ? state.armed ? "Vigilancia activa" : "C\xE1mara encendida" : "Sin c\xE1mara activa";
  $("deviceCardState").textContent = state.stream ? status : "Preparar como c\xE1mara";
  $("cameraStateBadge").textContent = state.recording ? "GRABANDO" : state.stream ? "EN DIRECTO" : "SIN C\xC1MARA";
  $("deviceBadge").textContent = state.stream ? "En este dispositivo" : "Configurar";
  $("deviceBadge").classList.toggle("online", !!state.stream);
  $("homeLocalState").textContent = state.alarm ? "Alarma activada" : state.warningPending ? "Aviso de seguridad" : state.armed ? "Sistema armado" : "Sistema desarmado";
  $("homeLocalDetail").textContent = state.recording ? "Grabaci\xF3n en curso en este dispositivo." : state.armed ? $("recordMode").value === "event" ? "Solo personas \xB7 clips por detecci\xF3n." : "Solo personas \xB7 clips en modo manual." : "Recuadros al encender. Arma para grabar personas.";
  $("homeStatusDot").classList.toggle("on", state.armed);
  const clips = $("clips").querySelectorAll(".clip").length;
  const pending = $("clips").querySelectorAll(".pending-evidence").length;
  $("clipCount").textContent = pending ? pending + " pendiente de guardar" : clips + " " + (clips === 1 ? "clip" : "clips");
  $("globalAlert").hidden = !state.alarm && !state.warningPending && !(activeAudio && !mediaAudio.paused);
  $("globalAlertText").textContent = state.alarm ? "Alarma activada en este dispositivo" : state.warningPending ? "Aviso de seguridad en curso" : "Reproduciendo sonido";
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
  renderHomeStatus(clips);
  const entries = events.filter((e) => e.type !== "movimiento" && !e.message.includes("PIN")).slice(0, 3);
  const activitySignature = JSON.stringify(entries);
  if (activitySignature !== lastActivitySignature) {
    lastActivitySignature = activitySignature;
    $("recentActivity").replaceChildren();
    if (!entries.length) emptyState($("recentActivity"), "Sin eventos todav\xEDa", "Las detecciones y grabaciones aparecer\xE1n aqu\xED.");
    for (const e of entries) {
      const clip = (state.clipSummary || []).find((c) => e.clipId ? c.id === e.clipId : e.eventId && c.eventId === e.eventId);
      const row = document.createElement("button");
      row.className = "activity-row";
      const media = document.createElement("div");
      media.className = "activity-media";
      if (clip == null ? void 0 : clip.thumbnail) {
        const img = document.createElement("img");
        img.src = clip.thumbnail;
        img.alt = "Miniatura del clip guardado";
        media.append(img);
      } else media.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 8 3v5c0 5-4 7-8 10-4-3-8-5-8-10V6Z"/></svg>';
      const copy = document.createElement("div"), title = document.createElement("strong"), detail = document.createElement("p"), time = document.createElement("time");
      title.textContent = eventTitle(e);
      detail.textContent = e.message;
      time.textContent = new Date(e.time).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
      time.dateTime = new Date(e.time).toISOString();
      copy.append(title, detail);
      row.append(media, copy, time);
      row.onclick = () => clip ? openClipResult(clip.id) : openEventResult(e);
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
function renderHomeStatus(clips) {
  const live = !!state.stream && !state.cameraMuted;
  $("cameraMessage").hidden = !!state.stream;
  $("homeCameraCount").textContent = live ? "1 activa" : "0 activas";
  $("homeCameraCount").classList.toggle("online", live);
  $("homeCameraStatus").textContent = state.cameraMuted ? "C\xE1mara en pausa" : live ? "1 c\xE1mara en directo" : "C\xE1mara apagada";
  $("homeProtect").textContent = homeActionBusy ? "Espera\u2026" : state.armed ? "Desarmar" : "Armar";
  $("homeProtect").disabled = homeActionBusy;
  $("cameraPower").textContent = state.stream ? "Detener" : "Encender";
  $("cameraPower").setAttribute("aria-label", state.stream ? "Detener c\xE1mara" : "Iniciar c\xE1mara");
  $("cameraPower").disabled = $("homeStartCamera").disabled = homeActionBusy;
  $("record").classList.toggle("is-recording", state.recording);
  $("record").setAttribute("aria-label", state.recording ? "Detener grabaci\xF3n" : "Grabar clip manual");
  $("record").title = state.recording ? "Detener grabaci\xF3n" : "Grabar clip manual";
  $("photo").setAttribute("aria-label", "Capturar fotograf\xEDa");
  $("photo").title = "Capturar fotograf\xEDa";
  $("fullscreen").setAttribute("aria-label", "Ampliar v\xEDdeo");
  $("fullscreen").title = "Ampliar v\xEDdeo";
  $("clock").hidden = !state.stream;
  $("record").disabled = !state.stream || !window.MediaRecorder || state.recordStarting || state.recordFinalizing;
  $("photo").disabled = !state.stream;
  $("fullscreen").disabled = !state.stream;
  const status = state.alarm ? "Alarma activa" : state.warningPending ? "Aviso de seguridad" : state.storageFailed ? "Revisar almacenamiento" : state.peopleError ? "Error de IA" : state.peopleLoading || state.stream && $("person").checked && !state.personResultAt ? "Preparando personas" : !$("person").checked ? "Personas pausadas" : state.cameraMuted ? "Captura en pausa" : !live ? "C\xE1mara apagada" : state.armed ? "Vigilancia activa" : "Solo vista previa";
  $("homeSystemPill").textContent = status;
  $("homeSystemPill").classList.toggle("online", live && state.armed && !state.storageFailed && !state.alarm && !state.peopleError && !state.peopleLoading && !!state.personResultAt && $("person").checked);
  $("homeSystemPill").classList.toggle("alarm", state.alarm || !!state.peopleError);
  const summary = state.clipSummary || [], bytes = summary.reduce((n, c) => n + c.size, 0), estimate = state.storageEstimate;
  $("homeStorageDetail").textContent = state.storageFailed ? "Error local \xB7 revisa tus clips" : estimate && estimate.quota ? "".concat((estimate.usage / 1048576).toFixed(1), " MB de ").concat((estimate.quota / 1048576).toFixed(0), " MB \xB7 cuota estimada") : "".concat(clips, " clips \xB7 ").concat((bytes / 1048576).toFixed(1), " MB guardados \xB7 cuota no disponible");
  $("homeStorageProgress").hidden = !(estimate && estimate.quota);
  if (estimate == null ? void 0 : estimate.quota) $("homeStorageProgress").value = Math.min(1, estimate.usage / estimate.quota);
}
function eventTitle(e) {
  return { persona: "Persona detectada", movimiento: "Movimiento (hist\xF3rico)", alarma: "Alarma", audio: "Sonido", c\u00E1mara: "C\xE1mara", modo: "Vigilancia" }[e.type] || (e.type === "grabaci\xF3n" && e.message.includes("guardada") ? "Clip guardado" : e.type === "grabaci\xF3n" ? "Grabaci\xF3n" : "Evento del sistema");
}
function highlightTarget(target) {
  if (!target) return;
  target.scrollIntoView({ block: "center" });
  target.classList.add("search-highlight");
  setTimeout(() => target.classList.remove("search-highlight"), 3e3);
}
function openClipResult(id) {
  goPage("activity");
  selectActivity("clips");
  highlightTarget([...$("clips").children].find((c) => c.dataset.clipId === String(id)));
}
function openEventResult(e) {
  goPage("events");
  $("filter").value = e.type;
  renderEvents(500);
  highlightTarget([...$("events").children].find((row) => row.dataset.eventTime === String(e.time)));
}
function searchText(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es");
}
function renderSearch() {
  const query = searchText($("globalSearch").value.trim());
  const target = $("searchResults");
  target.hidden = !query;
  target.replaceChildren();
  if (!query) return;
  const results = [], cameraName = profileData.camera || "Entrada";
  if (searchText(cameraName + " c\xE1mara este tel\xE9fono").includes(query)) results.push({ title: cameraName, detail: "C\xE1mara de este dispositivo", action: openLocalCamera });
  for (const clip of (state.clipSummary || []).slice().sort((a, b) => b.id - a.id)) {
    if (searchText(clip.reason + " grabaci\xF3n clip " + new Date(clip.id).toLocaleString("es-ES")).includes(query)) results.push({ title: clip.reason, detail: new Date(clip.id).toLocaleString("es-ES") + " \xB7 clip guardado", action: () => openClipResult(clip.id) });
    if (results.length >= 6) break;
  }
  for (const e of events) {
    if (searchText(e.type + " " + e.message + " " + new Date(e.time).toLocaleString("es-ES")).includes(query)) results.push({ title: eventTitle(e), detail: e.message, action: () => openEventResult(e) });
    if (results.length >= 6) break;
  }
  if (!results.length) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "No hay resultados en este dispositivo.";
    target.append(p);
    return;
  }
  for (const result of results.slice(0, 6)) {
    const button = document.createElement("button"), copy = document.createElement("span"), title = document.createElement("strong"), detail = document.createElement("small");
    button.className = "search-result";
    title.textContent = result.title;
    detail.textContent = result.detail;
    copy.append(title, detail);
    button.append(copy);
    button.onclick = () => {
      $("globalSearch").value = "";
      target.hidden = true;
      result.action();
    };
    target.append(button);
  }
}
$("globalSearch").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderSearch, 120);
});
document.addEventListener("security:clips", () => {
  lastActivitySignature = "";
  renderApp();
  if ($("globalSearch").value) renderSearch();
});
setInterval(() => {
  if (currentPage === "home" && state.stream) storage();
}, 3e4);
