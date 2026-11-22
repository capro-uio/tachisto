import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Spec, TrialNode } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "tasks.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const square = readFileSync(
  fileURLToPath(new URL("../../../apps/builder/test/fixtures/square.png", import.meta.url)),
).toString("base64");

const step = (plugin: string, params: Record<string, unknown>): TrialNode => ({
  kind: "trial",
  plugin,
  tag: plugin,
  params: params as TrialNode["params"],
});

const spec: Spec = {
  name: "tasks",
  assets: [{ name: "square.png", url: `data:image/png;base64,${square}` }],
  timeline: [
    step("animation", { stimuli: ["square.png", "square.png"], frame_time: 100 }),
    step("cloze", { text: "<p>The cat sat on the %mat%.</p>" }),
    step("maxdiff", {
      alternatives: ["tea", "coffee", "water"],
      labels: ["Least liked", "Most liked"],
    }),
    step("iat-html", { stimulus: "<p>tulip</p>", stim_key_association: "left" }),
    step("visual-search-circle", {
      target: "square.png",
      foil: "square.png",
      set_size: 3,
      target_present: true,
      fixation_image: "square.png",
      fixation_duration: 100,
    }),
    step("free-sort", { stimuli: ["square.png", "square.png"], stim_starts_inside: true }),
    step("sketchpad", { prompt: "<p>draw something</p>" }),
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

async function rowOf(page: Page, tag: string) {
  await expect
    .poll(() => page.evaluate(`jsPsych.data.get().filter({ tag: ${JSON.stringify(tag)} }).count()`))
    .toBe(1);
  // The generated script declares jsPsych as a constant, so it is read by name.
  return page.evaluate<Record<string, unknown>>(
    `jsPsych.data.get().filter({ tag: ${JSON.stringify(tag)} }).values()[0]`,
  );
}

describe("participant tasks", () => {
  it("runs each one and records what the participant did", async () => {
    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    expect((await rowOf(page, "animation")).animation_sequence).toHaveLength(2);

    await page.locator("#input0").fill("mat");
    await page.locator("#finish_cloze_button").click();
    expect((await rowOf(page, "cloze")).response).toEqual(["mat"]);

    await page.locator('input[name="left"][data-name="2"]').check();
    await page.locator('input[name="right"][data-name="1"]').check();
    await page.locator("#jspsych-maxdiff-next").click();
    expect((await rowOf(page, "maxdiff")).response).toEqual({ left: "water", right: "coffee" });

    await page.locator("#jspsych-content").getByText("tulip").waitFor();
    await page.keyboard.press("e");
    expect((await rowOf(page, "iat-html")).correct).toBe(true);

    await page.locator("#jspsych-content img").nth(1).waitFor({ timeout: 10_000 });
    await page.keyboard.press("j");
    expect((await rowOf(page, "visual-search-circle")).correct).toBe(true);

    await page.locator("#jspsych-free-sort-done-btn").click();
    expect((await rowOf(page, "free-sort")).final_locations).toHaveLength(2);

    const canvas = page.locator("#sketchpad-canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 120, { steps: 5 });
    await page.mouse.up();
    await page.locator("#sketchpad-end").click();
    const drawing = await rowOf(page, "sketchpad");
    expect(drawing.png).toMatch(/^data:image\/png;base64,/);
    expect(drawing.strokes).toHaveLength(1);

    expect(errors).toEqual([]);
    await page.close();
  });
});
