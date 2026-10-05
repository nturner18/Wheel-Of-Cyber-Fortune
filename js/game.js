// Wheel of Cyber Fortune — game state machine + UI wiring
"use strict";

(() => {
  const VOWELS = "AEIOU";
  const VOWEL_COST = 250;
  const FREE_PLAY_CONS_VALUE = 500; // per occurrence, like the show
  const HOUSE_MIN = 1000;           // round winner banks at least this
  const BONUS_PRIZES = [25000, 30000, 35000, 40000, 50000];
  const BONUS_SECONDS = 30;
  const CPU_NAMES = ["GL1TCH", "D43M0N", "C1PH3R"];

  const TIMING = { scale: 1 }; // __dbg.fast() drops this for testing
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms * TIMING.scale));

  // ── state ────────────────────────────────────────────────────
  const S = {
    screen: "setup",
    players: [],        // {name, isHuman, bank, round, lastWon}
    totalRounds: 3,
    roundNum: 0,        // 0-based
    puzzle: null,       // {cat, text}
    used: new Set(),    // letters called this round
    revealed: new Set(),// letters revealed on the board
    cur: 0,
    phase: "idle",      // turn | pickConsonant | pickVowel | freePick | spinning | solving | cpu-locked
    currentValue: 0,    // wedge $ for the pending consonant pick
    freeSolve: false,   // solving under FREE PLAY protection
    roundOver: false,
    busy: false,
    usedPuzzles: new Set(),
    tileEls: [],        // [{el, ch}] for the active board
    bonus: null,
  };

  // ── dom ──────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const el = {
    setup: $("screen-setup"), game: $("screen-game"), bonusScr: $("screen-bonus"), over: $("screen-over"),
    segHumans: $("seg-humans"), segRounds: $("seg-rounds"), nameInputs: $("name-inputs"),
    start: $("btn-start"), mute: $("btn-mute"),
    roundInd: $("round-ind"), catBar: $("category-bar"), wedgeRes: $("wedge-result"),
    board: $("board"), scoreboard: $("scoreboard"), log: $("status-log"),
    spin: $("btn-spin"), vowel: $("btn-vowel"), solve: $("btn-solve"), keyboard: $("keyboard"),
    modal: $("solve-modal"), solvePattern: $("solve-pattern"), solveInput: $("solve-input"),
    solveGo: $("btn-solve-go"), solveCancel: $("btn-solve-cancel"), solveTitle: $("solve-title"),
    bonusCat: $("bonus-category"), bonusTimer: $("bonus-timer"), bonusBoard: $("bonus-board"),
    bonusMsg: $("bonus-msg"), bonusKb: $("bonus-keyboard"), bonusInput: $("bonus-input"),
    overTitle: $("over-title"), standings: $("final-standings"), again: $("btn-again"),
  };

  const fmt = (n) => "$" + n.toLocaleString("en-US");
  const cp = () => S.players[S.cur];

  function log(msg, cls = "") {
    const d = document.createElement("div");
    if (cls) d.className = cls;
    d.textContent = msg;
    el.log.appendChild(d);
    el.log.scrollTop = el.log.scrollHeight;
  }

  function showScreen(name) {
    S.screen = name;
    el.setup.hidden = name !== "setup";
    el.game.hidden = name !== "game";
    el.bonusScr.hidden = name !== "bonus";
    el.over.hidden = name !== "over";
  }

  // ── setup screen ─────────────────────────────────────────────
  let humanCount = 1, roundChoice = 3;

  function segWire(seg, onPick) {
    seg.querySelectorAll("button").forEach((b) =>
      b.addEventListener("click", () => {
        seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
        onPick(parseInt(b.dataset.v, 10));
      }));
  }
  segWire(el.segHumans, (v) => { humanCount = v; renderNameInputs(); });
  segWire(el.segRounds, (v) => { roundChoice = v; });

  function renderNameInputs() {
    el.nameInputs.innerHTML = "";
    for (let i = 0; i < humanCount; i++) {
      const inp = document.createElement("input");
      inp.placeholder = `PLAYER ${i + 1} NAME`;
      inp.maxLength = 12;
      inp.dataset.i = i;
      el.nameInputs.appendChild(inp);
    }
  }
  renderNameInputs();

  el.start.addEventListener("click", () => {
    const names = [...el.nameInputs.querySelectorAll("input")].map(
      (inp, i) => (inp.value.trim().toUpperCase() || `PLAYER ${i + 1}`));
    S.players = [];
    for (let i = 0; i < 3; i++) {
      if (i < humanCount) S.players.push({ name: names[i], isHuman: true, bank: 0, round: 0, lastWon: -1 });
      else S.players.push({ name: CPU_NAMES[i - humanCount], isHuman: false, bank: 0, round: 0, lastWon: -1 });
    }
    S.totalRounds = roundChoice;
    S.roundNum = 0;
    S.usedPuzzles.clear();
    showScreen("game");
    Wheel.init($("wheel"));
    el.log.innerHTML = "";
    startRound();
  });

  el.mute.addEventListener("click", () => {
    el.mute.textContent = Sfx.toggleMute() ? "SOUND: OFF" : "SOUND: ON";
  });

  // ── puzzle / board ───────────────────────────────────────────
  function pickPuzzle() {
    const avail = PUZZLES.map((p, i) => i).filter((i) => !S.usedPuzzles.has(i));
    const i = avail[Math.floor(Math.random() * avail.length)];
    S.usedPuzzles.add(i);
    return PUZZLES[i];
  }

  function layoutRows(text) {
    const attempts = [[12, 14, 14, 12], [14, 14, 14, 14], [16, 16, 16, 16]];
    const words = text.split(" ");
    for (const widths of attempts) {
      const rows = [];
      let cur = "";
      let ok = true;
      for (const w of words) {
        if (cur === "") cur = w;
        else if ((cur + " " + w).length <= widths[rows.length]) cur += " " + w;
        else { rows.push(cur); cur = w; }
        if (rows.length >= widths.length || w.length > widths[Math.min(rows.length, widths.length - 1)]) { ok = false; break; }
      }
      if (ok && cur) rows.push(cur);
      if (ok && rows.length <= widths.length) return rows;
    }
    return [text]; // fallback, CSS will shrink
  }

  function renderBoard(container) {
    container.innerHTML = "";
    S.tileEls = [];
    for (const row of layoutRows(S.puzzle.text)) {
      const rowEl = document.createElement("div");
      rowEl.className = "board-row";
      for (const ch of row) {
        const t = document.createElement("div");
        if (ch === " ") t.className = "tile gap";
        else if (!/[A-Z]/.test(ch)) { t.className = "tile static"; t.textContent = ch; }
        else if (S.revealed.has(ch)) { t.className = "tile revealed"; t.textContent = ch; }
        else { t.className = "tile hidden-letter"; S.tileEls.push({ el: t, ch }); }
        rowEl.appendChild(t);
      }
      container.appendChild(rowEl);
    }
  }

  // Flip all tiles for `letter`, one at a time. Returns occurrence count.
  async function revealLetter(letter) {
    S.revealed.add(letter);
    const hits = S.tileEls.filter((t) => t.ch === letter);
    for (const t of hits) {
      await sleep(320);
      t.el.classList.remove("hidden-letter");
      t.el.classList.add("revealed");
      t.el.textContent = letter;
      Sfx.ding();
    }
    S.tileEls = S.tileEls.filter((t) => t.ch !== letter);
    return hits.length;
  }

  async function revealAll() {
    for (const t of S.tileEls) {
      t.el.classList.remove("hidden-letter");
      t.el.classList.add("revealed");
      t.el.textContent = t.ch;
    }
    S.tileEls = [];
    for (const ch of S.puzzle.text) if (/[A-Z]/.test(ch)) S.revealed.add(ch);
  }

  const countIn = (letter) => [...S.puzzle.text].filter((c) => c === letter).length;
  const puzzleLetters = () => new Set([...S.puzzle.text].filter((c) => /[A-Z]/.test(c)));
  const consonantsRemain = () => [...puzzleLetters()].some((L) => !VOWELS.includes(L) && !S.revealed.has(L));
  const vowelsRemainUnused = () => [...VOWELS].some((L) => !S.used.has(L));
  const consonantsRemainUnused = () => "BCDFGHJKLMNPQRSTVWXYZ".split("").some((L) => !S.used.has(L));
  const allRevealed = () => [...puzzleLetters()].every((L) => S.revealed.has(L));

  const normalize = (s) => s.toUpperCase().replace(/-/g, " ").replace(/[^A-Z& ]+/g, "").replace(/\s+/g, " ").trim();
  // accept the answer with or without special chars typed (e.g. ATT&CK vs ATTCK)
  const solveMatches = (guess) => {
    const strip = (s) => s.replace(/&/g, "");
    return normalize(guess) === normalize(S.puzzle.text) ||
           strip(normalize(guess)) === strip(normalize(S.puzzle.text));
  };

  // ── rendering: scoreboard / controls / keyboard ─────────────
  function renderScoreboard() {
    el.scoreboard.innerHTML = "";
    S.players.forEach((p, i) => {
      const c = document.createElement("div");
      c.className = "player-card" + (i === S.cur && S.screen === "game" ? " turn" : "");
      c.innerHTML = `<div class="pname">${p.name}</div>
        <div class="ptag">${p.isHuman ? "HUMAN" : "CPU"}</div>
        <div class="pround">${fmt(p.round)}</div>
        <div class="pbank">BANKED ${fmt(p.bank)}</div>`;
      el.scoreboard.appendChild(c);
    });
  }

  function buildKeyboard(container, handler) {
    container.innerHTML = "";
    for (const L of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const b = document.createElement("button");
      b.className = "key" + (VOWELS.includes(L) ? " vowel" : "");
      b.textContent = L;
      b.dataset.letter = L;
      b.disabled = true;
      b.addEventListener("click", () => handler(L));
      container.appendChild(b);
    }
  }

  function updateKeyboard() {
    const humanTurn = cp().isHuman && !S.busy && !S.roundOver;
    el.keyboard.querySelectorAll(".key").forEach((b) => {
      const L = b.dataset.letter, isV = VOWELS.includes(L);
      let on = false;
      if (humanTurn && !S.used.has(L)) {
        if (S.phase === "pickConsonant") on = !isV;
        else if (S.phase === "pickVowel") on = isV;
        else if (S.phase === "freePick") on = true;
      }
      b.disabled = !on;
    });
  }

  function updateControls() {
    const p = cp();
    const humanChoice = p.isHuman && S.phase === "turn" && !S.busy && !S.roundOver;
    el.spin.disabled = !(humanChoice && consonantsRemain() && consonantsRemainUnused());
    el.vowel.disabled = !(humanChoice && p.round >= VOWEL_COST && vowelsRemainUnused());
    el.solve.disabled = !((humanChoice || (p.isHuman && S.phase === "freePick" && !S.busy)) && !S.roundOver);
    el.roundInd.textContent = `ROUND ${S.roundNum + 1}/${S.totalRounds}`;
    renderScoreboard();
    updateKeyboard();
  }

  // ── round flow ───────────────────────────────────────────────
  function startRound() {
    S.puzzle = pickPuzzle();
    S.used = new Set();
    S.revealed = new Set();
    S.players.forEach((p) => (p.round = 0));
    S.cur = S.roundNum % S.players.length;
    S.roundOver = false;
    S.freeSolve = false;
    S.phase = "turn";
    el.catBar.textContent = S.puzzle.cat;
    el.wedgeRes.innerHTML = "&nbsp;";
    renderBoard(el.board);
    log(`═══ ROUND ${S.roundNum + 1} — ${S.puzzle.cat} ═══`, "info");
    log(`${cp().name} goes first.`);
    updateControls();
    maybeCpu();
  }

  function beginTurnPhase() {
    S.phase = "turn";
    S.freeSolve = false;
    if (!S.roundOver && cp().isHuman && !consonantsRemain()) {
      log("No consonants remain — buy a vowel or solve!", "warn");
    }
    updateControls();
  }

  function passTurn(reason) {
    if (S.roundOver) return;
    if (reason) log(reason, "warn");
    S.cur = (S.cur + 1) % S.players.length;
    log(`▶ ${cp().name}'s turn.`);
    beginTurnPhase();
    maybeCpu();
  }

  async function endRound(winnerIdx, solvedText) {
    S.roundOver = true;
    S.busy = true;
    updateControls();
    await revealAll();
    Sfx.win();
    const w = S.players[winnerIdx];
    const banked = Math.max(w.round, HOUSE_MIN);
    log(`★ ${w.name} solves it: "${S.puzzle.text}"`, "good");
    log(`${w.name} banks ${fmt(banked)}${w.round < HOUSE_MIN ? " (house minimum)" : ""}. Other round totals are wiped.`, "good");
    w.bank += banked;
    w.lastWon = S.roundNum;
    S.players.forEach((p) => (p.round = 0));
    renderScoreboard();
    S.roundNum++;
    await sleep(2600);
    S.busy = false;
    if (S.roundNum >= S.totalRounds) startBonusQualification();
    else startRound();
  }

  // shared result handling for a called letter (human or CPU)
  // kind: "consonant" (worth S.currentValue) | "vowel" | "free"
  async function handleLetter(letter, kind) {
    const p = cp();
    S.used.add(letter);
    S.busy = true;
    updateControls();
    const n = countIn(letter);
    if (n > 0) {
      let gain = 0;
      if (kind === "consonant") gain = S.currentValue * n;
      else if (kind === "free" && !VOWELS.includes(letter)) gain = FREE_PLAY_CONS_VALUE * n;
      await revealLetter(letter);
      if (gain) { p.round += gain; Sfx.cash(); }
      log(`✔ ${letter} — ${n} on the board${gain ? " (+" + fmt(gain) + ")" : ""}.`, "good");
      S.busy = false;
      if (allRevealed()) { await endRound(S.cur); return; }
      beginTurnPhase();
      maybeCpu();
    } else {
      Sfx.buzz();
      S.busy = false;
      if (kind === "free") {
        log(`✗ No ${letter}. FREE PLAY — no penalty, ${p.name} keeps the turn.`);
        beginTurnPhase();
        maybeCpu();
      } else {
        passTurn(`✗ No ${letter}.`);
      }
    }
  }

  // ── human actions ────────────────────────────────────────────
  async function doSpin() {
    S.busy = true;
    S.phase = "spinning";
    updateControls();
    el.wedgeRes.textContent = "SPINNING…";
    const res = await Wheel.spin(TIMING.scale);
    el.wedgeRes.textContent = res.label;
    S.busy = false;
    const w = res.wedge;
    if (w.t === "bankrupt") {
      Sfx.bankrupt();
      cp().round = 0;
      renderScoreboard();
      passTurn(`☠ BANKRUPT! ${cp().name} loses their round winnings.`);
    } else if (w.t === "loseturn") {
      Sfx.lose();
      passTurn(`⊘ LOSE A TURN.`);
    } else if (w.t === "freeplay") {
      Sfx.cash();
      log(`◈ FREE PLAY! Call any letter (vowels free, consonants ${fmt(FREE_PLAY_CONS_VALUE)} each) or solve — no risk.`, "info");
      S.phase = "freePick";
      updateControls();
      return "freeplay";
    } else {
      S.currentValue = w.v;
      log(`Wheel lands on ${fmt(w.v)} — call a consonant.`);
      S.phase = "pickConsonant";
      updateControls();
      return "cash";
    }
    return w.t;
  }

  el.spin.addEventListener("click", () => { if (!el.spin.disabled) doSpin(); });

  el.vowel.addEventListener("click", () => {
    if (el.vowel.disabled) return;
    cp().round -= VOWEL_COST; // flat cost, charged up front like the show
    log(`${cp().name} buys a vowel (−${fmt(VOWEL_COST)}).`);
    S.phase = "pickVowel";
    updateControls();
  });

  function onKeyLetter(L) {
    if (S.phase === "pickConsonant") handleLetter(L, "consonant");
    else if (S.phase === "pickVowel") handleLetter(L, "vowel");
    else if (S.phase === "freePick") handleLetter(L, "free");
  }
  buildKeyboard(el.keyboard, onKeyLetter);

  // solve modal
  function boardPattern() {
    return [...S.puzzle.text].map((ch) => {
      if (!/[A-Z]/.test(ch)) return ch;
      return S.revealed.has(ch) ? ch : "◻";
    }).join("");
  }

  function openSolve() {
    S.freeSolve = S.phase === "freePick";
    S.phase = "solving";
    updateControls();
    el.solvePattern.textContent = boardPattern();
    el.solveInput.value = "";
    el.modal.hidden = false;
    el.solveInput.focus();
  }

  function closeSolve() { el.modal.hidden = true; }

  el.solve.addEventListener("click", () => { if (!el.solve.disabled) openSolve(); });
  el.solveCancel.addEventListener("click", () => {
    closeSolve();
    S.phase = S.freeSolve ? "freePick" : "turn";
    updateControls();
  });

  async function submitSolve() {
    const guess = el.solveInput.value;
    closeSolve();
    if (solveMatches(guess)) {
      await endRound(S.cur);
    } else {
      Sfx.buzz();
      if (S.freeSolve) {
        log(`✗ "${guess.toUpperCase()}" is wrong — but it was FREE PLAY, no penalty.`);
        beginTurnPhase();
      } else {
        passTurn(`✗ "${guess.toUpperCase()}" is not the puzzle.`);
      }
    }
  }
  el.solveGo.addEventListener("click", submitSolve);
  el.solveInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitSolve(); });

  // physical keyboard support for letter picks
  document.addEventListener("keydown", (e) => {
    if (S.screen !== "game" || !el.modal.hidden) return;
    const L = e.key.toUpperCase();
    if (L.length === 1 && L >= "A" && L <= "Z") {
      const btn = el.keyboard.querySelector(`.key[data-letter="${L}"]`);
      if (btn && !btn.disabled) btn.click();
    }
  });

  // ── CPU turn ─────────────────────────────────────────────────
  function maybeCpu() {
    if (S.screen === "game" && !S.roundOver && !cp().isHuman) cpuTurn();
  }

  async function cpuTurn() {
    const me = S.cur;
    const p = cp();
    const d = Cpu.difficulty(S.players);
    updateControls();

    for (let step = 0; step < 60; step++) {
      if (S.roundOver || S.cur !== me || S.screen !== "game") return;
      await sleep(1100);
      if (S.roundOver || S.cur !== me) return;

      const canSpin = consonantsRemain() && consonantsRemainUnused();
      const canBuy = p.round >= VOWEL_COST && vowelsRemainUnused();
      const state = { puzzle: S.puzzle, revealed: S.revealed, used: S.used };
      const pick = Cpu.chooseAction(state, d, canSpin, canBuy);

      if (pick.action === "solve") {
        log(`${p.name} wants to solve the puzzle…`, "info");
        await sleep(1400);
        if (pick.success) { await endRound(me); return; }
        Sfx.buzz();
        passTurn(`✗ ${p.name} guesses wrong!`);
        return;
      }

      if (pick.action === "vowel") {
        const L = Cpu.pickVowel(state, d);
        if (L) {
          p.round -= VOWEL_COST;
          log(`${p.name} buys a vowel: ${L} (−${fmt(VOWEL_COST)}).`);
          renderScoreboard();
          await sleep(700);
          await cpuLetter(L, "vowel", me);
          if (turnEnded(me)) return;
          continue;
        }
      }

      // spin (default)
      log(`${p.name} spins the wheel…`);
      S.busy = true;
      el.wedgeRes.textContent = "SPINNING…";
      const res = await Wheel.spin(TIMING.scale);
      el.wedgeRes.textContent = res.label;
      S.busy = false;
      const w = res.wedge;

      if (w.t === "bankrupt") {
        Sfx.bankrupt();
        p.round = 0;
        renderScoreboard();
        passTurn(`☠ BANKRUPT! ${p.name} loses their round winnings.`);
        return;
      }
      if (w.t === "loseturn") {
        Sfx.lose();
        passTurn(`⊘ ${p.name} loses a turn.`);
        return;
      }
      if (w.t === "freeplay") {
        log(`◈ FREE PLAY for ${p.name}.`, "info");
        await sleep(900);
        const L = Cpu.pickVowel(state, d) || Cpu.pickConsonant(state, d);
        if (!L) continue;
        log(`${p.name} calls ${L}.`);
        await cpuLetter(L, "free", me);
        if (turnEnded(me)) return;
        continue;
      }
      // cash wedge
      S.currentValue = w.v;
      await sleep(900);
      const L = Cpu.pickConsonant(state, d);
      if (!L) { passTurn(`${p.name} has no letter to call.`); return; }
      log(`${p.name} calls ${L} for ${fmt(w.v)}.`);
      await cpuLetter(L, "consonant", me);
      if (turnEnded(me)) return;
    }
  }

  // After a CPU letter resolves, the maybeCpu() inside handleLetter was
  // suppressed (cpuActing). If the turn moved to another player, kick off
  // that player's CPU loop here.
  function turnEnded(me) {
    if (S.roundOver) return true;
    if (S.cur !== me) { maybeCpu(); return true; }
    return false;
  }

  // wraps handleLetter but suppresses its human-oriented maybeCpu recursion:
  // handleLetter already calls maybeCpu(), which would start a *second* loop.
  // Guard with a flag.
  let cpuActing = false;
  async function cpuLetter(L, kind, me) {
    cpuActing = true;
    try { await handleLetter(L, kind); }
    finally { cpuActing = false; }
  }
  const _maybeCpu = maybeCpu;
  maybeCpu = function () { if (!cpuActing) _maybeCpu(); };

  // ── bonus round ──────────────────────────────────────────────
  function startBonusQualification() {
    const sorted = [...S.players].sort((a, b) => b.bank - a.bank || b.lastWon - a.lastWon);
    const q = sorted[0];
    const tied = S.players.filter((p) => p.bank === q.bank).length > 1;
    log(`═══ MAIN GAME COMPLETE ═══`, "info");
    if (tied) log(`Tie at ${fmt(q.bank)} — broken by most recent round win.`, "info");
    log(`${q.name} advances to the BONUS ROUND!`, "good");
    setTimeout(() => startBonus(q), 1800 * TIMING.scale);
  }

  function startBonus(player) {
    const prize = BONUS_PRIZES[Math.floor(Math.random() * BONUS_PRIZES.length)];
    S.bonus = {
      player, prize,
      consPicked: [], vowelPicked: null,
      phase: "reveal", timer: null, timeLeft: BONUS_SECONDS,
      done: false,
    };
    S.puzzle = pickPuzzle();
    S.used = new Set(["R", "S", "T", "L", "N", "E"]);
    S.revealed = new Set();
    showScreen("bonus");
    el.bonusCat.textContent = S.puzzle.cat;
    el.bonusTimer.innerHTML = "&nbsp;";
    el.bonusInput.hidden = true;
    renderBoard(el.bonusBoard);
    buildKeyboard(el.bonusKb, onBonusLetter);
    el.bonusMsg.textContent = `${player.name} — the wheel has chosen a hidden prize. We'll give you R, S, T, L, N, E…`;
    (async () => {
      await sleep(1400);
      for (const L of "RSTLNE") if (countIn(L)) await revealLetter(L);
      await sleep(600);
      if (player.isHuman) {
        S.bonus.phase = "cons";
        el.bonusMsg.textContent = "Pick 3 more consonants.";
        updateBonusKb();
      } else {
        cpuBonus();
      }
    })();
  }

  function updateBonusKb() {
    const b = S.bonus;
    el.bonusKb.querySelectorAll(".key").forEach((k) => {
      const L = k.dataset.letter, isV = VOWELS.includes(L);
      let on = false;
      if (!S.used.has(L)) {
        if (b.phase === "cons") on = !isV;
        else if (b.phase === "vowel") on = isV;
      }
      k.disabled = !on;
    });
  }

  async function onBonusLetter(L) {
    const b = S.bonus;
    S.used.add(L);
    if (b.phase === "cons") {
      b.consPicked.push(L);
      el.bonusMsg.textContent = `Consonants: ${b.consPicked.join(" ")} — ${3 - b.consPicked.length ? "pick " + (3 - b.consPicked.length) + " more" : "now pick a vowel"}.`;
      if (b.consPicked.length >= 3) b.phase = "vowel";
      updateBonusKb();
    } else if (b.phase === "vowel") {
      b.vowelPicked = L;
      b.phase = "revealPicks";
      updateBonusKb();
      await revealBonusPicks();
    }
  }

  async function revealBonusPicks() {
    const b = S.bonus;
    const picks = [...b.consPicked, b.vowelPicked];
    el.bonusMsg.textContent = `Letters: ${picks.join(" ")} — revealing…`;
    await sleep(800);
    let any = false;
    for (const L of picks) if (countIn(L)) { any = true; await revealLetter(L); }
    if (!any) { Sfx.buzz(); el.bonusMsg.textContent = "None of your letters are up there. Ouch."; await sleep(1000); }
    startBonusSolve();
  }

  function startBonusSolve() {
    const b = S.bonus;
    b.phase = "solve";
    if (b.player.isHuman) {
      el.bonusMsg.textContent = `Solve the puzzle! Unlimited guesses — ${BONUS_SECONDS} seconds.`;
      el.bonusInput.hidden = false;
      el.bonusInput.value = "";
      el.bonusInput.focus();
      b.timeLeft = BONUS_SECONDS;
      el.bonusTimer.textContent = b.timeLeft + "s";
      b.timer = setInterval(() => {
        b.timeLeft--;
        el.bonusTimer.textContent = Math.max(0, b.timeLeft) + "s";
        if (b.timeLeft <= 5 && b.timeLeft > 0) Sfx.tick();
        if (b.timeLeft <= 0) finishBonus(false);
      }, 1000 * TIMING.scale);
    }
  }

  el.bonusInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !S.bonus || S.bonus.phase !== "solve" || S.bonus.done) return;
    if (solveMatches(el.bonusInput.value)) finishBonus(true);
    else { Sfx.buzz(); el.bonusInput.value = ""; el.bonusMsg.textContent = "Not it — keep trying!"; }
  });

  async function cpuBonus() {
    const b = S.bonus;
    const { cons, vowel } = Cpu.bonusPicks(S.used);
    cons.forEach((L) => S.used.add(L));
    S.used.add(vowel);
    b.consPicked = cons; b.vowelPicked = vowel;
    el.bonusMsg.textContent = `${b.player.name} picks ${cons.join(" ")} and ${vowel}.`;
    await sleep(1200);
    let any = false;
    for (const L of [...cons, vowel]) if (countIn(L)) { any = true; await revealLetter(L); }
    b.phase = "solve";
    el.bonusMsg.textContent = `${b.player.name} is thinking…`;
    await sleep(2200);
    const frac = Cpu.revealedFraction(S.puzzle.text, S.revealed);
    const success = Math.random() < 0.25 + 0.55 * frac;
    finishBonus(success);
  }

  async function finishBonus(won) {
    const b = S.bonus;
    if (b.done) return;
    b.done = true;
    if (b.timer) clearInterval(b.timer);
    el.bonusInput.hidden = true;
    await revealAll();
    if (won) {
      Sfx.win();
      b.player.bank += b.prize;
      el.bonusMsg.textContent = `"${S.puzzle.text}" — CORRECT! The envelope held ${fmt(b.prize)}!`;
    } else {
      Sfx.lose();
      el.bonusMsg.textContent = `Time! The answer was "${S.puzzle.text}". The envelope held ${fmt(b.prize)}.`;
    }
    await sleep(3200);
    gameOver(won);
  }

  // ── game over ────────────────────────────────────────────────
  function gameOver(bonusWon) {
    showScreen("over");
    const sorted = [...S.players].sort((a, b) => b.bank - a.bank);
    el.overTitle.textContent = `> ${sorted[0].name} WINS WITH ${fmt(sorted[0].bank)}_`;
    el.standings.innerHTML = "";
    sorted.forEach((p, i) => {
      const d = document.createElement("div");
      d.className = "standing" + (i === 0 ? " winner" : "");
      const bonusNote = S.bonus && S.bonus.player === p ? (bonusWon ? " ◈ BONUS WON" : " ◈ bonus missed") : "";
      d.innerHTML = `<span>${i + 1}. ${p.name}${p.isHuman ? "" : " [CPU]"}${bonusNote}</span><span class="amount">${fmt(p.bank)}</span>`;
      el.standings.appendChild(d);
    });
  }

  el.again.addEventListener("click", () => location.reload());

  // ── debug hooks for testing ──────────────────────────────────
  window.__dbg = {
    S,
    forceWedge: Wheel.forceNext,
    fast(scale = 0.12) { TIMING.scale = scale; return "timing scale = " + scale; },
    answer() { return S.puzzle && S.puzzle.text; },
  };
})();
