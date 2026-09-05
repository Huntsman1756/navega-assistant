# Gitleaks evaluation ? PRE-P01 security closure

Evaluated 2026-09-05: https://github.com/gitleaks/gitleaks . CLI license: MIT
(https://github.com/gitleaks/gitleaks/blob/v8.30.1/LICENSE).
GitHub latest release API returned **v8.30.1**, published 2026-03-21;
latest repository commit observed: b58d3f102cf3a2c84cb7f923d05c25c9b1aed84b,
2026-07-22. Release and commit activity indicate ongoing maintenance.
Sources: https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1 and
https://api.github.com/repos/gitleaks/gitleaks/releases/latest .

Temporary evaluation used the upstream Windows x64 release archive, SHA-256
`d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e`,
verified against upstream checksums before execution. No runtime dependency,
installation in the project, action, or provider call was added.
If adopted later, pin that exact version plus archive digest per platform;
Linux x64 upstream archive digest:
`551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb`.
Do not execute an unverified rolling binary or require the licensed hosted action.

`node --test scripts/git-secret-scan.test.mjs` constructs temporary Git repositories.
Set `GITLEAKS_BINARY` to an already integrity-verified CLI to repeat the comparison.
The evaluation invokes `git --redact=100 --log-opts=--all` and tests exit status
and absence of the synthetic credential in stdout/stderr.

| Fixture | Repaired project scanner | Gitleaks 8.30.1 |
|---|---|---|
| Synthetic GitHub-format token introduced then removed | detected | detected |
| Exact safe placeholder | accepted | accepted |
| Synthetic actual-looking token in .env.example | detected | detected |
| Shallow clone claiming complete history | explicit failure | project preflight required |

Repository comparison reported four generic-api-key findings: three in the new
synthetic outbound regression and one in participant/privacy prose. Readback
confirmed synthetic test data or ordinary prose; no additional confirmed secret
was identified by this evaluation. Reports used full redaction.

**Decision: retain the repaired project scanner for this bounded closure.**
Gitleaks offers broader maintained detectors, but the required fixtures have equal
outcomes here and replacement adds binary distribution/pinning and false-positive
policy without an observed additional confirmed finding. That does not establish
that the tools have equal general recall. Re-evaluate if coverage needs broaden.

History means blobs reachable from all locally available refs, not deleted remote
refs or unreachable objects. CI checks out full history (`fetch-depth: 0`), and
the scanner refuses shallow repositories. Value scanning includes `.env.example`;
only the exact documented dummy values `sk-your-nan-builders-key` and
`synthetic-only` in AI_API_KEY assignments are accepted. Environment filenames
are checked separately across historical paths. No tool proves universal absence
of secrets. No new OSS was adopted, so upstream-reuse/notices need no new entry.
