import { describe, expect, it } from "vitest";
import stroop from "../../../examples/stroop.json";
import type { Spec, SpecNode, TrialNode } from "tachisto-compiler";
import { pluginSchema } from "../src/lib/schemas.ts";
import {
  activeSegment,
  conditionColumns,
  containerName,
  containerPaths,
  detailText,
  rowLabels,
  segmentFor,
  segmentInputs,
  segmentHolds,
  sequenceAt,
  sweepMs,
  timingText,
  UNTIMED_WEIGHT,
  type Segment,
  type Sequence,
} from "../src/lib/sequence.ts";

const keyTrial = (params: TrialNode["params"], tag?: string): TrialNode => ({
  kind: "trial",
  plugin: "html-keyboard-response",
  ...(tag && { tag }),
  params,
});

const segment = (trial: TrialNode, rows: Record<string, unknown>[] = []) =>
  segmentFor(trial, [0], rows, pluginSchema);

describe("segmentFor", () => {
  it("draws a timed plus sign as a fixation that lasts its duration", () => {
    const fixation = segment(
      keyTrial({
        stimulus: "<p style='font-size:48px'>+</p>",
        choices: "NO_KEYS",
        trial_duration: 500,
      }),
    );
    expect(fixation).toMatchObject({
      role: "fixation",
      title: "Fixation",
      timing: { kind: "fixed", ms: { min: 500, max: 500 } },
      weight: 500,
    });
    expect(fixation.answer).toBeUndefined();
    expect(timingText(fixation)).toBe("500 ms");
  });

  it("shows a step waiting for a key as the stimulus, with the keys that answer it", () => {
    const word = segment(keyTrial({ stimulus: "RED", choices: ["r", "b"] }, "stroop"));
    expect(word).toMatchObject({
      role: "stimulus",
      title: "stroop",
      timing: { kind: "response" },
      answer: "r or b",
      weight: UNTIMED_WEIGHT,
    });
    expect(timingText(word)).toBe("until response");
  });

  it("gives a response a deadline when the step also has a duration", () => {
    const limited = segment(keyTrial({ stimulus: "RED", trial_duration: 1500 }));
    expect(limited.timing).toEqual({ kind: "limit", ms: { min: 1500, max: 1500 } });
    expect(limited.answer).toBe("any key");
    expect(timingText(limited)).toBe("up to 1500 ms");
  });

  it("runs the full duration when a response does not end the step", () => {
    const fixed = segment(
      keyTrial({ stimulus: "RED", trial_duration: 800, response_ends_trial: false }),
    );
    expect(fixed.timing.kind).toBe("fixed");
    expect(fixed.role).toBe("stimulus");
  });

  it.each([
    ["a bare plus", "+"],
    ["a styled plus", "<p style='font-size:48px'>+</p>"],
    ["a spaced plus", "<div>&nbsp; + </div>"],
  ])("knows %s for a fixation", (_case, stimulus) => {
    expect(segment(keyTrial({ stimulus, choices: "NO_KEYS", trial_duration: 300 })).role).toBe(
      "fixation",
    );
  });

  it.each([
    ["a sum", "<p>2 + 2</p>"],
    ["a plus inside markup", "<p title='+'>x</p>"],
    ["two crosses", "<p>+</p><p>+</p>"],
  ])("does not take %s for a fixation", (_case, stimulus) => {
    expect(segment(keyTrial({ stimulus, choices: "NO_KEYS", trial_duration: 300 })).role).toBe(
      "screen",
    );
  });

  it("calls a timed screen without responses a screen", () => {
    const blank = segment(keyTrial({ stimulus: "", choices: "NO_KEYS", trial_duration: 250 }));
    expect(blank.role).toBe("screen");
  });

  it("reads a duration from a column as the range of its rows", () => {
    const rows = [{ soa: 200 }, { soa: "600" }, { soa: 400 }];
    const timed = segment(
      keyTrial({ stimulus: "+", choices: "NO_KEYS", trial_duration: { var: "soa" } }),
      rows,
    );
    expect(timed.timing).toEqual({ kind: "fixed", ms: { min: 200, max: 600 } });
    expect(timed.weight).toBe(400);
    expect(timingText(timed)).toBe("200–600 ms");
  });

  it("says a duration varies when its column holds something other than durations", () => {
    const rows = [{ soa: 200 }, { soa: "long" }];
    const varied = segment(keyTrial({ stimulus: "x", trial_duration: { var: "soa" } }), rows);
    expect(varied.timing).toEqual({ kind: "varies", column: "soa" });
    expect(timingText(varied)).toBe("from soa");
  });

  it("does not take a blank or missing cell for a duration of nothing", () => {
    const trial = keyTrial({ stimulus: "x", choices: "NO_KEYS", trial_duration: { var: "isi" } });
    for (const blank of ["", "  ", null, false, undefined]) {
      const rows = [{ isi: 500 }, { isi: blank }];
      expect(segment(trial, rows).timing).toEqual({ kind: "varies", column: "isi" });
    }
    expect(segment(trial, [{ isi: "200" }, { isi: 400 }]).timing).toEqual({
      kind: "fixed",
      ms: { min: 200, max: 400 },
    });
  });

  it("notes when the stimulus disappears before the step ends", () => {
    const flashed = segment(
      keyTrial({ stimulus: "RED", stimulus_duration: 200, trial_duration: 1500 }),
    );
    expect(flashed.shownFor).toEqual({ min: 200, max: 200 });
    expect(detailText(flashed)).toBe("shown 200 ms · any key");
  });

  it("names keys from a column, a long list of keys, and buttons", () => {
    expect(segment(keyTrial({ stimulus: "x", choices: { var: "keys" } })).answer).toBe(
      "keys from keys",
    );
    expect(segment(keyTrial({ stimulus: "x", choices: ["a", "s", "d", "f"] })).answer).toBe(
      "one of 4 keys",
    );
    const button = segmentFor(
      {
        kind: "trial",
        plugin: "html-button-response",
        params: { stimulus: "x", choices: ["Yes", "No"] },
      },
      [0],
      [],
      pluginSchema,
    );
    expect(button.answer).toBe("a button");
  });

  it("leaves a step with no set length, such as instructions, until the participant is done", () => {
    const pages = segmentFor(
      { kind: "trial", plugin: "instructions", params: { pages: ["<p>hi</p>"] } },
      [0],
      [],
      pluginSchema,
    );
    expect(pages.role).toBe("other");
    expect(timingText(pages)).toBe("until done");
  });

  it("uses the plugin's own name for a plugin the schemas do not know", () => {
    const unknown = segmentFor({ kind: "trial", plugin: "made-up" }, [0], [], pluginSchema);
    expect(unknown.title).toBe("made-up");
    expect(unknown.timing.kind).toBe("untimed");
  });
});

const fixation = keyTrial({ stimulus: "+", choices: "NO_KEYS", trial_duration: 300 });
const word = keyTrial({ stimulus: { var: "word" }, choices: ["r", "b"] }, "word");

const study = (extra: Partial<Spec> = {}, inner: SpecNode[] = [fixation, word]): Spec => ({
  name: "study",
  conditions: { words: [{ word: "RED" }, { word: "BLUE" }] },
  timeline: [
    keyTrial({ stimulus: "Welcome" }),
    { kind: "block", conditions: "words", children: inner },
    {
      kind: "branch",
      when: { scope: "word", accuracy_below: 0.5 },
      then: [
        { kind: "loop", repeat_while: { scope: "word", accuracy_below: 0.5 }, children: [word] },
      ],
    },
  ],
  ...extra,
});

describe("containerPaths", () => {
  it("finds every block and loop, inside each other and down a branch's paths", () => {
    const nested: SpecNode = {
      kind: "loop",
      repeat_while: { scope: "word", accuracy_below: 0.5 },
      children: [{ kind: "block", conditions: "words", children: [word] }],
    };
    const paths = containerPaths([...study().timeline, nested]);
    expect(paths).toEqual([[1], [2, 0, 0], [3], [3, 0]]);
  });

  it("names paths a selection can be laid out from", () => {
    for (const path of containerPaths(study().timeline)) {
      expect(sequenceAt(study(), path, pluginSchema)?.path).toEqual(path);
    }
  });
});

describe("containerName", () => {
  it("names a block by its table, a loop by its id or as a loop", () => {
    expect(containerName(study(), [1])).toBe("words");
    expect(containerName(study(), [2, 0, 0])).toBe("loop");
    expect(containerName(study(), [0])).toBe("steps");
  });
});

describe("sequenceAt", () => {
  it("lays out the block around a selected step, one segment for each of its steps", () => {
    const sequence = sequenceAt(study(), [1, 1], pluginSchema)!;
    expect(sequence.path).toEqual([1]);
    expect(sequence.kind).toBe("block");
    expect(sequence.segments.map((part) => [part.path, part.role])).toEqual([
      [[1, 0], "fixation"],
      [[1, 1], "stimulus"],
    ]);
  });

  it("lays out a selected block itself", () => {
    expect(sequenceAt(study(), [1], pluginSchema)?.path).toEqual([1]);
  });

  it("follows a branch's path to a loop inside it", () => {
    const sequence = sequenceAt(study(), [2, 0, 0, 0], pluginSchema)!;
    expect(sequence).toMatchObject({ path: [2, 0, 0], kind: "loop" });
    expect(sequence.segments[0].path).toEqual([2, 0, 0, 0]);
  });

  it("shows nothing for a step outside any block or loop, or for no selection", () => {
    expect(sequenceAt(study(), [0], pluginSchema)).toBeNull();
    expect(sequenceAt(study(), [2], pluginSchema)).toBeNull();
    expect(sequenceAt(study(), null, pluginSchema)).toBeNull();
    expect(sequenceAt(study(), [9, 0], pluginSchema)).toBeNull();
  });

  it("puts the pause between steps after each one, when the study has one", () => {
    const sequence = sequenceAt(study({ settings: { default_iti: 250 } }), [1], pluginSchema)!;
    expect(sequence.segments.map((part) => part.role)).toEqual([
      "fixation",
      "gap",
      "stimulus",
      "gap",
    ]);
    expect(timingText(sequence.segments[1])).toBe("250 ms");
  });

  it("shows a block inside the block as one segment that can be selected", () => {
    const nested = study({}, [fixation, { kind: "block", conditions: "words", children: [word] }]);
    const inner = sequenceAt(nested, [1], pluginSchema)!.segments[1];
    expect(inner).toMatchObject({ path: [1, 1], role: "group", title: "Block · 1 step" });
    expect(timingText(inner)).toBe("");
  });

  it("names the other kinds of step it can hold", () => {
    const titles = sequenceAt(
      study({}, [
        {
          kind: "loop",
          repeat_while: { scope: "word", accuracy_below: 0.5 },
          children: [word, word],
        },
        { kind: "checkpoint", name: "half" },
        { kind: "end", ending: "done" },
        { kind: "assign", method: "random", groups: [] },
        { kind: "counterbalance", method: "random", tasks: [] },
        { kind: "branch", when: { scope: "word", accuracy_below: 0.5 }, then: [] },
      ]),
      [1],
      pluginSchema,
    )!.segments.map((part) => part.title);
    expect(titles).toEqual([
      "Repeat · 2 steps",
      "Checkpoint “half”",
      "End",
      "Groups",
      "Tasks in turn",
      "Branch",
    ]);
  });
});

describe("segmentHolds", () => {
  const group: Segment = {
    path: [1, 2],
    role: "group",
    title: "Block",
    timing: { kind: "untimed" },
    weight: 1,
  };

  it("holds its own step and the steps inside it, but not a neighbour that shares a prefix", () => {
    expect(segmentHolds(group, "1.2")).toBe(true);
    expect(segmentHolds(group, "1.2.0")).toBe(true);
    expect(segmentHolds(group, "1.20")).toBe(false);
    expect(segmentHolds({ ...group, path: null }, "1.2")).toBe(false);
  });
});

const timed = (path: number[] | null, role: Segment["role"], ms: number): Segment => ({
  path,
  role,
  title: role,
  timing: { kind: "fixed", ms: { min: ms, max: ms } },
  weight: ms,
});

const playing: Sequence = {
  path: [1],
  kind: "block",
  segments: [
    timed([1, 0], "fixation", 500),
    timed(null, "gap", 250),
    timed([1, 1], "group", 1000),
    timed([1, 2], "stimulus", 800),
  ],
};

describe("activeSegment", () => {
  it("is the running step's own segment, or a group holding it", () => {
    expect(activeSegment(playing, { step: "1.0", phase: "step" })).toBe(0);
    expect(activeSegment(playing, { step: "1.1.0.2", phase: "step" })).toBe(2);
  });

  it("moves to the pause after a step once it finishes, and to nothing when no pause follows", () => {
    expect(activeSegment(playing, { step: "1.0", phase: "after" })).toBe(1);
    expect(activeSegment(playing, { step: "1.2", phase: "after" })).toBe(-1);
  });

  it("is nothing when the preview is idle or running a step elsewhere", () => {
    expect(activeSegment(playing, { step: null, phase: "step" })).toBe(-1);
    expect(activeSegment(playing, { step: "0", phase: "step" })).toBe(-1);
  });
});

describe("sweepMs", () => {
  it("crosses a step in the time the running study reported for it", () => {
    expect(sweepMs(playing.segments[3], 650)).toBe(650);
  });

  it("falls back on a segment's own length, and a pause always keeps its own", () => {
    expect(sweepMs(playing.segments[3], null)).toBe(800);
    expect(sweepMs(playing.segments[1], 650)).toBe(250);
  });

  it("holds the playhead on a step with no set length", () => {
    const waiting: Segment = { ...playing.segments[3], timing: { kind: "response" } };
    expect(sweepMs(waiting, null)).toBeNull();
  });
});

describe("rowLabels", () => {
  it("names each row of the block's table by its number and its values, markup left out", () => {
    const spec = specWithTable([
      { word: "BLUE", ink: "red", stimulus: "<p style='color:red'>BLUE</p>" },
      { word: "RED", ink: "red", stimulus: "<p>RED</p>" },
    ]);
    expect(rowLabels(spec, [0, 0])).toEqual(["1: BLUE · red · BLUE", "2: RED · red · RED"]);
  });

  it("takes out a tag split around another, however it is nested", () => {
    const spec = specWithTable([{ stimulus: "<scr<b>ipt>x</scr</b>ipt> &lt;i&gt;y" }]);
    expect(rowLabels(spec, [0, 0])).toEqual(["1: x y"]);
  });

  it("leaves text that only looks like markup, and reads the entities written in it", () => {
    const spec = specWithTable([{ stimulus: "<<<>>", answer: "a &lt; b &amp;&nbsp;c" }]);
    expect(rowLabels(spec, [0, 0])).toEqual(["1: <<<>> · a < b & c"]);
  });

  it("shortens a long row, and has none for a step outside any block", () => {
    const spec = specWithTable([{ text: "x".repeat(80) }]);
    const [label] = rowLabels(spec, [0, 0]);
    expect(label.length).toBe(40);
    expect(label.endsWith("…")).toBe(true);
    expect(rowLabels({ name: "n", timeline: [keyTrial({ stimulus: "x" })] }, [0])).toEqual([]);
  });
});

function specWithTable(rows: Record<string, unknown>[]): Spec {
  return {
    name: "rows",
    conditions: { words: rows },
    timeline: [{ kind: "block", conditions: "words", children: [keyTrial({ stimulus: "x" })] }],
  };
}

describe("conditionColumns", () => {
  it("offers the columns that split the rows into a few conditions, each with its first row", () => {
    const spec = specWithTable([
      { congruency: "congruent", word: "RED", trial: 1, constant: "x" },
      { congruency: "incongruent", word: "RED", trial: 2, constant: "x" },
      { congruency: "congruent", word: "BLUE", trial: 3, constant: "x" },
      { congruency: "incongruent", word: "BLUE", trial: 4, constant: "x" },
      { congruency: "congruent", word: "GREEN", trial: 5, constant: "x" },
    ]);
    expect(conditionColumns(spec, [0, 0])).toEqual([
      {
        column: "congruency",
        values: [
          { value: "congruent", row: 0 },
          { value: "incongruent", row: 1 },
        ],
      },
      {
        column: "word",
        values: [
          { value: "RED", row: 0 },
          { value: "BLUE", row: 2 },
          { value: "GREEN", row: 4 },
        ],
      },
    ]);
  });
});

describe("segmentInputs", () => {
  it("gives each step's settings with the row's values in place of its columns", () => {
    const spec = stroop as Spec;
    const sequence = sequenceAt(spec, [2, 1], pluginSchema)!;
    const [fixationFirst, wordFirst] = segmentInputs(spec, sequence, 0);
    const [fixationSecond, wordSecond] = segmentInputs(spec, sequence, 1);
    expect(fixationFirst).toBe(fixationSecond);
    expect(wordFirst).not.toBe(wordSecond);
    expect(wordFirst).toContain(JSON.stringify(spec.conditions!.stroop_trials[0].stimulus));
  });
});
