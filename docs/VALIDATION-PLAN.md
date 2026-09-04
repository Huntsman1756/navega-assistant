# P0 Validation Plan

## G1 gate — P0 Human Product Validation

The next open gate is **G1**:

```text
G1 — P0 HUMAN PRODUCT VALIDATION
```

> **G1 artifact:** the pre-G1 baseline is `v0.0.4-p0-g1-baseline`. It adds a
> small, **ephemeral current help session** (a bounded conversation so the
> assistant can answer short follow-ups such as “ya estoy” / “¿y ahora?”) and a
> **per-origin permission UX** for sites `activeTab` cannot reach. It does **not**
> add highlighting, autonomous actions or browsing history.

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

The prototype holds a **bounded, ephemeral** current help conversation. When
the participant says a short follow-up (e.g. “ya estoy”), the assistant should
continue the same help task. This is a help-session feature, not a
browsing-history tracker; the conversation resets with “Nueva ayuda” and is
cleared on browser restart.

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

## Descriptive event — MULTI_ACTION_GUIDANCE

A descriptive marker (not yet a new taxonomy) for the login fixture and similar:

```text
MULTI_ACTION_GUIDANCE
Navega gives more than one physical action in a single response.
```

Example:

> escribe el usuario → escribe la contraseña → pulsa iniciar sesión

This lets us separate two different phenomena:

```text
GUIDANCE_UNCLEAR       → the person does not understand what Navega means
MULTI_ACTION_GUIDANCE  → they understand each step, but receive too many at once
```

Record it as a descriptive datum. Do not convert it into `GUIDANCE_UNCLEAR` until we see what real participants do.

## Suggested task set (per participant, 4–6 tasks)

```text
T1  Login / access
T2  Account recovery
T3  E-commerce product page
T4  Administrative form
T5  Social or webmail navigation
T6  Confusing / error / suspicious content page
```

It is not mandatory to do all six per person; 4–6 tasks per participant is enough.

## Session flow for P01 + login fixture

1. **Baseline.** Show the fixture without Navega; give only the task goal. Do not
   explain where to press or which fields to use. Record completion/abandonment,
   approximate time, errors, help requested and verbalizations.
2. **Reset the fixture.** Return to the initial state. Open Navega with the real
   provider. Give an equivalent task and let the participant phrase their own
   question — do not write the prompt for them.
3. **Assisted.** Record literally each Navega response and what the person does
   afterwards. Watch `MODEL_WRONG`, `GUIDANCE_UNCLEAR`, `TARGET_NOT_FOUND`,
   `ASSISTANT_ACCESS_FRICTION` and `MULTI_ACTION_GUIDANCE`.
4. **Do not intervene early.** If the person stalls, record the situation first.
   Only intervene if they explicitly abandon, request human help, or the
   protocol decides the task should end.
5. **Post-task.** The four short questions (see participant template).

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
