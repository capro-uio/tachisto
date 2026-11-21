import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Spec } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "judging.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

const spec: Spec = {
  name: "judging",
  timeline: [
    {
      kind: "trial",
      plugin: "categorize-html",
      tag: "sorted",
      params: {
        stimulus: "<p>a vowel?</p>",
        choices: ["f", "j"],
        key_answer: "f",
        feedback_duration: 100,
      },
    },
    {
      kind: "trial",
      plugin: "same-different-html",
      tag: "compared",
      params: {
        stimuli: ["<p>A</p>", "<p>A</p>"],
        answer: "same",
        first_stim_duration: 100,
        gap_duration: 100,
        second_stim_duration: 100,
        prompt: "<p>same or different?</p>",
      },
    },
    {
      kind: "branch",
      when: { scope: "sorted", accuracy_at_least: 1 },
      then: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: '<p id="path">sorted right</p>' },
        },
      ],
      otherwise: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: '<p id="path">sorted wrong</p>' },
        },
      ],
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

describe("steps that score themselves", () => {
  it("record whether each answer was right, which a branch on accuracy then reads", async () => {
    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    await page.locator("#jspsych-content").getByText("a vowel?").waitFor({ timeout: 15_000 });
    await page.keyboard.press("j");
    await page.locator("#jspsych-content").getByText("same or different?").waitFor();
    await page.keyboard.press("q");
    await expect.poll(() => page.locator("#path").innerText()).toBe("sorted wrong");

    // The generated script declares jsPsych as a constant, so it is read by name.
    const rows = await page.evaluate(
      "jsPsych.data.get().values().filter((row) => row.tag).map((row) => [row.tag, row.response, row.correct])",
    );
    expect(rows).toEqual([
      ["sorted", "j", false],
      ["compared", "q", true],
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });
});

describe("squares lit one at a time", () => {
  it("score the key pressed and the square clicked", async () => {
    const squares: Spec = {
      name: "squares",
      // A conditions cell holds its target as text, as the builder's table writes it.
      conditions: { targets: [{ target: "0,1" }] },
      timeline: [
        {
          kind: "trial",
          plugin: "serial-reaction-time",
          tag: "keyed",
          params: {
            grid: [
              [1, 1],
              [1, 1],
            ],
            choices: [
              ["q", "w"],
              ["a", "s"],
            ],
            target: [1, 0],
          },
        },
        {
          kind: "block",
          conditions: "targets",
          children: [
            {
              kind: "trial",
              plugin: "serial-reaction-time-mouse",
              tag: "clicked",
              params: {
                grid: [
                  [1, 1],
                  [1, 1],
                ],
                target: { var: "target" },
              },
            },
          ],
        },
      ],
    };
    const { html } = await emitHtml(compileSpec(squares, schemas), {
      title: squares.name,
      base: "/node_modules",
    });
    writeFileSync(join(workspaceRoot, PAGE_NAME), html);
    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    await page
      .locator("#jspsych-serial-reaction-time-stimulus-cell-1-0")
      .waitFor({ timeout: 15_000 });
    await page.keyboard.press("a");
    await expect
      .poll(() => page.evaluate("jsPsych.data.get().filter({ tag: 'keyed' }).count()"))
      .toBe(1);
    await page
      .locator("#jspsych-serial-reaction-time-stimulus-cell-0-1")
      .dispatchEvent("mousedown");

    // The generated script declares jsPsych as a constant, so it is read by name.
    await expect
      .poll(() => page.evaluate("jsPsych.data.get().filter({ tag: 'clicked' }).count()"))
      .toBe(1);
    const rows = await page.evaluate(
      "jsPsych.data.get().values().filter((row) => row.tag).map((row) => [row.tag, row.correct])",
    );
    expect(rows).toEqual([
      ["keyed", true],
      ["clicked", true],
    ]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
