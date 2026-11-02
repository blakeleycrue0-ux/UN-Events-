// Hand gestures through the Chromebook webcam (Human hand models, all local).
//   ✋ open palm (hold)  → pause / play     👉 swipe sideways → next song
//   👍 thumb up (hold)   → louder           👎 thumb down     → quieter
//   ☝️ index up (hold)   → talk to Jarvis without saying his name
import { loadScript } from "./common.js";

const FINGERS = ["index", "middle", "ring", "pinky"];
// Pure: one hand's finger landmarks → pose name.
export function pose(landmarks) {
  if (!landmarks?.thumb) return "";
  const curls = FINGERS.map((f) => landmarks[f]?.curl);
  const thumb = landmarks.thumb;
  if (curls.every((c) => c === "none")) return "palm";
  if (curls.every((c) => c !== "none")) {
    if (thumb.curl === "none" && /^(verticalUp|diagonalUp)/.test(thumb.direction)) return "thumbUp";
    if (thumb.curl === "none" && /^(verticalDown|diagonalDown)/.test(thumb.direction)) return "thumbDown";
    return "fist";
  }
  if (curls[0] === "none" && curls.slice(1).every((c) => c !== "none") && /Up/.test(landmarks.index.direction || "")) return "point";
  return "";
}

// Pure state machine: feed one observation per frame, get an action or "".
// x is the hand centre from 0 (your left) to 1 (your right).
export function createGestureReader({ holdMS = 600, cooldownMS = 1400, swipe = 0.22, swipeMS = 450 } = {}) {
  let current = "", since = 0, fired = false, until = 0, trail = [];
  return (p, x, now) => {
    if (x != null) { trail.push({ x, now }); trail = trail.filter((t) => now - t.now <= swipeMS); }
    else trail = [];
    if (now < until) { current = p; since = now; return ""; }
    // A quick sideways move of an open hand is a swipe.
    if (p === "palm" && trail.length > 2 && Math.abs(trail[trail.length - 1].x - trail[0].x) > swipe) {
      const dir = trail[trail.length - 1].x > trail[0].x ? "right" : "left";
      until = now + cooldownMS; trail = []; fired = true;
      return dir === "right" ? "next" : "previous";
    }
    if (p !== current) { current = p; since = now; fired = false; return ""; }
    if (!p || fired || now - since < holdMS) return "";
    // Holding still: only when the hand hasn't been travelling.
    if (trail.length > 1 && Math.abs(trail[trail.length - 1].x - trail[0].x) > swipe / 3) return "";
    fired = true; until = now + cooldownMS;
    return { palm: "toggle", thumbUp: "louder", thumbDown: "quieter", point: "talk" }[p] || "";
  };
}

export async function createHandDetector() {
  if (!window.Human) await loadScript("vendor/human.js");
  const human = new Human.Human({
    backend: "webgl", modelBasePath: new URL("models/", location.href).href,
    cacheModels: false, debug: false, async: false, warmup: "none",
    filter: { enabled: false, return: false },
    face: { enabled: false }, body: { enabled: false }, object: { enabled: false }, segmentation: { enabled: false }, gesture: { enabled: false },
    hand: {
      enabled: true, rotation: false, maxDetected: 1, minConfidence: 0.55, skipFrames: 0, skipTime: 0, landmarks: true,
      detector: { modelPath: "handtrack.json" }, skeleton: { modelPath: "handlandmark-lite.json" },
    },
  });
  await human.load();
  const stats = human.models.stats();
  const missing = ["handtrack", "handskeleton"].filter((n) => {
    const m = stats.modelStats.find((s) => s.name === n);
    return m && (!m.loaded || m.sizeLoadedWeights <= 0);
  });
  if (!stats.numLoadedModels || missing.length) { human.reset(); throw Error("No se cargaron los modelos de manos."); }
  return {
    async detect(video) {
      const result = await human.detect(video);
      const hand = result?.hand?.[0];
      if (!hand?.landmarks) return null;
      const [bx, by, bw, bh] = hand.box || [0, 0, 0, 0];
      const w = video.videoWidth || video.width || 1, h = video.videoHeight || video.height || 1;
      // Mirror: the webcam faces you, so your right is the image's left.
      return { pose: pose(hand.landmarks), x: 1 - (bx + bw / 2) / w, y: (by + bh / 2) / h };
    },
  };
}
