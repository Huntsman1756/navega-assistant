# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Status
- P0 prototype implementation complete.
- Human product validation pending. This is an experimental prerelease
  (`0.0.1-p0`).

### Added
- P0 product-validation prototype: Guided Web Assistant

### Highlights
- MV3 Chromium extension (Side Panel) with least-privilege permissions
  (`activeTab`, `scripting`, `storage`, `sidePanel`)
- On-demand, sanitized, DOM-derived `AccessibleDOMSnapshot` extraction
- Strict, versioned shared schemas
- Provider abstraction with `mock` and `openai-compatible` providers
  (nan.builders configurable through the OpenAI-compatible interface)
- Self-hostable backend with strict validation, instruction safety and
  conversation-simplicity checks
- Deterministic fixture pages (login, recovery, product, admin form, SPA,
  prompt-injection)
- Unit, schema, sanitization, policy, integration, security and browser E2E tests
- Open-source repository metadata and CI

### Intentionally not implemented (P0)
- autonomous continuation, automatic highlighting, voice, trusted contact,
  automatic vision routing, target resolution, MutationObserver-driven diffs
