# G1 — P0 Human Product Validation: participant evidence

Copy per participant. Use alias (`P01`, `P02`, …). Functional profile only — no
medical diagnoses. No real personal data.

> The moderator observes and does NOT direct. Do not help the participant
> before the system has had a chance to fail.

## Participant
- Alias: P01
- Functional profile: low digital familiarity / difficulty reading small & dense
  interfaces / difficulty with fine pointing / difficulty with technical terms

## Session flow

```text
BASELINE   (without Navega)   → record outcome
ASSISTED   (with Navega)      → moderator observes, records each turn/failure
POST-TASK  → short questions
```

## Recorded values

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
outcome: DOM_ONLY_SUCCESS        # DOM_ONLY_SUCCESS | DOM_ONLY_FAILURE | UNRESOLVED
would_vision_plausibly_help: unknown   # yes | no | unknown
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

## Key events flagged (tick those observed)
- [ ] `MODEL_WRONG` — the model mis-understands the page
- [ ] `GUIDANCE_UNCLEAR` — it understands the page but explains poorly
- [ ] `TARGET_NOT_FOUND` — instruction correct, person cannot find the control
- [ ] `ASSISTANT_ACCESS_FRICTION` — the problem is opening/using Navega
- [ ] `MULTI_ACTION_GUIDANCE` (descriptive, not a new taxonomy) — more than one
      physical action in a single response

## Post-task questions (record answers)
- Did you find it easier?
- Was there any explanation you did not understand?
- Was there a moment you did not know where to look?
- Would you have asked another person for help?

## Review notes (used to decide P1)
- Task(s) that improved / did not:
- Model errors:
- Confusing instructions:
- DOM insufficiency:
- Profile differences:
- Problems a highlight would solve (`TARGET_NOT_FOUND`):
- Problems unrelated to highlight (context/model `MODEL_WRONG`,
  conversational/UX `GUIDANCE_UNCLEAR`, onboarding `ASSISTANT_ACCESS_FRICTION`):
- Descriptive: `MULTI_ACTION_GUIDANCE` occurrences (too many steps at once), noted
  separately from `GUIDANCE_UNCLEAR`:
