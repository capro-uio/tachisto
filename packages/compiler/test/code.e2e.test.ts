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
const PAGE_NAME = "code.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

const spec: Spec = {
  name: "coded",
  conditions: { words: [{ word: "apple" }] },
  timeline: [
    {
      kind: "block",
      conditions: "words",
      children: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: {
            stimulus: {
              code: '`<p id="computed">${jsPsych.evaluateTimelineVariable("word").toUpperCase()}</p>`',
            },
          },
        },
      ],
    },
    {
      kind: "trial",
      plugin: "html-button-response",
      params: {
        stimulus: "<p>pick one</p>",
        choices: ["left", "right"],
        button_html: {
          code: '(choice, index) => `<button class="jspsych-btn custom-button" data-index="${index}">${choice}!</button>`',
        },
      },
    },
  ],
};

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("code written into a study", () => {
  it("works out a value when the trial starts, and hands a plugin its function", async () => {
    const { html } = await emitHtml(compileSpec(spec, schemas), {
      title: "coded",
      base: "/node_modules",
    });
    writeFileSync(join(workspaceRoot, PAGE_NAME), html);

    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    await expect.poll(() => page.locator("#computed").innerText()).toBe("APPLE");
    await page.keyboard.press("a");

    const buttons = page.locator(".custom-button");
    await expect.poll(() => buttons.allInnerTexts()).toEqual(["left!", "right!"]);
    expect(errors).toEqual([]);
    await page.close();
  });
});
