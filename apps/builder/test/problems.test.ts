import { describe, expect, it } from "vitest";
import type { Problem, Spec } from "tachisto-compiler";
import { loadSpec } from "../src/lib/project.svelte.ts";
import {
  currentProblems,
  errorsOf,
  overallProblems,
  stepCount,
  warningsOf,
} from "../src/lib/problems.svelte.ts";

const unending = {
  kind: "trial" as const,
  plugin: "sketchpad",
  params: { show_finished_button: false },
};

const unfinished = { kind: "trial" as const, plugin: "html-keyboard-response", params: {} };

const study = (timeline: Spec["timeline"]): Spec => ({ name: "problems", timeline });

describe("the current experiment's problems", () => {
  it("holds the warnings of an experiment that builds", () => {
    loadSpec(study([unending]));
    const problems = currentProblems();
    expect(errorsOf(problems)).toEqual([]);
    expect(warningsOf(problems)).toEqual([
      expect.objectContaining({ path: [0], severity: "warning" }),
    ]);
  });

  it("holds both the errors and the warnings of one that does not", () => {
    loadSpec(study([unending, unfinished]));
    const problems = currentProblems();
    expect(warningsOf(problems).map((problem) => problem.path)).toEqual([[0]]);
    expect(errorsOf(problems).map((problem) => problem.path)).toEqual([[1]]);
  });

  it("warns, about the whole experiment, when two steps share DataPipe's condition counter", () => {
    const screen = { kind: "trial" as const, plugin: "html-keyboard-response", params: {} };
    const slots = (names: string[]) => names.map((name) => ({ name, children: [screen] }));
    loadSpec({
      ...study([
        { kind: "assign", method: "balanced", groups: slots(["red", "green"]) },
        {
          kind: "counterbalance",
          method: "latin_square",
          record_as: "order",
          tasks: slots(["stroop", "flanker"]),
        },
      ]),
      data: { save: "post", experiment_id: "abc123DEF456" },
    });
    const shared = currentProblems().filter((problem) =>
      problem.message.includes("ask DataPipe for a condition"),
    );
    expect(shared).toEqual([expect.objectContaining({ severity: "warning" })]);
    expect(shared[0].path).toBeUndefined();
    expect(overallProblems(warningsOf(shared))).toEqual(shared);
  });

  it("is empty for an experiment with nothing to question", () => {
    loadSpec(
      study([
        { kind: "trial", plugin: "html-keyboard-response", params: { stimulus: "<p>+</p>" } },
      ]),
    );
    expect(currentProblems()).toEqual([]);
  });
});

describe("stepCount", () => {
  const at = (path?: number[]): Problem => ({ message: "m", path, severity: "error" });

  it("counts each step once, however many problems it has", () => {
    expect(stepCount([at([0]), at([0]), at([1, 0, 2])])).toBe(2);
  });

  it("leaves out problems about the experiment as a whole", () => {
    expect(stepCount([at(), at([3])])).toBe(1);
  });
});
