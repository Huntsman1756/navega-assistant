# P0 Validation Protocol

## Setup
- Operator controls the context mode per task: `DOM_ONLY` or `DOM_PLUS_VISION`.
- Use the deterministic fixture pages in `tests/fixtures/` (fake data only).
- **G1 baseline (single source of truth):** `docs/validation/G1-BASELINE.json`.
  It currently resolves to `v0.0.9-p0-g1-baseline` at commit
  `dfca83f76dd53aa36c8d8a017da09b79fb7c9df6` (protocol version 3). The tag is
  frozen — never move, re-create or substitute it with the current HEAD.
  Voice and highlighting are **not** part of the G1 treatment.
- **P01, P02, P03 and P04 all use the exact same baseline SHA.** Before every
  session the operator preflights:

  ```bash
  git rev-parse HEAD
  git rev-parse v0.0.9-p0-g1-baseline^{}
  ```

  Both MUST print the identical full SHA from `G1-BASELINE.json`. If they do
  not, stop and check out the exact frozen commit first. Run
  `pnpm check:g1-baseline` to catch documentation drift.
- Sessions are recorded locally; nothing is uploaded in P0. (Local = study
  records. Runtime inference is NOT fully local — see pre-session disclosure.)

## Facilitated installation — the participant never touches setup

G1 measures Navega's usefulness, **not** developer-setup ability. Before the
participant arrives, the OPERATOR completes all of:

1. check out the exact frozen G1 SHA (verified against `G1-BASELINE.json`);
2. `pnpm install` / `pnpm build` as needed;
3. start the backend and verify NaN health (`provider=openai-compatible`,
   `model=qwen3.6` at `http://127.0.0.1:8787/health`);
4. load `apps/extension/dist` unpacked in the participant's Chrome;
5. prepare fixture pages and test accounts;
6. complete any permission pre-authorization the study design allows;
7. hide the terminal and all developer tooling before the session starts.

The participant starts at: browser open + test task ready + Navega available.
The participant is NEVER asked to install the extension, enable Developer
Mode, edit `.env`, run Node/pnpm or configure a provider. If setup breaks,
the session is paused and recorded as an operator/infrastructure issue, not
participant data.

## Pre-session disclosure (Spanish, read aloud or handed before P01)

"Durante las tareas con Navega, la pregunta que escribas y una representación
saneada de la página (botones, textos y estructura accesible, sin contraseñas
ni datos sensibles) se enviarán a un servidor local y de ahí a un proveedor
externo de inteligencia artificial para generar la ayuda. Las pruebas usan
páginas, cuentas y datos ficticios. No introduzcas contraseñas, códigos,
datos bancarios ni información personal real. Puedes parar cuando quieras."

Data flow for the G1 (NaN) configuration:

```text
participant question
+ sanitized/bounded page snapshot
+ bounded recent help conversation
→ local Navega backend (127.0.0.1)
→ external NaN AI API (qwen3.6)
```

"Validation data stays local" refers to LOCAL STUDY RECORDS (moderator notes,
participant templates, observation logs, consolidated G1 analysis). It does
not mean runtime inference is local. Fixtures/test accounts only. Never real
passwords, OTPs, card/PAN/CVV data, recovery codes, banking data, personal
inbox content or other sensitive personal data.

## G1 test-data rule (P01–P04)
P01–P04 MUST use:
- local fixture pages / controlled test accounts;
- dedicated test accounts (e.g. a controlled Gmail-like test account);
- dummy form data (fake passwords, fake OTPs, fake card numbers).

Participants MUST NOT use real:
- passwords;
- OTP/one-time or verification codes;
- payment cards / CVV / PANs;
- recovery codes;
- banking data;
- sensitive personal inbox content.

Validate secret-safety behaviour with fixtures/test accounts only.

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
4. Record literal evidence per assisted task in `P0-PARTICIPANT-TEMPLATE.md`
   (one file per participant). This is the source of truth for G1.
5. Optionally keep a one-line-per-task summary in `P0-SESSION-TEMPLATE.md`.
6. Aggregate into `P0-RESULTS-TEMPLATE.csv`.
7. Record baselines in `P0-BASELINE-TEMPLATE.csv`.

## Per assisted task — mandatory fields (frozen for G1)

For every assisted task the participant template MUST capture these fields
literally. This is what makes the study comparable across participants.
Pre-registration revision frozen before P01 (no session has been run against
an earlier field list):

```text
PARTICIPANT_ID            alias (P01, P02, …)
TASK_ID                   local task label (T1, T2, …)
BASELINE_OUTCOME          completed | abandoned | human_help | not_attempted

USER_QUESTION             LITERAL participant question, verbatim, in the
                          participant's own language (do NOT paraphrase)

NAVEGA_EXACT_OUTPUT       LITERAL Navega response, verbatim (do NOT summarize)

USER_ACTIONS              what the participant did next, in the order they
                          did it (click / type / scroll / nothing / stopped)

CONFUSION_POINTS          any moment they paused, asked the moderator,
                          verbalised uncertainty or repeated an action

WRONG_ACTIONS             any action the participant took that Navega did
                          not ask for, or a wrong target

HUMAN_HELP                did they request help from another person?
MODERATOR_INTERVENTION    did the moderator have to intervene?

PRIMARY_EVENT             EXACTLY ONE of:
                            MODEL_WRONG
                            GUIDANCE_UNCLEAR
                            TARGET_NOT_FOUND
                            ASSISTANT_ACCESS_FRICTION
                            NONE

MULTI_ACTION_GUIDANCE     separate annotation, YES / NO (+ count if useful).
                          This is NOT a competing primary event; if the
                          participant did not understand the page, the
                          primary event remains MODEL_WRONG, etc.

DOM_OUTCOME               DOM_ONLY_SUCCESS | DOM_ONLY_FAILURE | UNRESOLVED

WOULD_VISION_PLAUSIBLY_HELP   YES | NO | UNKNOWN

DELTA                     POSITIVE_DELTA | NO_DELTA | NEGATIVE_DELTA |
                          ABANDONED | UNRESOLVED

LATENCY_PERCEPTION        NOT_NOTICED | NOTICEABLE | ANNOYING | BLOCKING

--- progress (orthogonal to DELTA/PRIMARY_EVENT) ---

TASK_PROGRESS             COMPLETED | PARTIAL | ABANDONED | TIMEOUT
LAST_CONFIRMED_STEP       one factual sentence: the last successfully
                          reached task state (e.g. "llegó al formulario de
                          recuperación y vio el campo de correo")

--- highlight rubric (pre-registered, only for TARGET_NOT_FOUND cases) ---

WOULD_HIGHLIGHT_PLAUSIBLY_HELP   YES | NO | UNKNOWN
HIGHLIGHT_JUSTIFICATION   one factual sentence (mandatory for every YES)

--- follow-up / state alignment (for turns after a participant action) ---

PAGE_STATE_CHANGED        YES | NO | UNKNOWN
FOLLOWUP_STATE_ALIGNMENT  CORRECT_STATE | CORRECT_RECOVERY | WRONG_STATE |
                          UNRESOLVED | NOT_APPLICABLE

--- instruction analysis ---

INSTRUCTION_SPATIAL_ANCHOR       NONE | COARSE | PRECISE
                          (classify the instruction the participant ACTUALLY
                          received; NONE="Pulsa Continuar.", COARSE="Pulsa
                          Continuar al final del formulario.", PRECISE=
                          "Pulsa Continuar abajo a la derecha del formulario.")

--- context / sanitization provenance (existing local evidence only) ---

CONTEXT_TRUNCATED         YES | NO | UNKNOWN
                          (PageContext already carries a truncation signal;
                          record it — no new telemetry)

REDACTION_IMPACT          NONE | POSSIBLY_RELEVANT | MATERIAL | UNKNOWN
                          (controlled fixtures only, where full ground truth
                          is known; MATERIAL = a required piece of known
                          fixture information was unavailable to the model
                          because of sanitization/redaction)
```

Rules of thumb for the primary event:

- Model clearly misreads/misrepresents the page → `MODEL_WRONG`.
- Model understands but the participant cannot tell what to do →
  `GUIDANCE_UNCLEAR`.
- Instruction is correct but the control is visually hard to find →
  `TARGET_NOT_FOUND`.
- The problem is opening / granting / using Navega, not the web page →
  `ASSISTANT_ACCESS_FRICTION`.
- None of the above applies (task just went well, or the failure has another
  explanation not covered here) → `NONE`.

`MULTI_ACTION_GUIDANCE` is recorded alongside the primary event, never
instead of it.

### TASK_PROGRESS — partial progress, not binary completion

`BASELINE_OUTCOME`/`ASSISTED_OUTCOME`/`DELTA`/`PRIMARY_EVENT`/`DOM_OUTCOME`
are NOT replaced. `TASK_PROGRESS` is an orthogonal persistence/progress
capture: a task can be `DOM_ONLY_FAILURE` + `ABANDONED` delta yet show
`TASK_PROGRESS=PARTIAL` with a real `LAST_CONFIRMED_STEP`. Rationale: external
work such as PageGuide suggests guided assistance may increase partial
progress/persistence even without full completion — treated strictly as a
directional prior (see `docs/VALIDATION-PLAN.md`), never as an expected
effect size.

### WOULD_HIGHLIGHT_PLAUSIBLY_HELP — pre-registered rubric

YES only when ALL four are factually supported:

```text
A. TARGET_PRESENT             the required control existed in the relevant
                              page state
B. GUIDANCE_SEMANTICALLY_CORRECT   Navega identified the correct control/action
C. USER_UNDERSTOOD_ACTION     the participant understood what to do
D. FAILURE_WAS_LOCALIZATION   the observed failure was finding the target
                              physically/visually
```

- Navega misunderstood the page → NO.
- The instruction was conceptually unclear → NO.
- Evidence insufficient → UNKNOWN.
- Never assign YES retroactively to justify building P1; every YES keeps its
  one-line `HIGHLIGHT_JUSTIFICATION`.
- With N≈3–4, report cases/patterns, not population percentages.

### FOLLOWUP_STATE_ALIGNMENT — recovery is not failure

`WRONG_STATE` requires POSITIVE contradictory evidence: Navega asserted,
assumed or relied on a state contradicted by the independently verified
fixture/page state. Prudently reorienting when evidence is missing (e.g.
“¿Qué ves ahora?”) is `CORRECT_RECOVERY`, not a failure. Do not punish
appropriate uncertainty. `UNRESOLVED` when the recording cannot support any
classification; `NOT_APPLICABLE` when there was no post-action follow-up.

### INSTRUCTION_SPATIAL_ANCHOR — separating localization causes

This classification exists because the runtime gives Navega no geometry yet
(no bounding boxes, no overlay — none are added before G1). It separates
`TARGET_NOT_FOUND` because textual localization was weak (NONE/COARSE pattern)
from `TARGET_NOT_FOUND` despite adequate spatial language (PRECISE pattern).
That distinction decides whether the smallest P1 intervention to test is
A) better spatial grounding/text or B) a visual highlight overlay.
Do NOT pre-commit to B.

### CONTEXT_TRUNCATED / REDACTION_IMPACT — don't blame the model for what it never received

When analyzing failures, explicitly inspect the combinations
`MODEL_WRONG + CONTEXT_TRUNCATED`, `TARGET_NOT_FOUND + CONTEXT_TRUNCATED` and
`DOM_ONLY_FAILURE + CONTEXT_TRUNCATED`, and record `REDACTION_IMPACT` whenever
a required fixture fact was plausibly or materially unavailable. This uses
the existing PageContext truncation signal and controlled-fixture ground
truth only — no new telemetry, and NEVER by weakening sanitization or
collecting real secrets. G1 identifies concrete product-impact cases only;
it does not estimate global sanitizer precision/recall.

## Notes
- P0 is directional/exploratory, not a population estimate.
- Do not publish misleading percentages from tiny cells.
- Use participant aliases `P01`, `P02`, `P03`, …; no unnecessary personal data.
