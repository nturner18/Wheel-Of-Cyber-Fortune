# Wheel of Cyber Fortune — Plan

## Stack
Vanilla HTML/CSS/JS, no build step. Open `index.html` directly or serve with any static server.
Wheel is drawn on `<canvas>`; everything else is DOM. Sounds via Web Audio (no files).

## File layout
```
index.html   — page shell, screens (setup / game / bonus / game-over)
style.css    — dark cyber theme, board tile flip animations, layout
js/puzzles.js — puzzle bank (60+ phrases, 5 categories)
js/audio.js  — tiny Web Audio synth (spin ticks, ding, buzz, bankrupt, win)
js/wheel.js  — wheel model + canvas render + spin animation (easing, pointer)
js/cpu.js    — CPU player logic (adaptive difficulty, letter frequency, solve)
js/game.js   — state machine, turn flow, UI wiring
```

## State machine
Screens: SETUP → GAME (N rounds) → BONUS → GAME_OVER.

Turn phases inside a round:
- `TURN_START` → player may Spin, Buy Vowel ($250+, vowels remain), or Solve.
- `SPINNING` → animated; lands on wedge.
  - Cash wedge → `PICK_CONSONANT` (on-screen keyboard, consonants only).
  - BANKRUPT → round winnings = 0, pass turn.
  - LOSE A TURN → pass turn.
  - FREE PLAY → pick ANY letter (vowel free) or solve; no penalty on miss.
- `PICK_CONSONANT` → correct: +value×count, back to `TURN_START` (same player).
  Wrong/repeated: pass turn.
- Buy vowel → −$250 flat; correct keeps turn, wrong passes.
- Solve → type/complete the phrase; correct ends round, wrong passes turn.

## Rules details
- Round winner banks round winnings (min $1000 floor like the show? → no, keep faithful-simple: banks exactly round winnings, but winner gets at least the solve; losers' round totals reset to 0).
- No letter repeats within a round; used-letter keyboard disables.
- Edge cases:
  - No consonants remain in puzzle → spinning disabled; must buy vowel or solve.
  - No vowels remain → buy-vowel disabled.
  - < $250 → buy-vowel disabled.
  - All letters revealed by guesses → auto-solve credit to current player.
- Bonus round: highest banked total advances; tie → tie-breaker puzzle? Simpler
  faithful option: tie broken by most recent round win among the tied
  (documented in UI); implemented as: tied players compared by last round won.
- Bonus: R,S,T,L,N,E auto-revealed; pick 3 consonants + 1 vowel; 30s timer to
  type the solution; prize $25k–$50k wedge-style random pick shown before.

## CPU (adaptive)
- Difficulty scalar `d ∈ [0,1]` recomputed each CPU turn from (human leader
  banked+round) − (CPU best). Human ahead → d rises; human behind → d falls.
- Letter pick: with prob `d` choose best remaining letter by frequency in the
  *actual puzzle-bank corpus* + pattern match against revealed board; otherwise
  choose from generic ETAOIN order with noise.
- Solve attempt: when fraction revealed ≥ threshold(d) (lower threshold when d
  high), CPU attempts solve with success prob scaling with revealed fraction
  and d. CPU actions are staged with ~1s delays and status-line narration.

## Puzzle bank
≥60 phrases across TECHNOLOGY, TOOLS, CONCEPTS, FRAMEWORKS, PEOPLE & COMPANIES.
Only A–Z and spaces/&/- allowed; non-letters render as static tiles.

## Testing
Drive the game in the embedded browser: setup → spins (mock via exposed debug
hook `window.__dbg` to force wedge outcomes) → letter guesses, vowel buy,
bankrupt, solve, round transition, bonus round, timer expiry, game over.
