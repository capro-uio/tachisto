import { describe, expect, it } from "vitest";
import { loadBundle } from "@tachisto/schemas/bundle";
import type { Spec } from "@tachisto/compiler";
import { compile, type Files } from "../src/commands.ts";
import { payloadOf, reportOf } from "../src/report.ts";
import type { Outcome } from "../src/outcome.ts";

const bundle = loadBundle();
const versions = { tachisto: "0.0.2", jspsych: "8.3.0" };

const drawing = (params: Record<string, boolean>): Spec => ({
  name: "drawing",
  timeline: [{ kind: "trial", plugin: "sketchpad", params }],
});

function filesHolding(spec: Spec) {
  const written = new Map<string, string>();
  const files: Files = {
    read: () => JSON.stringify(spec),
    write: (path, text) => void written.set(path, text),
  };
  return files;
}

const built = (spec: Spec) => compile("drawing.json", { json: false }, filesHolding(spec), bundle);

describe("what the command line says once a study is built", () => {
  it("prints each warning on a line of its own, marked as a warning", async () => {
    const report = reportOf(await built(drawing({ show_finished_button: false })), versions, false);
    expect(report.stderr).toMatch(/^warning: step "[^"]+" \(sketchpad\) has nothing to end it/);
    expect(report.stderr.trimEnd().split("\n")).toHaveLength(1);
  });

  it("prints no warnings for a study with nothing to question", async () => {
    expect(reportOf(await built(drawing({})), versions, false).stderr).toBe("");
  });

  it("says how many plugins the page uses and where it went", async () => {
    const report = reportOf(await built(drawing({})), versions, false);
    expect(report.stdout).toBe("drawing: 1 plugin(s) -> drawing.html\n");
    expect(report.exitCode).toBe(0);
  });
});

describe("the status a command leaves behind", () => {
  const outcome = (status: Outcome["status"]): Outcome => ({
    command: "validate",
    status,
    problems: status === "ok" ? [] : [{ message: "no good", severity: "error" }],
    spec: "study.json",
  });

  it("separates nothing wrong, a wrong spec, and a spec it could not read", () => {
    expect(reportOf(outcome("ok"), versions, false).exitCode).toBe(0);
    expect(reportOf(outcome("invalid"), versions, false).exitCode).toBe(1);
    expect(reportOf(outcome("unreadable"), versions, false).exitCode).toBe(2);
  });

  it("puts errors on stderr, leaving stdout for what a caller wanted", () => {
    const report = reportOf(outcome("invalid"), versions, false);
    expect(report.stderr).toBe("error: no good\n");
    expect(report.stdout).toBe("");
  });
});

describe("what another program reads", () => {
  it("answers every command with the same envelope", () => {
    const payload = payloadOf(
      {
        command: "validate",
        status: "ok",
        problems: [{ message: "mind this", severity: "warning", path: [0, 1] }],
        spec: "study.json",
        name: "drawing",
      },
      versions,
    );
    expect(payload).toEqual({
      tachisto: "0.0.2",
      jspsych: "8.3.0",
      command: "validate",
      ok: true,
      spec: "study.json",
      name: "drawing",
      problems: [{ message: "mind this", severity: "warning", path: [0, 1] }],
    });
  });

  it("says a spec is not ok when it has errors, and keeps the problems machine-readable", () => {
    const report = reportOf(
      {
        command: "validate",
        status: "invalid",
        problems: [{ message: "the timeline has no steps", severity: "error" }],
        spec: "study.json",
        name: "empty",
      },
      versions,
      true,
    );
    expect(report.stderr).toBe("");
    expect(report.exitCode).toBe(1);
    expect(JSON.parse(report.stdout)).toMatchObject({
      ok: false,
      problems: [{ message: "the timeline has no steps", severity: "error" }],
    });
  });

  // A step's place is an index path in the spec; a person reads it counting from one.
  it("numbers a step from one for a person and leaves the path alone for a program", () => {
    const outcome: Outcome = {
      command: "validate",
      status: "invalid",
      problems: [{ message: "no good", severity: "error", path: [1, 0] }],
      spec: "study.json",
    };
    expect(reportOf(outcome, versions, false).stderr).toBe("error: no good (step 2.1)\n");
    expect(payloadOf(outcome, versions).problems[0].path).toEqual([1, 0]);
  });
});
