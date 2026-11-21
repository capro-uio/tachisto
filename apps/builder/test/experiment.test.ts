import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Spec } from "tachisto-compiler";
import flanker from "../../../examples/flanker.json";
import {
  buildExperimentHtml,
  buildProjectZip,
  studyFigures,
} from "../src/lib/experiment.svelte.ts";
import { studyFlowFigure } from "../src/lib/flow-figure.ts";
import { exportedSpec, loadSpec } from "../src/lib/project.svelte.ts";
import { installedFetch } from "./installed.ts";

describe("buildProjectZip", () => {
  it("carries the study's flow figure beside the experiment", async () => {
    loadSpec(flanker as Spec);
    const files = unzipSync(await buildProjectZip({ selfContained: false, capture: pictureFirst }));
    expect(strFromU8(files["figures/flow.svg"])).toBe(studyFlowFigure(exportedSpec()));
    expect(strFromU8(files["figures/block-flanker_trials.svg"])).toContain("<image");
    expect(strFromU8(files["README.md"])).toContain(
      "`flow.svg`, `loop-practice.svg`, `block-flanker_trials.svg`",
    );
    expect(files["index.html"]).toBeDefined();
  });
});

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const pictureFirst = vi.fn((_spec: Spec, sequence: { segments: unknown[] }) =>
  Promise.resolve(sequence.segments.map((_, index) => (index === 0 ? PNG : undefined))),
);

describe("studyFigures", () => {
  it("draws the flow and each block and loop, pictured, named after its conditions or the loop", async () => {
    const figures = await studyFigures(flanker as Spec, { capture: pictureFirst });
    expect(Object.keys(figures)).toEqual([
      "flow.svg",
      "loop-practice.svg",
      "block-flanker_trials.svg",
    ]);
    expect(figures["block-flanker_trials.svg"]).toContain(`xlink:href="${PNG}"`);
  });

  it("still draws a block whose screens could not be pictured", async () => {
    const failing = () => Promise.reject(new Error("no frame"));
    const figures = await studyFigures(flanker as Spec, { capture: failing });
    expect(figures["block-flanker_trials.svg"]).toContain("<svg");
    expect(figures["block-flanker_trials.svg"]).not.toContain("<image");
  });

  it("stops picturing once a block comes back with no screen at all, as when jsPsych is out of reach", async () => {
    const nothing = vi.fn(() => Promise.resolve([] as (string | undefined)[]));
    const figures = await studyFigures(flanker as Spec, { capture: nothing });
    expect(nothing).toHaveBeenCalledTimes(1);
    expect(Object.keys(figures)).toHaveLength(3);
  });

  it("says how far along it is", async () => {
    const progress: number[] = [];
    await studyFigures(flanker as Spec, {
      capture: pictureFirst,
      onProgress: ({ done, total }) => progress.push(done, total),
    });
    expect(progress).toEqual([0, 2, 1, 2]);
  });

  it("makes each figure as chosen, with a PNG beside it when PNGs are chosen", async () => {
    const toPng = vi.fn(() => Promise.resolve(new Blob([new Uint8Array([137, 80, 78, 71])])));
    const figures = await studyFigures(flanker as Spec, {
      capture: pictureFirst,
      toPng,
      choices: { arrangement: "row", size: "single", format: "png", blocks: {} },
    });
    expect(figures["block-flanker_trials.svg"]).toMatch(/width="[\d.]+mm"/);
    expect(figures["block-flanker_trials.png"]).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(figures["flow.png"]).toEqual(new Uint8Array([137, 80, 78, 71]));
    expect(figures["flow.svg"]).toMatch(/width="[\d.]+mm"/);
    expect(toPng).toHaveBeenCalledTimes(3);
  });

  it("tells apart two blocks that run the same table", async () => {
    const twice: Spec = {
      name: "twice",
      conditions: { words: [{ word: "RED" }] },
      timeline: [0, 1].map(() => ({
        kind: "block" as const,
        conditions: "words",
        children: [
          { kind: "trial" as const, plugin: "html-keyboard-response", params: { stimulus: "x" } },
        ],
      })),
    };
    const figures = await studyFigures(twice, { capture: pictureFirst });
    expect(Object.keys(figures)).toEqual(["flow.svg", "block-words.svg", "block-words-1.svg"]);
  });
});

describe("a self-contained download", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("carries checked copies of jsPsych and its plugins under lib/, loading nothing from unpkg", async () => {
    vi.stubGlobal("fetch", installedFetch);
    loadSpec(flanker as Spec);
    const files = unzipSync(await buildProjectZip({ selfContained: true, capture: pictureFirst }));
    expect(files["lib/jspsych/dist/index.browser.min.js"]).toBeDefined();
    expect(
      files["lib/@jspsych/plugin-html-keyboard-response/dist/index.browser.min.js"],
    ).toBeDefined();
    expect(strFromU8(files["index.html"])).not.toContain("unpkg.com");
  });

  it("writes jsPsych and its plugins into a single page", async () => {
    vi.stubGlobal("fetch", installedFetch);
    loadSpec(flanker as Spec);
    const html = await buildExperimentHtml({ selfContained: true });
    expect(html).not.toMatch(/\bsrc="|<link /);
    expect(html).toContain(".jspsych-display-element");
  });

  it("carries a study that saves as it goes in a single page, its extension checked", async () => {
    vi.stubGlobal("fetch", installedFetch);
    loadSpec({
      ...(flanker as Spec),
      data: { save: "post", experiment_id: "abc123DEF456", stream: true },
    });
    const html = await buildExperimentHtml({ selfContained: true });
    expect(html).toMatch(
      /<script data-package="@jspsych\/extension-pipe" src="data:text\/javascript;base64,[A-Za-z0-9+/=]+" integrity="sha384-[A-Za-z0-9+/=]+"><\/script>/,
    );
    expect(html).not.toMatch(/<script[^>]*\ssrc="(?!data:)|<link /);
  });

  it("refuses an eye-tracking study as one page before fetching anything", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    loadSpec({
      name: "tracking",
      timeline: [
        { kind: "trial", plugin: "webgazer-init-camera" },
        { kind: "trial", plugin: "webgazer-calibrate" },
      ],
    });
    await expect(buildExperimentHtml({ selfContained: true })).rejects.toThrow(
      /cannot be carried in one page; download the project folder instead/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("loads from unpkg, checked, when it is not self-contained", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    loadSpec(flanker as Spec);
    const html = await buildExperimentHtml({ selfContained: false });
    expect(html).toContain('src="https://unpkg.com/jspsych@');
    expect(html).toContain('integrity="sha384-');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
