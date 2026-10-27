import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  // A path that cannot be written to is the caller's input, as a missing spec file is — not a
  // fault in the compiler. EXIT_BROKEN stays for faults with no reachable trigger today, which is
  // why nothing here provokes one.
  it("treats a path it cannot write as bad input, not as its own failure", () => {
    const { exitCode, stderr } = run([
      "compile",
      runnable,
      "--out",
      join(workspace, "no", "x.html"),
    ]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("ENOENT");
    expect(EXIT_BROKEN).not.toBe(2);
  });

  it("hands out the spec schema whole, even down a pipe", () => {
    const { exitCode, stdout } = run(["schema"]);
    expect(exitCode).toBe(0);
    // Exiting straight after a write to a pipe loses whatever has not drained; this is 533 kB.
    const schema = JSON.parse(stdout) as { $id: string };
    expect(schema.$id).toBe("https://www.capro.dev/tachisto/spec-schema.json");
  });

  it("writes the spec schema where it is told, and says so", () => {
    const out = join(workspace, "spec-schema.json");
    const { exitCode, stdout } = run(["schema", "--out", out]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`spec schema -> ${out}`);
    expect((JSON.parse(readFileSync(out, "utf8")) as { $id: string }).$id).toContain("spec-schema");
  });

  it("refuses a schema path it cannot write, without a stack trace", () => {
    const { exitCode, stderr } = run(["schema", "--out", join(workspace, "no", "s.json")]);
    expect(exitCode).toBe(2);
    expect(stderr).toContain("ENOENT");
    expect(stderr).not.toContain("at ");
  });

  it("builds a page that loads its plugins from where --base says", () => {
    const out = join(workspace, "local.html");
    expect(run(["compile", runnable, "--out", out, "--base", "./vendor"]).exitCode).toBe(0);
    const html = readFileSync(out, "utf8");
    expect(html).toContain("./vendor/");
    expect(html).not.toContain("unpkg.com");
  });

  it("offers usage when asked for nothing", () => {
    const { exitCode, stdout } = run([]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage: tachisto validate");
  });
});
