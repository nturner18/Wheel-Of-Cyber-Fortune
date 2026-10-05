// CPU player logic with adaptive difficulty.
"use strict";

const Cpu = (() => {
  const VOWELS = "AEIOU";
  // generic consonant frequency order (English)
  const CONS_ORDER = "TNSRHLDCMFPGWYBVKXJQZ".split("");
  const VOWEL_ORDER = "EAOIU".split("");

  // Adaptive difficulty in [0.15, 1]:
  // humans ahead -> higher d (CPU plays smarter); humans behind -> lower d.
  function difficulty(players) {
    const best = (list) => list.reduce((m, p) => Math.max(m, p.bank + p.round), 0);
    const humans = players.filter((p) => p.isHuman);
    const cpus = players.filter((p) => !p.isHuman);
    if (!humans.length || !cpus.length) return 0.5;
    const gap = best(humans) - best(cpus);
    return Math.min(1, Math.max(0.15, 0.5 + gap / 8000));
  }

  function unrevealedLetters(puzzleText, revealed) {
    const counts = {};
    for (const ch of puzzleText) {
      if (/[A-Z]/.test(ch) && !revealed.has(ch)) counts[ch] = (counts[ch] || 0) + 1;
    }
    return counts;
  }

  function revealedFraction(puzzleText, revealed) {
    let total = 0, shown = 0;
    for (const ch of puzzleText) {
      if (/[A-Z]/.test(ch)) { total++; if (revealed.has(ch)) shown++; }
    }
    return total ? shown / total : 1;
  }

  // Pick a consonant: with probability scaling in d, pick the most common
  // unrevealed consonant actually in the puzzle; otherwise use the generic
  // frequency order with a little noise.
  function pickConsonant(state, d) {
    const { puzzle, revealed, used } = state;
    const counts = unrevealedLetters(puzzle.text, revealed);
    const inPuzzle = Object.keys(counts)
      .filter((L) => !VOWELS.includes(L) && !used.has(L))
      .sort((a, b) => counts[b] - counts[a]);
    if (inPuzzle.length && Math.random() < 0.2 + 0.65 * d) return inPuzzle[0];
    const pool = CONS_ORDER.filter((L) => !used.has(L));
    if (!pool.length) return null;
    const top = pool.slice(0, Math.max(2, 5 - Math.round(d * 3)));
    return top[Math.floor(Math.random() * top.length)];
  }

  function pickVowel(state, d) {
    const { puzzle, revealed, used } = state;
    const counts = unrevealedLetters(puzzle.text, revealed);
    const inPuzzle = Object.keys(counts)
      .filter((L) => VOWELS.includes(L) && !used.has(L))
      .sort((a, b) => counts[b] - counts[a]);
    if (inPuzzle.length && Math.random() < 0.25 + 0.6 * d) return inPuzzle[0];
    const pool = VOWEL_ORDER.filter((L) => !used.has(L));
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }

  // Should the CPU attempt a solve this turn, and would it succeed?
  function solvePlan(state, d) {
    const frac = revealedFraction(state.puzzle.text, state.revealed);
    const threshold = 0.9 - 0.5 * d;            // smart CPUs try earlier
    if (frac < threshold) return { attempt: false };
    const attemptProb = 0.25 + 0.6 * frac;       // more revealed -> more eager
    if (Math.random() > attemptProb) return { attempt: false };
    const successProb = Math.min(0.97, 0.15 + 0.55 * d + 0.35 * frac);
    return { attempt: true, success: Math.random() < successProb, frac };
  }

  // Decide the CPU's next action at the top of its turn.
  // Returns "solve" | "vowel" | "spin"
  function chooseAction(state, d, canSpin, canBuyVowel) {
    const plan = solvePlan(state, d);
    if (plan.attempt) return { action: "solve", success: plan.success };
    if (!canSpin) {
      if (canBuyVowel) return { action: "vowel" };
      // must solve — success still gated by difficulty & board state
      const frac = revealedFraction(state.puzzle.text, state.revealed);
      return { action: "solve", success: Math.random() < Math.min(0.95, 0.2 + 0.5 * d + 0.3 * frac) };
    }
    if (canBuyVowel && Math.random() < 0.18 + 0.25 * d) return { action: "vowel" };
    return { action: "spin" };
  }

  // Bonus-round letter picks (3 consonants + 1 vowel), reasonably smart.
  function bonusPicks(used) {
    const cons = ["C", "D", "M", "P", "H", "G", "B"].filter((L) => !used.has(L)).slice(0, 3);
    while (cons.length < 3) {
      const c = CONS_ORDER.find((L) => !used.has(L) && !cons.includes(L));
      if (!c) break;
      cons.push(c);
    }
    const vowel = ["A", "O", "I", "U"].find((L) => !used.has(L)) || "A";
    return { cons, vowel };
  }

  return { difficulty, pickConsonant, pickVowel, chooseAction, bonusPicks, revealedFraction };
})();
