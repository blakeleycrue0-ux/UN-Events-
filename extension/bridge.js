// Lets the Jarvis desk page (on this Chromebook) talk to the extension directly,
// e.g. hand gestures → pause/next. Only the fixed actions in commands.js exist.
window.addEventListener("message", (event) => {
  if (event.source !== window || event.data?.source !== "jarvis-desk") return;
  const { id, action, query, site, service, task, lang, text, ask } = event.data;
  chrome.runtime.sendMessage({ bridge: true, action, query, site, service, task, lang, text, ask }, (answer) => {
    window.postMessage({ source: "jarvis-extension", id, ok: !!answer?.ok, state: answer?.state || "" }, "*");
  });
});
// Agent progress and questions from the extension, for the desk to show and speak.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.agent) window.postMessage({ source: "jarvis-extension", agent: message.agent }, "*");
});
window.postMessage({ source: "jarvis-extension", hello: true }, "*");
