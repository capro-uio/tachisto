# Risk Tiers

Risk is a property of the diff, not of how confident the author feels. Classify by what the change
touches, then apply the matching gate.

The asymmetry that sets these tiers: npm versions are immutable and unpublishable after 72 hours,
and Zenodo records are permanent. Everything else here can be fixed forward.

## T0 — merge on green CI

Documentation and comments, tests only, internal refactors with no behaviour change, dev-dependency
bumps, builder styling with no change to what a study compiles to.

**Gate:** CI green. One correctness reviewer.

## T1 — green CI plus a deliberate read

New builder behaviour, internal logic changes, a new spec field with a safe default, new tests for
existing behaviour, CI workflow edits that remove no check.

**Gate:** CI green, full `pre-merge-review` fan-out, and read the diff yourself once with the PR
description closed. If you cannot say what it does from the diff alone, it wants better naming or a
comment before it merges.

## T2 — green CI, a deliberate read, and a written revert path

- Anything that changes what a compiled study contains, or what its data says produced it
- The spec format, or what a published package exports
- `.github/workflows/release.yml`, or any manifest field npm reads
- Release commits and version bumps
- Removing or weakening a CI check

**Gate:** everything in T1, plus:

- A revert path written in the PR, and for anything reaching npm, the honest version: a published
  version cannot be withdrawn, so the way back is a new release
- For generated output, a compiled example before and after in the PR, so the change to what
  researchers receive is visible rather than described
- Prefer proving it on a prerelease (`vX.Y.Z-rc.N`, which publishes to `next` and never becomes
  what `npm install` gives people) before the release that people get

## Always T2 regardless of size

`.github/workflows/release.yml`, `packages/*/package.json`, `packages/compiler/src/targets/`,
`packages/compiler/src/metadata.ts`, `packages/compiler/src/types.ts`, `codemeta.json`.

## Solo-maintainer note

With no second human, the T1/T2 deliberate read is the only human layer there is. Read the diff
cold — a different day, or at least after the agents have reported — so you are reading the code
rather than remembering what you meant.
