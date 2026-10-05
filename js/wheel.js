// Wheel model, canvas rendering, spin animation.
"use strict";

const Wheel = (() => {
  // 24 wedges. Types: cash | bankrupt | loseturn | freeplay
  const WEDGES = [
    { t: "cash", v: 2500 },
    { t: "cash", v: 600 },
    { t: "cash", v: 700 },
    { t: "cash", v: 600 },
    { t: "cash", v: 650 },
    { t: "cash", v: 500 },
    { t: "cash", v: 900 },
    { t: "bankrupt" },
    { t: "cash", v: 800 },
    { t: "cash", v: 550 },
    { t: "cash", v: 400 },
    { t: "cash", v: 300 },
    { t: "freeplay" },
    { t: "cash", v: 500 },
    { t: "cash", v: 300 },
    { t: "cash", v: 550 },
    { t: "loseturn" },
    { t: "cash", v: 800 },
    { t: "cash", v: 350 },
    { t: "cash", v: 450 },
    { t: "cash", v: 700 },
    { t: "cash", v: 1000 },
    { t: "bankrupt" },
    { t: "cash", v: 650 },
  ];
  const N = WEDGES.length;
  const STEP = (Math.PI * 2) / N;
  const POINTER = -Math.PI / 2; // top of the wheel

  const CASH_COLORS = ["#0b3d2e", "#123c52", "#28104a", "#3d2b0b", "#0d4646", "#33104a", "#0b4225", "#472309"];
  const TEXT_COLORS = ["#39ffb0", "#54d8ff", "#c99cff", "#ffd166", "#4dfff1", "#e59cff", "#5dff9c", "#ffb26b"];

  let canvas, ctx2d, rotation = 0, spinning = false;
  let forcedNext = null; // debug hook: index of wedge to land on

  function label(w) {
    if (w.t === "cash") return "$" + w.v;
    if (w.t === "bankrupt") return "BANKRUPT";
    if (w.t === "loseturn") return "LOSE A TURN";
    return "FREE PLAY";
  }

  function wedgeAt(rot) {
    // which wedge is under the pointer for a given rotation
    let a = (POINTER - rot) % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    return Math.floor(a / STEP) % N;
  }

  function draw() {
    const c = ctx2d, W = canvas.width, H = canvas.height;
    const cx = W / 2, cy = H / 2, R = Math.min(cx, cy) - 8;
    c.clearRect(0, 0, W, H);
    c.save();
    c.translate(cx, cy);
    c.rotate(rotation);
    for (let i = 0; i < N; i++) {
      const w = WEDGES[i];
      const a0 = i * STEP, a1 = a0 + STEP;
      c.beginPath();
      c.moveTo(0, 0);
      c.arc(0, 0, R, a0, a1);
      c.closePath();
      let fill, txt;
      if (w.t === "bankrupt") { fill = "#000000"; txt = "#ff2d55"; }
      else if (w.t === "loseturn") { fill = "#3a3a3a"; txt = "#e8e8e8"; }
      else if (w.t === "freeplay") { fill = "#0a5a2a"; txt = "#aaffcc"; }
      else { fill = CASH_COLORS[i % CASH_COLORS.length]; txt = TEXT_COLORS[i % TEXT_COLORS.length]; }
      c.fillStyle = fill;
      c.fill();
      c.strokeStyle = "#0affc244";
      c.lineWidth = 1.5;
      c.stroke();

      // label along the radius
      c.save();
      c.rotate(a0 + STEP / 2);
      c.textAlign = "right";
      c.textBaseline = "middle";
      c.fillStyle = txt;
      const l = label(w);
      if (w.t === "cash") {
        c.font = "bold 22px Consolas, monospace";
        c.fillText(l, R - 14, 0);
      } else {
        c.font = "bold 11px Consolas, monospace";
        // stack words for long labels
        const words = l.split(" ");
        if (words.length > 1) {
          words.forEach((word, k) => c.fillText(word, R - 12, (k - (words.length - 1) / 2) * 13));
        } else {
          c.fillText(l, R - 12, 0);
        }
      }
      c.restore();
    }
    // hub
    c.beginPath();
    c.arc(0, 0, 44, 0, Math.PI * 2);
    c.fillStyle = "#02120c";
    c.fill();
    c.strokeStyle = "#00ff9c";
    c.lineWidth = 2;
    c.stroke();
    c.rotate(-rotation);
    c.fillStyle = "#00ff9c";
    c.font = "bold 13px Consolas, monospace";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("SPIN", 0, 0);
    c.restore();

    // outer ring
    c.beginPath();
    c.arc(cx, cy, R + 3, 0, Math.PI * 2);
    c.strokeStyle = "#00e5ff66";
    c.lineWidth = 3;
    c.stroke();
  }

  function init(canvasEl) {
    canvas = canvasEl;
    ctx2d = canvas.getContext("2d");
    rotation = Math.random() * Math.PI * 2;
    draw();
  }

  // Spin with ease-out; resolves with the landed wedge object.
  function spin(speedScale = 1) {
    if (spinning) return Promise.reject(new Error("already spinning"));
    spinning = true;
    return new Promise((resolve) => {
      let target;
      if (forcedNext != null) {
        const i = forcedNext; forcedNext = null;
        // rotation that puts wedge i's center under the pointer, plus extra turns
        const jitter = (Math.random() - 0.5) * STEP * 0.7;
        const base = POINTER - (i + 0.5) * STEP + jitter;
        const turns = Math.PI * 2 * (3 + Math.floor(Math.random() * 2));
        target = rotation + turns + ((base - rotation) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      } else {
        target = rotation + Math.PI * 2 * (3 + Math.random() * 2.5) + Math.random() * Math.PI * 2;
      }
      const start = rotation;
      const dur = (3200 + Math.random() * 900) * speedScale;
      const t0 = performance.now();
      let lastWedge = wedgeAt(rotation);

      // Schedule via rAF with a setTimeout fallback so the spin still
      // resolves when the tab is hidden (rAF pauses there).
      function schedule(fn) {
        let fired = false;
        const once = () => { if (!fired) { fired = true; fn(performance.now()); } };
        requestAnimationFrame(once);
        setTimeout(once, 60);
      }

      function frame(now) {
        const p = Math.min(1, (now - t0) / dur);
        const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
        rotation = start + (target - start) * ease;
        const cur = wedgeAt(rotation);
        if (cur !== lastWedge) { Sfx.tick(); lastWedge = cur; }
        draw();
        if (p < 1) {
          schedule(frame);
        } else {
          spinning = false;
          resolve({ index: cur, wedge: WEDGES[cur], label: label(WEDGES[cur]) });
        }
      }
      schedule(frame);
    });
  }

  function forceNext(query) {
    // debug: accept index, "$600", "BANKRUPT", "LOSE A TURN", "FREE PLAY"
    if (typeof query === "number") { forcedNext = ((query % N) + N) % N; return forcedNext; }
    const q = String(query).toUpperCase();
    const i = WEDGES.findIndex((w) => label(w) === q || label(w) === "$" + q);
    if (i >= 0) forcedNext = i;
    return forcedNext;
  }

  return { init, spin, draw, forceNext, WEDGES, label, get spinning() { return spinning; } };
})();
