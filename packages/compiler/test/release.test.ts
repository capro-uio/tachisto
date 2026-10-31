import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  askedVersion,
  bumpedManifests,
  internalRange,
  optionValue,
  publishedWorkspaces,
  releaseNotes,
  versionDisagreements,
  versionFromTag,
  workspaceDirectories,
  workspaceVersions,
  type InternalRange,
  type WorkspaceVersion,
} from "../scripts/release.ts";

function workspace(
  name: string,
  directory: string,
  version?: string,
  internal: InternalRange[] = [],
  isPrivate = false,
): WorkspaceVersion {
  return { name, directory, version, private: isPrivate, internal };
}

function dependency(name: string, range: string): InternalRange {
  return { field: "dependencies", name, range };
}

function repository(patterns: string[], manifests: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "tachisto-release-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: patterns }));
  for (const [directory, manifest] of Object.entries(manifests)) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return root;
}

describe("workspaceDirectories", () => {
  let root: string;

  beforeEach(() => {
    root = repository(["packages/*"], {
      "packages/schemas": {},
      "packages/compiler": {},
      "apps/site": {},
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("expands a trailing star into the directories under it", () => {
    expect(workspaceDirectories(root, ["packages/*", "apps/*"])).toEqual([
      "apps/site",
      "packages/compiler",
      "packages/schemas",
    ]);
  });

  it("passes a pattern without a star through as the one directory it names", () => {
    expect(workspaceDirectories(root, ["apps/site"])).toEqual(["apps/site"]);
  });

  it("skips a directory that holds no package.json, such as a stray build folder", () => {
    mkdirSync(join(root, "packages/coverage"));
    expect(workspaceDirectories(root, ["packages/*"])).toEqual([
      "packages/compiler",
      "packages/schemas",
    ]);
  });

  it("says nothing of a pattern whose parent does not exist", () => {
    expect(workspaceDirectories(root, ["nowhere/*"])).toEqual([]);
  });

  it("ignores a negated pattern rather than taking it for a directory of that name", () => {
    expect(workspaceDirectories(root, ["packages/*", "!packages/schemas"])).toEqual([
      "packages/compiler",
      "packages/schemas",
    ]);
  });
});

describe("workspaceVersions", () => {
  let root: string;

  beforeEach(() => {
    root = repository(["packages/*"], {
      "packages/schemas": { name: "@tachisto/schemas", version: "0.0.3" },
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("reads each workspace's name, version and whether it is published", () => {
    expect(workspaceVersions(root)).toEqual([
      {
        name: "@tachisto/schemas",
        directory: "packages/schemas",
        version: "0.0.3",
        private: false,
        internal: [],
      },
    ]);
  });

  it("includes a private workspace, which a release stamps too", () => {
    mkdirSync(join(root, "packages/brand"));
    writeFileSync(
      join(root, "packages/brand/package.json"),
      JSON.stringify({ name: "@tachisto/brand", private: true, version: "0.0.3" }),
    );
    expect(workspaceVersions(root).map((found) => [found.name, found.private])).toEqual([
      ["@tachisto/brand", true],
      ["@tachisto/schemas", false],
    ]);
  });

  it("finds nothing when the repository declares no workspaces", () => {
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "tachisto" }));
    expect(workspaceVersions(root)).toEqual([]);
  });

  it("names a declared workspace that holds no manifest by its directory", () => {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ workspaces: ["packages/schemas", "packages/gone"] }),
    );
    expect(workspaceVersions(root).map((found) => [found.name, found.version])).toEqual([
      ["packages/gone", undefined],
      ["@tachisto/schemas", "0.0.3"],
    ]);
  });

  it("says where it looked when there is no repository manifest", () => {
    const empty = mkdtempSync(join(tmpdir(), "tachisto-release-"));
    expect(() => workspaceVersions(empty)).toThrow(empty);
    rmSync(empty, { recursive: true, force: true });
  });
});

describe("workspaceVersions, on the ranges workspaces state for each other", () => {
  let root: string;

  beforeEach(() => {
    root = repository(["packages/*"], {
      "packages/schemas": { name: "@tachisto/schemas", version: "0.0.2" },
      "packages/compiler": { name: "@tachisto/compiler", version: "0.0.2" },
      "packages/mcp": {
        name: "@tachisto/mcp",
        version: "0.0.2",
        dependencies: { "@tachisto/schemas": "^0.0.2", zod: "^4.6.7" },
        devDependencies: { "@tachisto/compiler": "^0.0.2" },
        peerDependencies: { "@tachisto/schemas": "^0.0.2" },
        optionalDependencies: { "@tachisto/compiler": "^0.0.2" },
      },
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const mcp = () => workspaceVersions(root).find((found) => found.name === "@tachisto/mcp")!;

  it("records a sibling's range from every dependency field, and ignores outside packages", () => {
    expect(mcp().internal).toEqual([
      { field: "dependencies", name: "@tachisto/schemas", range: "^0.0.2" },
      { field: "devDependencies", name: "@tachisto/compiler", range: "^0.0.2" },
      { field: "peerDependencies", name: "@tachisto/schemas", range: "^0.0.2" },
      { field: "optionalDependencies", name: "@tachisto/compiler", range: "^0.0.2" },
    ]);
  });

  it("keeps the same sibling named in two fields, so neither hides the other", () => {
    const schemas = mcp().internal.filter((range) => range.name === "@tachisto/schemas");
    expect(schemas.map((range) => range.field)).toEqual(["dependencies", "peerDependencies"]);
  });

  it("is silent when the ranges name the version being released", () => {
    expect(versionDisagreements(workspaceVersions(root), "0.0.2")).toEqual([]);
  });

  it("names every range left at the version before, field by field", () => {
    expect(versionDisagreements(workspaceVersions(root), "0.0.3")).toEqual([
      "packages/compiler/package.json: @tachisto/compiler is 0.0.2, not 0.0.3",
      "packages/mcp/package.json: @tachisto/mcp is 0.0.2, not 0.0.3",
      "packages/schemas/package.json: @tachisto/schemas is 0.0.2, not 0.0.3",
      "packages/mcp/package.json: @tachisto/mcp names @tachisto/schemas ^0.0.2 in dependencies, not ^0.0.3",
      "packages/mcp/package.json: @tachisto/mcp names @tachisto/compiler ^0.0.2 in devDependencies, not ^0.0.3",
      "packages/mcp/package.json: @tachisto/mcp names @tachisto/schemas ^0.0.2 in peerDependencies, not ^0.0.3",
      "packages/mcp/package.json: @tachisto/mcp names @tachisto/compiler ^0.0.2 in optionalDependencies, not ^0.0.3",
    ]);
  });

  it("catches a stale range hiding behind a star in another field", () => {
    const manifest = JSON.parse(
      readFileSync(join(root, "packages/mcp/package.json"), "utf8"),
    ) as Record<string, Record<string, string>>;
    manifest.peerDependencies = { "@tachisto/schemas": "*" };
    manifest.dependencies = { "@tachisto/schemas": "^0.0.2" };
    writeFileSync(join(root, "packages/mcp/package.json"), JSON.stringify(manifest));
    expect(versionDisagreements(workspaceVersions(root), "0.0.2")).toEqual([
      "packages/mcp/package.json: @tachisto/mcp names @tachisto/schemas * in peerDependencies, not ^0.0.2",
    ]);
  });
});

describe("versionDisagreements", () => {
  it("is silent when every workspace carries the same version", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/compiler", "packages/compiler", "0.0.3"),
      ]),
    ).toEqual([]);
  });

  it("names the workspace left behind by a partial bump, and the file to edit", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/compiler", "packages/compiler", "0.0.3"),
        workspace("@tachisto/mcp", "packages/mcp", "0.0.2"),
      ]),
    ).toEqual(["packages/mcp/package.json: @tachisto/mcp is 0.0.2, not 0.0.3"]);
  });

  it("holds every workspace to the version a release says, not to each other", () => {
    expect(
      versionDisagreements(
        [
          workspace("@tachisto/schemas", "packages/schemas", "0.0.2"),
          workspace("@tachisto/compiler", "packages/compiler", "0.0.2"),
        ],
        "0.0.3",
      ),
    ).toEqual([
      "packages/schemas/package.json: @tachisto/schemas is 0.0.2, not 0.0.3",
      "packages/compiler/package.json: @tachisto/compiler is 0.0.2, not 0.0.3",
    ]);
  });

  it("is silent when every workspace already matches the version a release says", () => {
    expect(
      versionDisagreements([workspace("@tachisto/schemas", "packages/schemas", "0.0.3")], "0.0.3"),
    ).toEqual([]);
  });

  it("reports a workspace whose manifest states no version at all", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/brand", "packages/brand"),
      ]),
    ).toEqual(["packages/brand/package.json: @tachisto/brand carries no version"]);
  });

  it("blames only the workspaces that lack a version, not the ones that have it", () => {
    // Leaving `version` out of a workspace nobody installs is ordinary npm practice, and must not
    // make the majority look wrong just by outnumbering them.
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/site", "apps/site", undefined, [], true),
        workspace("@tachisto/builder", "apps/builder", undefined, [], true),
        workspace("@tachisto/brand", "packages/brand", undefined, [], true),
      ]),
    ).toEqual([
      "apps/site/package.json: @tachisto/site carries no version",
      "apps/builder/package.json: @tachisto/builder carries no version",
      "packages/brand/package.json: @tachisto/brand carries no version",
    ]);
  });

  it("reports every workspace when none states a version and no release says what it is", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas"),
        workspace("@tachisto/brand", "packages/brand"),
      ]),
    ).toEqual([
      "packages/schemas/package.json: @tachisto/schemas carries no version",
      "packages/brand/package.json: @tachisto/brand carries no version",
    ]);
  });

  it("does not call an empty repository a release", () => {
    expect(versionDisagreements([])).toEqual(["no workspaces found"]);
  });

  it("leaves a star alone in a workspace nobody installs", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/brand", "packages/brand", "0.0.3", [], true),
        workspace(
          "@tachisto/site",
          "apps/site",
          "0.0.3",
          [dependency("@tachisto/brand", "*")],
          true,
        ),
      ]),
    ).toEqual([]);
  });

  it("refuses a star in a published workspace, which would ship an unpinned dependency", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/cli", "packages/cli", "0.0.3", [dependency("@tachisto/schemas", "*")]),
      ]),
    ).toEqual([
      "packages/cli/package.json: @tachisto/cli names @tachisto/schemas * in dependencies, not ^0.0.3",
    ]);
  });

  it("holds a range to the version even when every version itself agrees", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/cli", "packages/cli", "0.0.3", [
          dependency("@tachisto/schemas", "^0.0.2"),
        ]),
      ]),
    ).toEqual([
      "packages/cli/package.json: @tachisto/cli names @tachisto/schemas ^0.0.2 in dependencies, not ^0.0.3",
    ]);
  });

  it("asks for the one canonical form, so an exact pin is named too", () => {
    expect(
      versionDisagreements([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/cli", "packages/cli", "0.0.3", [
          dependency("@tachisto/schemas", "0.0.3"),
        ]),
      ]),
    ).toEqual([
      "packages/cli/package.json: @tachisto/cli names @tachisto/schemas 0.0.3 in dependencies, not ^0.0.3",
    ]);
  });
});

describe("internalRange", () => {
  it("is the caret range for the version released", () => {
    expect(internalRange("0.0.3")).toBe("^0.0.3");
  });
});

describe("versionFromTag", () => {
  it("takes the version out of a release tag", () => {
    expect(versionFromTag("v0.0.3")).toBe("0.0.3");
  });

  it("keeps a prerelease suffix", () => {
    expect(versionFromTag("v1.0.0-rc.1")).toBe("1.0.0-rc.1");
  });

  it("refuses a tag that names no version", () => {
    expect(() => versionFromTag("latest")).toThrow("not a release tag");
    expect(() => versionFromTag("0.0.3")).toThrow("not a release tag");
    expect(() => versionFromTag("v0.0")).toThrow("not a release tag");
  });

  it("refuses a leading zero, which npm would refuse later with the tree already rewritten", () => {
    expect(() => versionFromTag("v1.02.3")).toThrow("not a release tag");
    expect(() => versionFromTag("v01.2.3")).toThrow("not a release tag");
  });
});

describe("optionValue", () => {
  it("reads a value written after a space", () => {
    expect(optionValue(["versions", "--tag", "v0.0.3"], "tag")).toBe("v0.0.3");
  });

  it("reads a value written with an equals sign", () => {
    expect(optionValue(["versions", "--tag=v0.0.3"], "tag")).toBe("v0.0.3");
  });

  it("is undefined only when the flag is absent", () => {
    expect(optionValue(["versions"], "tag")).toBeUndefined();
  });

  it("refuses a flag given with no value, rather than reading as though it were absent", () => {
    expect(() => optionValue(["versions", "--tag"], "tag")).toThrow("--tag needs a value");
    expect(() => optionValue(["versions", "--tag="], "tag")).toThrow("--tag needs a value");
    expect(() => optionValue(["versions", "--tag", "--expect", "0.0.3"], "tag")).toThrow(
      "--tag needs a value",
    );
  });
});

describe("askedVersion", () => {
  it("takes the version from a tag", () => {
    expect(askedVersion(["versions", "--tag", "v0.0.3"])).toBe("0.0.3");
  });

  it("takes a version given outright", () => {
    expect(askedVersion(["notes", "--version", "0.0.3"])).toBe("0.0.3");
    expect(askedVersion(["versions", "--expect", "0.0.3"])).toBe("0.0.3");
  });

  it("lets a tag win over a version given outright", () => {
    expect(askedVersion(["versions", "--tag", "v0.0.3", "--version", "9.9.9"])).toBe("0.0.3");
  });

  it("is undefined when nothing names a version", () => {
    expect(askedVersion(["versions"])).toBeUndefined();
  });

  it("refuses a tag that names no version, rather than checking nothing", () => {
    expect(() => askedVersion(["versions", "--tag", "latest"])).toThrow("not a release tag");
  });

  it("refuses a flag with no value, which would quietly check nothing at all", () => {
    expect(() => askedVersion(["versions", "--tag"])).toThrow("--tag needs a value");
    expect(() => askedVersion(["versions", "--expect"])).toThrow("--expect needs a value");
  });
});

describe("releaseNotes", () => {
  const news = [
    "# Changes",
    "",
    "## Unreleased",
    "",
    "- something not out yet",
    "",
    "## 0.0.3 (2026-11-01)",
    "",
    "What this release does.",
    "",
    "### Fixes",
    "",
    "- a fix",
    "",
    "## 0.0.2 (2026-10-26)",
    "",
    "The first release under the name Tachisto.",
    "",
  ].join("\n");

  it("takes one version's section, down to the next version's heading", () => {
    expect(releaseNotes(news, "0.0.3")).toBe("What this release does.\n\n### Fixes\n\n- a fix");
  });

  it("reads the last section to the end of the file", () => {
    expect(releaseNotes(news, "0.0.2")).toBe("The first release under the name Tachisto.");
  });

  it("does not mistake the unreleased section for a version", () => {
    expect(() => releaseNotes(news, "Unreleased")).toThrow("no section for Unreleased");
  });

  it("accepts a heading that writes the version with a v", () => {
    expect(releaseNotes("## v0.0.3\n\nnotes\n", "0.0.3")).toBe("notes");
  });

  it("accepts a heading that says more after the version", () => {
    expect(releaseNotes("## 0.0.3: the big one\n\nnotes\n", "0.0.3")).toBe("notes");
    expect(releaseNotes("## 0.0.3 (2026-11-01)\n\nnotes\n", "0.0.3")).toBe("notes");
  });

  it("tells one version from another that starts the same way", () => {
    const both = "## 0.0.30\n\nthirty\n\n## 0.0.3\n\nthree\n";
    expect(releaseNotes(both, "0.0.3")).toBe("three");
    expect(releaseNotes(both, "0.0.30")).toBe("thirty");
  });

  it("refuses a version the file says nothing about, rather than releasing without notes", () => {
    expect(() => releaseNotes(news, "0.0.4")).toThrow("NEWS.md has no section for 0.0.4");
  });

  it("refuses a heading with an empty section under it", () => {
    expect(() => releaseNotes("## 0.0.3\n\n## 0.0.2\n\nnotes\n", "0.0.3")).toThrow(
      "says nothing under 0.0.3",
    );
  });

  it("ends a section at a top-level heading, so a footer is not read as notes", () => {
    const withFooter = "## 0.0.3\n\n- entry\n\n# Older releases\n\nelsewhere\n";
    expect(releaseNotes(withFooter, "0.0.3")).toBe("- entry");
  });

  it("reads a heading inside a fenced block as text, so an entry may quote one", () => {
    const quoting = [
      "## 0.0.3",
      "",
      "Write the heading like this:",
      "",
      "```md",
      "## 0.0.4",
      "```",
      "",
      "- a real entry",
      "",
      "## 0.0.2",
      "",
      "older",
      "",
    ].join("\n");
    expect(releaseNotes(quoting, "0.0.3")).toBe(
      "Write the heading like this:\n\n```md\n## 0.0.4\n```\n\n- a real entry",
    );
  });

  it("does not take a version heading inside a fenced block for a section of its own", () => {
    const quoting = ["## 0.0.3", "", "```md", "## 0.0.4", "```", "", "- entry", ""].join("\n");
    expect(() => releaseNotes(quoting, "0.0.4")).toThrow("no section for 0.0.4");
  });
});

describe("bumpedManifests", () => {
  let root: string;

  beforeEach(() => {
    root = repository(["packages/*", "apps/*"], {
      "packages/schemas": { name: "@tachisto/schemas", version: "0.0.2" },
      "packages/brand": { name: "@tachisto/brand", private: true, version: "0.0.2" },
      "packages/cli": {
        name: "@tachisto/cli",
        version: "0.0.2",
        dependencies: { "@tachisto/schemas": "^0.0.2", commander: "^12.0.0" },
        peerDependencies: { "@tachisto/schemas": "^0.0.2" },
      },
      "apps/site": {
        name: "@tachisto/site",
        private: true,
        version: "0.0.2",
        dependencies: { "@tachisto/brand": "*" },
      },
    });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function bumped(version: string) {
    return new Map(
      [...bumpedManifests(root, version)].map(([path, text]) => [
        path.slice(root.length + 1),
        JSON.parse(text) as Record<string, Record<string, string>>,
      ]),
    );
  }

  it("sets the version in every workspace, private ones included", () => {
    expect([...bumped("0.0.3")].map(([path, manifest]) => [path, manifest.version])).toEqual([
      ["apps/site/package.json", "0.0.3"],
      ["packages/brand/package.json", "0.0.3"],
      ["packages/cli/package.json", "0.0.3"],
      ["packages/schemas/package.json", "0.0.3"],
    ]);
  });

  it("moves a sibling's range with the version, and leaves outside packages alone", () => {
    expect(bumped("0.0.3").get("packages/cli/package.json")?.dependencies).toEqual({
      "@tachisto/schemas": "^0.0.3",
      commander: "^12.0.0",
    });
  });

  it("moves a sibling's range in every field it is stated in", () => {
    expect(bumped("0.0.3").get("packages/cli/package.json")?.peerDependencies).toEqual({
      "@tachisto/schemas": "^0.0.3",
    });
  });

  it("leaves a star where a workspace nobody installs states it", () => {
    expect(bumped("0.0.3").get("apps/site/package.json")?.dependencies).toEqual({
      "@tachisto/brand": "*",
    });
  });

  it("writes nothing itself, so a bump can be inspected before it happens", () => {
    bumpedManifests(root, "9.9.9");
    const onDisk = JSON.parse(
      readFileSync(join(root, "packages/cli/package.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(onDisk.version).toBe("0.0.2");
  });
});

describe("publishedWorkspaces", () => {
  it("is the workspaces that are not private", () => {
    expect(
      publishedWorkspaces([
        workspace("@tachisto/schemas", "packages/schemas", "0.0.3"),
        workspace("@tachisto/brand", "packages/brand", "0.0.3", [], true),
      ]),
    ).toEqual(["@tachisto/schemas"]);
  });

  it("is what the release workflow publishes, so the two cannot drift apart", () => {
    const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
    const workflow = readFileSync(join(repositoryRoot, ".github/workflows/release.yml"), "utf8");
    const loop = /for package in ([^;\n]+); do/.exec(workflow);
    expect(loop, "the publish loop in release.yml").not.toBeNull();
    const published = loop![1]
      .trim()
      .split(/\s+/)
      .map((name) => `@tachisto/${name}`);
    expect(published.sort()).toEqual(publishedWorkspaces(workspaceVersions(repositoryRoot)).sort());
  });
});
