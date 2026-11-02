// Turns a command from Jarvis into something this Chromebook does. Only these
// fixed actions exist: a message can never make the extension open any URL.
const JARVIS_SITES = {
  youtube: "https://www.youtube.com/",
  spotify: "https://open.spotify.com/",
  teams: "https://teams.microsoft.com/",
  gmail: "https://mail.google.com/",
  classroom: "https://classroom.google.com/",
  netflix: "https://www.netflix.com/",
  google: "https://www.google.com/",
  calendar: "https://calendar.google.com/",
};
function jarvisPlan(command) {
  if (!command || typeof command !== "object") return null;
  const text = (value) => String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (command.action === "play") {
    const query = text(command.query);
    if (!query) return null;
    return command.service === "spotify"
      ? { kind: "play", url: "https://open.spotify.com/search/" + encodeURIComponent(query) + "#jarvis-play" }
      : { kind: "play", url: "https://www.youtube.com/results?search_query=" + encodeURIComponent(query) + "#jarvis-play" };
  }
  if (command.action === "open" && Object.prototype.hasOwnProperty.call(JARVIS_SITES, command.site))
    return { kind: "open", url: JARVIS_SITES[command.site] };
  if (command.action === "search" && text(command.query))
    return { kind: "open", url: "https://www.google.com/search?q=" + encodeURIComponent(text(command.query)) };
  // Agent mode: a multi-step job, carried out step by step with confirmations.
  if (command.action === "agent") {
    const task = String(command.task || "").replace(/\s+/g, " ").trim().slice(0, 600);
    return task ? { kind: "agent", task, lang: command.lang === "es" ? "es" : "en" } : null;
  }
  if (command.action === "agent-stop") return { kind: "agent-stop" };
  if (["pause", "resume", "next", "previous", "louder", "quieter"].includes(command.action)) return { kind: "media", action: command.action };
  return null;
}
async function jarvisTopic(key) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jarvis-pc:" + key.trim()));
  return "jarvis-pc-" + Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}
if (typeof module !== "undefined") module.exports = { jarvisPlan, jarvisTopic, JARVIS_SITES };
