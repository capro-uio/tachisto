import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Spec } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "survey.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

const spec: Spec = {
  name: "choices",
  timeline: [
    {
      kind: "trial",
      plugin: "survey-multi-choice",
      tag: "colour",
      params: {
        questions: [
          {
            prompt: "<p>Pick a colour</p>",
            name: "colour",
            options: ["red", "blue"],
            required: true,
          },
        ],
      },
    },
    {
      kind: "branch",
      when: { scope: "colour", question: "colour", response_equals: "blue" },
      then: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: '<p id="path">blue path</p>' },
        },
      ],
      otherwise: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: '<p id="path">red path</p>' },
        },
      ],
    },
    {
      kind: "trial",
      plugin: "survey-multi-select",
      tag: "fruit",
      params: {
        questions: [
          { prompt: "<p>Which do you eat?</p>", name: "fruit", options: ["apple", "pear", "plum"] },
        ],
      },
    },
    {
      kind: "branch",
      when: { scope: "fruit", question: "fruit", response_equals: "plum" },
      then: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: '<p id="ticked">plum was ticked</p>' },
        },
      ],
    },
  ],
};

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("choice questions", () => {
  it("records one choice and several ticks, and branches on each", async () => {
    const { html } = await emitHtml(compileSpec(spec, schemas), {
      title: "choices",
      base: "/node_modules",
    });
    writeFileSync(join(workspaceRoot, PAGE_NAME), html);

    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    await page.getByLabel("blue").check();
    await page.locator("#jspsych-survey-multi-choice-next").click();
    await expect.poll(() => page.locator("#path").innerText()).toBe("blue path");
    await page.keyboard.press("a");

    await page.getByLabel("apple").check();
    await page.getByLabel("plum").check();
    await page.locator("#jspsych-survey-multi-select-next").click();
    await expect.poll(() => page.locator("#ticked").innerText()).toBe("plum was ticked");

    const responses = await page.evaluate(() =>
      (
        window as unknown as {
          studioExperiment: {
            jsPsych: { data: { get(): { values(): { tag?: string; response?: unknown }[] } } };
          };
        }
      ).studioExperiment.jsPsych.data
        .get()
        .values()
        .filter((row) => row.tag)
        .map((row) => [row.tag, row.response]),
    );
    expect(responses).toEqual([
      ["colour", { colour: "blue" }],
      ["fruit", { fruit: ["apple", "plum"] }],
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
