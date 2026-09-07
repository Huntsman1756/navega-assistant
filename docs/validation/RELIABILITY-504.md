# Assist reliability closure - post-G1 candidate

This evidence applies only to the post-G1 candidate. The frozen
`v0.0.9-p0-g1-baseline` tag remains immutable and was not used for candidate
changes.

## Pre-change baseline

Measured against real NaN/qwen3.6 with sequential, synthetic, protocol-valid
fixture snapshots only. No question, DOM, session, URL or provider response
content was recorded.

```text
BASELINE_N = 36
BASELINE_TIMEOUTS = 5
BASELINE_TIMEOUT_RATE = 13.9%
BASELINE_P50 = 721 ms total
BASELINE_P95 = 8012 ms total
BASELINE_MAX = 8015 ms total
```

The 5 timeouts terminated at the existing 8000 ms provider cutoff. A first
150-element large fixture was rejected by Navega's 16000-character protocol
bound before provider invocation; it was excluded and replaced by a
130-element protocol-valid fixture.

## Root cause and upstream decision

The observed failure is the interaction between a real provider latency tail
and the original single 8000 ms hard cutoff. The baseline evidence shows a
healthy median but a tail that reaches and exceeds that cutoff. NaN/qwen3.6
was not treated as the sole root cause.

`docs/UPSTREAM-REUSE.md` records the maintained-solution review:

- OpenAI Node SDK 6.39.0: PATTERN_ONLY. It has useful timeout/retry behavior,
  but replacing Navega's generic fetch adapter would add migration surface and
  would not by itself express the required authoritative total budget and
  fresh per-attempt signals.
- `p-retry` 8.0.1: REUSE. It is already the narrow maintained dependency that
  provides bounded retry, backoff/jitter, retry classification hooks,
  `maxRetryTime`, and `AbortSignal` support.
- `ai-retry`: PATTERN_ONLY. Its per-attempt deadline/total-budget concept was
  applied without migrating to the Vercel AI SDK.
- LiteLLM router patterns: PATTERN_ONLY. No second LiteLLM proxy was added.

No undocumented qwen3.6 reasoning-control parameter is sent.

## Candidate A

Candidate A used the first bounded retry implementation with a 15000 ms
attempt deadline and 18000 ms total budget. Its output bound was 4096 tokens.
It was retained as evidence only; it was not the final B allocation.

```text
EXPERIMENT_A_N = 40
EXPERIMENT_A_TIMEOUTS = 2
EXPERIMENT_A_TIMEOUT_RATE = 5.0%
EXPERIMENT_A_RECOVERED_RETRIES = 5
EXPERIMENT_A_P50 = 4221 ms total
EXPERIMENT_A_P95 = 17453 ms total
EXPERIMENT_A_MAX = 18014 ms total
EXPERIMENT_A_RELEASE_GATE = FAIL
```

The flaw was that an attempt consuming 15000 ms left only about 3000 ms for a
meaningful second inference window.

## Output-cap evaluation

All calls below used real NaN/qwen3.6, sequential synthetic fixtures, the same
structured schema, and a 2-second inter-call pause. `schema_valid` means the
backend returned HTTP 200 with a valid P0 decision. `invalid_model_output`
includes JSON/schema failures.

| max_tokens | N | success | schema_valid | invalid_model_output | timeouts | Ahora/Ruta candidates | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 512 | 6 | 3 | 3 | 3 | 0 | 3 | 1502 ms | 4596 ms | 4596 ms |
| 768 | 6 | 5 | 5 | 1 | 0 | 5 | 1821 ms | 5523 ms | 5523 ms |
| 1024 | 6 | 5 | 5 | 1 | 0 | 5 | 1320 ms | 13560 ms | 13560 ms |
| 4096 | 6 | 5 | 5 | 0 | 1 | 5 | 1249 ms | 16382 ms | 16382 ms |

Deterministic tests cover `explain`, `ask_user`, `cannot_help`, and an
`Ahora:/Ruta` candidate-shaped explanation. The smallest cap with zero observed
truncation/schema regression was 4096, so the explicit production bound remains
4096. No reasoning flag was changed.

## Experiment B policy

```text
PROVIDER_ATTEMPT_TIMEOUT_MS = 8000
PROVIDER_TOTAL_BUDGET_MS = 18000
RETRY_JITTER = 250-500 ms
EXTENSION_FAILSAFE_MS = 22000
MAX_PROVIDER_ATTEMPTS = 2
MAX_OUTPUT_TOKENS = 4096
```

The total budget is authoritative. Each attempt gets a fresh
`AbortController`; a retry is not started when the remaining budget cannot
provide a useful attempt window. Retry-After is honored only when it fits in
that remaining budget. Only network/connection failures, 408, 409, 429, 5xx,
and attempt timeouts are retryable. Deterministic client, policy, schema, and
invalid-output failures are not retried.

## Experiment B live burn

Real NaN/qwen3.6, synthetic fixtures only, one active request, sequential
requests, balanced tiny/medium/bounded-large contexts, and a 2-second
inter-call pause. The runner retained only duration/outcome fields and an
ephemeral local request identifier; it did not retain question, DOM, session,
URL, model output, or API key data.

```text
EXPERIMENT_B_N = 60
FIRST_ATTEMPT_TIMEOUTS = 13
RETRY_ATTEMPTS = 13
RECOVERED_RETRIES = 11
FINAL_TIMEOUTS = 2
OTHER_FAILURES = 0
INVALID_MODEL_OUTPUT = 0
EXPERIMENT_B_TIMEOUT_RATE = 3.3%
EXPERIMENT_B_P50 = 1361 ms total
EXPERIMENT_B_P95 = 13891 ms total
EXPERIMENT_B_MAX = 16492 ms total
ATTEMPT_P50 = 1323 ms
ATTEMPT_P95 = 8010 ms
USER_VISIBLE_PROVIDER_TIMEOUTS = 2
RELEASE_GATE = FAIL
```

Experiment B materially reduced ordinary latency versus Candidate A and
recovered 11 of 13 first-attempt timeouts, but it did not meet the mandatory
zero-user-visible-timeout gate. No third timeout-tuning loop was run.

## Single fallback-model experiment

Because B failed, exactly one fallback model was evaluated as a controlled
separate experiment. `gemma4` used the same three fixture classes, questions,
structured schema, 8000/18000 retry policy, 4096-token bound, and sequential
2-second spacing. Guidance correctness used a fixed offline rubric matching
the fixture-specific actionable terms; output text was not recorded.

```text
FALLBACK_MODEL = gemma4
N = 12
SCHEMA_VALID = 12
GUIDANCE_CORRECT = 4
GUIDANCE_UNCLEAR = 8
FIRST_ATTEMPT_TIMEOUTS = 1
RECOVERED_RETRIES = 1
FINAL_TIMEOUTS = 0
OTHER_FAILURES = 0
INVALID_MODEL_OUTPUT = 0
P50 = 1306 ms total
P95 = 9383 ms total
MAX = 9383 ms total
```

`gemma4` was faster and had no final timeout in this small sample, but it was
not guidance-non-inferior to qwen3.6 (the matched earlier qwen3.6 A/B had
10/12 guidance-correct results). It was not adopted and no silent model
failover was implemented.

## Closure decision

The candidate implements the bounded retry/output-cost mitigation and passes
the deterministic engineering contract, but reliability closure is not a
release PASS: Experiment B still had 2 user-visible provider timeouts. The
authorized fallback experiment did not establish a safe non-inferior model.
Voice live validation and P01-P04 remain separate human gates.

## Experiment C — final model and hedging decision

Experiment B was preserved at `b803a3399a64a6afe4c0b1665e026570d9cad1e8` and
was not repeated. The current candidate queried NaN's OpenAI-compatible model
catalogue with the operator's existing key; only model identifiers were
retained. `qwen3.8-flash` was available.

### qwen3.8-flash paired A/B

The paired set contained 26 fixed synthetic cases, run sequentially with the
same prompt, schema, context, temperature and `max_tokens: 4096`. It covered
login/recovery, forms, confusing/error states, explanations, follow-up state,
permission-like fixtures and bounded larger DOM contexts (130 elements).
Guidance was judged by a fixed offline rubric; no question, DOM, session, URL
or model output was stored. Each case ran as a single provider attempt (no
hedge) so model quality and raw latency were measured independently.

`SCHEMA_INVALID_OR_NON200` below includes non-200 calls as well as malformed or
schema-invalid output; it is not a claim that every non-200 response contained
malformed JSON.

```text
QWEN38_AVAILABLE = YES
QWEN38_AB_N = 26 paired cases per model

QWEN36:
  HTTP_200 = 25
  SCHEMA_VALID = 25
  SCHEMA_INVALID_OR_NON200 = 1
  GUIDANCE_CORRECT = 20
  GUIDANCE_UNCLEAR = 3
  TARGET_CORRECT = 20
  TIMEOUTS = 1
  OTHER_ERRORS = 0
  P50 = 2743 ms
  P95 = 14075 ms
  MAX = 15004 ms

QWEN38_FLASH:
  HTTP_200 = 22
  SCHEMA_VALID = 22
  SCHEMA_INVALID_OR_NON200 = 4
  GUIDANCE_CORRECT = 17
  GUIDANCE_UNCLEAR = 2
  TARGET_CORRECT = 17
  TIMEOUTS = 4
  OTHER_ERRORS = 0
  P50 = 6545 ms
  P95 = 15009 ms
  MAX = 15010 ms
```

`qwen3.8-flash` failed the qwen3.6 non-inferiority gate (17/26 vs 20/26
guidance-correct), had a higher schema-invalid count (4 vs 1), more timeouts
(4 vs 1) and a ~2.4x worse median (6545 ms vs 2743 ms). It was not adopted.
`MODEL_DECISION = KEEP_QWEN36`.

### Hedging upstream audit and selected design

The gRPC A6 proposal and `@fetchkit/ffetch` hedge plugin were inspected as
recorded in `docs/UPSTREAM-REUSE.md`; both were classified PATTERN_ONLY. The
candidate uses a provider-specific native adapter with the same bounded
first-success-wins semantics. It does not add an HTTP-client stack, a second
proxy, a third attempt or parallel hedging beyond the one alternate.

```text
PROVIDER_ATTEMPT_TIMEOUT_MS = 8000
PROVIDER_TOTAL_BUDGET_MS = 12000
SELECTED_HEDGE_DELAY_MS = 4000
EXPECTED_HEDGE_RATE = 10-25% target; measured 18% by the burn below
LOGICAL_DEADLINE_MS = 12000
EXTENSION_FAILSAFE_MS = 16000
MAX_PROVIDER_ATTEMPTS = 2 physical calls
MAX_OUTPUT_TOKENS = 4096
```

Attempt A starts immediately. If still pending at 4000 ms, B starts with a
fresh `AbortController`; the first successful response wins and aborts the
loser. 400/401/403/404/422, invalid model output and policy failures do not
start or continue a hedge. The global logical deadline is authoritative.

### Experiment C live hedge burn

Real NaN/qwen3.6, synthetic fixtures only, one active request, sequential
requests, balanced tiny/medium/large contexts, and a 2-second inter-call pause.
The runner retained only duration/outcome fields and an ephemeral local
request identifier; it did not retain question, DOM, session, URL, model
output, or API key data.

```text
LOGICAL_N = 100
HEDGES_LAUNCHED = 18
HEDGE_RATE = 18.0%
A_WINS = 72
B_WINS = 12
USER_VISIBLE_TIMEOUTS = 3
OTHER_FAILURES = 2
INVALID_MODEL_OUTPUT = 11
P50 = 701 ms total
P95 = 5379 ms total
MAX = 12031 ms total
```

Hedging materially reduced tail latency versus the Experiment B baseline
(P95 5379 ms vs 13891 ms; P50 701 ms vs 1361 ms) and its hedge rate of 18%
is inside the 10-25% target. Hedging targets only the slow tail, not ordinary
requests.

However the practical candidate gate was NOT met: user-visible timeouts (3)
and invalid model output (11) are both above the required zero. The invalid
outputs are model quality, not a latency artefact: the hedge does not retry
invalid structured output, and a naive "first provider response wins" can
select a schema-invalid alternate over a still-pending valid original.

```text
MODEL_DECISION = KEEP_QWEN36
HEDGE_UPSTREAM_DECISION = PATTERN_ONLY
HEDGE_DELAY_MS = 4000
LOGICAL_DEADLINE_MS = 12000
EXTENSION_FAILSAFE_MS = 16000
RELIABILITY_DECISION = EXTERNAL_PROVIDER_RELIABILITY_LIMIT
```

Per the stop rule, hedged qwen3.6 still produced recurrent visible timeouts
(3/100) and recurrent invalid model output (11/100). No third attempt, no
further model search and no additional timeout tuning was performed. This is
classified as an external provider reliability limit: the application already
preserves the user's question and presents a recoverable error. The 0/100 gate
is a bounded engineering burn, NOT proof of a zero production failure rate or
any SLA.

### Deterministic engineering contract

The hedged adapter passes the deterministic contract: fast A success never
launches B; B launches after the hedge delay with a fresh controller; A wins
and aborts B; B wins and aborts A; fatal 400/401/403/404/422 never hedge;
transient 408/409/429/5xx/network may launch the alternate; both-fail returns
one bounded final error; the global deadline aborts all pending calls; exactly
one session result is appended; no stale answer is delivered; `activeCalls`
returns correctly; and at most two upstream calls occur.

The 11% invalid-model-output in this burn reflects both model instability and
the hedge's first-provider-response-wins selection, and is documented honestly
rather than hidden behind a retry loop.
