// Jarvis agent mode: multi-step jobs in the browser (check Teams, read Gmail,
// download or hand in work). Claude (jarvis-agent function) picks each step;
// this file carries it out in a dedicated window and asks the user, by voice
// on the Jarvis desk, before anything that can't be undone.
const AGENT_MAX_STEPS = 30;
const RISKY_WORDS = /\b(submit|turn in|hand in|send|post|publish|delete|remove|pay|buy|purchase|order|unsubscribe|reply all)\b|entregar|enviar|publicar|eliminar|borrar|pagar|comprar|darse de baja|responder a todos/i;
const YES = /^\s*(s[ií]|yes|yeah|yep|vale|dale|ok|okay|claro|venga|hazlo|do it|go ahead|sure|adelante|correcto|confirm|confirmo)(?![\p{L}])/iu;

// A step needs the user's OK if Claude says so or the button/text looks final.
function agentNeedsConfirm(action, label = "") {
  if (!action) return false;
  if (action.type === "click") return !!action.risky || RISKY_WORDS.test(label);
  if (action.type === "type") return !!action.submit && RISKY_WORDS.test(label);
  return false;
}
const agentSaidYes = (answer) => YES.test(String(answer || ""));

// Runs inside the page: numbered list of what can be clicked or typed into.
function agentSnapshot() {
  for (const el of document.querySelectorAll("[data-jarvis-id]")) el.removeAttribute("data-jarvis-id");
  const sel = 'a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="treeitem"], [contenteditable="true"]';
  const elements = []; let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < -50 || r.top > innerHeight * 2.5) continue;
    const st = getComputedStyle(el);
    if (st.visibility === "hidden" || st.display === "none" || +st.opacity === 0) continue;
    el.setAttribute("data-jarvis-id", String(++n));
    const label = (el.getAttribute("aria-label") || el.innerText || el.value || el.placeholder || el.title || el.getAttribute("alt") || el.name || "").replace(/\s+/g, " ").trim().slice(0, 90);
    const kind = el.tagName.toLowerCase() + (el.type && el.tagName !== "BUTTON" ? `(${el.type})` : "") + (el.getAttribute("role") ? `[${el.getAttribute("role")}]` : "");
    const href = el.tagName === "A" && el.href && !el.href.startsWith("javascript:") ? " → " + el.href.slice(0, 120) : "";
    elements.push(`[${n}] ${kind} ${label}${href}${r.top > innerHeight ? " (below)" : ""}`);
    if (n >= 180) break;
  }
  const text = (document.body?.innerText || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").slice(0, 6000);
  return { url: location.href, title: document.title, text, elements };
}
// Runs inside the page: one action on a numbered element.
function agentAct(action) {
  const el = action.id ? document.querySelector(`[data-jarvis-id="${action.id}"]`) : null;
  const label = el ? (el.getAttribute("aria-label") || el.innerText || el.value || el.title || "").replace(/\s+/g, " ").trim().slice(0, 90) : "";
  if (action.peek) return { ok: !!el, label, href: el?.href || "" };
  if (action.type === "scroll") { scrollBy({ top: (action.direction === "up" ? -0.8 : 0.8) * innerHeight, behavior: "instant" }); return { ok: true }; }
  if (!el) return { ok: false, error: "element " + action.id + " not found (the page changed)" };
  el.scrollIntoView({ block: "center", behavior: "instant" });
  if (action.type === "click") {
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    el.click(); return { ok: true, label };
  }
  if (action.type === "type") {
    el.focus();
    if (el.isContentEditable) { document.execCommand("selectAll"); document.execCommand("insertText", false, action.text); }
    else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, action.text);
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (action.submit) {
      for (const type of ["keydown", "keypress", "keyup"]) el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
      if (el.form && !el.isContentEditable) el.form.requestSubmit?.();
    }
    return { ok: true, label };
  }
  return { ok: false, error: "unknown action" };
}

const agent = { job: null, windowId: 0, tabId: 0, asks: new Map(), askId: 0 };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Tell the Jarvis desk tab (bridge.js) what's happening.
async function toDesk(message) {
  const tabs = await chrome.tabs.query({ url: ["https://unevents.netlify.app/*", "http://127.0.0.1:8001/*"] });
  const desks = tabs.filter((t) => !/\/(pared|camara)/.test(t.url || ""));
  for (const tab of desks) { try { await chrome.tabs.sendMessage(tab.id, { agent: message }); } catch { /* no bridge yet */ } }
  return desks.length > 0;
}
// Ask the user out loud on the desk; the reply comes back through bridge.js.
async function agentAsk(question) {
  const id = ++agent.askId;
  const answer = new Promise((resolve) => { agent.asks.set(id, resolve); setTimeout(() => { if (agent.asks.delete(id)) resolve(""); }, 90000); });
  if (!(await toDesk({ kind: "ask", id, question }))) {
    agent.asks.delete(id);
    // No desk open: ask in the agent window itself.
    try {
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: agent.tabId }, args: [question], func: (q) => prompt("Jarvis: " + q) || "" });
      return result;
    } catch { return ""; }
  }
  return answer;
}
function agentAnswer(id, text) { const resolve = agent.asks.get(id); if (resolve) { agent.asks.delete(id); resolve(String(text || "")); } }

async function agentWindow() {
  try { if (agent.tabId) { const tab = await chrome.tabs.get(agent.tabId); if (tab) return tab; } } catch { /* closed */ }
  const win = await chrome.windows.create({ url: "https://www.google.com/", focused: false, width: 1280, height: 860, type: "normal" });
  agent.windowId = win.id; agent.tabId = win.tabs[0].id;
  return win.tabs[0];
}
async function settle(tabId) {
  for (let i = 0; i < 40; i++) { const tab = await chrome.tabs.get(tabId); if (tab.status === "complete") break; await pause(250); }
  await pause(700);
}
async function agentCall(body) {
  const { key } = await chrome.storage.local.get("key");
  const response = await fetch(JARVIS_CONFIG.url + "/functions/v1/jarvis-agent", {
    method: "POST", headers: { "Content-Type": "application/json", "x-jarvis-key": key || "", apikey: JARVIS_CONFIG.anonKey },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(data.error || "agent " + response.status);
  return data.action;
}

async function runAgent(task, lang = "en") {
  if (agent.job) agent.job.cancel = true;
  const job = agent.job = { task, lang, log: [], cancel: false };
  const es = lang === "es";
  const finish = async (summary, ok = true) => { if (agent.job === job) agent.job = null; await toDesk({ kind: "done", ok, summary, task }); };
  try {
    const tab = await agentWindow();
    await toDesk({ kind: "start", task });
    let approved = false;
    for (let step = 1; step <= AGENT_MAX_STEPS; step++) {
      if (job.cancel) return;
      await settle(tab.id);
      let page;
      try { [{ result: page }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: agentSnapshot }); }
      catch { const t = await chrome.tabs.get(tab.id); page = { url: t.url, title: t.title, text: "(this page can't be read)", elements: [] }; }
      let screenshot = "";
      try { screenshot = await chrome.tabs.captureVisibleTab(agent.windowId, { format: "jpeg", quality: 50 }); } catch { /* window hidden */ }
      const action = await agentCall({ task, step, log: job.log, page, screenshot, lang });
      if (job.cancel) return;
      if (action.say) await toDesk({ kind: "step", step, say: action.say });
      if (action.type === "done") return finish(action.summary);
      if (action.type === "ask") {
        const answer = await agentAsk(action.question);
        job.log.push(`Asked "${action.question}" → user said: "${answer || "(no answer)"}"`);
        approved = agentSaidYes(answer);
        continue;
      }
      // Look at the element before acting, so risky clicks can be confirmed.
      let label = "";
      if (action.id) { try { [{ result: { label } }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [{ ...action, peek: true }], func: agentAct }); } catch { /* checked below */ } }
      if (agentNeedsConfirm(action, label) && !approved) {
        const question = es ? `¿Confirmas que pulse «${label || "ese botón"}»?` : `Shall I press "${label || "that button"}"? This can't be undone.`;
        const answer = await agentAsk(question);
        if (!agentSaidYes(answer)) { job.log.push(`Wanted to ${action.type} "${label}" but the user said no ("${answer || "no answer"}"). Don't do it.`); continue; }
      }
      approved = false;
      let result = { ok: true };
      if (action.type === "navigate") await chrome.tabs.update(tab.id, { url: action.url });
      else if (action.type === "back") { try { await chrome.tabs.goBack(tab.id); } catch { result = { ok: false, error: "no previous page" }; } }
      else if (action.type === "wait") await pause(2000);
      else if (action.type === "download") {
        const [{ result: info }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [{ ...action, peek: true }], func: agentAct });
        if (/^https?:/.test(info?.href || "")) await chrome.downloads.download({ url: info.href });
        else { await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [{ type: "click", id: action.id }], func: agentAct }); }
      } else {
        try { [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [action], func: agentAct }); }
        catch (e) { result = { ok: false, error: String(e.message || e).slice(0, 100) }; }
      }
      const what = action.type === "navigate" ? `opened ${action.url}` : action.type === "type" ? `typed "${action.text.slice(0, 60)}" into [${action.id}] ${label}` : `${action.type}${action.id ? ` [${action.id}] ${label}` : action.direction ? " " + action.direction : ""}`;
      job.log.push(what + (result?.ok === false ? ` — failed: ${result.error}` : ""));
    }
    await finish(es ? "He llegado al límite de pasos sin terminar. Te lo dejo abierto en la ventana de Jarvis." : "I ran out of steps before finishing. I've left it open in the Jarvis window.", false);
  } catch (e) {
    console.warn("agent", e);
    await finish(es ? "No he podido terminar la tarea: " + (e.message || "error") : "I couldn't finish the task: " + (e.message || "error"), false);
  }
}
function stopAgent() { if (agent.job) { agent.job.cancel = true; agent.job = null; void toDesk({ kind: "done", ok: false, summary: "", stopped: true }); } }

if (typeof module !== "undefined") module.exports = { agentNeedsConfirm, agentSaidYes, agentSnapshot, agentAct, runAgent, stopAgent, agentAnswer, agent };
