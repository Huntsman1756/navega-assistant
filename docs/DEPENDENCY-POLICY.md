# Dependency policy

## Why workspace overrides exist

The root `package.json` declares a `pnpm.overrides` policy:

```json
"pnpm": {
  "overrides": {
    "vite": "^6.4.3",
    "esbuild": "^0.25.0"
  }
}
```

These are **supply-chain** constraints. They exist for two reasons:

1. **Advisory-fixed versions only.** There was a set of Dependabot advisories
   with `first_patched_version` values of `vite ≥ 6.4.3` and `esbuild ≥ 0.25.0`
   (all were dev/build tooling, never shipped in the runtime bundles). Pinning
   to the patched lines keeps the whole tree, including transitive tooling, on
   fixed versions.

2. **Transitive drift.** `vite` is a transitive dependency of `vitest`, and
   `esbuild` is used by both our build scripts and `vite`. `pnpm.overrides`
   applies to the entire tree, so these two packages are guaranteed to resolve
   to the patched versions regardless of which package asks for them. This is
   why the lockfile may show a version that does not exactly match a direct
   manifest declaration.

## Version alignment

- Direct `esbuild` devDependencies are declared as `^0.25.0` so the manifest and
  the override policy agree.
- `vite` is never declared directly; it is transitively resolved and pinned by
  the override to `^6.4.3`.

## Rationale for keeping the override even when the manifest already matches

Without the `esbuild` override, a transitive dependency (e.g. `vite`) that
declares `esbuild ^0.24.x` could pull a vulnerable version. The override keeps
every `esbuild` in the tree at or above the patched version.

## Tooling-only scope

None of these advisories affect the published runtime bundles. The extension
and API are bundled at build time; `vite`/`vitest`/`happy-dom`/`esbuild` are
development/build-time tools. This is documented so readers understand the
override is a safe-hardening measure, not a sign of a runtime issue.
