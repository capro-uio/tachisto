import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EXIT_BROKEN } from "../src/outcome.ts";

const main = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), "tachisto-cli-"));

const spec = (name: string, contents: unknown) => {
  const path = join(workspace, name);
  writeFileSync(path, JSON.stringify(contents));
  return path;
};

const runnable = spec("runnable.json", {
  name: "beep",
  timeline: [
    { kind: "trial", plugin: "html-keyboard-response", params: { stimulus: "<p>hi</p>" } },
  ],
});

/** Runs the command as anyone installing it would, and reports what a caller would see. */
function run(args: string[]) {
  try {
    const stdout = execFileSync("node", [main, ...args], {
      encoding: "utf8",
      cwd: workspace,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { exitCode: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { exitCode: failure.status, stdout: failure.stdout, stderr: failure.stderr };
  }
}

describe("the command as it is installed", () => {
  it("says nothing is wrong, and says it as JSON when asked", () => {
    expect(run(["validate", runnable])).toMatchObject({ exitCode: 0 });
    const { stdout, exitCode } = run(["validate", runnable, "--json"]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ command: "validate", ok: true, name: "beep" });
  });

  it("exits 1 for a spec with errors and 2 for one it could not read", () => {
    expect(run(["validate", spec("empty.json", { name: "e", timeline: [] })]).exitCode).toBe(1);
    expect(run(["validate", join(workspace, "absent.json")]).exitCode).toBe(2);
    expect(run(["validate", spec("notes.json", "just a string")]).exitCode).toBe(2);
    expect(run(["frobnicate"]).exitCode).toBe(2);
  });

  it("compiles a page a browser would load", () => {
    const { exitCode, stdout } = run(["compile", runnable, "--out", "study.html"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 plugin(s) -> study.html");
  });

  // Writing to a directory fails inside the command, which is not the spec being wrong.
  it("keeps its own failures apart from a wrong spec", () => {
    const { exitCode, stderr } = run(["compile", runnable, "--out", workspace]);
    expect(exitCode).toBe(EXIT_BROKEN);
    expect(stderr).toMatch(/^tachisto: /);
  });

  it("offers usage when asked for nothing", () => {
    const { exitCode, stdout } = run([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: tachisto validate");
  });
});
