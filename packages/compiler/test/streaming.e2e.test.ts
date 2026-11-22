import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Download } from "playwright";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { packageFileKey } from "../src/package-files.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { CompileResult, Spec } from "../src/types.ts";
import { recordsOf } from "./csv.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "streaming.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const PLATFORM = "https://platform.example";
const PIPE_BUNDLE = "@jspsych/extension-pipe/dist/index.browser.min.js";

// Pressing n ends the study early at the "declined" ending; any other key goes on to the end.
const spec = (recruitment?: Spec["recruitment"]): Spec => ({
  name: "streaming",
  data: {
    save: "post",
    experiment_id: "testExperiment",
    endpoint: served.server.url,
    stream: true,
  },
  recruitment: {
    ...recruitment,
    endings: {
      declined: { message: "<p>Thank you anyway.</p>" },
      ...recruitment?.endings,
    },
  },
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
      then: [{ kind: "end", ending: "declined" }],
    },
  ],
});

async function runExperiment(key: string, recruitment?: Spec["recruitment"]) {
  const { html } = await emitHtml(compileSpec(spec(recruitment), schemas), {
    title: "streaming",
    base: "/node_modules",
  });
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);

  const page = await served.browser.newPage({ acceptDownloads: true });
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.route(`${PLATFORM}/**`, (route) => route.fulfill({ body: "back on the platform" }));
  await page.goto(`${served.server.url}/${PAGE_NAME}?participant_id=p42`);
  await page.locator("#jspsych-content").getByText("press y").waitFor();
  await page.keyboard.press(key);
  return { page, downloads };
}

const shown = (page: Awaited<ReturnType<typeof runExperiment>>["page"]) =>
  page.locator("body").innerText();

afterEach(() => {
  served.server.uploads.length = 0;
  served.server.sessions.length = 0;
  served.server.failUploads = false;
});

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("a compiled experiment that saves its data as it goes", () => {
  it("asks DataPipe to take its rows as they come, then uploads them all at the end", async () => {
    const { page } = await runExperiment("y");

    await expect.poll(() => shown(page), { timeout: 15_000 }).toContain("Your data has been saved");
    expect(served.server.sessions).toEqual([
      { experimentID: "testExperiment", filename: "streaming_p42.csv" },
    ]);
    expect(served.server.uploads).toHaveLength(1);
    const [upload] = served.server.uploads;
    expect(upload).toMatchObject({
      experimentID: "testExperiment",
      filename: "streaming_p42.csv",
      encoding: "gzip",
    });
    expect(recordsOf(upload.data).map((record) => record.participant_id)).toContain("p42");
    expect(await shown(page)).not.toContain("You may close this page");
    await page.close();
  }, 120_000);

  it("shows an early ending's message once the data is uploaded", async () => {
    const { page } = await runExperiment("n");

    await expect.poll(() => shown(page), { timeout: 15_000 }).toContain("Thank you anyway.");
    expect(served.server.uploads).toHaveLength(1);
    expect(served.server.uploads[0].data).toContain("declined");
    expect(await shown(page)).not.toContain("Saving your data");
    await page.close();
  }, 120_000);

  it("downloads the data and says so when the upload fails", async () => {
    served.server.failUploads = true;
    const { page, downloads } = await runExperiment("n");

    await expect.poll(() => shown(page), { timeout: 15_000 }).toContain("could not be uploaded");
    expect(await shown(page)).toContain("Thank you anyway.");
    await expect
      .poll(() => downloads.map((download) => download.suggestedFilename()), { timeout: 15_000 })
      .toEqual(["streaming_p42.csv"]);
    await page.close();
  }, 120_000);

  it("sends the participant back to the platform only after the upload", async () => {
    const { page } = await runExperiment("y", {
      endings: { complete: { url: `${PLATFORM}/complete?pid={participant_id}` } },
    });

    await page.waitForURL(`${PLATFORM}/complete?pid=p42`, { timeout: 15_000 });
    expect(served.server.uploads).toHaveLength(1);
    await page.close();
  }, 120_000);
});

describe("a single-file experiment that saves its data as it goes", () => {
  const installedCopies = (compiled: CompileResult) =>
    Object.fromEntries(
      compiled.files.map((file) => [
        packageFileKey(file),
        new Uint8Array(readFileSync(join(workspaceRoot, "node_modules", packageFileKey(file)))),
      ]),
    );

  async function openSingleFile(alter = (copies: Record<string, Uint8Array>) => copies) {
    const compiled = compileSpec(spec(), schemas);
    const { html } = await emitHtml(compiled, {
      title: "streaming",
      inline: alter(installedCopies(compiled)),
    });
    expect(html).not.toMatch(/<script[^>]*\ssrc="(?!data:)|<link /);
    writeFileSync(join(workspaceRoot, PAGE_NAME), html);
    const page = await served.browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto(`${served.server.url}/${PAGE_NAME}?participant_id=p42`);
    return { page, errors };
  }

  it("registers the DataPipe extension it carries, and saves through it", async () => {
    const { page, errors } = await openSingleFile();
    await page.locator("#jspsych-content").getByText("press y").waitFor({ timeout: 15_000 });
    expect(await page.evaluate("Object.keys(jsPsych.extensions)")).toContain("pipe");
    await page.keyboard.press("y");

    await expect.poll(() => shown(page), { timeout: 15_000 }).toContain("Your data has been saved");
    expect(served.server.sessions).toEqual([
      { experimentID: "testExperiment", filename: "streaming_p42.csv" },
    ]);
    expect(served.server.uploads).toHaveLength(1);
    expect(errors.filter((error) => !error.includes("503"))).toEqual([]);
    await page.close();
  }, 120_000);

  it("refuses to run a carried file that is not the one Tachisto checked", async () => {
    const { page, errors } = await openSingleFile((copies) => ({
      ...copies,
      [PIPE_BUNDLE]: new TextEncoder().encode("window.jsPsychExtensionPipe = 'tampered';"),
    }));
    await expect.poll(() => errors.join("\n"), { timeout: 15_000 }).toMatch(/integrity/i);
    expect(await page.evaluate("typeof window.jsPsychExtensionPipe")).toBe("undefined");
    await page.close();
  }, 120_000);
});
