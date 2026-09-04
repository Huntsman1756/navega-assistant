# Security Policy

## Supported versions

Only the latest `main` is supported. P0 is an **experimental
product-validation prototype** and is not recommended for sensitive flows.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for a vulnerability. Report
privately to the maintainers.

In your report, please describe:

- the asset affected;
- the threat/attack path;
- a minimal reproduction;
- the affected version/commit;
- your suggested mitigation.

You can open a private Security Advisory in the repository’s “Security” tab.

## What we consider security-sensitive

- secret leakage (password, OTP, CVV, tokens, recovery codes)
- prompt injection that produces dangerous guidance
- unauthorized browsing-history access
- trusted-contact privacy bypass
- provider-key exposure
- extension permission escalation
- unsafe future browser actions (autonomous click/type/submit)

## Responsible disclosure

We ask that you coordinate with us before any public disclosure. We will
respond and work toward a fix as soon as possible. Please give us a reasonable
timeframe before disclosure.
