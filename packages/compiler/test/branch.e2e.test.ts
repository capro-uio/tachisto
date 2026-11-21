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
const PAGE_NAME = "branch.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

// Two screening trials where "f" is correct, then a branch: 80% accuracy or better continues.
const spec: Spec = {
  name: "screening",
  conditions: { items: [{ answer: "f" }, { answer: "f" }] },
  timeline: [
    {
      kind: "block",
      conditions: "items",
      children: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          tag: "screening",
          params: { stimulus: "<p>press f</p>", choices: ["f", "j"] },
          score: { correct_if_response_equals: { var: "answer" } },
        },
      ],
    },
    {
      kind: "branch",
      when: { scope: "screening", accuracy_at_least: 0.8 },
      then: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          tag: "main",
          params: { stimulus: "<p>the study continues</p>" },
        },
      ],
      otherwise: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          tag: "rejected",
          params: { stimulus: "<p>thank you for your time</p>" },
        },
      ],
    },
  ],
};

// Consent as buttons: the second button, index 1, declines and leads out of the study.
const consentSpec: Spec = {
  name: "consent",
  timeline: [
    {
      kind: "trial",
      plugin: "html-button-response",
      tag: "consent",
      params: { stimulus: "<p>do you agree?</p>", choices: ["I agree", "I do not agree"] },
    },
    {
      kind: "branch",
      when: { scope: "consent", response_equals: 1 },
      then: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: "<p>thank you for your time</p>" },
        },
      ],
      otherwise: [
        {
          kind: "trial",
          plugin: "html-keyboard-response",
          params: { stimulus: "<p>the study continues</p>" },
        },
      ],
    },
  ],
};

async function openPage(experiment: Spec) {
  const { html } = await emitHtml(compileSpec(experiment, schemas), {
    title: experiment.name,
    base: "/node_modules",
  });
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);
  const page = await served.browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${served.server.url}/${PAGE_NAME}`);
  return { page, errors };
}

async function answerConsent(button: string) {
  const { page, errors } = await openPage(consentSpec);
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect
    .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 10_000 })
    .toMatch(/continues|thank you/);
  const shown = await page.locator("#jspsych-content").innerText();
  await page.close();
  return { shown, errors };
}

async function run(answers: string[]) {
  const { page, errors } = await openPage(spec);

  for (const answer of answers) {
    await expect
      .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 10_000 })
      .toContain("press f");
    await page.keyboard.press(answer);
  }

  await expect
    .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 10_000 })
    .toMatch(/continues|thank you/);
  const shown = await page.locator("#jspsych-content").innerText();
  await page.close();
  return { shown, errors };
}

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("a study that routes on performance", () => {
  it("continues when the participant passes screening", async () => {
    const { shown, errors } = await run(["f", "f"]);
    expect(errors).toEqual([]);
    expect(shown).toContain("the study continues");
  }, 120_000);

  it("takes the other path when they do not", async () => {
    const { shown } = await run(["j", "j"]);
    expect(shown).toContain("thank you for your time");
    expect(shown).not.toContain("the study continues");
  }, 120_000);

  it("takes the other path on a borderline score", async () => {
    const { shown } = await run(["f", "j"]);
    expect(shown).toContain("thank you for your time");
  }, 120_000);
});

describe("a study that routes on an answer", () => {
  it("leads a participant who declines consent out of the study", async () => {
    const { shown, errors } = await answerConsent("I do not agree");
    expect(errors).toEqual([]);
    expect(shown).toContain("thank you for your time");
    expect(shown).not.toContain("the study continues");
  }, 120_000);

  it("continues for a participant who agrees", async () => {
    const { shown } = await answerConsent("I agree");
    expect(shown).toContain("the study continues");
  }, 120_000);
});
