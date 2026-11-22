import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Download, type Page } from "playwright";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Ending, Spec } from "../src/types.ts";
import { recordsOf } from "./csv.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "endings.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PLATFORM = "https://platform.example";
const THANKS: Ending = { message: "<p>Thank you anyway.</p>" };

interface Study {
  noConsent: Ending;
  /** Where the data goes; uploading to the test server unless a test says otherwise. */
  data?: Spec["data"] | null;
}

// Pressing n declines consent and reaches the no_consent ending; y goes on to the task.
function spec({ noConsent, data }: Study): Spec {
  const saving =
    data === undefined
      ? { save: "post" as const, experiment_id: "testExperiment", endpoint: served.server.url }
      : (data ?? undefined);
  const complete: Record<string, Ending> =
    saving?.save === "post" ? { complete: { url: `${PLATFORM}/complete` } } : {};
  return {
    name: "consenting",
    data: saving,
    recruitment: { endings: { ...complete, no_consent: noConsent } },
    timeline: [
      {
        kind: "trial",
        plugin: "html-keyboard-response",
        tag: "consent",
        params: { stimulus: "<p>press y to agree, n to decline</p>", choices: ["y", "n"] },
      },
      {
        kind: "branch",
        when: { scope: "consent", response_equals: "n" },
        then: [{ kind: "end", ending: "no_consent" }],
      },
      {
        kind: "trial",
        plugin: "html-keyboard-response",
        params: { stimulus: "<p>the task</p>" },
      },
    ],
  };
}

async function answerConsent(study: Study, key: string, query = "participant_id=p1") {
  const { html } = await emitHtml(compileSpec(spec(study), schemas), {
    title: "consenting",
    base: "/node_modules",
  });
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);

  const page = await served.browser.newPage({ acceptDownloads: true });
  const downloads: Download[] = [];
  const requests: string[] = [];
  page.on("download", (download) => downloads.push(download));
  page.on("request", (request) => requests.push(`${request.method()} ${request.url()}`));
  await page.route(`${PLATFORM}/**`, (route) => route.fulfill({ body: "back on the platform" }));
  await page.goto(`${served.server.url}/${PAGE_NAME}?${query}`);
  await page.locator("#jspsych-content").getByText("press y").waitFor();
  await page.keyboard.press(key);
  return { page, downloads, requests };
}

async function shownMessage(page: Page) {
  await expect
    .poll(() => page.locator("body").innerText(), { timeout: 15_000 })
    .toContain("Thank you anyway.");
  return page.locator("body").innerText();
}

afterEach(() => {
  served.server.uploads.length = 0;
  served.server.failUploads = false;
});

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("a participant who declines consent", () => {
  it("is shown the ending's message once their data is saved, and goes no further", async () => {
    const { page } = await answerConsent({ noConsent: THANKS }, "n");

    expect(await shownMessage(page)).not.toContain("the task");
    expect(served.server.uploads).toHaveLength(1);
    expect(served.server.uploads[0].data).toContain("no_consent");
    expect(page.url()).toContain(PAGE_NAME);
    await page.close();
  }, 120_000);

  it("is sent to the ending's address instead of the completion one", async () => {
    const { page } = await answerConsent({ noConsent: { url: `${PLATFORM}/declined` } }, "n");

    await page.waitForURL(`${PLATFORM}/declined`, { timeout: 15_000 });
    expect(served.server.uploads).toHaveLength(1);
    await page.close();
  }, 120_000);

  it("downloads their data first when the study saves it locally", async () => {
    const { page, downloads } = await answerConsent(
      { noConsent: THANKS, data: { save: "download" } },
      "n",
    );

    expect(await shownMessage(page)).not.toContain("the task");
    await expect
      .poll(() => downloads.map((download) => download.suggestedFilename()), { timeout: 15_000 })
      .toEqual(["consenting_p1.csv"]);
    expect(served.server.uploads).toHaveLength(0);
    await page.close();
  }, 120_000);

  it("is only shown the message when the study keeps no data", async () => {
    const { page, downloads } = await answerConsent({ noConsent: THANKS, data: null }, "n");

    expect(await shownMessage(page)).not.toContain("the task");
    expect(downloads).toEqual([]);
    expect(served.server.uploads).toHaveLength(0);
    await page.close();
  }, 120_000);

  it("is recorded as reaching the ending whatever the link says", async () => {
    const { page } = await answerConsent({ noConsent: THANKS }, "n", "participant_id=p1&ending=x");

    await shownMessage(page);
    const records = recordsOf(served.server.uploads[0].data);
    expect(records.filter((record) => record.ending === "no_consent")).toHaveLength(1);
    expect(records.every((record) => ["", "no_consent"].includes(record.ending))).toBe(true);
    expect(records.every((record) => record.url_ending === "x")).toBe(true);
    await page.close();
  }, 120_000);
});

describe("a participant who agrees", () => {
  it("runs the study and completes it as usual", async () => {
    const { page } = await answerConsent({ noConsent: THANKS }, "y");

    await page.locator("#jspsych-content").getByText("the task").waitFor({ timeout: 10_000 });
    await page.keyboard.press("Space");
    await page.waitForURL(`${PLATFORM}/complete`, { timeout: 15_000 });
    expect(served.server.uploads).toHaveLength(1);
    expect(served.server.uploads[0].data).not.toContain("no_consent");
    await page.close();
  }, 120_000);
});

async function contentsOf(download: Download) {
  return readFileSync(await download.path(), "utf8");
}

describe("an ending that keeps only a checkpoint", () => {
  const SCREENED: Ending = { ...THANKS, keep: "checkpoint" };

  it("uploads the one row saying who ended there, and none of their answers", async () => {
    const { page } = await answerConsent({ noConsent: SCREENED }, "n");

    await shownMessage(page);
    expect(served.server.uploads).toHaveLength(1);
    const records = recordsOf(served.server.uploads[0].data);
    expect(records).toHaveLength(1);
    const [record] = records;
    expect(record).toMatchObject({ ending: "no_consent", participant_id: "p1" });
    expect(served.server.uploads[0].data).not.toContain("press y");
    await page.close();
  }, 120_000);

  it("downloads only that row when the upload fails", async () => {
    served.server.failUploads = true;
    const { page, downloads } = await answerConsent({ noConsent: SCREENED }, "n");

    await expect.poll(() => downloads.length, { timeout: 15_000 }).toBe(1);
    const saved = await contentsOf(downloads[0]);
    expect(recordsOf(saved)).toHaveLength(1);
    expect(saved).toContain("no_consent");
    expect(saved).not.toContain("press y");
    await page.close();
  }, 120_000);
});

describe("an ending that keeps nothing", () => {
  const DISCARDED: Ending = { ...THANKS, keep: "nothing" };
  const dataRequests = (requests: string[]) =>
    requests.filter((request) => request.includes("/api/"));

  it("sends nothing to the data service and saves nothing on the computer", async () => {
    const { page, downloads, requests } = await answerConsent({ noConsent: DISCARDED }, "n");

    expect(await shownMessage(page)).not.toContain("the task");
    // Long enough for a save that should not happen to have been attempted.
    await page.waitForTimeout(1_000);
    expect(dataRequests(requests)).toEqual([]);
    expect(served.server.uploads).toHaveLength(0);
    expect(downloads).toHaveLength(0);
    await page.close();
  }, 120_000);

  it("downloads nothing when the study saves locally", async () => {
    const { page, downloads } = await answerConsent(
      { noConsent: DISCARDED, data: { save: "download" } },
      "n",
    );

    await shownMessage(page);
    await page.waitForTimeout(1_000);
    expect(downloads).toHaveLength(0);
    await page.close();
  }, 120_000);

  it("sends the participant back to the platform without uploading first", async () => {
    const { page, requests } = await answerConsent(
      { noConsent: { url: `${PLATFORM}/declined?pid={participant_id}`, keep: "nothing" } },
      "n",
    );

    await page.waitForURL(`${PLATFORM}/declined?pid=p1`, { timeout: 15_000 });
    expect(dataRequests(requests)).toEqual([]);
    expect(served.server.uploads).toHaveLength(0);
    await page.close();
  }, 120_000);

  it("sends them back with their id from a study that keeps no data at all", async () => {
    const { page, downloads } = await answerConsent(
      {
        noConsent: { url: `${PLATFORM}/declined?pid={participant_id}`, keep: "nothing" },
        data: null,
      },
      "n",
      "PROLIFIC_PID=x&participant_id=p9",
    );

    await page.waitForURL(`${PLATFORM}/declined?pid=p9`, { timeout: 15_000 });
    expect(downloads).toHaveLength(0);
    expect(served.server.uploads).toHaveLength(0);
    await page.close();
  }, 120_000);
});
