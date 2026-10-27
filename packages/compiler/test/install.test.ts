import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const PUBLISHED = ["@tachisto/schemas", "@tachisto/compiler"];

let consumer: string;

const run = (command: string, args: string[], cwd: string) =>
  execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

/**
 * Installs the real tarballs into a directory of their own. Everything else about packaging can be
 * checked by reading manifests; this cannot. Inside the repository every @tachisto package is a
 * symlink whose target lies outside node_modules, so source that an install could never run — a
 * .ts entry point, a path that only resolves in the workspace — works perfectly here and fails
 * only for someone who installed it.
 */
beforeAll(() => {
  consumer = mkdtempSync(join(tmpdir(), "tachisto-install-"));
  const tarballs = PUBLISHED.map((workspace) => {
    const output = run(
      "npm",
      ["pack", "--json", "--workspace", workspace, "--pack-destination", consumer],
      root,
    );
    return join(consumer, (JSON.parse(output) as { filename: string }[])[0].filename);
  });
  const dependencies = Object.fromEntries(
    PUBLISHED.map((name, index) => [name, `file:${tarballs[index]}`]),
  );
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      name: "consumer",
      version: "1.0.0",
      private: true,
      type: "module",
      dependencies,
      overrides: dependencies,
    }),
  );
  run("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], consumer);
}, 600_000);

describe("the packages as someone else installs them", () => {
  it.each(PUBLISHED)("imports %s from an install", (name) => {
    const imported = run(
      "node",
      [
        "-e",
        `import(${JSON.stringify(name)}).then(() => console.log("ok"), (error) => { console.error(error.code ?? error.message); process.exit(1); })`,
      ],
      consumer,
    );
    expect(imported.trim()).toBe("ok");
  });

  it("compiles a study from an installed copy, with no jsPsych plugin present", () => {
    const script = `
      const { compileSpec, emitHtml } = await import("@tachisto/compiler");
      const { loadBundle } = await import("@tachisto/schemas/bundle");
      const spec = { name: "beep", timeline: [{ kind: "trial", plugin: "html-keyboard-response", params: { stimulus: "<p>hi</p>" } }] };
      const { html } = await emitHtml(compileSpec(spec, loadBundle()), { title: spec.name, base: "cdn" });
      console.log(html.includes("<html") ? "ok" : "no html");
    `;
    expect(run("node", ["--input-type=module", "-e", script], consumer).trim()).toBe("ok");
  });

  it("ships no TypeScript source to run, so nothing depends on stripping types", () => {
    for (const name of PUBLISHED) {
      const listed = run("npm", ["pack", "--dry-run", "--json", "--workspace", name], root);
      const paths = (JSON.parse(listed) as { files: { path: string }[] }[])[0].files.map(
        (f) => f.path,
      );
      expect(
        paths.filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts")),
        name,
      ).toEqual([]);
    }
  });
});
