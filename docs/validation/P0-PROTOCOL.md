# P0 Validation Protocol

## Setup
- Operator controls the context mode per task: `DOM_ONLY` or `DOM_PLUS_VISION`.
- Use the deterministic fixture pages in `tests/fixtures/` (fake data only).
- The G1 artifact is `v0.0.8-p0-g1-baseline` (commit `05898434b480f11a0a8b59e115a150b1e54d10da`).
  It is the latency / fail-fast closure on top of the runtime-correctness
  baseline. It holds a bounded, ephemeral current help session (short
  follow-ups are possible), a per-origin permission UX and a hard
  provider/backend deadline with friendly Spanish errors. It does NOT add
  highlighting, autonomous actions or browsing history.
- Sessions are recorded locally; nothing is uploaded in P0.

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
literally. This is what makes the study comparable across participants:

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

## Notes
- P0 is directional/exploratory, not a population estimate.
- Do not publish misleading percentages from tiny cells.
- Use participant aliases `P01`, `P02`, `P03`, …; no unnecessary personal data.
