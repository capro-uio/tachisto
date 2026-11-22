import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Asset, Spec, TrialNode } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace({ args: ["--autoplay-policy=no-user-gesture-required"] });
const PAGE_NAME = "slider.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

function fixture(name: string, path: string, type: string): Asset {
  const contents = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
  return { name, url: `data:${type};base64,${contents.toString("base64")}` };
}

const slider = (plugin: string, stimulus: unknown): TrialNode => ({
  kind: "trial",
  plugin,
  tag: plugin,
  params: { stimulus, labels: ["low", "high"], prompt: `<p>${plugin}</p>` } as TrialNode["params"],
});

const spec: Spec = {
  name: "sliders",
  assets: [
    fixture("square.png", "../../../apps/builder/test/fixtures/square.png", "image/png"),
    fixture("tone.wav", "./fixtures/tone.wav", "audio/wav"),
    fixture("clip.webm", "./fixtures/clip.webm", "video/webm"),
  ],
  timeline: [
    slider("html-slider-response", "<p>How sure are you?</p>"),
    {
      kind: "branch",
      when: { scope: "html-slider-response", response_equals: 80 },
      then: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: '<p id="path">quite sure</p>' },
        },
      ],
    },
    slider("image-slider-response", "square.png"),
    slider("audio-slider-response", "tone.wav"),
    slider("video-slider-response", ["clip.webm"]),
    {
      kind: "block",
      conditions: "videos",
      children: [{ ...slider("video-slider-response", { var: "video" }), tag: "from a column" }],
    },
  ],
  conditions: { videos: [{ video: "clip.webm" }] },
};

// A video that can play has its first frame decoded; one with no usable source never does.
async function videoPlays(page: Page) {
  await expect
    .poll(
      () =>
        page
          .locator("#jspsych-content video")
          .evaluate((video) => (video as HTMLVideoElement).readyState),
      {
        timeout: 10_000,
      },
    )
    .toBeGreaterThanOrEqual(2);
}

beforeAll(async () => {
  const { html } = await emitHtml(compileSpec(spec, schemas), {
    title: spec.name,
    base: "/node_modules",
  });
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);
}, 120_000);

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

async function answer(page: Page, plugin: string, value: string) {
  await page.locator("#jspsych-content").getByText(plugin).waitFor({ timeout: 15_000 });
  await page.locator(`#jspsych-${plugin}-response`).fill(value);
  await page.locator(`#jspsych-${plugin}-next`).click();
}

describe("slider questions", () => {
  it("records where each slider was set, whatever it shows, and branches on it", async () => {
    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    await answer(page, "html-slider-response", "80");
    await expect.poll(() => page.locator("#path").innerText()).toBe("quite sure");
    await page.keyboard.press("a");
    await answer(page, "image-slider-response", "10");
    await answer(page, "audio-slider-response", "30");
    await page.locator("#jspsych-content").getByText("video-slider-response").waitFor();
    await videoPlays(page);
    await answer(page, "video-slider-response", "60");
    await page.locator("#jspsych-content").getByText("video-slider-response").waitFor();
    await videoPlays(page);
    await answer(page, "video-slider-response", "40");

    // The generated script declares jsPsych as a constant, so it is read by name.
    const responses = await page.evaluate(
      "jsPsych.data.get().values().filter((row) => row.tag).map((row) => [row.tag, row.response])",
    );
    expect(responses).toEqual([
      ["html-slider-response", 80],
      ["image-slider-response", 10],
      ["audio-slider-response", 30],
      ["video-slider-response", 60],
      ["from a column", 40],
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });
});

describe("a single-file experiment opened from disk", () => {
  it("plays its embedded video", async () => {
    const opened: Spec = {
      name: "from disk",
      assets: spec.assets,
      timeline: [slider("video-slider-response", ["clip.webm"])],
    };
    const { html } = await emitHtml(compileSpec(opened, schemas), {
      title: opened.name,
      base: `file://${join(workspaceRoot, "node_modules")}`,
    });
    const file = join(workspaceRoot, "slider-from-disk.e2e.html");
    writeFileSync(file, html);
    try {
      const page = await served.browser.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`file://${file}`);
      await page
        .locator("#jspsych-content")
        .getByText("video-slider-response")
        .waitFor({ timeout: 15_000 });
      await videoPlays(page);
      expect(errors).toEqual([]);
      await page.close();
    } finally {
      rmSync(file, { force: true });
    }
  });
});
