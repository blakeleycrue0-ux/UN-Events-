// When Jarvis opens a search with #jarvis-play, start the first result.
(() => {
  if (location.hash !== "#jarvis-play") return;
  history.replaceState(null, "", location.pathname + location.search);
  const selectors = location.host === "open.spotify.com"
    ? ['[data-testid="top-result-card"] [data-testid="play-button"]', '[data-testid="tracklist-row"] button']
    : ["ytd-video-renderer a#video-title", "a#video-title"];
  let tries = 0;
  const timer = setInterval(() => {
    const target = selectors.map((s) => document.querySelector(s)).find(Boolean);
    if (target) { clearInterval(timer); target.click(); }
    else if (++tries > 40) clearInterval(timer);
  }, 250);
})();
