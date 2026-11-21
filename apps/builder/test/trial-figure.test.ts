// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Spec } from "tachisto-compiler";
import stroop from "../../../examples/stroop.json";
import { pluginSchema } from "../src/lib/schemas.ts";
import { sequenceAt, type Segment, type Sequence } from "../src/lib/sequence.ts";
import type { TextScreen } from "../src/lib/text-screen.ts";
import { CHAR_WIDTH } from "../src/lib/figure.ts";
import {
  COLUMN_WIDTH_MM,
  fitTrialFigure,
  LINE_HEIGHT,
  labelLines,
  MIN_SCREEN_WIDTH,
  MM_PER_UNIT,
  layoutTrialFigure,
  SCREEN,
  sequenceFigure,
  trialFigureSvg,
  varyingScreens,
  withConditions,
  type TrialFigure,
} from "../src/lib/trial-figure.ts";

const segment = (role: Segment["role"], title: string, extra: Partial<Segment> = {}): Segment => ({
  path: [0],
  role,
  title,
  timing: { kind: "fixed", ms: { min: 500, max: 500 } },
  weight: 500,
  ...extra,
});

const wordScreen = (text: string, background: string | null = null): TextScreen => ({
  width: 800,
  height: 500,
  background,
  lines: [
    {
      x: 400,
      baseline: 260,
      anchor: "middle",
      spans: [
        {
          text,
          fontFamily: "'Open Sans', sans-serif",
          fontSize: 48,
          fontWeight: "400",
          fontStyle: "normal",
          fill: "#ff0000",
          opacity: 1,
        },
      ],
    },
  ],
});

const sequenceOf = (...segments: Segment[]): Sequence => ({ path: [0], kind: "block", segments });

const trial = sequenceOf(
  segment("fixation", "Fixation"),
  segment("gap", "Pause", { path: null, timing: { kind: "fixed", ms: { min: 200, max: 400 } } }),
  segment("stimulus", "Target", {
    timing: { kind: "limit", ms: { min: 2000, max: 2000 } },
    answer: "f or j",
    shownFor: { min: 100, max: 100 },
  }),
);

function parse(svg: string) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(document.querySelector("parsererror")).toBeNull();
  return document.documentElement;
}

const labelHeight = 3 * LINE_HEIGHT;

function inside(figure: TrialFigure) {
  return figure.screens.every(
    (screen) =>
      screen.x >= 0 &&
      screen.y >= 0 &&
      screen.x + SCREEN.width <= figure.width &&
      screen.y + SCREEN.height <= figure.height,
  );
}

describe("labelLines", () => {
  it("names the step, says how long it lasts and how it is answered", () => {
    expect(labelLines(trial.segments[2])).toEqual([
      { text: "Target", emphasis: "title" },
      { text: "up to 2000 ms", emphasis: "timing" },
      { text: "shown 100 ms · f or j", emphasis: "detail" },
    ]);
  });

  it("writes a jittered pause as its range, and leaves out a detail it does not have", () => {
    expect(labelLines(trial.segments[1])).toEqual([
      { text: "Pause", emphasis: "title" },
      { text: "200–400 ms", emphasis: "timing" },
    ]);
  });
});

describe("layoutTrialFigure", () => {
  it("steps each stacked screen down and right of the last by the same amount", () => {
    const { screens } = layoutTrialFigure(trial, "stack");
    const steps = screens.slice(1).map((screen, index) => ({
      x: screen.x - screens[index].x,
      y: screen.y - screens[index].y,
    }));
    expect(new Set(steps.map((step) => `${step.x},${step.y}`)).size).toBe(1);
    expect(steps[0].x).toBeGreaterThan(0);
    expect(steps[0].y).toBeGreaterThan(0);
    expect(steps[0].x).toBeLessThan(SCREEN.width);
  });

  it("writes a stacked screen's label to its right, clear of the screen that follows", () => {
    const { screens } = layoutTrialFigure(trial, "stack");
    for (const [index, screen] of screens.slice(0, -1).entries()) {
      expect(screen.label.at.x).toBeGreaterThan(screen.x + SCREEN.width);
      expect(screen.label.at.y + labelHeight).toBeLessThanOrEqual(screens[index + 1].y);
    }
  });

  it("runs the stack's time arrow down and right, below every screen", () => {
    const { arrow, screens } = layoutTrialFigure(trial, "stack");
    expect(arrow.to.x).toBeGreaterThan(arrow.from.x);
    expect(arrow.to.y).toBeGreaterThan(arrow.from.y);
    expect(arrow.from.y).toBeGreaterThan(screens[0].y + SCREEN.height);
  });

  it("lines a row's screens up side by side without overlap, labelled beneath", () => {
    const { screens } = layoutTrialFigure(trial, "row");
    expect(new Set(screens.map((screen) => screen.y)).size).toBe(1);
    for (const [index, screen] of screens.slice(1).entries()) {
      expect(screen.x).toBeGreaterThan(screens[index].x + SCREEN.width);
    }
    for (const screen of screens) {
      expect(screen.label.anchor).toBe("middle");
      expect(screen.label.at.x).toBeCloseTo(screen.x + SCREEN.width / 2);
      expect(screen.label.at.y).toBeGreaterThan(screen.y + SCREEN.height);
    }
  });

  it("runs a row's time arrow level, under the labels, across every screen", () => {
    const { arrow, screens } = layoutTrialFigure(trial, "row");
    expect(arrow.from.y).toBe(arrow.to.y);
    expect(arrow.from.y).toBeGreaterThan(screens[0].label.at.y + 2 * LINE_HEIGHT);
    expect(arrow.to.x).toBeGreaterThanOrEqual(screens.at(-1)!.x + SCREEN.width);
  });

  it.each(["stack", "row"] as const)("fits every %s screen and label inside the figure", (way) => {
    const figure = layoutTrialFigure(trial, way);
    expect(inside(figure)).toBe(true);
    expect(figure.arrow.to.x).toBeLessThan(figure.width);
    expect(figure.arrow.to.y).toBeLessThan(figure.height);
  });

  it.each(["stack", "row"] as const)("draws an empty block as a finite %s figure", (way) => {
    const figure = layoutTrialFigure(sequenceOf(), way);
    for (const value of [figure.width, figure.height, figure.arrow.to.x, figure.arrow.to.y]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(figure.arrow.to.x).toBeGreaterThan(figure.arrow.from.x);
    parse(trialFigureSvg(figure, "empty", undefined));
  });

  it("widens a row's columns to fit a label longer than a screen", () => {
    const long = sequenceOf(segment("screen", "A".repeat(60)), segment("screen", "B"));
    const [first, second] = layoutTrialFigure(long, "row").screens;
    expect(second.label.at.x - first.label.at.x).toBeGreaterThan(60 * CHAR_WIDTH);
  });
});

describe("trialFigureSvg", () => {
  const svgOf = (settings?: Spec["settings"]) =>
    parse(trialFigureSvg(layoutTrialFigure(trial, "stack"), "a & b", settings));

  it("draws one screen per step, on the experiment's own background", () => {
    const root = svgOf({ background_color: "#808080" });
    const frames = root.querySelectorAll(`rect[width="${SCREEN.width}"]`);
    expect(frames).toHaveLength(3);
    for (const frame of frames) expect(frame.getAttribute("fill")).toBe("#808080");
  });

  it("draws a fixation's cross, leaves a pause blank, and names any other screen", () => {
    const groups = [...svgOf().querySelectorAll(":scope > g")];
    expect(groups[0].querySelector("path")).not.toBeNull();
    expect(groups[1].querySelector("path")).toBeNull();
    expect(groups[1].querySelectorAll(":scope > text")).toHaveLength(1);
    expect(groups[2].textContent).toContain("Target");
  });

  it("paints a colour that is not a colour as the default, so it cannot break the file", () => {
    const root = svgOf({ background_color: 'red"/><script>alert(1)</script><rect x="' });
    expect(root.querySelector("script")).toBeNull();
    expect(root.querySelector(`rect[width="${SCREEN.width}"]`)?.getAttribute("fill")).toBe(
      "#ffffff",
    );
  });

  it("shortens a name too long to fit across its screen", () => {
    const long = sequenceOf(segment("screen", "a very long name for a single screen of the task"));
    const root = parse(trialFigureSvg(layoutTrialFigure(long, "row"), "t", undefined));
    const centre = root.querySelector(":scope > g > text[opacity]")?.textContent ?? "";
    expect(centre.endsWith("…")).toBe(true);
    expect(centre.length * CHAR_WIDTH).toBeLessThan(SCREEN.width);
  });

  it("draws a captured screen inside its outline, and a placeholder where there is none", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    const root = parse(
      trialFigureSvg(layoutTrialFigure(trial, "stack"), "t", undefined, [png, undefined, png]),
    );
    const groups = [...root.querySelectorAll(":scope > g")];
    expect(groups[0].querySelector("image")?.getAttribute("xlink:href")).toBe(png);
    expect(groups[1].querySelector("image")).toBeNull();
    expect(groups[2].querySelector("image")).not.toBeNull();
    expect(groups[0].querySelector("path")).toBeNull();
  });

  it("draws a screen of text as text, on the page's background or the study's", () => {
    const settings = { background_color: "#eeeeee" };
    const root = parse(
      trialFigureSvg(layoutTrialFigure(trial, "stack"), "t", settings, [
        wordScreen("+", "#000000"),
        undefined,
        wordScreen("RED"),
      ]),
    );
    expect(root.querySelector("image")).toBeNull();
    const groups = [...root.querySelectorAll(":scope > g")];
    const [fixation, , target] = groups;
    expect(fixation.querySelector("rect")?.getAttribute("fill")).toBe("#000000");
    expect(target.querySelector("rect")?.getAttribute("fill")).toBe("#eeeeee");
    const word = target.querySelector("text[x]")!;
    expect(word.textContent).toBe("RED");
    expect(word.querySelector("tspan")?.getAttribute("fill")).toBe("#ff0000");
    const outline = target.querySelectorAll("rect")[1];
    expect(outline.getAttribute("fill")).toBe("none");
    expect(Number(word.getAttribute("x"))).toBeCloseTo(
      Number(outline.getAttribute("x")) + Number(outline.getAttribute("width")) / 2,
    );
  });

  it("carries every label and an arrow marked as time", () => {
    const root = svgOf();
    const text = root.textContent ?? "";
    for (const line of ["Fixation", "500 ms", "200–400 ms", "up to 2000 ms", "f or j", "Time"]) {
      expect(text).toContain(line);
    }
    expect(root.querySelector('path[marker-end="url(#arrow)"]')).not.toBeNull();
    expect(root.querySelector("title")?.textContent).toBe("a & b");
  });

  it("needs no stylesheet", () => {
    expect(trialFigureSvg(layoutTrialFigure(trial, "row"), "t", undefined)).not.toMatch(
      /var\(|class=|<style/,
    );
  });
});

describe("sequenceFigure", () => {
  it("draws an example's block from the timing strip, named after the study", () => {
    const spec = stroop as Spec;
    const sequence = sequenceAt(spec, [2, 1], pluginSchema)!;
    const { svg } = sequenceFigure(spec, sequence, { arrangement: "row", size: "screen" });
    const root = parse(svg);
    expect(root.querySelector("title")?.textContent).toMatch(/one pass through the block$/);
    expect(root.textContent).toContain("300 ms");
    expect(root.textContent).toContain("r or b");
  });

  it("is sized in pixels at screen size, and made twice over as a PNG", () => {
    const { svg, pixelWidth } = sequenceFigure(
      stroop as Spec,
      sequenceAt(stroop as Spec, [2, 1], pluginSchema)!,
      {
        arrangement: "stack",
        size: "screen",
      },
    );
    const width = Number(parse(svg).getAttribute("width"));
    expect(pixelWidth).toBe(width * 2);
  });

  it.each(["single", "double"] as const)(
    "fits a %s column of a page in millimetres, and prints at 300 dpi",
    (size) => {
      const sequence = sequenceAt(stroop as Spec, [2, 1], pluginSchema)!;
      const { svg, pixelWidth } = sequenceFigure(stroop as Spec, sequence, {
        arrangement: "stack",
        size,
      });
      const width = parseFloat(parse(svg).getAttribute("width") ?? "");
      expect(parse(svg).getAttribute("width")).toMatch(/mm$/);
      expect(width).toBeLessThanOrEqual(COLUMN_WIDTH_MM[size]);
      expect(pixelWidth).toBe(Math.round((width / 25.4) * 300));
    },
  );
});

describe("fitTrialFigure", () => {
  const four = sequenceOf(
    segment("fixation", "Fixation"),
    segment("screen", "Cue"),
    segment("stimulus", "Target", { answer: "f or j" }),
    segment("screen", "Feedback"),
  );
  const column = COLUMN_WIDTH_MM.single / MM_PER_UNIT;

  it("draws the largest screens that let the figure fit the width", () => {
    const fitted = fitTrialFigure(four, "stack", column);
    expect(fitted.width).toBeLessThanOrEqual(column);
    expect(fitted.screen.width).toBeLessThan(SCREEN.width);
    const larger = layoutTrialFigure(four, "stack", fitted.screen.width + 4);
    expect(larger.width).toBeGreaterThan(column);
  });

  it("keeps full-size screens when they already fit", () => {
    expect(fitTrialFigure(trial, "stack", 10_000).screen).toEqual(SCREEN);
  });

  it("goes no smaller than its smallest screens, even when the figure will not fit", () => {
    const figure = fitTrialFigure(four, "stack", 100);
    expect(figure.screen.width).toBe(MIN_SCREEN_WIDTH);
    expect(figure.width).toBeGreaterThan(100);
  });

  it("stops shrinking screens once the labels, not the screens, set the width", () => {
    const wordy = sequenceOf(
      ...["One", "Two", "Three", "Four"].map((name) =>
        segment("screen", `${name} screen with a long name`),
      ),
    );
    const figure = fitTrialFigure(wordy, "row", 100);
    const smallest = layoutTrialFigure(wordy, "row", MIN_SCREEN_WIDTH);
    expect(figure.width).toBe(smallest.width);
    expect(figure.screen.width).toBeGreaterThan(MIN_SCREEN_WIDTH);
  });

  it("keeps each label in a stack clear of the next screen, however small the screens", () => {
    const { screens } = layoutTrialFigure(trial, "stack", MIN_SCREEN_WIDTH);
    for (const [index, screen] of screens.slice(0, -1).entries()) {
      const lastBaseline = screen.label.at.y + (screen.label.lines.length - 1) * LINE_HEIGHT;
      expect(lastBaseline).toBeLessThan(screens[index + 1].y);
    }
  });
});

describe("conditions side by side", () => {
  const A = "data:image/png;base64,QQ==";
  const B = "data:image/png;base64,Qg==";
  const C = "data:image/png;base64,Qw==";
  const conditions = [
    { label: "congruent", pictures: [A, undefined, B], inputs: ["fix", "", "red"] },
    { label: "incongruent", pictures: [A, undefined, C], inputs: ["fix", "", "blue"] },
  ];

  it("finds the screens whose steps are given something different, never a pause", () => {
    expect(varyingScreens(trial, conditions)).toEqual([2]);
  });

  it("does not take pictures that differ for screens that differ", () => {
    const flickering = conditions.map((condition, index) => ({
      ...condition,
      pictures: [index ? B : A, undefined, condition.pictures[2]],
    }));
    expect(varyingScreens(trial, flickering)).toEqual([2]);
  });

  it("shows each differing screen in each condition beneath the sequence, captioned", () => {
    const figure = layoutTrialFigure(trial, "stack");
    const shown = withConditions(figure, trial, "congruency", conditions);
    const panel = shown.conditions!;
    expect(panel.heading.text).toBe("Conditions by congruency");
    expect(panel.cells.map((cell) => [cell.picture, cell.caption])).toEqual([
      [B, "congruent"],
      [C, "incongruent"],
    ]);
    expect(panel.cells[0].y).toBeGreaterThan(figure.height);
    expect(panel.cells[1].x).toBeGreaterThan(panel.cells[0].x + panel.screen.width);
    expect(panel.screen.width).toBeLessThan(figure.screen.width);
    expect(shown.height).toBeGreaterThan(panel.cells[0].captionY);
    expect(shown.screens).toEqual(figure.screens);
  });

  it("names the screen in each caption when more than one differs", () => {
    const two = [
      { label: "a", pictures: [A, undefined, B], inputs: ["1", "", "1"] },
      { label: "b", pictures: [B, undefined, C], inputs: ["2", "", "2"] },
    ];
    const panel = withConditions(layoutTrialFigure(trial, "row"), trial, "c", two).conditions!;
    expect(panel.cells.map((cell) => cell.caption)).toEqual([
      "Fixation: a",
      "Fixation: b",
      "Target: a",
      "Target: b",
    ]);
  });

  it("wraps onto more rows to stay within the width it is given", () => {
    const four = ["one", "two", "three", "four"].map((label, index) => ({
      label: `${label} condition`,
      pictures: [A, undefined, B],
      inputs: [`${index}`, "", `${index}`],
    }));
    const column = COLUMN_WIDTH_MM.single / MM_PER_UNIT;
    const figure = fitTrialFigure(trial, "stack", column);
    const shown = withConditions(figure, trial, "c", four, column);
    expect(shown.width).toBeLessThanOrEqual(column);
    expect(new Set(shown.conditions!.cells.map((cell) => cell.y)).size).toBeGreaterThan(1);
  });

  it("leaves out a differing screen not pictured in every condition", () => {
    const missing = [conditions[0], { ...conditions[1], pictures: [A, undefined, undefined] }];
    expect(withConditions(layoutTrialFigure(trial, "stack"), trial, "c", missing).conditions).toBe(
      undefined,
    );
  });

  it("leaves the figure alone when nothing differs or there is one condition", () => {
    const figure = layoutTrialFigure(trial, "stack");
    const alike = [conditions[0], { ...conditions[0], label: "again" }];
    expect(withConditions(figure, trial, "c", alike)).toBe(figure);
    expect(withConditions(figure, trial, "c", [conditions[0]])).toBe(figure);
  });

  it("draws the panel's heading, screens and captions", () => {
    const shown = withConditions(
      layoutTrialFigure(trial, "stack"),
      trial,
      "congruency",
      conditions,
    );
    const root = parse(trialFigureSvg(shown, "t", undefined, conditions[0].pictures));
    const text = root.textContent ?? "";
    expect(text).toContain("Conditions by congruency");
    expect(text).toContain("incongruent");
    expect(root.querySelectorAll(`image[*|href="${C}"]`)).toHaveLength(1);
    expect(Number(root.getAttribute("height"))).toBe(shown.height);
  });

  it("draws a condition's screen of text as text", () => {
    const words = [
      { label: "congruent", pictures: [A, undefined, wordScreen("RED")], inputs: ["", "", "1"] },
      { label: "incongruent", pictures: [A, undefined, wordScreen("BLUE")], inputs: ["", "", "2"] },
    ];
    const shown = withConditions(layoutTrialFigure(trial, "stack"), trial, "ink", words);
    const root = parse(trialFigureSvg(shown, "t", undefined, [undefined, undefined, undefined]));
    expect(root.querySelector("image")).toBeNull();
    const drawn = [...root.querySelectorAll("tspan[font-family]")].map((each) => each.textContent);
    expect(drawn).toEqual(["RED", "BLUE"]);
  });
});
