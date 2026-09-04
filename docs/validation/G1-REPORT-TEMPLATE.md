# G1 consolidated report template

This is the decisive artifact. Fill it from the participant evidence
(`P0-PARTICIPANT-TEMPLATE.md`) and complete the decision at the bottom.

## Overview
- Participants: P01, P02, P03[, P04]
- Tasks per participant: __
- Total assisted tasks: __
- Experiment protocol: see `docs/VALIDATION-PLAN.md` (moderator observes, does
  not direct; engineering baseline frozen).

## Outcome distribution
```text
DOM_ONLY_SUCCESS         __
DOM_ONLY_FAILURE         __
UNRESOLVED               __
```
```text
WOULD_VISION_PLAUSIBLY_HELP   yes __  |  no __  |  unknown __
```

## Deltas (task success / abandonment / human help / confusion)
Fill per participant and note the pattern.

## Key events
```text
MODEL_WRONG               __
GUIDANCE_UNCLEAR          __
TARGET_NOT_FOUND          __
ASSISTANT_ACCESS_FRICTION __
```

## Qualitative findings
- Tasks that improved / did not:
- Model errors (recurring?):
- Instructions that confused:
- Where DOM-derived context was insufficient:
- Differences between profiles:
- What a highlight overlay would actually solve:
- What has nothing to do with highlight (context/model, conversational/UX,
  onboarding):

## Caveats
- Sample size is tiny and directional, not a population estimate.
- Cells may have too few observations for statistical interpretation.
- The engineering baseline was frozen; no per-participant patches were applied.

## Decision
```text
PROCEED_TO_P1
ITERATE_P0
STOP_OR_REFRAME
```
- Reasoning:
- Recommended next step:
