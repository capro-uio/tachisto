import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publishedWorkspaces, workspaceDirectories } from "./published.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));

describe("where the workspaces are", () => {
  // `tachisto` lives in `packages/cli`, so a name can no longer be rewritten into a path. Pinning
  // the pairs is what keeps a test that reads a manifest from reading the wrong one: a release
  // bumps every package to the same version, which hides a mix-up from any version comparison.
  it("asks each workspace where it is rather than guessing from its name", () => {
    expect(Object.fromEntries(workspaceDirectories())).toEqual({
      tachisto: "packages/cli",
      "tachisto-brand": "packages/brand",
      "tachisto-builder": "apps/builder",
      "tachisto-compiler": "packages/compiler",
      "tachisto-mcp": "packages/mcp",
      "tachisto-schemas": "packages/schemas",
      "tachisto-site": "apps/site",
    });
  });

  it("publishes the four packages and keeps the rest private", () => {
    expect(publishedWorkspaces()).toEqual([
      "tachisto",
      "tachisto-compiler",
      "tachisto-mcp",
      "tachisto-schemas",
    ]);
  });

  // The build and the typecheck catch a stale import, but nothing catches stale prose — a README
  // or llms.txt telling someone to install a package that was never published.
  it("has no reference left to the scope the packages were renamed out of", () => {
    // Assembled, so this file does not match its own search.
    const scope = `@${"tachisto"}/`;
    const found = spawnSync("git", ["grep", "-l", "--", scope], {
      cwd: root,
      encoding: "utf8",
    });
    // git grep exits 1 when nothing matches, which is what passing looks like here.
    expect(found.status, found.stderr).not.toBe(2);
    expect(found.stdout.trim()).toBe("");
  });
});
