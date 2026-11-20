import { chromium, type Browser } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addStep, addTrial } from "./steps.ts";

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

describe("eye tracking in the builder", () => {
  it("offers to track gaze once the study calibrates, and records the stimulus by default", async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await addStep(page, "slot-0", "trial");
    expect(await page.getByTestId("track-gaze").count()).toBe(0);

    await addTrial(page, "webgazer-calibrate", "slot-0");
    expect(await page.getByTestId("track-gaze").count()).toBe(0);
    await page.getByTestId("node-1").click();
    await page.getByTestId("track-gaze").check();
    expect(await page.getByTestId("gaze-stimulus").isChecked()).toBe(true);

    // Two entries alike, both unreadable, and the form says so of each.
    for (const entry of [0, 1]) {
      await page.getByTestId("add-gaze-targets").click();
      await page.getByTestId(`gaze-targets-${entry}`).fill("#");
      await page.getByTestId(`gaze-targets-${entry}`).blur();
    }
    const problems = await page.getByTestId("gaze-target-problem").allInnerTexts();
    expect(problems).toHaveLength(2);
    expect(problems[1]).toContain('"#" is not a CSS selector the browser can read');
    await page.close();
  }, 120_000);

  it("edits calibration points as two numbers each", async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await addTrial(page, "webgazer-calibrate", "slot-0");
    await page.getByTestId("toggle-parameters").click();
    await page.getByTestId("mode-calibration_points").selectOption("fixed");

    const points = page.getByTestId("value-calibration_points");
    expect(await points.locator("tr").first().locator("input[type=number]").count()).toBe(2);
    expect(await page.getByTestId("value-calibration_points-add-column").count()).toBe(0);
    await page.getByTestId("value-calibration_points-0-1").fill("35");
    await page.getByTestId("value-calibration_points-0-1").blur();
    expect(await page.getByTestId("value-calibration_points-0-1").inputValue()).toBe("35");

    // A cleared place stays cleared, and is pointed out, rather than running with the old number.
    await page.getByTestId("value-calibration_points-0-1").fill("");
    await page.getByTestId("value-calibration_points-0-1").blur();
    await expect
      .poll(() => page.getByTestId("step-problems").innerText())
      .toContain("expects each place of its grid to be a whole number");
    expect(await page.getByTestId("device-note").innerText()).toContain(
      "cannot reach a camera or microphone",
    );
    await page.close();
  }, 120_000);
});
