import { describe, expect, it } from "vitest";
import { loadBundle } from "@tachisto/schemas/bundle";
import type { Spec } from "@tachisto/compiler";
import { compile } from "../src/commands.ts";
import { fakeFiles } from "./files.ts";
import { payloadOf, reportOf } from "../src/report.ts";
import type { Outcome } from "../src/outcome.ts";

const bundle = loadBundle();
const versions = { tachisto: "0.0.2", jspsych: "8.3.0" };

const drawing = (params: Record<string, boolean>): Spec => ({
  name: "drawing",
  timeline: [{ kind: "trial", plugin: "sketchpad", params }],
});

const built = (spec: Spec) =>
  compile("drawing.json", {}, fakeFiles({ "drawing.json": JSON.stringify(spec) }).files, bundle);

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

describe("what a person is told when nothing is wrong", () => {
  it("says so, and counts the warnings when there are any", async () => {
    const { validate } = await import("../src/commands.ts");
    const quiet = validate(
      "drawing.json",
      fakeFiles({ "drawing.json": JSON.stringify(drawing({})) }).files,
      bundle,
    );
    expect(reportOf(quiet, versions, false).stdout).toBe("drawing: nothing to report\n");

    const noisy = validate(
      "drawing.json",
      fakeFiles({ "drawing.json": JSON.stringify(drawing({ show_finished_button: false })) }).files,
      bundle,
    );
    expect(reportOf(noisy, versions, false).stdout).toBe("drawing: 1 warning(s)\n");
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
  // A reader gets the place in words; a program keeps the indices it can act on. Both, not one.
  it("says where a problem is for a person and leaves the path alone for a program", () => {
    const outcome: Outcome = {
      command: "validate",
      status: "invalid",
      problems: [
        { message: "no good", severity: "error", path: [1, 0], place: "step 2, otherwise" },
      ],
      spec: "study.json",
    };
    expect(reportOf(outcome, versions, false).stderr).toBe("error: no good (step 2, otherwise)\n");
    const [problem] = payloadOf(outcome, versions).problems;
    expect(problem.path).toEqual([1, 0]);
    expect(problem.place).toBe("step 2, otherwise");
  });

  it("says nothing about a place when the problem has no path", () => {
    const outcome: Outcome = {
      command: "validate",
      status: "invalid",
      problems: [{ message: "the timeline has no steps", severity: "error" }],
      spec: "study.json",
    };
    expect(reportOf(outcome, versions, false).stderr).toBe("error: the timeline has no steps\n");
  });
});
