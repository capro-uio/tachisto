# Releasing Tachisto

A release is a `v*` tag. Pushing one runs
[`.github/workflows/release.yml`](.github/workflows/release.yml), which checks the tag against the
repository, publishes the packages to npm, and opens the GitHub release that Zenodo archives.

The tag is checked, not trusted. It is refused unless:

- the tagged commit is on `main`, so a release is something that went through review;
- every workspace carries the version the tag names, and states that version in the ranges it
  gives for its siblings, written as `^X.Y.Z` — one canonical form, so a range that merely happens
  to match is still reported rather than left to be read;
- `codemeta.json`, `CITATION.cff` and `.zenodo.json` are what regenerating them for that version
  produces, because Zenodo archives whatever `.zenodo.json` says at the moment the release is
  published and that record is permanent;
- `NEWS.md` has a section for that version.

## Cutting a release

1. **Write the notes.** Rename `## Unreleased` in `NEWS.md` to `## X.Y.Z (YYYY-MM-DD)` and open a
   fresh `## Unreleased` above it. Entries should already be there; they are added as changes land.

2. **Set the version.**

   ```sh
   npm run bump -- --to X.Y.Z        # every workspace, and the ranges they state for each other
   npm install --package-lock-only   # the lockfile follows
   npm run codemeta                  # codemeta.json, CITATION.cff and .zenodo.json
   npm run versions                  # says what disagrees, if anything
   ```

   `npm version --workspaces` is not enough: it moves the versions and leaves the `^X.Y.Z` ranges
   the packages state for each other behind. On a `0.0.x` version a caret range means that exact
   version, so a half-moved bump stops npm linking the sibling on disk, sends it to the registry
   for the version before, and would publish a package depending on the release before it.

3. **Open a PR with that, and merge it green.** The `versions-agree` and `codemeta-up-to-date` jobs
   check on the PR what the release workflow will check again at the tag.

4. **Tag the merge commit and push the tag.**

   ```sh
   git switch main && git pull
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```

   Watch the run. Nothing is published until the checks pass, and the GitHub release is opened last,
   so a failed publish does not leave a release announcing packages that are not there.

5. **Check Zenodo** has picked up the new release and minted its version DOI.

## Why the workflow has two jobs

`build` installs dependencies, builds the packages and writes the release notes. `publish` takes
both as artifacts and installs nothing.

They are apart on purpose. `npm ci` runs dependencies' install scripts, and an OIDC token is a
job-scoped environment variable every child process inherits — so an install running third-party
code in the job that can mint a publishing credential would let any `postinstall` publish under
these names, with provenance saying it came from here. Trusted publishing leaves nothing stored to
steal, which also means nothing to rotate afterwards. `npm publish --ignore-scripts` keeps
`prepack` from rebuilding in a job that deliberately has no dependencies: what ships is what
`build` made.

## Rules the workflow relies on

- **A version is published once.** npm versions are immutable and Zenodo records are permanent. If a
  tag's run fails partway, fix the cause and re-run the same tag — the publish step skips what is
  already out, so it continues where it stopped. Never move a tag to a different commit: the
  packages already published came from the old one, and the release would describe a commit that
  produced only some of them. Release a new patch version instead.
- **A prerelease stays out of the way.** A version with a hyphen (`1.0.0-rc.1`) publishes to npm's
  `next` tag, not `latest`, and opens a GitHub prerelease, so `npm install tachisto` keeps
  giving people the last real release. Zenodo still archives it, so use one only when that is
  wanted.
- **Private workspaces may say `*`.** `tachisto-brand`, `tachisto-builder` and `tachisto-site`
  are never published, so a `*` range between them means "whatever this repository has". A
  published package may not: a `*` there would ship a dependency on whatever the registry holds
  next, or on a package nobody can install.

## Who may cut a release

A ruleset, **Release tags are cut by admins**, restricts `creation`, `update` and `deletion` on
`refs/tags/v*` to the admin role. A workflow cannot limit who triggers it, so this is the one
protection here that lives in the repository settings rather than in a file.

`main` still requires no review, so the tag check above proves a release points at a commit that
reached `main`, not that anyone read it. The strongest remaining option is a GitHub Environment
with required reviewers on the `publish` job, named in each package's trusted-publisher config:
npm's OIDC subject includes the environment, so a run outside it cannot mint a usable token even
if `release.yml` itself is edited.

## Publishing a package for the first time

npm's trusted publishing verifies the GitHub Actions run through an OIDC token, so no npm
credential is stored in this repository. It has to be configured per package at npmjs.com, and npm
allows that only once the package exists. A package's **first** publish is therefore done by hand:

```sh
npm login
npm run build:packages
npm publish --workspace <name>
```

A prerelease needs `--tag next`, which npm insists on rather than letting an rc become what
`npm install` gives people.

Then, at `npmjs.com/package/<name>` → Settings → Trusted publisher, choose GitHub
Actions and give it:

- repository `capro-uio/tachisto`
- workflow `release.yml`

Tick **Allow `npm publish`** as well. A trusted publisher is only allowed `npm stage publish`
otherwise, and the workflow publishes directly, so without it the run fails as though nothing were
configured.

Two things are worth knowing before doing this, because between them they cost three failed runs
on `0.0.3`:

- **The workflow filename cannot be changed afterwards.** The form accepts typing in it and the
  save appears to work, but required fields are fixed once the connection exists. A typo such as
  `releas.yml` means deleting the connection and creating a new one.
- **A mismatch reads as `E404`, not as a permission error.** npm answers an unauthorised `PUT` with
  `404 ... could not be found or you do not have permission`, so a wrong workflow name, a wrong
  repository, or an environment named here but not declared in `release.yml` all look like the
  package is missing. If `npm notice` never mentions OIDC or provenance before the error, npm found
  no trusted publisher to use.

From then on the release workflow publishes that package, and provenance is attached to it
automatically. The GitHub release is opened after publishing, so a tag can be retried once a
setting is in place: the publish step skips the packages already out.

The published packages are `tachisto-schemas`, `tachisto-compiler`, `tachisto` and
`tachisto-mcp`. `tachisto-brand`, `tachisto-builder` and `tachisto-site` are private: they
carry the version so that one release means one version everywhere, but they are never published.
