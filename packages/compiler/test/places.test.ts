import { describe, expect, it } from "vitest";
import { placeOf } from "../src/places.ts";
import type { Spec } from "../src/types.ts";

const trial = (stimulus: string) => ({
  kind: "trial" as const,
  plugin: "html-keyboard-response",
  params: { stimulus },
});

const spec: Spec = {
  name: "placed",
  timeline: [
    trial("<p>one</p>"),
    {
      kind: "branch",
      on: { kind: "accuracy", threshold: 0.5 },
      then: [trial("<p>then</p>")],
      otherwise: [{ kind: "block", children: [trial("<p>deep</p>")] }],
    } as unknown as Spec["timeline"][number],
  ],
};

describe("where a problem is, in words", () => {
  it("counts a step from one, as a reader does", () => {
    expect(placeOf(spec, [0])).toBe("step 1");
    expect(placeOf(spec, [1])).toBe("step 2");
  });

  // "step 2.1.1" would name a step that does not exist: the middle index is which path, not a step.
  it("names a branch's path rather than numbering it", () => {
    expect(placeOf(spec, [1, 0, 0])).toBe("step 2, if so, step 1");
    expect(placeOf(spec, [1, 1, 0])).toBe("step 2, otherwise, step 1");
  });

  it("walks on through a step that holds steps of its own", () => {
    expect(placeOf(spec, [1, 1, 0, 0])).toBe("step 2, otherwise, step 1, step 1");
  });

  it("says as much as it can of a path that does not lead anywhere", () => {
    expect(placeOf(spec, [9])).toBe("step 10");
    expect(placeOf(spec, [1, 5, 0])).toBe("step 2");
  });
});
