// Jarvis service worker: shows push notifications on the phone remote.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "Jarvis", body: event.data?.text() || "" }; }
  event.waitUntil(self.registration.showNotification(data.title || "Jarvis", {
    body: data.body || "", tag: data.tag || "jarvis", renotify: true, icon: "/icon-192.png", badge: "/icon-192.png",
    data: { url: data.url || "/mando" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { await c.focus(); return; } }
    await self.clients.openWindow(event.notification.data?.url || "/mando");
  })());
});
