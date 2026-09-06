# G1 consolidated report template

This is the decisive artifact. Fill it from the participant evidence
(`P0-PARTICIPANT-TEMPLATE.md`) and complete the decision at the bottom.

- Frozen baseline: **must** be the tag/SHA in `docs/validation/G1-BASELINE.json`
  (single source of truth; verify with `pnpm check:g1-baseline`). Record the
  tag + full SHA at the top of the report. All P01–P04 use that same SHA.

## Overview
- Baseline tag / SHA: __ (from `docs/validation/G1-BASELINE.json`)
- Participants: P01, P02, P03[, P04]
- Tasks per participant: __
- Total assisted tasks: __
- Experiment protocol: see `docs/VALIDATION-PLAN.md` (moderator observes, does
  not direct; engineering baseline frozen; setup operator-facilitated).

## Outcome distribution
```text
DOM_ONLY_SUCCESS         __
DOM_ONLY_FAILURE         __
UNRESOLVED               __
```
```text
WOULD_VISION_PLAUSIBLY_HELP   yes __  |  no __  |  unknown __
```

## TASK_PROGRESS cases (partial progress is evidence, not noise)
```text
COMPLETED    __
PARTIAL      __
ABANDONED    __
TIMEOUT      __
```
- For each PARTIAL: `LAST_CONFIRMED_STEP` narrative (baseline vs assisted).
- CASE E review: does PARTIAL improve where COMPLETED does not? Do NOT call
  that "no benefit" without inspecting progress, human help and confusion.

## Key events
```text
MODEL_WRONG               __
GUIDANCE_UNCLEAR          __
TARGET_NOT_FOUND          __
ASSISTANT_ACCESS_FRICTION __
```

## Primary-event × context associations
```text
MODEL_WRONG       + CONTEXT_TRUNCATED __   + REDACTION_IMPACT=MATERIAL __
TARGET_NOT_FOUND  + CONTEXT_TRUNCATED __   + REDACTION_IMPACT=MATERIAL __
DOM_ONLY_FAILURE  + CONTEXT_TRUNCATED __   + REDACTION_IMPACT=MATERIAL __
```
Do not blame the model for information it never received.

## Highlight rubric evidence (per case, not percentages)
- TARGET_NOT_FOUND cases with `WOULD_HIGHLIGHT_PLAUSIBLY_HELP=YES`: list, each
  with its one-line `HIGHLIGHT_JUSTIFICATION` and proof of rubric items
  A (target present), B (semantically correct), C (action understood),
  D (failure was localization).
- NO / UNKNOWN cases: brief reasons (model misunderstanding / unclear
  instruction / insufficient evidence).
- `INSTRUCTION_SPATIAL_ANCHOR` pattern among YES cases:
  ```text
  NONE __  |  COARSE __  |  PRECISE __
  ```
  NONE/COARSE-dominant → test spatial grounding/text first; PRECISE-present
  failures → candidate for highlight overlay. Do NOT pre-commit to overlay.

## Follow-up / state alignment
```text
CORRECT_STATE     __
CORRECT_RECOVERY  __
WRONG_STATE       __   (each needs positive contradictory evidence)
UNRESOLVED        __
NOT_APPLICABLE    __
```
- `PAGE_STATE_CHANGED` YES/NO/UNKNOWN pattern on follow-up turns:

## Deltas (task success / abandonment / human help / confusion)
Fill per participant and note the pattern.

```text
POSITIVE_DELTA __  NO_DELTA __  NEGATIVE_DELTA __  ABANDONED __  UNRESOLVED __
```

## Human help / moderator intervention / latency perception
- human-help requests (baseline vs assisted):
- moderator interventions (and why — distinguish participant need from
  operator/infrastructure issues):
- `LATENCY_PERCEPTION`: NOT_NOTICED / NOTICEABLE / ANNOYING / BLOCKING counts:

## Qualitative findings
- Tasks that improved / did not:
- Model errors (recurring?):
- Instructions that confused:
- Where DOM-derived context was insufficient (truncation? redaction?):
- Differences between profiles:
- What a highlight overlay would actually solve (rubric-supported cases only):
- What has nothing to do with highlight (context/model, conversational/UX,
  onboarding):

## Caveats
- Sample size is tiny and directional, not a population estimate.
- Do NOT report misleading percentages from tiny cells — use participant-level
  and task-level narrative evidence, cases and patterns.
- Cells may have too few observations for statistical interpretation.
- The engineering baseline was frozen; no per-participant patches were applied.
- External priors (e.g. PageGuide) are directional only and NOT expected
  effect sizes for this population.

## Decision (pre-registered cases A–E, see `docs/VALIDATION-PLAN.md`)
```text
PROCEED_TO_P1
ITERATE_P0
STOP_OR_REFRAME
```
- Which pre-registered case(s) match the evidence (A / B / C / D / E):
- Reasoning:
- If B: smallest next intervention to test — A) spatial grounding/text vs
  B) highlight overlay:
- Recommended next step:
