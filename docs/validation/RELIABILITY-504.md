# Assist reliability closure — post-G1 candidate

This evidence applies only to the post-G1 candidate. The frozen
`v0.0.9-p0-g1-baseline` tag remains immutable and was not used for candidate
changes.

## Pre-change baseline

Measured before source changes against real NaN/qwen3.6 with sequential,
synthetic, protocol-valid fixture snapshots only. No question, DOM, session,
URL or provider response content was recorded.

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
bound before provider invocation; it was excluded and replaced with a
130-element protocol-valid fixture.

## Candidate policy

```text
PROVIDER_ATTEMPT_TIMEOUT_MS = 15000
PROVIDER_TOTAL_BUDGET_MS = 18000
EXTENSION_FAILSAFE_MS = 20000
MAX_PROVIDER_ATTEMPTS = 2
MAX_OUTPUT_TOKENS = 4096
```

Only connection failures, 408, 409, 429, 5xx and an attempt timeout are
retryable. Retry-After is used only when it fits the remaining total budget.
Every attempt receives a fresh AbortController. The extension owns one
logical operation; it does not add a second automatic retry.

The initial 512-token evaluation was not viable for qwen3.6: controlled
comparisons showed no final assistant content at 512, 768, 1024 and often
2048 (the response ended with reasoning content and `finish_reason=length`).
4096 was the smallest tested bound with complete structured JSON and remains
an explicit finite output cap.

## Candidate burn

Required run: approximately 40 sequential real-NaN/qwen3.6 calls using only
balanced tiny, medium and bounded-large synthetic contexts. Record only
attempt number, fixture class, provider duration, total duration, HTTP outcome
and timeout/recovery classification.

```text
CANDIDATE_N = 40
CANDIDATE_TIMEOUTS = 2
CANDIDATE_TIMEOUT_RATE = 5.0%
CANDIDATE_RECOVERED_RETRIES = 5
CANDIDATE_RETRY_RECOVERY_RATE = 12.5% (5/40)
CANDIDATE_FINAL_FAILURES = 2
CANDIDATE_P50 = 4221 ms total
CANDIDATE_P95 = 17453 ms total
CANDIDATE_MAX = 18014 ms total
USER_VISIBLE_PROVIDER_TIMEOUTS = 2
RELEASE_GATE = FAIL
```

The final selected candidate run used 40 sequential calls, balanced across
the three fixture classes, with a 2000 ms inter-call pause. It returned 38
HTTP 200 responses, 2 final HTTP 504 timeouts, and no other final failures;
5 requests recovered on their internal second attempt. The two 504s remain
user-visible failures, so the primary release gate is **not passed**.

The following bounded experiments were also run before selecting the 15000 /
18000 allocation:

| Allocation | N | Timeouts | Recovered | Final failures | P50 | P95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8000 / 17000 | 40 | 3 | 1 | 5 | 682 ms | 16144 ms | 16226 ms |
| 12000 / 18000 | 10 | 1 | 0 | 2 | 4142 ms | 18005 ms | 18005 ms |
| 15000 / 18000 | 12 | 0 | 1 | 0 | 1756 ms | 16900 ms | 16900 ms |
| 15000 / 18000 | 40 | 2 | 5 | 2 | 4221 ms | 17453 ms | 18014 ms |
| 18000 / 18000 | 40 | 4 | 0 | 6 | 1867 ms | 18006 ms | 18007 ms |

The 18000 / 18000 run was rejected despite its longer single-attempt
allocation. Recurrent final timeouts therefore remain an unresolved provider
reliability gate; they are not justification for another blind timeout
increase.

Because the bounded retry/output fix did not produce zero final timeouts, a
current-model A/B was performed with the same fixtures, prompt and schema:

| Model | N | Success | Timeouts | Guidance correct | Guidance unclear | Invalid output | P50 | P95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| qwen3.6 | 12 | 11 | 1 | 10 | 1 | 0 | 1938 ms | 18011 ms |
| deepseek-v4-flash | 12 | 11 | 1 | 4 | 7 | 0 | 5124 ms | 18011 ms |
| mimo-v2.5 | 12 | 11 | 1 | 4 | 7 | 0 | 6063 ms | 18006 ms |

No alternative was demonstrably non-inferior in guidance and materially more
reliable. qwen3.6 remains the default. The candidate is therefore a bounded
engineering mitigation, not a release-passing reliability closure.
