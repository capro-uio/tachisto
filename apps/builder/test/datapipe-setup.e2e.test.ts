import type { Spec } from "tachisto-compiler";
import { chromium, type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let browser: Browser;
let server: PreviewServer;
let appUrl: string;

beforeAll(async () => {
  await build({ logLevel: "warn" });
  server = await preview({ preview: { port: 0 }, logLevel: "warn" });
  appUrl = server.resolvedUrls!.local[0];
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? "chrome" });
}, 180_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

const screen = (text: string) => ({
  kind: "trial" as const,
  plugin: "html-keyboard-response",
  params: { stimulus: `<p>${text}</p>` },
});

const study: Spec = {
  name: "picture naming",
  authors: [{ name: "Ada Lovelace" }],
  data: { save: "download" },
  timeline: [
    { kind: "trial", plugin: "initialize-microphone", params: {} },
    { kind: "trial", plugin: "html-audio-response", params: { stimulus: "<p>Say it</p>" } },
    {
      kind: "assign",
      method: "balanced",
      groups: ["red", "green", "blue"].map((name) => ({ name, children: [screen(name)] })),
    },
  ],
};

async function openStudy(page: Page, spec: Spec) {
  await page.goto(appUrl);
  await page.getByTestId("header-menu").click();
  await page.getByTestId("import-spec").setInputFiles({
    name: "study.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(spec)),
  });
  await page.getByTestId("tab-study").click();
}

async function authoredSpec(page: Page) {
  await page.getByTestId("view-spec").click();
  return JSON.parse(await page.getByTestId("spec-json").innerText()) as Spec;
}

const text = (page: Page, testId: string) => page.getByTestId(testId).innerText();

describe("the checklist for setting up DataPipe", () => {
  it("appears only once the study uploads to DataPipe, open until it has an experiment ID", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, study);
    expect(await page.getByTestId("datapipe-setup").count()).toBe(0);

    await page.getByTestId("data-mode").selectOption("post");
    const checklist = page.getByTestId("datapipe-setup");
    expect(await checklist.getAttribute("open")).not.toBeNull();
    expect(await checklist.locator("summary").innerText()).toBe("Set up DataPipe");

    await page.getByTestId("data-mode").selectOption("download");
    expect(await page.getByTestId("datapipe-setup").count()).toBe(0);
    await page.close();
  }, 120_000);

  it("is filled in from the study, and follows it as it changes", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, study);
    await page.getByTestId("data-mode").selectOption("post");

    expect(await text(page, "datapipe-title-value")).toBe("picture naming");
    expect(await text(page, "datapipe-author-name-value")).toBe("Ada Lovelace");
    expect(await text(page, "datapipe-description-value")).toContain('"picture naming"');
    expect(await text(page, "datapipe-accept-base64-file-uploads-state")).toBe("on");
    expect(await text(page, "datapipe-assign-conditions-in-sequence-state")).toBe("on");
    expect(await text(page, "datapipe-how-many-conditions-value")).toBe("3");
    expect(await text(page, "datapipe-assign-conditions-in-sequence-warning")).toContain(
      "exactly 3",
    );
    expect(await text(page, "datapipe-required-fields-value")).toBe(
      "trial_type, trial_index, time_elapsed, participant_id",
    );
    expect(await text(page, "datapipe-generate-psych-ds-metadata-warning")).toContain(
      "a pilot included",
    );
    expect(await text(page, "datapipe-partial-files")).toContain("no .partial.json");

    await page.getByTestId("add-author").click();
    const second = page.getByTestId("author-name-1");
    await second.fill("Alan Turing");
    await second.blur();
    await expect
      .poll(() => text(page, "datapipe-author-name-value"))
      .toBe("Ada Lovelace; Alan Turing");

    await page.getByTestId("data-stream").check();
    await expect
      .poll(() => text(page, "datapipe-partial-files"))
      .toContain("one .partial.json file for each participant who leaves partway");
    await page.close();
  }, 120_000);

  it("gives no number of conditions when two steps share DataPipe's counter, and warns", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, {
      ...study,
      data: { save: "post", experiment_id: "abc123DEF456" },
      timeline: [
        ...study.timeline,
        {
          kind: "counterbalance",
          method: "latin_square",
          tasks: ["stroop", "flanker"].map((name) => ({ name, children: [screen(name)] })),
        },
      ],
    });
    await page.getByTestId("datapipe-setup").locator("summary").click();
    expect(await text(page, "datapipe-how-many-conditions")).toContain("no single right number");
    expect(await page.getByTestId("datapipe-how-many-conditions-value").count()).toBe(0);
    await expect
      .poll(() => page.getByTestId("compile-warnings").innerText(), { timeout: 5_000 })
      .toContain("2 steps ask DataPipe for a condition");
    expect(await page.getByTestId("compile-error").count()).toBe(0);
    await page.close();
  }, 120_000);

  it("fills in the session limit and the affiliation once the study gives them", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, study);
    await page.getByTestId("data-mode").selectOption("post");
    const limit = "datapipe-stop-after-a-set-number-of-sessions";
    expect(await text(page, `${limit}-state`)).toBe("optional");
    expect(await page.getByTestId("datapipe-affiliation-value").count()).toBe(0);

    const sampleSize = page.getByTestId("recruitment-sample-size");
    await sampleSize.fill("120");
    await sampleSize.blur();
    await expect.poll(() => text(page, `${limit}-state`)).toBe("on");
    expect(await text(page, "datapipe-how-many-total-sessions-value")).toBe("120");

    const affiliation = page.getByRole("textbox", { name: "affiliation of author 1" });
    await affiliation.fill("University of Oslo");
    await affiliation.blur();
    await expect.poll(() => text(page, "datapipe-affiliation-value")).toBe("University of Oslo");

    const spec = await authoredSpec(page);
    expect(spec.sample_size).toBe(120);
    expect(spec.authors).toEqual([{ name: "Ada Lovelace", affiliation: "University of Oslo" }]);

    await page.getByTestId("tab-study").click();
    await page.getByTestId("recruitment-sample-size").fill("");
    await page.getByTestId("recruitment-sample-size").blur();
    await page.getByTestId("author-affiliation-0").fill("  ");
    await page.getByTestId("author-affiliation-0").blur();
    const cleared = await authoredSpec(page);
    expect(cleared.sample_size).toBeUndefined();
    expect(cleared.authors).toEqual([{ name: "Ada Lovelace" }]);
    await page.close();
  }, 120_000);

  it("copies a value with a labelled button", async () => {
    const context = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: new URL(appUrl).origin,
    });
    const page = await context.newPage();
    await openStudy(page, study);
    await page.getByTestId("data-mode").selectOption("post");

    const copy = page.getByRole("button", { name: "Copy how many conditions" });
    await copy.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("3");
    expect(await copy.innerText()).toBe("copied");
    expect(await text(page, "datapipe-copy-status")).toBe("How many conditions? copied");

    await page.getByRole("button", { name: "Copy title" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("picture naming");
    expect(await copy.innerText()).toBe("copy");
    await context.close();
  }, 120_000);

  it("links to the study's DataPipe only when its address is usable, and says when it is not", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, study);
    await page.getByTestId("data-mode").selectOption("post");
    const checklist = page.getByTestId("datapipe-setup");
    expect(await checklist.getByRole("link", { name: "DataPipe" }).getAttribute("href")).toBe(
      "https://pipe.jspsych.org",
    );

    const endpoint = page.getByTestId("data-endpoint");
    await endpoint.fill("javascript:alert(1)");
    await endpoint.blur();
    await expect.poll(() => checklist.getByRole("link").count()).toBe(0);
    expect(await checklist.innerText()).toContain("DataPipe (javascript:alert(1))");
    await expect
      .poll(() => page.getByTestId("compile-error").innerText(), { timeout: 5_000 })
      .toContain("the DataPipe address must be a full web address starting with https://");

    await endpoint.fill("https://example.org/datapipe/");
    await endpoint.blur();
    await expect
      .poll(() => checklist.getByRole("link", { name: "DataPipe" }).getAttribute("href"))
      .toBe("https://example.org/datapipe");
    await expect
      .poll(() => page.getByTestId("compile-error").innerText(), { timeout: 5_000 })
      .not.toContain("DataPipe address");
    await page.close();
  }, 120_000);

  it("closes once the experiment has an ID, and ends where the ID goes", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, {
      ...study,
      data: { save: "post", experiment_id: "abc123DEF456" },
    });
    const checklist = page.getByTestId("datapipe-setup");
    expect(await checklist.getAttribute("open")).toBeNull();
    const followedByIdField = await checklist.evaluate(
      (element) =>
        element.nextElementSibling?.getAttribute("for") === "data-experiment-id" &&
        element.querySelector("ol > li:last-child h3")?.textContent === "Paste the experiment ID",
    );
    expect(followedByIdField).toBe(true);
    await page.close();
  }, 120_000);
});

describe("what a study does when DataPipe hands out no condition", () => {
  it("stops by default, and draws in the browser only when asked, saying what that risks", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, study);
    await page.getByTestId("data-mode").selectOption("post");

    const fallback = page.getByTestId("data-condition-fallback");
    expect(await fallback.isChecked()).toBe(false);
    expect(await text(page, "data-condition-fallback-note")).toContain("stops");

    await fallback.check();
    expect(await text(page, "data-condition-fallback-note")).toContain("unbalanced");
    expect(await text(page, "datapipe-assign-conditions-in-sequence")).toContain("unbalanced");
    expect((await authoredSpec(page)).data?.condition_fallback).toBe("random");

    await page.getByTestId("tab-study").click();
    await page.getByTestId("data-condition-fallback").uncheck();
    expect((await authoredSpec(page)).data?.condition_fallback).toBeUndefined();
    await page.close();
  }, 120_000);

  it("is not asked about by a study that asks DataPipe for nothing", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await openStudy(page, { ...study, timeline: [screen("hello")] });
    await page.getByTestId("data-mode").selectOption("post");
    expect(await page.getByTestId("data-condition-fallback").count()).toBe(0);
    expect(await text(page, "datapipe-assign-conditions-in-sequence-state")).toBe("off");
    await page.close();
  }, 120_000);
});
