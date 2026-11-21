import { describe, expect, it } from "vitest";
import { STEP_COLUMN, type Spec } from "tachisto-compiler";
import flanker from "../../../examples/flanker.json";
import stroop from "../../../examples/stroop.json";
import { pluginSchema } from "../src/lib/schemas.ts";
import {
  capturePage,
  captureSpec,
  placeCapture,
  readCaptureMessage,
} from "../src/lib/screen-capture.ts";
import { sequenceAt, type Sequence } from "../src/lib/sequence.ts";
import type { ScreenPicture } from "../src/lib/text-screen.ts";

const spec = stroop as Spec;
const sequence = sequenceAt(spec, [2, 1], pluginSchema)!;
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const TEXT = {
  width: 800,
  height: 500,
  background: null,
  lines: [
    {
      x: 400,
      baseline: 260,
      anchor: "middle",
      spans: [
        {
          text: "RED",
          fontFamily: '"Open Sans", Arial, sans-serif',
          fontSize: 48,
          fontWeight: "400",
          fontStyle: "normal",
          colour: "rgb(255, 0, 0)",
        },
      ],
    },
  ],
};

describe("captureSpec", () => {
  it("runs the block once, in order, for the row asked for, with no pause between steps", () => {
    const { spec: narrowed } = captureSpec(spec, sequence, 1);
    const block = narrowed.timeline.find((node) => node.kind === "block")!;
    expect(block).toMatchObject({ repetitions: 1, randomize_order: false });
    expect(narrowed.conditions?.stroop_trials).toEqual([spec.conditions!.stroop_trials[1]]);
    expect(narrowed.settings?.default_iti).toBe(0);
  });

  it("runs a loop once, since nobody answers to end it", () => {
    const practice = sequenceAt(flanker as Spec, [1, 0, 0], pluginSchema)!;
    const { spec: narrowed } = captureSpec(flanker as Spec, practice);
    const loop = narrowed.timeline.find((node) => node.kind === "loop")!;
    expect(loop).toMatchObject({ repeat_while: { accuracy_below: 0 } });
  });

  it("falls back on the first row for a row the table does not have", () => {
    const { spec: narrowed } = captureSpec(spec, sequence, 99);
    expect(narrowed.conditions?.stroop_trials).toEqual([spec.conditions!.stroop_trials[0]]);
  });

  it("leaves out everything before the block, and never saves data", () => {
    const { spec: narrowed } = captureSpec({ ...spec, data: { save: "download" } }, sequence);
    expect(narrowed.timeline).toHaveLength(1);
    expect(narrowed.data).toBeUndefined();
  });

  it("does not change the study it narrows", () => {
    const before = JSON.stringify(spec);
    captureSpec(spec, sequence, 2);
    expect(JSON.stringify(spec)).toBe(before);
  });
});

describe("capturePage", () => {
  it("holds the study's timers before jsPsych loads, so no step ends before it is pictured", async () => {
    const html = await capturePage(spec, sequence);
    const hold = html.indexOf("window.setTimeout = ");
    expect(hold).toBeGreaterThan(-1);
    expect(hold).toBeLessThan(html.indexOf('<script src="https://unpkg.com/jspsych@'));
    expect(html).toContain("this.muted = true");
  });

  it("never loads the DataPipe extension, so picturing a study that saves as it goes sends nothing", async () => {
    const streaming: Spec = {
      ...spec,
      data: { save: "post", experiment_id: "real", stream: true },
    };
    const html = await capturePage(streaming, sequence);
    expect(html).not.toContain("extension-pipe");
    expect(html).not.toContain("jsPsychExtensionPipe");
  });

  it("carries the picturing library and the hooks that picture each step", async () => {
    const html = await capturePage(spec, sequence);
    expect(html).toContain("htmlToImage");
    expect(html).toContain("const measureTextScreen = (function");
    expect(html).toContain(`trial.data?.${STEP_COLUMN}`);
    expect(html).toContain("window.tachistoCapture(step)");
    expect(html).toContain('"tachisto-capture"');
  });
});

describe("readCaptureMessage", () => {
  it("reads a picture of a step, and the end of the run", () => {
    expect(readCaptureMessage({ source: "tachisto-capture", step: "2.1", png: PNG })).toEqual({
      done: false,
      step: "2.1",
      picture: PNG,
    });
    expect(readCaptureMessage({ source: "tachisto-capture", done: true })).toEqual({ done: true });
  });

  it("refuses a picture that is anything but plain PNG data, since it goes into the figure", () => {
    const hostile = `${PNG}"/><script>alert(1)</script>`;
    expect(
      readCaptureMessage({ source: "tachisto-capture", step: "2.1", png: hostile }),
    ).toBeNull();
    expect(
      readCaptureMessage({
        source: "tachisto-capture",
        step: "2.1",
        png: "data:image/svg+xml,<svg/>",
      }),
    ).toBeNull();
  });

  it("refuses a picture far larger than any screen", () => {
    const huge = `data:image/png;base64,${"A".repeat(4_000_001)}`;
    expect(readCaptureMessage({ source: "tachisto-capture", step: "2.1", png: huge })).toBeNull();
  });

  it("reads a step that could not be pictured", () => {
    expect(readCaptureMessage({ source: "tachisto-capture", step: "2.1", png: null })).toEqual({
      done: false,
      step: "2.1",
      picture: null,
    });
  });

  it("takes a step's text over its picture, where the step showed nothing else", () => {
    const message = readCaptureMessage({
      source: "tachisto-capture",
      step: "2.1",
      png: PNG,
      text: TEXT,
    });
    expect(message).toMatchObject({ picture: { lines: [{ spans: [{ text: "RED" }] }] } });
    expect(
      readCaptureMessage({ source: "tachisto-capture", step: "2.1", png: null, text: TEXT }),
    ).toMatchObject({ picture: { width: 800 } });
  });

  it("falls back on the picture when the text cannot be read", () => {
    const unreadable = { ...TEXT, lines: [{ ...TEXT.lines[0], anchor: "justify" }] };
    for (const text of [null, unreadable, "RED"]) {
      expect(
        readCaptureMessage({ source: "tachisto-capture", step: "2.1", png: PNG, text }),
      ).toEqual({ done: false, step: "2.1", picture: PNG });
    }
  });

  it("refuses a hostile picture even beside readable text", () => {
    expect(
      readCaptureMessage({ source: "tachisto-capture", step: "2.1", png: "<svg/>", text: TEXT }),
    ).toBeNull();
  });

  it("ignores messages from anything else, and steps that are not places in the timeline", () => {
    expect(readCaptureMessage({ source: "tachisto-preview", step: "2.1", png: PNG })).toBeNull();
    expect(readCaptureMessage({ source: "tachisto-capture", step: "2.x", png: PNG })).toBeNull();
    expect(readCaptureMessage({ source: "tachisto-capture", step: null, png: PNG })).toBeNull();
    expect(readCaptureMessage("tachisto-capture")).toBeNull();
  });
});

describe("placeCapture", () => {
  const withPause: Sequence = {
    ...sequence,
    segments: [
      sequence.segments[0],
      { ...sequence.segments[0], path: null, role: "gap", title: "Pause" },
      { ...sequence.segments[1], path: [2, 1], role: "group" },
    ],
  };

  it("gives a picture to the segment holding the step, and only the first one it gets", () => {
    const screens: (ScreenPicture | undefined)[] = [undefined, undefined, undefined];
    expect(placeCapture(withPause, screens, "2.1.0", PNG)).toBe(true);
    expect(placeCapture(withPause, screens, "2.1.1", "data:image/png;base64,later")).toBe(false);
    expect(screens).toEqual([undefined, undefined, PNG]);
  });

  it("never gives one to a pause, or to a step outside the sequence", () => {
    const screens: (ScreenPicture | undefined)[] = [undefined, undefined, undefined];
    expect(placeCapture(withPause, screens, "7", PNG)).toBe(false);
    expect(screens).toEqual([undefined, undefined, undefined]);
  });
});
