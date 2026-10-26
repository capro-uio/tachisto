import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PUBLISHED = ["@tachisto/schemas", "@tachisto/compiler"];
const root = fileURLToPath(new URL("../../..", import.meta.url));

interface PackResult {
  files: { path: string }[];
}

interface Manifest {
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  publishConfig?: { access?: string };
}

// One `npm pack` a workspace: each is a subprocess reading the whole package.
const packs = new Map<string, PackResult>();

function packed(workspace: string): PackResult {
  const already = packs.get(workspace);
  if (already) return already;
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--workspace", workspace], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const result = (JSON.parse(output) as PackResult[])[0];
  packs.set(workspace, result);
  return result;
}

function manifest(workspace: string): Manifest {
  const directory = workspace.replace("@tachisto/", "packages/");
  return JSON.parse(readFileSync(`${root}/${directory}/package.json`, "utf8")) as Manifest;
}

function shippedPaths(workspace: string) {
  return packed(workspace).files.map((file) => file.path);
}

describe("what the published packages carry", () => {
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
  it("asks for the schemas release it is published beside", () => {
    const { dependencies } = manifest("@tachisto/compiler");
    expect(dependencies?.["@tachisto/schemas"]).toBe(`^${manifest("@tachisto/schemas").version}`);
  });

  it("ships the schemas the compiler reads at runtime", () => {
    const paths = shippedPaths("@tachisto/schemas");
    expect(paths).toContain("plugin-schemas.json");
    expect(paths).toContain("src/bundle.ts");
  });

  it("ships the compiler's command line and the spec schema", () => {
    const paths = shippedPaths("@tachisto/compiler");
    expect(paths).toContain("src/cli.ts");
    expect(paths).toContain("spec-schema.json");
  });

  it.each(PUBLISHED)("leaves %s's own tests out", (workspace) => {
    const tests = shippedPaths(workspace).filter(
      (path) => path.startsWith("test/") || path.endsWith(".test.ts"),
    );
    expect(tests).toEqual([]);
  });
});
