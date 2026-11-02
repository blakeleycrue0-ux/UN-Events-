// Hand-drawn line icons (no emoji): 24×24, stroke = currentColor.
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const sunRays = '<path d="M12 2.8v1.9M12 19.3v1.9M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.8 12h1.9M19.3 12h1.9M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>';
const cloud = '<path d="M7.2 18.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 12.2a3.2 3.2 0 0 0 .5 6.3z"/>';
export const ICONS = {
  clear: svg('<circle cx="12" cy="12" r="4.2"/>' + sunRays),
  night: svg('<path d="M19.5 14.6A7.6 7.6 0 1 1 9.4 4.5a6 6 0 0 0 10.1 10.1z"/>'),
  partly: svg('<circle cx="9" cy="8.6" r="3.2"/><path d="M9 2.6v1.2M3.1 8.6h1.2M4.8 4.4l.85.85M13.2 4.4l-.85.85"/><path d="M9.2 19.5h8.6a3.2 3.2 0 0 0 .4-6.38 4.7 4.7 0 0 0-8.9.86 2.8 2.8 0 0 0-.1 5.52z"/>'),
  cloud: svg(cloud),
  fog: svg('<path d="M4 9.5h16M6 13h12M4 16.5h16M8 20h8"/>'),
  drizzle: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M9 18.6l-.6 1.4M13 18.6l-.6 1.4M17 18.6l-.6 1.4"/>'),
  rain: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M8.5 18l-1 2.6M12.5 18l-1 2.6M16.5 18l-1 2.6"/>'),
  storm: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M12.6 15.6l-2 3.4h3l-2 3.2"/>'),
  snow: svg('<path d="M7.2 15.5h9.6a3.7 3.7 0 0 0 .5-7.37A5.5 5.5 0 0 0 6.7 9.2a3.2 3.2 0 0 0 .5 6.3z"/><path d="M9 19h.01M12 21h.01M15 19h.01"/>'),
  prev: svg('<path d="M18 6.5v11L9.5 12 18 6.5z" fill="currentColor" stroke="none"/><path d="M6.5 6.5v11"/>'),
  next: svg('<path d="M6 6.5v11l8.5-5.5L6 6.5z" fill="currentColor" stroke="none"/><path d="M17.5 6.5v11"/>'),
  play: svg('<path d="M8 5.8v12.4L18 12 8 5.8z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M8.2 6v12M15.8 6v12" stroke-width="2.4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14.2H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 10h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z"/>'),
  door: svg('<path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M4 21h16"/><circle cx="14.5" cy="12" r=".6" fill="currentColor"/>'),
  laptop: svg('<rect x="4.5" y="5" width="15" height="10" rx="1.4"/><path d="M2.5 19h19"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>'),
  shield: svg('<path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6l7-3z"/>'),
  moon: svg('<path d="M19.5 14.6A7.6 7.6 0 1 1 9.4 4.5a6 6 0 0 0 10.1 10.1z"/>'),
};
// WMO weather code → [English, Spanish, icon]
export function weatherKind(code, night = false) {
  if (code === 0 || code === 1) return [code ? "Mostly clear" : "Clear", code ? "Casi despejado" : "Despejado", night ? "night" : "clear"];
  if (code === 2) return ["Partly cloudy", "Parcialmente nublado", night ? "cloud" : "partly"];
  if (code === 3) return ["Overcast", "Nublado", "cloud"];
  if (code === 45 || code === 48) return ["Fog", "Niebla", "fog"];
  if (code >= 51 && code <= 57) return ["Drizzle", "Llovizna", "drizzle"];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return [code >= 80 ? "Showers" : code >= 65 ? "Heavy rain" : "Rain", code >= 80 ? "Chubascos" : code >= 65 ? "Lluvia fuerte" : "Lluvia", "rain"];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ["Snow", "Nieve", "snow"];
  if (code >= 95) return ["Thunderstorm", "Tormenta", "storm"];
  return ["", "", "cloud"];
}
