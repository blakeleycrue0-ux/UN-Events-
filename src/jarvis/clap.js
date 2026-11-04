// Double clap, like in the film: two sharp sounds 0.15–0.8 s apart.
// A clap is loud, starts suddenly and dies within ~0.15 s; speech, music and
// doors don't do all three. A clap is also noise-like (many zero crossings),
// unlike beeps, notification tones and vowels. Fed with ~10 ms chunks
// (peak, rms, time in ms, zero-crossing rate).
export function createClapDetector({ onDouble, min = 0.25 } = {}) {
  let floor = 0.01, prev = 0.01, onset = null, lastClap = -1e9, coolUntil = -1e9;
  const d = { claps: 0 };
  d.feed = (peak, rms, t, zcr = 1) => {
    if (onset) {
      const dt = t - onset.t;
      if (dt > 40 && dt < 160) onset.tail = Math.max(onset.tail, rms);
      if (dt >= 160) {
        // Died away fast enough: it was a clap.
        if (onset.tail < onset.rms * 0.4) clap(onset.t);
        onset = null;
      }
    }
    if (!onset && peak > min && peak > floor * 8 && rms > prev * 2.5 && zcr > 0.1) onset = { t, rms: Math.max(rms, 1e-4), tail: 0 };
    if (!onset && rms < floor * 4) floor = floor * 0.98 + rms * 0.02;
    prev = Math.max(rms, 1e-4);
  };
  function clap(t) {
    d.claps++;
    if (t < coolUntil) return;
    const gap = t - lastClap;
    if (gap > 150 && gap < 800) { lastClap = -1e9; coolUntil = t + 3000; onDouble?.(); return; }
    lastClap = t;
  }
  // Raw microphone samples, split into ~10 ms chunks.
  d.samples = (input, rate, t0) => {
    const size = Math.max(64, Math.round(rate / 100));
    for (let i = 0; i < input.length; i += size) {
      let peak = 0, sum = 0, cross = 0; const end = Math.min(input.length, i + size);
      for (let j = i; j < end; j++) { const v = input[j], a = v < 0 ? -v : v; if (a > peak) peak = a; sum += v * v; if (j > i && (v >= 0) !== (input[j - 1] >= 0)) cross++; }
      // Zero crossings per sample, normalised to 48 kHz so it means the same at any rate.
      d.feed(peak, Math.sqrt(sum / (end - i)), t0 + (i / rate) * 1000, (cross / (end - i)) * (rate / 48000));
    }
  };
  return d;
}
