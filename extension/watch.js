// Jarvis keeps an eye on Teams, the school email (Outlook) and the club's
// Instagram from this Chrome, with your own sign-ins, every 10 minutes. It uses
// one small minimised window, never your tabs, and only tells Jarvis what the
// page shows; Jarvis decides what's new and whether to call you.
const WATCH_EVERY_MS = 10 * 60000;
const WATCH_SITES = {
  teams: { on: (c) => c.teams, url: () => "https://teams.microsoft.com/v2/", wait: 8000, min: 1500 },
  school: { on: (c) => c.school, url: () => "https://outlook.office.com/mail/inbox", wait: 6000, min: 1200 },
  instagram: { on: (c) => c.instagramOn && !!c.instagram, url: (c) => `https://www.instagram.com/${c.instagram}/`, wait: 9000, min: 0 },
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
// Runs inside Outlook: each message in the inbox list (Outlook gives every row an id and a summary).
function watchOutlookMail() {
  const signIn = /login|signin|oauth|authorize/.test(location.href) || !!document.querySelector('input[type="password"]');
  const rows = [...document.querySelectorAll('[data-convid], div[role="option"][aria-label]')];
  const seen = new Set(), items = [];
  for (const r of rows) {
    const id = r.getAttribute("data-convid") || r.getAttribute("aria-label") || "";
    const text = (r.getAttribute("aria-label") || r.innerText || "").replace(/\s+/g, " ").trim();
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    items.push({ id: id.slice(0, 190), title: text.slice(0, 180), text: (r.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500), url: "https://outlook.office.com/mail/inbox" });
    if (items.length >= 20) break;
  }
  return { signIn, items, ready: items.length > 0 };
}
// Runs inside Teams: open the Activity feed (notes, assignments, posts, mentions).
function watchTeamsActivity() {
  const button = [...document.querySelectorAll('button[aria-label], [role="button"][aria-label]')]
    .find((b) => /^(activity|actividad|activitat)\b/i.test(b.getAttribute("aria-label") || ""));
  if (button) button.click();
  return !!button;
}
// Outlook only draws its message list when the page is painted, and a minimised
// window never paints. Through the debugger, asking for a (tiny) screenshot makes
// Chrome draw the page; if even that fails, the watch window is un-minimised
// (unfocused, behind your windows) for a moment and minimised again.
async function wakePage(tabId, ready, maxMs) {
  const target = { tabId };
  let attached = false, shown = false;
  try { await chrome.debugger.attach(target, "1.3"); attached = true; } catch { /* the agent may be using it */ }
  try {
    if (attached) await chrome.debugger.sendCommand(target, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    for (let t = 0; t < maxMs; t += 1500) {
      if (attached) {
        const shot = await chrome.debugger.sendCommand(target, "Page.captureScreenshot", { format: "jpeg", quality: 5 }).catch(() => null);
        if (!shot && !shown) {
          const tab = await chrome.tabs.get(tabId);
          await chrome.windows.update(tab.windowId, { state: "normal", focused: false }).catch(() => {});
          shown = true;
        }
      }
      await nap(1500);
      if (await ready()) return true;
    }
    return false;
  } finally {
    if (attached) await chrome.debugger.detach(target).catch(() => {});
    if (shown) { const tab = await chrome.tabs.get(tabId).catch(() => null); if (tab) await chrome.windows.update(tab.windowId, { state: "minimized" }).catch(() => {}); }
  }
}
// Waits until a page has really drawn its content (these apps keep loading after "complete").
async function waitForContent(tabId, minChars, maxMs) {
  let last = -1, steady = 0, len = 0;
  for (let t = 0; t < maxMs; t += 2000) {
    await nap(2000);
    const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (document.body?.innerText || "").length }).catch(() => [{}]);
    len = result || 0;
    steady = len === last ? steady + 1 : 0; last = len;
    if (len >= minChars && steady >= 1) break;
  }
  return len;
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
  if (source === "teams") {
    // Teams opens on the last class; the Activity feed has the new notes, posts and assignments.
    await chrome.scripting.executeScript({ target: { tabId }, func: watchTeamsActivity }).catch(() => null);
    await nap(3000);
  }
  if (source === "school") {
    const count = async () => (await chrome.scripting.executeScript({ target: { tabId }, func: () => document.querySelectorAll('[data-convid], div[role="option"][aria-label]').length }).catch(() => [{}]))[0]?.result > 0;
    if (!(await count())) await wakePage(tabId, count, 30000);
  } else if (site.min) await waitForContent(tabId, site.min, 40000);
  const func = source === "instagram" ? watchInstagramPosts : source === "school" ? watchOutlookMail : watchPageText;
  const [{ result } = {}] = await chrome.scripting.executeScript({ target: { tabId }, func });
  if (!result) return "sin datos";
  if (result.signIn) return "inicia sesión en Chrome";
  if (source === "school" && !result.ready) return "no veo los emails (¿Outlook cargó?)";
  const sent = await watchCall(result.items ? { action: "watch", source, items: result.items } : { action: "watch", source, text: result.text });
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
