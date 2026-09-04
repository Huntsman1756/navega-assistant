# P0 Validation Plan

## G1 gate — P0 Human Product Validation

The next open gate is **G1**:

```text
G1 — P0 HUMAN PRODUCT VALIDATION
```

Requirement: **real human evidence**, not a technical gate. It is deliberately
not a single percentage. The gate passes when the qualitative review answers
these questions with evidence:

- which tasks improved with the assistant, and which did not?
- what errors did the model make?
- which instructions confused the participant?
- where was DOM-derived context insufficient?
- what differences were there between functional profiles?
- which problems would a highlight overlay actually solve?
- which problems have nothing to do with highlighting (context/model, UX/onboarding)?

P1 is **deliberately blocked** until G1 produces this evidence.

## Scope of the prototype being tested

The P0 prototype has **no real vision/redaction flow** and no display of a
highlight overlay. G1 therefore does **not** compare `DOM_ONLY` against
`DOM_PLUS_VISION`. P0 is not modified to introduce that variable.

Per assisted task, classify the outcome with one of:

```text
DOM_ONLY_SUCCESS
DOM_ONLY_FAILURE
UNRESOLVED
```

and record a separate, annotated judgement (not a measured column):

```text
WOULD_VISION_PLAUSIBLY_HELP = yes | no | unknown
```

Only if a clearly defined and safe experimental vision mode existed would it
make sense to later compare `DOM_ONLY` with `DOM_PLUS_VISION`.

## Method (moderator observes, does not direct)

**Crucial rule:** do not help the participant before the system has had a
chance to fail. If the moderator points to the button, keeps rephrasing the
question, or corrects the interaction, the session measures the moderator, not
Navega.

```text
BASELINE
person tries the task WITHOUT Navega
        ↓
record the outcome

ASSISTED
same class of difficulty WITH Navega
        ↓
moderator observes, does not direct
        ↓
record each turn and each failure

POST-TASK
short questions:
- Did you find it easier?
- Was there any explanation you did not understand?
- Was there a moment you did not know where to look?
- Would you have asked another person for help?
```

**Participants:** 3–4 people with intentionally different functional profiles.

> Do NOT categorize people by medical diagnosis. Use functional observations:
> low familiarity with digital interfaces; difficulty reading small/dense
> interfaces; difficulty with fine pointing/clicking; difficulty understanding
> technical terminology.

**Tasks:** approximately 4–6 per participant.

**Baseline:** before using the prototype, establish an individual baseline:
- can they complete the task unaided?
- would they normally ask another person?
- do they abandon?
- number of human interventions
- approximate time
- confusion/error events

**Repeat:** then repeat suitable tasks with the assistant.

## Metrics (deltas)

```text
task success delta
abandonment delta
human-intervention delta
wrong-guidance events
unsafe-guidance events
turns per task
confusion events
```

> Findings are **directional and exploratory, not population estimates**.
> Per-domain and per-participant cells may contain too few observations for
> statistical interpretation. Do not publish misleading percentages from tiny
> cells.

## Key events to flag

These four events are the ones that will actually decide P1:

```text
MODEL_WRONG
The model mis-understands the page.

GUIDANCE_UNCLEAR
It understands the page but explains it poorly.

TARGET_NOT_FOUND
The instruction is correct, but the person cannot find the
control visually.

ASSISTANT_ACCESS_FRICTION
The problem is opening/using Navega, not the web page.
```

Interpretation is then largely predetermined:

```text
a lot of TARGET_NOT_FOUND            → strong evidence to build P1 highlight
a lot of MODEL_WRONG                 → improve context/model before P1
a lot of GUIDANCE_UNCLEAR            → work on conversational policy/UX
a lot of ASSISTANT_ACCESS_FRICTION   → fix entry/onboarding first
```

## Domain matrix

Record results by broad domain category (the matrix discovers failure
patterns, it does not estimate prevalence).

```text
                        DOM_ONLY_SUCCESS  DOM_ONLY_FAILURE  UNRESOLVED

Webmail
Social
E-commerce
Public administration
Authentication
Documents/forms
```

## Engineering freeze during validation

Do not change the engineering baseline during the first sessions even if small
defects appear — except for a security problem or something that entirely
prevents running the study. Patching after each participant would destroy a
comparable reference. Record first; decide afterwards.

## Final report (G1)

The important artifact is the **consolidated G1 report** with the evidence from
the 3–4 people. It must decide explicitly between:

```text
PROCEED_TO_P1
ITERATE_P0
STOP_OR_REFRAME
```

## Data handling

Validation data is **not uploaded** by default. Templates live in
`docs/validation/`. Real participant data is git-ignored. Participants use
aliases (`P01`…). Do not collect unnecessary personal data.
