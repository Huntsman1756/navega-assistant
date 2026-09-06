# POST-G1 candidate backlog (NOT for implementation before P01–P04)

Status: **deferred by decision.** The G1 runtime is frozen at
`v0.0.9-p0-g1-baseline` (`docs/validation/G1-BASELINE.json`); the current
voice/output candidate `91690c4…` is a **posterior hypothesis, not proven
design**. Nothing in this file may be applied to the baseline, and nothing
here pre-commits P1 feature selection. After the P01–P04 evidence packet we
compare reality against these options before changing anything.

## A. Conceptual adjustments to the current candidate prompt

### A1. The "≈12 words" cap is a strong preference, not a law

Current candidate prompt: "Keep every sentence very short (about 12 words or
fewer)". Digital.gov's plain-language guidance asks for short, simple,
active-voice sentences written **for the specific audience** — it never sets
a magic number, and insists on challenging each word for value, not for
length. If a necessary condition genuinely needs 14 words, an honest 14-word
sentence beats an artificial or ambiguous 12-word one.

Planned refinement (post-G1, evidence-gated):

```text
- Prefer very short sentences (around 12 words or fewer), one idea per
  sentence. If a necessary condition genuinely needs more words, clarity
  wins over the number.
```

### A2. `Ruta:` must contain labels, not re-ordered commands

Current candidate example ("Escribir tu nombre / Escribir tu clave / Pulsar
'Entrar'") repeats three imperatives. Even with the one-action rule, a
low-confidence user may read it as "tengo que hacer estas tres cosas ahora".
GOV.UK's step-by-step pattern (researched through 8 rounds with users
including people with low digital literacy) uses short step/task names and
keeps the current task clearly separate from the end-to-end journey. USWDS
process list / step indicator show the same separation structurally.

Preferred shape (to validate after G1):

```text
Ahora:
Escribe tu usuario en el cuadro «Usuario».

Ruta:
1. Usuario
2. Contraseña
3. Entrar
```

Alternative heading wording ("Te faltan:" for remaining steps; "Paso 1 de 3"
progress framing) should be tested as variants, not assumed.

### A3. Keep the correct abstraction

The candidate's separation `Ahora:` = what I do now / `Ruta:` = where I am
and what comes next is likely the right abstraction. What remains unproven
is **how much information `Ruta:` should carry** (0, 2–3 short labels, or
contextual hints). Decide from evidence, not taste.

## B. Evidence gate before choosing any of this

After P01–P04, the frozen methodology fields decide whether the bottleneck
is wording, orientation, spatial language, or visual localization:

```text
GUIDANCE_UNCLEAR + plain-word analysis   → supports A1 / wording work
MULTI_ACTION_GUIDANCE pattern            → informs A2 (map size/labels)
INSTRUCTION_SPATIAL_ANCHOR NONE/COARSE   → supports spatial-text work
TARGET_NOT_FOUND + PRECISE + rubric YES  → visual-highlight hypothesis
```

"Diagramas = mejor" stays an accessibility hypothesis with good public
design-system references, NOT a demonstrated result, until G1 evidence and a
later comparison support it.

## C. Reuse map (post-G1 adoption plan)

```text
Digital.gov Plain Language guide series
  → PATTERN_ONLY (wording rules; already recorded in UPSTREAM-REUSE.md)
  → A1 wording refinement

GOV.UK Design System — Step by step navigation + Task list
  → PATTERN_ONLY (current-task vs full-journey separation; short task names)
  → A2 map shape; adoption requires full source/page inspection at that time
  → https://design-system.service.gov.uk/patterns/step-by-step-navigation/
    https://design-system.service.gov.uk/components/task-list/
    content license seen 2026-09-06: Open Government Licence v3.0;
    step-by-step code is NOT in govuk-frontend (prototype-kit plugin only)

USWDS — Process list + Step indicator (incl. accessibility tests pages)
  → PATTERN_ONLY (accessible sequential-step representation for a future
    visual pass in the side panel)
  → https://designsystem.digital.gov/components/process-list/
    https://designsystem.digital.gov/components/step-indicator/
    license/source inspection pending (adoption deferred)

Mermaid
  → REJECT as runtime (self-documented user-text sanitization risk; heavy
    dependency); at most conceptual inspiration. Text first, then safe
    semantic HTML/CSS if a visual pass is ever justified:

    Paso 1 de 3            (progress framing, screen-reader friendly)
    ● Usuario
    ○ Contraseña
    ○ Entrar

    Not SVG, not canvas, not a DSL.
```

## D. Explicit non-goals right now

- No prompt edits before P01–P04 finish.
- No UI/HTML work on the side panel until G1 consolidates.
- No highlight/geometry/voice decisions (roadmap decision waits until after
  P04 per pre-registered logic).
