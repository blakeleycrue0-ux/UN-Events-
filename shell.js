"use strict";
function showPage(name) {
  if (!["home", "camera", "remote"].includes(name)) name = "home";
  const viewport = $("videoViewport");
  if (name !== "camera" && state.stream) $("captureDock").append(viewport);
  else if (name === "camera") $("stage").insertBefore(viewport, $("overlay"));
  document.body.dataset.page = name;
  $("landingPage").hidden = name !== "home";
  $("cameraPage").hidden = name !== "camera";
  $("remotePage").hidden = name !== "remote";
  $("backHome").hidden = name === "home";
  $("unlock").hidden = name !== "camera";
  if (name === "camera") requestAnimationFrame(draw);
  window.scrollTo(0, 0);
}
function goPage(name) {
  showPage(name);
  if (location.hash !== "#" + name) location.hash = name;
}
window.addEventListener("hashchange", () => showPage(location.hash.slice(1)));
$("backHome").onclick = () => goPage("home");
$("openCamera").onclick = () => goPage("camera");
$("openViewer").onclick = () => {
  goPage("remote");
  $("remoteRole").value = "viewer";
  updateRemoteRole();
};
$("homeConnection").onclick = () => goPage("remote");
$("homeClips").onclick = () => {
  goPage("camera");
  const panel = document.querySelector(".evidence");
  panel.open = true;
  setTimeout(() => panel.scrollIntoView({ behavior: "smooth" }), 50);
};
$("navHome").onclick = () => goPage("home");
setInterval(() => {
  $("homeLocalState").textContent = state.armed ? "Vigilancia activa en este m\xF3vil" : state.stream ? "C\xE1mara encendida \xB7 sin protecci\xF3n" : "Protecci\xF3n local desactivada";
  $("homeLocalDetail").textContent = state.recording ? "Se est\xE1 grabando un clip en este dispositivo." : state.armed ? "Puedes volver al control de la c\xE1mara sin detenerla." : "Elige el papel de este m\xF3vil para empezar.";
}, 1e3);
showPage(location.hash.slice(1));
