import { describe, expect, it } from "vitest";
import type { Spec, SpecNode } from "tachisto-compiler";
import flanker from "../../../examples/flanker.json";
import stroop from "../../../examples/stroop.json";
import {
  layoutFlow,
  STEP_WIDTH,
  wrapText,
  type FlowBox,
  type FlowLayout,
} from "../src/lib/flow.ts";

const trial = (plugin = "html-keyboard-response", extra: Partial<SpecNode> = {}) =>
  ({ kind: "trial", plugin, ...extra }) as SpecNode;

const specOf = (timeline: SpecNode[], conditions: Spec["conditions"] = {}): Spec => ({
  name: "test",
  conditions,
  timeline,
});

function boxAt(layout: FlowLayout, key: string): FlowBox {
  const box = layout.boxes.find((candidate) => candidate.key === key);
  if (!box) throw new Error(`no box ${key} in ${layout.boxes.map((b) => b.key).join(", ")}`);
  return box;
}

const text = (box: FlowBox) => [...box.title, ...box.details].join(" ");

const contains = (outer: FlowBox, inner: FlowBox) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const overlaps = (a: FlowBox, b: FlowBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function expectInsideCanvas(layout: FlowLayout) {
  for (const box of layout.boxes) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(layout.width);
    expect(box.y + box.height).toBeLessThanOrEqual(layout.height);
  }
  for (const edge of layout.edges) {
    for (const point of edge.points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(layout.width);
      expect(point.y).toBeLessThanOrEqual(layout.height);
    }
  }
}

describe("layoutFlow", () => {
  describe("the timeline as a whole", () => {
    it("runs from a start to an end, with a placeholder when there are no steps", () => {
      const layout = layoutFlow(specOf([]));
      expect(layout.boxes.map((box) => box.shape)).toEqual(["terminal", "empty", "terminal"]);
      expect(boxAt(layout, "start").label).toBe("Start");
      expect(boxAt(layout, "end").label).toBe("End");
      expect(layout.edges).toHaveLength(2);
      expectInsideCanvas(layout);
    });

    it("places steps one below the next, joined by arrows", () => {
      const layout = layoutFlow(specOf([trial("instructions"), trial()]));
      const first = boxAt(layout, "node-0");
      const second = boxAt(layout, "node-1");
      expect(second.y).toBeGreaterThan(first.y + first.height);
      expect(first.x + first.width / 2).toBe(second.x + second.width / 2);
      const between = layout.edges.find(
        (edge) => edge.points[0].y === first.y + first.height && edge.points.at(-1)!.y === second.y,
      );
      expect(between?.arrow).toBe(true);
    });

    it("lists boxes in the order a participant meets them", () => {
      const layout = layoutFlow(flanker as unknown as Spec);
      expect(layout.boxes.map((box) => box.key)).toEqual([
        "start",
        "node-0",
        "node-1",
        "node-1-0",
        "node-1-0-0",
        "node-1-0-1",
        "end",
      ]);
      expectInsideCanvas(layout);
    });
  });

  describe("trials", () => {
    it("names the step by its title, the tag and how the response is scored", () => {
      const layout = layoutFlow(
        specOf([
          trial("html-keyboard-response", {
            tag: "practice",
            score: { correct_if_response_equals: { var: "correct_key" } },
          }),
          trial("html-button-response", {
            score: { correct_if_response_equals: 1 },
          }),
        ]),
      );
      const scored = boxAt(layout, "node-0");
      expect(scored.shape).toBe("step");
      expect(scored.title).toEqual(["Text, answered with a key"]);
      expect(scored.label).toBe(
        "Text, answered with a key, tagged practice, correct when the response matches column correct_key",
      );
      expect(boxAt(layout, "node-1").label).toContain("matches 1");
    });

    it("grows to fit wrapped text instead of cutting it off", () => {
      const layout = layoutFlow(
        specOf([trial(), trial("x", { tag: "a-very-long-tag-name-that-wraps" })]),
      );
      const plain = boxAt(layout, "node-0");
      const tagged = boxAt(layout, "node-1");
      expect(tagged.width).toBe(plain.width);
      expect(tagged.height).toBeGreaterThan(plain.height);
      expect(text(tagged).replace(/ /g, "")).toContain("a-very-long-tag-name-that-wraps");
    });
  });

  describe("blocks", () => {
    const conditions = {
      trials: [
        { stim: "<", key: "f" },
        { stim: ">", key: "j" },
      ],
    };

    it("summarises the conditions table, repetitions and order", () => {
      const layout = layoutFlow(
        specOf(
          [
            {
              kind: "block",
              conditions: "trials",
              randomize_order: true,
              repetitions: 3,
              children: [trial()],
            },
          ],
          conditions,
        ),
      );
      const block = boxAt(layout, "node-0");
      expect(block.shape).toBe("frame");
      expect(block.label).toBe(
        "block · trials, 2 rows × 3 repetitions, rows in random order, columns: stim, key",
      );
      expect(contains(block, boxAt(layout, "node-0-0"))).toBe(true);
      expect(layout.edges.some((edge) => edge.repeat)).toBe(false);
    });

    it("says when the table is missing or empty and the order is fixed", () => {
      const layout = layoutFlow(
        specOf([{ kind: "block", conditions: "", children: [trial()] }], {}),
      );
      expect(boxAt(layout, "node-0").label).toBe(
        "block · no table, 0 rows × 1 repetition, rows in table order",
      );
    });

    it("shows an empty block as holding no steps", () => {
      const layout = layoutFlow(
        specOf([{ kind: "block", conditions: "trials", children: [] }], conditions),
      );
      const block = boxAt(layout, "node-0");
      const placeholder = boxAt(layout, "empty-0");
      expect(placeholder.path).toBeNull();
      expect(contains(block, placeholder)).toBe(true);
    });
  });

  describe("loops", () => {
    it("states the repeat condition and draws the way back to the top", () => {
      const layout = layoutFlow(flanker as unknown as Spec);
      const loop = boxAt(layout, "node-1");
      expect(loop.label).toBe("loop · practice, repeat while accuracy under 75% on practice");
      const repeat = layout.edges.filter((edge) => edge.repeat);
      expect(repeat).toHaveLength(1);
      expect(repeat[0].label).toBe("repeat");
      const [from, , , , to] = repeat[0].points;
      const inner = boxAt(layout, "node-1-0");
      expect(from.y).toBe(inner.y + inner.height);
      expect(to.y).toBeLessThan(inner.y);
      expect(Math.min(...repeat[0].points.map((point) => point.x))).toBeGreaterThan(loop.x);
      expect(repeat[0].labelAt!.y).toBeLessThan(loop.y + loop.height);
    });

    it("names an unnamed loop by its kind and reads an at-least rule", () => {
      const layout = layoutFlow(
        specOf([
          {
            kind: "loop",
            repeat_while: { scope: "", accuracy_at_least: 0.5 },
            children: [trial()],
          },
        ]),
      );
      expect(boxAt(layout, "node-0").label).toBe("loop, repeat while accuracy at least 50% on …");
    });
  });

  describe("branches", () => {
    const branch: SpecNode = {
      kind: "branch",
      when: { scope: "practice", accuracy_below: 0.8 },
      then: [trial("instructions"), trial()],
      otherwise: [],
    };

    it("forks into its two paths side by side and joins them again", () => {
      const layout = layoutFlow(specOf([branch, trial("survey-text")]));
      const decision = boxAt(layout, "node-0");
      expect(decision.shape).toBe("decision");
      expect(decision.label).toBe("branch, if accuracy under 80% on practice");

      const ifSo = boxAt(layout, "lane-0-0");
      const otherwise = boxAt(layout, "lane-0-1");
      expect(ifSo.label).toBe("if so");
      expect(otherwise.label).toBe("otherwise");
      expect(ifSo.path).toEqual([0, 0]);
      expect(ifSo.y).toBe(otherwise.y);
      expect(ifSo.x + ifSo.width).toBeLessThan(otherwise.x);

      expect(boxAt(layout, "node-0-0-1").path).toEqual([0, 0, 1]);
      expect(boxAt(layout, "empty-0-1").path).toBeNull();

      const after = boxAt(layout, "node-1");
      const lowest = Math.max(
        ...layout.boxes
          .filter((box) => /^(node|lane|empty)-0-/.test(box.key))
          .map((box) => box.y + box.height),
      );
      expect(after.y).toBeGreaterThan(lowest);
      const joins = layout.edges.filter((edge) => !edge.arrow);
      expect(joins).toHaveLength(2);
      expect(new Set(joins.map((edge) => edge.points.at(-1)!.y)).size).toBe(1);
    });

    it("says which answer a branch on a response looks for", () => {
      const onAnswer: SpecNode = {
        kind: "branch",
        when: { scope: "consent", question: "agree", response_equals: "no" },
        then: [trial()],
      };
      const layout = layoutFlow(specOf([onAnswer]));
      expect(boxAt(layout, "node-0").label).toBe("branch, if consent › agree answered “no”");
    });

    it("treats a missing otherwise as an empty path", () => {
      const { otherwise: _otherwise, ...withoutOtherwise } = branch;
      const layout = layoutFlow(specOf([withoutOtherwise]));
      expect(boxAt(layout, "empty-0-1").label).toBe("no steps");
    });
  });

  describe("group assignment", () => {
    it("shows each group as a path and says how participants are split", () => {
      const layout = layoutFlow(
        specOf([
          {
            kind: "assign",
            method: "balanced",
            record_as: "condition",
            groups: [
              { name: "control", children: [trial()] },
              { name: "", children: [trial()] },
              { name: "training", children: [trial()] },
            ],
          },
        ]),
      );
      expect(boxAt(layout, "node-0").label).toBe(
        "split · balanced, the data service picks the next group, recorded as condition",
      );
      expect(boxAt(layout, "lane-0-1").label).toBe("unnamed");
      const lanes = [0, 1, 2].map((index) => boxAt(layout, `lane-0-${index}`));
      for (let index = 1; index < lanes.length; index += 1) {
        expect(overlaps(lanes[index - 1], lanes[index])).toBe(false);
      }
      expect(layout.width).toBeGreaterThan(3 * STEP_WIDTH);
      expectInsideCanvas(layout);
    });

    it("describes random assignment", () => {
      const layout = layoutFlow(
        specOf([
          {
            kind: "assign",
            method: "random",
            groups: [{ name: "only", children: [trial()] }],
          },
        ]),
      );
      expect(boxAt(layout, "node-0").label).toBe(
        "split · random, each participant gets a group at random",
      );
    });
  });

  describe("checkpoints", () => {
    it("marks the point reached", () => {
      const layout = layoutFlow(stroop as unknown as Spec);
      const checkpoint = boxAt(layout, "node-1");
      expect(checkpoint.shape).toBe("marker");
      expect(checkpoint.label).toBe("checkpoint, reached “instructions-read”");
    });
  });

  describe("counterbalancing", () => {
    it("shows each task as a path and says how the order is chosen", () => {
      const layout = layoutFlow(
        specOf([
          {
            kind: "counterbalance",
            method: "latin_square",
            tasks: [
              { name: "flanker", children: [trial()] },
              { name: "stroop", children: [trial()] },
            ],
          },
        ]),
      );
      const decision = boxAt(layout, "node-0");
      expect(decision.shape).toBe("decision");
      expect(decision.label).toBe(
        "counterbalance · Latin square, the data service picks the next order, recorded as order",
      );
      expect(boxAt(layout, "lane-0-0").label).toBe("flanker");
      expect(boxAt(layout, "lane-0-1").label).toBe("stroop");
      expectInsideCanvas(layout);
    });

    it("describes a random order under its own column", () => {
      const layout = layoutFlow(
        specOf([
          {
            kind: "counterbalance",
            method: "random",
            record_as: "task_order",
            tasks: [{ name: "only", children: [trial()] }],
          },
        ]),
      );
      expect(boxAt(layout, "node-0").label).toBe(
        "counterbalance · random, each participant gets an order at random, recorded as task_order",
      );
    });
  });

  describe("early endings", () => {
    const end: SpecNode = { kind: "end", ending: "no_consent" };

    it("marks where the study ends and how", () => {
      const message = layoutFlow({
        ...specOf([end]),
        recruitment: { endings: { no_consent: { message: "<p>Thanks</p>" } } },
      });
      const box = boxAt(message, "node-0");
      expect(box.shape).toBe("marker");
      expect(box.label).toBe("end early, ending “no_consent”, shows a message, keeps all data");

      const redirect = layoutFlow({
        ...specOf([end]),
        recruitment: { endings: { no_consent: { url: "https://example.org/return" } } },
      });
      expect(boxAt(redirect, "node-0").label).toBe(
        "end early, ending “no_consent”, sends the participant on, keeps all data",
      );
    });

    it("says what an ending keeps of the participant's data", () => {
      const keeping = (keep: "checkpoint" | "nothing") =>
        boxAt(
          layoutFlow({
            ...specOf([end]),
            recruitment: { endings: { no_consent: { message: "<p>Thanks</p>", keep } } },
          }),
          "node-0",
        ).details.at(-1);
      expect(keeping("checkpoint")).toBe("keeps only where they ended");
      expect(keeping("nothing")).toBe("keeps no data");
    });

    it("names an ending that does not exist without guessing what it does", () => {
      const layout = layoutFlow(specOf([end]));
      expect(boxAt(layout, "node-0").label).toBe("end early, ending “no_consent”");
    });
  });

  describe("kinds without a layout of their own", () => {
    it("draws an unknown step by its kind", () => {
      const layout = layoutFlow(specOf([{ kind: "pause", seconds: 5 } as never]));
      const box = boxAt(layout, "node-0");
      expect(box.shape).toBe("step");
      expect(box.kind).toBe("pause");
      expect(box.label).toBe("pause");
    });

    it("leaves the steps of an unknown kind out until the compiler says where they are", () => {
      const layout = layoutFlow(
        specOf([{ kind: "sequence", children: [trial(), trial()] } as never]),
      );
      expect(boxAt(layout, "node-0").shape).toBe("step");
      expect(layout.boxes.some((box) => box.key.startsWith("node-0-"))).toBe(false);
    });
  });

  describe("nesting", () => {
    it("keeps every box inside the containers that hold it, at any depth", () => {
      const layout = layoutFlow(
        specOf(
          [
            {
              kind: "assign",
              method: "random",
              groups: [
                {
                  name: "a",
                  children: [
                    {
                      kind: "loop",
                      repeat_while: { scope: "p", accuracy_below: 0.7 },
                      children: [
                        {
                          kind: "block",
                          conditions: "t",
                          children: [trial("x", { tag: "p" })],
                        },
                        {
                          kind: "branch",
                          when: { scope: "p", accuracy_at_least: 0.9 },
                          then: [{ kind: "checkpoint", name: "good" }],
                        },
                      ],
                    },
                  ],
                },
                { name: "b", children: [trial()] },
              ],
            },
          ],
          { t: [{ x: 1 }] },
        ),
      );
      const loop = boxAt(layout, "node-0-0-0");
      const block = boxAt(layout, "node-0-0-0-0");
      expect(loop.shape).toBe("frame");
      expect(contains(loop, block)).toBe(true);
      expect(contains(block, boxAt(layout, "node-0-0-0-0-0"))).toBe(true);
      expect(contains(loop, boxAt(layout, "node-0-0-0-1"))).toBe(true);
      expect(contains(loop, boxAt(layout, "node-0-0-0-1-0-0"))).toBe(true);
      expect(boxAt(layout, "node-0-0-0-1-0-0").path).toEqual([0, 0, 0, 1, 0, 0]);
      expect(contains(loop, boxAt(layout, "empty-0-0-0-1-1"))).toBe(true);
      expect(overlaps(loop, boxAt(layout, "node-0-1-0"))).toBe(false);
      expect(new Set(layout.boxes.map((box) => box.key)).size).toBe(layout.boxes.length);
      expectInsideCanvas(layout);
    });
  });
});

describe("wrapText", () => {
  it("fills lines word by word", () => {
    expect(wrapText("repeat while accuracy under 75%", 14)).toEqual([
      "repeat while",
      "accuracy under",
      "75%",
    ]);
  });

  it("breaks a word longer than a line", () => {
    expect(wrapText("go abcdefghij", 4)).toEqual(["go", "abcd", "efgh", "ij"]);
  });

  it("keeps an empty text as one empty line", () => {
    expect(wrapText("", 10)).toEqual([""]);
  });
});
