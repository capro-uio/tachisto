# Review Guidance

Read by every automated and human review of this repository. It defines what counts as a failure
here — findings outside it are noise.

## What this is

A no-code builder for jsPsych experiments: researchers author a study in the browser and export
readable jsPsych they host themselves. Four packages are published to npm (`tachisto`,
`tachisto-mcp`, `tachisto-compiler`, `tachisto-schemas`); the builder and website are private.

What breaking it costs: a study that compiles wrong does not crash, it collects the wrong data,
and nobody finds out until analysis. npm versions are immutable and Zenodo records are permanent,
so a bad release cannot be withdrawn — only followed by another.

## What counts as a failure

Report these as **Important**:

- A spec that compiles to an experiment which does not match it — wrong trial order, a condition
  silently dropped, a parameter not reaching the plugin
- Data that arrives wrong rather than absent: a missing or misnamed column, an exclusion or
  counterbalance that records something other than what ran
- Provenance that misstates what produced a dataset — `dataset_description.json`, the source
  header, the generator meta tag
- A change to the spec format, or to what a published package exports, with no migration for
  specs and installs that already exist
- A published package's `^x.y.z` range for a sibling left behind, which ships a package depending
  on the previous release
- Anything that lets the release workflow publish in the wrong order, publish a private workspace,
  or publish without the checks the tag is supposed to prove
- New behaviour or a new branch with no test exercising it, and tests that would pass if the code
  they name were deleted

## What is not a failure

- Style, naming, formatting — prettier and eslint own those and run in CI
- Anything the CI jobs already prove: types, lint, generated metadata freshness, version
  agreement, release notes, workflow syntax
- Hypotheticals with no input that triggers them
- Performance opinions with no measurement on a realistic spec
- Pre-existing issues outside the diff, unless the diff makes them materially worse — tag those
  `Pre-existing`, one line each

## Evidence standard

Every finding cites `file:line` and a concrete failure scenario: specific spec or state → specific
wrong output. A claim that cannot be anchored to a line is not a finding.

For a test, the question is what would have to break for it to fail. If the answer is "nothing" —
it asserts a literal, or compares a mock to itself — that is a coverage finding, not a nit.

## Nit budget

At most **3** per review. If there are more, keep the three that matter and drop the rest.

## Paths to skip

- `dist/`, `dist-pages/`, `coverage/` — build output
- `package-lock.json` — regenerated, and reviewed only for what it reveals about a manifest change
- `*.e2e.html` — test artifacts
- `codemeta.json`, `CITATION.cff`, `.zenodo.json` — generated; CI fails if they are stale
- `packages/schemas/plugin-schemas.json`, `packages/compiler/spec-schema.json` — extracted, and
  checked fresh in CI

## Paths that always get full depth

However small the diff looks:

- `.github/workflows/release.yml` — it publishes irreversibly
- `packages/*/package.json` — names, versions, `files`, `private`, `publishConfig`, sibling ranges
- `packages/compiler/src/targets/` — what a compiled study actually contains
- `packages/compiler/src/metadata.ts` — what a dataset says produced it
- `packages/compiler/src/types.ts` and the spec schema it describes
