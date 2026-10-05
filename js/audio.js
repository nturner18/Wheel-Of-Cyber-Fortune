// Tiny Web Audio synth — no external files.
"use strict";

const Sfx = (() => {
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  function tone(freq, dur, { type = "square", vol = 0.08, when = 0, slide = 0 } = {}) {
    if (muted) return;
    try {
      const a = ac();
      const t0 = a.currentTime + when;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(a.destination);
      o.start(t0);
      o.stop(t0 + dur + 0.05);
    } catch (_) { /* audio unavailable */ }
  }

  return {
    get muted() { return muted; },
    toggleMute() { muted = !muted; return muted; },
    tick()     { tone(2200, 0.03, { type: "square", vol: 0.05 }); },
    ding()     { tone(1320, 0.18, { type: "sine", vol: 0.12 }); tone(1760, 0.22, { type: "sine", vol: 0.08, when: 0.02 }); },
    buzz()     { tone(140, 0.35, { type: "sawtooth", vol: 0.12 }); tone(110, 0.4, { type: "sawtooth", vol: 0.1, when: 0.02 }); },
    bankrupt() { tone(600, 0.7, { type: "sawtooth", vol: 0.12, slide: -520 }); },
    cash()     { tone(880, 0.1, { type: "triangle", vol: 0.1 }); tone(1174, 0.12, { type: "triangle", vol: 0.1, when: 0.09 }); },
    win() {
      [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.25, { type: "triangle", vol: 0.12, when: i * 0.12 }));
    },
    lose() { tone(392, 0.25, { type: "square", vol: 0.09 }); tone(311, 0.45, { type: "square", vol: 0.09, when: 0.22 }); },
  };
})();
