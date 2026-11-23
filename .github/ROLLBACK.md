# Rollback

What "undo" means depends on how far a change has travelled. The further down this page, the less
of it is reversible.

## Not yet merged

Close the PR, or `git revert` on the branch. Nothing external has happened.

## Merged to main, not tagged

`git revert <sha>` and merge it. The website redeploys from `main` on every push, so a revert also
restores the deployed builder within a run.

Today's merge is the unit to revert — PRs squash, so one commit is one change.

## Tagged, but the release run failed before publishing

Nothing is on npm and no GitHub release exists: the release is opened only after all four packages
publish. Fix the cause and re-run the same tag — the publish step skips anything already out, so it
continues where it stopped.

Never move a tag to a different commit. Any package already published came from the old one, and
the release would then describe a commit that produced only some of it.

## Published to npm

**There is no rollback.** A version is immutable, and unpublishable at all after 72 hours.

- Wrong but harmless: release the fix as the next patch. Leave the bad version in place.
- Actively harmful: `npm deprecate tachisto@X.Y.Z "<why, and what to use instead>"`, which warns on
  install without breaking anyone pinned to it, then release the fix.
- `npm unpublish` is a last resort inside 72 hours, and breaks anyone who already installed it.

## Archived on Zenodo

The DOI and its record are permanent by design — that is the point of an archive. A later release
gets its own DOI; the concept DOI follows the newest. A superseded version cannot be withdrawn, so
if a release must be disowned, say so in the notes of the one that replaces it.
