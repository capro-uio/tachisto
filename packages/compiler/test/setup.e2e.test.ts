import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Spec } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "setup.e2e.html";
const CONSENT_PAGE = "setup-consent.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

const spec: Spec = {
  name: "setup",
  timeline: [
    { kind: "trial", plugin: "browser-check", tag: "browser", params: { features: ["width"] } },
    { kind: "trial", plugin: "resize", tag: "resize", params: { item_width: 3, item_height: 2 } },
    {
      kind: "trial",
      plugin: "external-html",
      tag: "consent",
      params: { url: CONSENT_PAGE, cont_btn: "agree" },
    },
    {
      kind: "trial",
      plugin: "survey-html-form",
      tag: "form",
      params: { html: '<p><label>Your age <input name="age" type="number"></label></p>' },
    },
  ],
};

beforeAll(async () => {
  const { html } = await emitHtml(compileSpec(spec, schemas), {
    title: spec.name,
    base: "/node_modules",
  });
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);
  writeFileSync(
    join(workspaceRoot, CONSENT_PAGE),
    '<p>Do you agree to take part?</p><button id="agree">I agree</button>',
  );
}, 120_000);

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
  rmSync(join(workspaceRoot, CONSENT_PAGE), { force: true });
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

describe("setting up a session", () => {
  it("checks the browser, calibrates, shows a page from the site, and takes a form", async () => {
    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${served.server.url}/${PAGE_NAME}`);

    expect((await rowOf(page, "browser")).width).toBeGreaterThan(0);

    await page.locator("#jspsych-resize-btn").click();
    expect((await rowOf(page, "resize")).scale_factor).toBeGreaterThan(0);

    await page.locator("#jspsych-content").getByText("Do you agree").waitFor({ timeout: 10_000 });
    await page.locator("#agree").click();
    expect((await rowOf(page, "consent")).url).toBe(CONSENT_PAGE);

    await page.getByLabel("Your age").fill("34");
    await page.locator("#jspsych-survey-html-form-next").click();
    expect((await rowOf(page, "form")).response).toEqual({ age: "34" });

    expect(errors).toEqual([]);
    await page.close();
  });
});
