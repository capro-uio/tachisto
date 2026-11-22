import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Asset, Spec } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace({ args: ["--autoplay-policy=no-user-gesture-required"] });
const PAGE_NAME = "media.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

function fixture(name: string, path: string, type: string): Asset {
  const contents = readFileSync(fileURLToPath(new URL(path, import.meta.url)));
  return { name, url: `data:${type};base64,${contents.toString("base64")}` };
}

const spec: Spec = {
  name: "media",
  assets: [
    fixture("square.png", "../../../apps/builder/test/fixtures/square.png", "image/png"),
    fixture("tone.wav", "./fixtures/tone.wav", "audio/wav"),
    fixture("clip.webm", "./fixtures/clip.webm", "video/webm"),
  ],
  timeline: [
    {
      kind: "trial",
      plugin: "audio-keyboard-response",
      params: { stimulus: "tone.wav", prompt: "<p>listening</p>", choices: ["a"] },
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

describe("a study with image, audio and video files", () => {
  it("loads every file and reaches the trial that plays the sound", async () => {
    const page = await served.browser.newPage();
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    await page.locator("#jspsych-content").getByText("listening").waitFor({ timeout: 15_000 });
    // The generated script declares jsPsych as a constant; window.jsPsych is jsPsych's own
    // migration trap, so the page's constant is read by name.
    const preload: unknown = await page.evaluate("jsPsych.data.get().values()[0]");
    expect(preload).toMatchObject({
      trial_type: "preload",
      success: true,
      failed_images: [],
      failed_audio: [],
      failed_video: [],
    });
    await page.close();
  }, 120_000);

  // An embedded file is shown from its data URL, which a plugin would otherwise record in full.
  it("records the file a trial played by its name, not by its contents", async () => {
    const page = await served.browser.newPage();
    await page.goto(`${served.server.url}/${PAGE_NAME}`);
    await page.locator("#jspsych-content").getByText("listening").waitFor({ timeout: 15_000 });
    await page.keyboard.press("a");

    await expect
      .poll(() =>
        page.evaluate(
          "jsPsych.data.get().filter({ trial_type: 'audio-keyboard-response' }).count()",
        ),
      )
      .toBe(1);
    const row = await page.evaluate<{ stimulus: string }>(
      "jsPsych.data.get().filter({ trial_type: 'audio-keyboard-response' }).values()[0]",
    );
    expect(row.stimulus).toBe("tone.wav");
    await page.close();
  }, 120_000);
});
