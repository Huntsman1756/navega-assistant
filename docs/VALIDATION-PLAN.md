# P0 Validation Plan

P0 is a **controlled, qualitative product-validation prototype**. The goal is
NOT to demonstrate engineering sophistication. The goal is to answer:

1. Can a model understand a compact DOM-derived representation well enough to
   help a low-digital-confidence user?
2. Are the instructions understandable and useful?
3. Does assistance reduce abandonment or dependence on another person?
4. How often is DOM-derived context sufficient?
5. When does vision materially improve the answer?

---

## Method

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

> P0 findings are **directional and exploratory, not population estimates**.
> Per-domain and per-participant cells may contain too few observations for
> statistical interpretation. Do not publish misleading percentages from tiny
> cells.

## Domain × context matrix

Record results by broad domain category.

```text
                        DOM_ONLY  DOM+VISION  UNRESOLVED

Webmail
Social
E-commerce
Public administration
Authentication/banking
Documents/forms
```

The matrix exists to discover failure patterns and prioritize future
validation, not to estimate prevalence.

## Modes

- `DOM_ONLY` (default)
- `DOM_PLUS_VISION` (experimental, operator-selected in validation tasks)

The operator chooses the mode for a validation task. The system does not
auto-route in P0.

## Success gate

No single arbitrary percentage is a hard P0 success gate. P0 is
qualitative/directional evidence.

## Data handling

Validation data is **not uploaded** by default. Templates live in
`docs/validation/`. Real participant data is git-ignored. Participants use
aliases (`P01`…). Do not collect unnecessary personal data.
