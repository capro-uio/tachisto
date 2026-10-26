import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PUBLISHED = ["@tachisto/schemas", "@tachisto/compiler"];
const root = fileURLToPath(new URL("../../..", import.meta.url));

interface PackResult {
  name: string;
  files: { path: string }[];
}

function packed(workspace: string): PackResult {
  const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--workspace", workspace], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return (JSON.parse(output) as PackResult[])[0];
}

function manifest(workspace: string) {
  const directory = workspace.replace("@tachisto/", "packages/");
  return JSON.parse(readFileSync(`${root}/${directory}/package.json`, "utf8")) as {
    private?: boolean;
    dependencies?: Record<string, string>;
    publishConfig?: { access?: string };
  };
}

describe("what the published packages carry", () => {
  it.each(PUBLISHED)("publishes %s publicly", (workspace) => {
    const pkg = manifest(workspace);
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig?.access).toBe("public");
  });

  // Extracting schemas imports all 49 plugin packages. An installed copy reads the schemas shipped
  // beside the source instead, so nobody who only compiles a spec installs the plugin ecosystem.
  it.each(PUBLISHED)("asks %s's users for no jsPsych plugin", (workspace) => {
    const names = Object.keys(manifest(workspace).dependencies ?? {});
    expect(names.filter((name) => /jspsych|psychophysics|webgazer/i.test(name))).toEqual([]);
  });

  it("ships the schemas the compiler reads at runtime", () => {
    const paths = packed("@tachisto/schemas").files.map((file) => file.path);
    expect(paths).toContain("plugin-schemas.json");
    expect(paths).toContain("src/bundle.ts");
  });

  it("ships the compiler's command line and the spec schema", () => {
    const paths = packed("@tachisto/compiler").files.map((file) => file.path);
    expect(paths).toContain("src/cli.ts");
    expect(paths).toContain("spec-schema.json");
  });

  it("leaves the tests and the builder's own files out", () => {
    for (const workspace of PUBLISHED) {
      const paths = packed(workspace).files.map((file) => file.path);
      expect(
        paths.filter((path) => path.includes("test")),
        workspace,
      ).toEqual([]);
    }
  });
});
