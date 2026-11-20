import { chromium, type Browser } from "playwright";
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

describe("a step that uses the camera or microphone", () => {
  it("is said to be out of the preview's reach", async () => {
    const page = await browser.newPage();
    await page.goto(appUrl);
    await page.getByTestId("slot-0").click();
    await page.getByTestId("slot-0-trial").click();
    expect(await page.getByTestId("device-note").count()).toBe(0);

    await page.getByTestId("trial-plugin").selectOption("initialize-microphone");
    expect(await page.getByTestId("device-note").innerText()).toContain(
      "cannot reach a camera or microphone",
    );
    await page.close();
  }, 120_000);
});
