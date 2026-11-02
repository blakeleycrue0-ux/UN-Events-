// Lets the Jarvis desk page (on this Chromebook) talk to the extension directly,
// e.g. hand gestures → pause/next. Only the fixed actions in commands.js exist.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "jarvis-desk") return;
  const { id, action, query, site, service } = event.data;
  chrome.runtime.sendMessage({ bridge: true, action, query, site, service }, (answer) => {
    window.postMessage({ source: "jarvis-extension", id, ok: !!answer?.ok, state: answer?.state || "" }, "*");
  });
});
window.postMessage({ source: "jarvis-extension", hello: true }, "*");
