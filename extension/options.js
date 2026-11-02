const $ = (id) => document.getElementById(id);
const labels = { conectado: "✓ Conectado. Ya puedes pedirle cosas a Jarvis.", desconectado: "Reconectando…", "sin-clave": "Falta la clave de Jarvis.", error: "No se puede conectar" };
async function render() {
  const { key, status, last } = await chrome.storage.local.get(["key", "status", "last"]);
  if (key && !$("key").value) $("key").value = key;
  const state = status?.state || "sin-clave";
  $("state").className = state === "conectado" ? "ok" : "";
  $("state").textContent = (labels[state] || state) + (status?.detail ? " · " + status.detail : "") +
    (last ? ` · Última orden: ${last.command.action}${last.command.query ? " «" + last.command.query + "»" : last.command.site ? " " + last.command.site : ""}` : "");
}
$("save").onclick = async () => {
  await chrome.storage.local.set({ key: $("key").value.trim() });
  chrome.runtime.sendMessage("reconnect");
  $("state").textContent = "Conectando…";
};
chrome.storage.onChanged.addListener(render);
render();
