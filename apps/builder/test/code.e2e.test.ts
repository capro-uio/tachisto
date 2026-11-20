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

describe("writing code for a parameter", () => {
  it("starts from the value it held, runs in the preview, and marks the step", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("example-flanker").click();
    await page.getByTestId("node-0").click();

    await page.getByTestId("mode-stimulus").selectOption("code");
    const code = page.getByTestId("code-stimulus");
    expect(await code.inputValue()).toMatch(/^"<p>Press <b>f<\/b>/);

    await code.fill("`<p id='computed'>${6 * 7}</p>`");
    await code.blur();

    const frame = page.frameLocator('[data-testid="preview"]');
    await expect.poll(() => frame.locator("#computed").innerText(), { timeout: 15_000 }).toBe("42");
    expect(await page.getByTestId("node-0").locator(".code-badge").innerText()).toBe("code");
    await page.close();
  }, 120_000);

  it("says what is wrong with code that does not parse, before it is saved", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("example-flanker").click();
    await page.getByTestId("node-0").click();

    await page.getByTestId("mode-stimulus").selectOption("code");
    await page.getByTestId("code-stimulus").fill("1); alert(2); (3");

    await expect
      .poll(() => page.getByTestId("code-stimulus-note").innerText())
      .toBe("This code should be a single JavaScript expression.");
    expect(await page.getByTestId("code-stimulus").getAttribute("aria-invalid")).toBe("true");
    await page.close();
  }, 120_000);

  it("offers a function parameter as code only, starting from the plugin's own", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("example-flanker").click();
    await page.getByTestId("node-0").click();
    await page.getByTestId("trial-plugin").selectOption("html-button-response");
    await page.getByTestId("toggle-parameters").click();

    const mode = page.getByTestId("mode-button_html");
    const offered = await mode
      .locator("option")
      .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
    expect(offered).toEqual(["unset", "code"]);

    await mode.selectOption("code");
    expect(await page.getByTestId("code-button_html").inputValue()).toMatch(
      /^function\(choice, choice_index\) \{\n {2}return `<button class="jspsych-btn">/,
    );

    await page.locator(`label[for="param-button_html"]`).click();
    expect(
      await page.getByTestId("code-button_html").evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.close();
  }, 120_000);
});
