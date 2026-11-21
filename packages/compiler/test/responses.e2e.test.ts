import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Asset, Spec } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace({ args: ["--autoplay-policy=no-user-gesture-required"] });
const PAGE_NAME = "responses.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

function fixture(name: string, path: string, type: string): Asset {
  const contents = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
  return { name, url: `data:${type};base64,${contents.toString("base64")}` };
}

const spec: Spec = {
  name: "responses",
  assets: [
    fixture("tone.wav", "./fixtures/tone.wav", "audio/wav"),
    fixture("clip.webm", "./fixtures/clip.webm", "video/webm"),
  ],
  conditions: { clips: [{ clip: "clip.webm" }] },
  timeline: [
    {
      kind: "block",
      conditions: "clips",
      children: [
        {
          kind: "trial",
          plugin: "video-keyboard-response",
          tag: "video key",
          params: { stimulus: { var: "clip" }, prompt: "<p>video key</p>", choices: ["f", "j"] },
        },
      ],
    },
    {
      kind: "trial",
      plugin: "video-button-response",
      tag: "video buttons",
      params: { stimulus: ["clip.webm"], prompt: "<p>video buttons</p>", choices: ["yes", "no"] },
    },
    {
      kind: "trial",
      plugin: "audio-button-response",
      tag: "sound buttons",
      params: { stimulus: "tone.wav", prompt: "<p>sound buttons</p>", choices: ["low", "high"] },
    },
  ],
};

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

async function shown(page: Page, prompt: string) {
  await page.locator("#jspsych-content").getByText(prompt).waitFor({ timeout: 15_000 });
}

// A video that can play has its first frame decoded; one with no usable source never does.
async function videoDecodes(page: Page) {
  await expect
    .poll(() =>
      page
        .locator("#jspsych-content video")
        .evaluate((video) => (video as HTMLVideoElement).readyState),
    )
    .toBeGreaterThanOrEqual(2);
}

describe("videos and sounds answered with keys or buttons", () => {
  it("plays each, takes the answer, and records it", async () => {
    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    await shown(page, "video key");
    await videoDecodes(page);
    await page.keyboard.press("j");

    await shown(page, "video buttons");
    await videoDecodes(page);
    await page.getByRole("button", { name: "no" }).click();

    await shown(page, "sound buttons");
    await page.getByRole("button", { name: "high" }).click();

    // The generated script declares jsPsych as a constant, so it is read by name.
    const responses = await page.evaluate(
      "jsPsych.data.get().values().filter((row) => row.tag).map((row) => [row.tag, row.response])",
    );
    expect(responses).toEqual([
      ["video key", "j"],
      ["video buttons", 1],
      ["sound buttons", 1],
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
