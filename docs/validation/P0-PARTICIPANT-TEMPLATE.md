# G1 — P0 Human Product Validation: participant evidence

Copy per participant. Use alias (`P01`, `P02`, …). Functional profile only — no
medical diagnoses. No real personal data.

> The moderator observes and does NOT direct. Do not help the participant
> before the system has had a chance to fail.

## Participant
- Alias: P01
- Functional profile: low digital familiarity / difficulty reading small & dense
  interfaces / difficulty with fine pointing / difficulty with technical terms
- Pre-session disclosure read/given (see `P0-PROTOCOL.md`): [ ] yes
- Setup was 100% operator-facilitated (participant installed/configured nothing): [ ] yes
- Baseline preflight: `git rev-parse HEAD` == `git rev-parse v0.0.9-p0-g1-baseline^{}`
  (must match `docs/validation/G1-BASELINE.json`): [ ] yes

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

# --- orthogonal progress capture (does NOT replace the fields above) ---
task_progress: COMPLETED         # COMPLETED | PARTIAL | ABANDONED | TIMEOUT
last_confirmed_step: completó el formulario y recibió el correo ficticio
                               # one factual sentence

# --- highlight rubric (only for TARGET_NOT_FOUND; YES needs A+B+C+D) ---
would_highlight_plausibly_help: UNKNOWN   # YES | NO | UNKNOWN
highlight_justification: —                # mandatory one-line fact for every YES

# --- follow-up / state alignment (post-action turns) ---
page_state_changed: NO           # YES | NO | UNKNOWN
followup_state_alignment: NOT_APPLICABLE
   # CORRECT_STATE | CORRECT_RECOVERY | WRONG_STATE | UNRESOLVED | NOT_APPLICABLE
   # WRONG_STATE requires positive contradictory evidence vs the fixture

# --- instruction analysis ---
instruction_spatial_anchor: COARSE   # NONE | COARSE | PRECISE (actual instruction received)

# --- context / sanitization provenance (existing local evidence only) ---
context_truncated: NO            # YES | NO | UNKNOWN
redaction_impact: NONE           # NONE | POSSIBLY_RELEVANT | MATERIAL | UNKNOWN

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
