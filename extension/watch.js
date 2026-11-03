// Jarvis keeps an eye on Teams, the school email (Outlook) and the club's
// Instagram from this Chrome, with your own sign-ins, every 10 minutes. It uses
// one small minimised window, never your tabs, and only tells Jarvis what the
// page shows; Jarvis decides what's new and whether to call you.
const WATCH_EVERY_MS = 10 * 60000;
const WATCH_SITES = {
  teams: { on: (c) => c.teams, url: () => "https://teams.microsoft.com/v2/", wait: 15000 },
  school: { on: (c) => c.school, url: () => "https://outlook.office.com/mail/inbox", wait: 12000 },
  instagram: { on: (c) => c.instagramOn && !!c.instagram, url: (c) => `https://www.instagram.com/${c.instagram}/`, wait: 9000 },
};
let watchBusy = false;

async function watchCall(body) {
  const { key } = await chrome.storage.local.get("key");
  if (!key) throw Error("Falta la clave de Jarvis");
  const response = await fetch(JARVIS_CONFIG.url + "/functions/v1/jarvis-call", {
    method: "POST", headers: { "Content-Type": "application/json", "x-jarvis-key": key, apikey: JARVIS_CONFIG.anonKey },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "jarvis-call " + response.status);
  return data;
}
async function watchTab() {
  const { watchWin } = await chrome.storage.session.get("watchWin").catch(() => ({}));
  if (watchWin) { try { const w = await chrome.windows.get(watchWin, { populate: true }); if (w.tabs?.[0]) return w.tabs[0].id; } catch { /* closed */ } }
  const w = await chrome.windows.create({ url: "about:blank", focused: false, state: "minimized" });
  await chrome.storage.session.set({ watchWin: w.id }).catch(() => {});
  return w.tabs[0].id;
}
const nap = (ms) => new Promise((r) => setTimeout(r, ms));
// Runs inside the page: what it shows, as text.
function watchPageText() {
  const signIn = /login|signin|oauth|authorize/.test(location.href) || !!document.querySelector('input[type="password"]');
  return { signIn, text: (document.body?.innerText || "").slice(0, 8000) };
}
// Runs inside Instagram: the latest posts (id, caption from the image description, link).
function watchInstagramPosts() {
  const signIn = /login/.test(location.href) || !!document.querySelector('input[name="password"]');
  const seen = new Set(), items = [];
  for (const a of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]')) {
    const m = (a.getAttribute("href") || "").match(/\/(p|reel)\/([\w-]+)/);
    if (!m || seen.has(m[2])) continue;
    seen.add(m[2]);
    const alt = a.querySelector("img")?.alt || "";
    items.push({ id: m[2], title: "Nueva publicación", text: alt.slice(0, 600), url: `https://www.instagram.com/${m[1]}/${m[2]}/` });
    if (items.length >= 12) break;
  }
  return { signIn, items };
}
async function watchOne(tabId, source, cfg) {
  const site = WATCH_SITES[source];
  await chrome.tabs.update(tabId, { url: site.url(cfg) });
  for (let i = 0; i < 60; i++) { await nap(500); const t = await chrome.tabs.get(tabId); if (t.status === "complete") break; }
  await nap(site.wait);   // these apps keep loading after the page is "complete"
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func: source === "instagram" ? watchInstagramPosts : watchPageText });
  if (!result) return "sin datos";
  if (result.signIn) return "inicia sesión en Chrome";
  const sent = await watchCall(source === "instagram" ? { action: "watch", source, items: result.items } : { action: "watch", source, text: result.text });
  return sent.baseline ? "listo (primera vez)" : sent.added ? `${sent.added} nuevo(s)${sent.called ? " · te he llamado" : ""}` : "nada nuevo";
}
async function watchAll(force = false) {
  if (watchBusy) return;
  const { watchAt = 0 } = await chrome.storage.local.get("watchAt");
  if (!force && Date.now() - watchAt < WATCH_EVERY_MS) return;
  watchBusy = true;
  await chrome.storage.local.set({ watchAt: Date.now() });
  const report = {};
  try {
    const cfg = await watchCall({ action: "watch-config" });
    const sources = Object.keys(WATCH_SITES).filter((s) => WATCH_SITES[s].on(cfg));
    if (sources.length) {
      const tabId = await watchTab();
      for (const source of sources) {
        try { report[source] = await watchOne(tabId, source, cfg); } catch (e) { report[source] = "error: " + String(e.message || e).slice(0, 80); }
      }
      await chrome.tabs.update(tabId, { url: "about:blank" }).catch(() => {});
    }
  } catch (e) { report.error = String(e.message || e).slice(0, 120); }
  finally { watchBusy = false; await chrome.storage.local.set({ watchReport: { at: Date.now(), report } }); }
}
chrome.alarms.onAlarm.addListener(() => void watchAll());
chrome.runtime.onMessage.addListener((message) => { if (message === "watch-now") void watchAll(true); });
