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

describe("the preview and the keyboard", () => {
  it("does not take the cursor from a field being edited when it restarts", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("example-flanker").click();
    const name = page.getByTestId("experiment-name");
    await name.fill("");
    await name.pressSequentially("first");

    // Long enough for the edit to rebuild the preview and its first trial to start.
    const frame = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => frame.locator("#jspsych-content").innerText(), { timeout: 15_000 })
      .toContain("Press any key");
    await page.waitForTimeout(500);

    await page.keyboard.type("-second");
    expect(await name.inputValue()).toBe("first-second");
    await page.close();
  }, 120_000);

  it("answers keys once you click into it", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("example-flanker").click();
    const frame = page.frameLocator('[data-testid="preview"]');
    const content = frame.locator("#jspsych-content");
    await expect.poll(() => content.innerText(), { timeout: 15_000 }).toContain("Press any key");

    await content.click();
    await page.keyboard.press("Space");
    await expect.poll(() => content.innerText(), { timeout: 5_000 }).not.toContain("Press any key");
    await page.close();
  }, 120_000);
});

describe("when the formatter cannot load", () => {
  // Prettier is fetched on demand, so a deploy that replaced its chunk can make it unavailable.
  it("says the preview could not be built, and still shows the code unformatted", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.route("**/assets/standalone-*.js", (route) => route.abort());
    await page.goto(appUrl);
    await page.getByTestId("example-flanker").click();

    await expect
      .poll(() => page.getByTestId("compile-error").innerText(), { timeout: 15_000 })
      .toContain("The preview could not be built");

    await page.getByTestId("view-code").click();
    await expect
      .poll(() => page.getByTestId("generated-code").innerText(), { timeout: 15_000 })
      .toContain("initJsPsych");
    await page.close();
  }, 120_000);
});
