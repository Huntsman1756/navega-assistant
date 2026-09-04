# P0 Validation Protocol

## Setup
- Operator controls the context mode per task: `DOM_ONLY` or `DOM_PLUS_VISION`.
- Use the deterministic fixture pages in `tests/fixtures/` (fake data only).
- The G1 artifact is `v0.0.4-p0-g1-baseline`. It holds a bounded, ephemeral
  current help session (short follow-ups are possible) and a per-origin
  permission UX.
- Sessions are recorded locally; nothing is uploaded in P0.

## Participant profiles
Use functional observations, not medical diagnoses. Examples:
- low familiarity with digital interfaces
- difficulty reading small/dense interfaces
- difficulty with fine pointing/clicking
- difficulty understanding technical terminology

## Per participant
1. Establish baseline (unaided, existing habit).
2. Assign 4–6 tasks.
3. Repeat suitable tasks with the assistant.
4. Record outcomes in `P0-SESSION-TEMPLATE.md`.
5. Aggregate into `P0-RESULTS-TEMPLATE.csv`.
6. Record baselines in `P0-BASELINE-TEMPLATE.csv`.

## Notes
- P0 is directional/exploratory, not a population estimate.
- Do not publish misleading percentages from tiny cells.
- Use participant aliases `P01`, `P02`, `P03`, …; no unnecessary personal data.
