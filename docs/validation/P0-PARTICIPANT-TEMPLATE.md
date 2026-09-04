# G1 — P0 Human Product Validation: participant evidence

Copy per participant. Use alias (`P01`, `P02`, …). Functional profile only — no
medical diagnoses. No real personal data.

## Participant
- Alias: P01
- Functional profile: low digital familiarity / difficulty reading small & dense
  interfaces / difficulty with fine pointing / difficulty with technical terms

## Recorded values (evidence, not a percentage)

For each participant: first a **baseline** (unaided / current habit), then
assisted runs; overlay them.

```text
Participant: P01
Functional profile: low digital familiarity

Task:
Recover access to webmail

BASELINE
completed: false
abandoned: true
human_help_requested: true
human_interventions: 2

ASSISTED
context_mode: DOM_ONLY
completed: true
human_help_requested: false
unsafe_guidance: 0
wrong_guidance: 0
confusion_events: 1
assistant_turns: 3

Outcome:
POSITIVE_DELTA
```

## Suggested outcomes
- `POSITIVE_DELTA` — better with assistance
- `NO_DELTA`
- `NEGATIVE_DELTA` — worse with assistance
- `ABANDONED`
- `UNRESOLVED`

## Review notes (used to decide P1)
- Task(s) that improved / did not:
- Model errors:
- Confusing instructions:
- DOM insufficiency:
- Profile differences:
- Problems a highlight would solve:
- Problems unrelated to highlight (context/model, UX/onboarding):
