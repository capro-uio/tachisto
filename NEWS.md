# Changes

Entries are added as changes land, so a release's notes are written by the people who made the
changes rather than reconstructed from the commit log at tag time. The release workflow takes a
version's section from this file as the body of its GitHub release, and refuses to publish a tag
this file says nothing about.

## Unreleased

- The release is cut by a workflow rather than by hand: a `v*` tag checks that every workspace
  carries the version the tag names, that the citation metadata has been regenerated for it, and
  that this file has notes for it, then publishes the packages to npm and opens the GitHub release.
  (#131)
- `@tachisto/schemas`, `@tachisto/compiler`, `@tachisto/cli` and `@tachisto/mcp` are published to
  npm, so `npx tachisto` and `npx tachisto-mcp` work without a clone.
- The repository states the Node it is developed on, so a contributor on an older one is told by
  `npm install` rather than by a confusing test failure.

## 0.0.2 (2026-10-26)

The first release under the name Tachisto, and the first Zenodo archives, so a methods section can
name the exact Tachisto that built an experiment. More kinds of question and task, counterbalancing
and branching, figures for a paper, and saving to DataPipe as a study runs.

Full notes: <https://github.com/capro-uio/tachisto/releases/tag/v0.0.2>

## 0.0.1 (2026-10-16)

The first release, as jsPsych Studio: a browser builder that exports readable jsPsych.

Full notes: <https://github.com/capro-uio/tachisto/releases/tag/v0.0.1>
