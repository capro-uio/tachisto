import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { publishedWorkspaces, workspaceDirectories } from "./published.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));

const PUBLISHED = publishedWorkspaces();

interface PackResult {
  files: { path: string }[];
}

interface Manifest {
  version: string;
  private?: boolean;
  main?: string;
  types?: string;
  bin?: Record<string, string>;
  dependencies?: Record<string, string>;
  publishConfig?: { access?: string };
}

// One `npm pack` a workspace: each is a subprocess reading the whole package.
const packs = new Map<string, PackResult>();

function packed(workspace: string): PackResult {
  const already = packs.get(workspace);
  if (already) return already;
  const output = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts", "--workspace", workspace],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const result = (JSON.parse(output) as PackResult[])[0];
  packs.set(workspace, result);
  return result;
}

const DIRECTORIES = workspaceDirectories();

function manifest(workspace: string): Manifest {
  const directory = DIRECTORIES.get(workspace);
  if (directory === undefined) throw new Error(`no workspace named ${workspace}`);
  return JSON.parse(readFileSync(`${root}/${directory}/package.json`, "utf8")) as Manifest;
}

/** The same question the tarball answers, asked of a package that is already built. */

function shippedPaths(workspace: string) {
  return packed(workspace).files.map((file) => file.path);
}

describe("what the published packages carry", () => {
  // `it.each(PUBLISHED)` writes no test at all for a workspace the derivation misses, so a
  // narrowed `publishedWorkspaces()` would empty this file rather than fail it.
  it("is told about every package a release publishes", () => {
    expect(PUBLISHED).toEqual([
      "tachisto",
      "tachisto-compiler",
      "tachisto-mcp",
      "tachisto-schemas",
    ]);
  });

  it.each(PUBLISHED)("publishes %s publicly", (workspace) => {
    const pkg = manifest(workspace);
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig?.access).toBe("public");
  });

  // Extracting schemas imports every jsPsych plugin package. An installed copy reads the schemas
  // shipped beside the source instead, so nobody who only compiles a spec installs the ecosystem.
  it.each(PUBLISHED)("asks %s's users for no jsPsych plugin", (workspace) => {
    const names = Object.keys(manifest(workspace).dependencies ?? {});
    expect(names.filter((name) => /jspsych|psychophysics|webgazer/i.test(name))).toEqual([]);
  });

  // A release bumps every package together, and a range left behind would publish a compiler that
  // installs the previous release's schemas — `^0.0.2` admits no other version to correct it.
  it.each(PUBLISHED)("asks %s for the sibling releases it is published beside", (workspace) => {
    const { dependencies } = manifest(workspace);
    // A name this repository ships but has no workspace for is the mistake this test looks for, so
    // it reaches `manifest()` and throws rather than being skipped as though it were external.
    const siblings = Object.entries(dependencies ?? {}).filter(([name]) =>
      name.startsWith("tachisto"),
    );
    expect(Object.fromEntries(siblings)).toEqual(
      Object.fromEntries(siblings.map(([name]) => [name, `^${manifest(name).version}`])),
    );
  });

  // Every published package but schemas depends on a sibling, so a filter that stopped matching
  // would leave the assertion above comparing two empty objects.
  it("finds the sibling dependencies it is meant to be checking", () => {
    const counted = PUBLISHED.map(
      (workspace) =>
        Object.keys(manifest(workspace).dependencies ?? {}).filter((name) => DIRECTORIES.has(name))
          .length,
    );
    expect(counted.filter((count) => count > 0).length).toBeGreaterThan(1);
  });

  it("ships the schemas the compiler reads at runtime", () => {
    const paths = shippedPaths("tachisto-schemas");
    expect(paths).toContain("plugin-schemas.json");
    expect(paths).toContain("dist/src/bundle.js");
  });

  it("ships the spec schema beside the compiler", () => {
    expect(shippedPaths("tachisto-compiler")).toContain("spec-schema.json");
  });

  // The bug this branch exists to fix: a tarball of TypeScript cannot run under node_modules.
  it.each(PUBLISHED)("ships no TypeScript for %s to run", (workspace) => {
    const source = shippedPaths(workspace).filter(
      (path) => path.endsWith(".ts") && !path.endsWith(".d.ts"),
    );
    expect(source).toEqual([]);
  });

  it("ships the command line and the MCP server built", () => {
    expect(shippedPaths("tachisto")).toContain("dist/src/main.js");
    expect(shippedPaths("tachisto-mcp")).toContain("dist/src/main.js");
  });

  // Two packages claiming one name would install over each other.
  it("gives each binary one owner", () => {
    const claims = new Map<string, string[]>();
    for (const workspace of PUBLISHED) {
      for (const binary of Object.keys(manifest(workspace).bin ?? {})) {
        claims.set(binary, [...(claims.get(binary) ?? []), workspace]);
      }
    }
    expect([...claims].filter(([, owners]) => owners.length > 1)).toEqual([]);
    expect(claims.get("tachisto")).toEqual(["tachisto"]);
    expect(claims.get("tachisto-mcp")).toEqual(["tachisto-mcp"]);
  });

  // An entry point npm installs has to be in the tarball, built, and reachable by its own path.
  it.each(PUBLISHED)("ships what %s's manifest points at", (workspace) => {
    const pkg = manifest(workspace);
    const paths = shippedPaths(workspace);
    const named = [pkg.main, pkg.types, ...Object.values(pkg.bin ?? {})].filter(
      (path): path is string => typeof path === "string",
    );
    for (const path of named) expect(paths, `${workspace} -> ${path}`).toContain(path);
  });

  it.each(PUBLISHED)("tells %s's users their rights and what it is", (workspace) => {
    const paths = shippedPaths(workspace);
    expect(paths).toContain("LICENSE");
    expect(paths).toContain("README.md");
  });

  it.each(PUBLISHED)("leaves %s's own tests out", (workspace) => {
    const tests = shippedPaths(workspace).filter(
      (path) => path.startsWith("test/") || path.endsWith(".test.ts"),
    );
    expect(tests).toEqual([]);
  });
});
