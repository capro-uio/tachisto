import { readFileSync } from "node:fs";
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

/** The builder with the flanker example open and the menu showing the download option. */
async function openMenu() {
  const page = await browser.newPage();
  await page.goto(appUrl);
  await page.getByTestId("example-flanker").click();
  await page.getByTestId("header-menu").click();
  return page;
}

describe("a self-contained download", () => {
  it("runs in a browser that can reach nothing outside it", async () => {
    const builder = await openMenu();
    expect(await builder.getByTestId("self-contained").isChecked()).toBe(true);
    const [file] = await Promise.all([
      builder.waitForEvent("download"),
      builder.getByTestId("download-html").click(),
    ]);
    const html = readFileSync(await file.path(), "utf8");
    await builder.close();

    const participant = await browser.newPage();
    const reached: string[] = [];
    await participant.route(/^https?:/, (route) => {
      reached.push(route.request().url());
      return route.abort();
    });
    await participant.setContent(html);
    await expect
      .poll(() => participant.locator("#jspsych-content").innerText(), { timeout: 10_000 })
      .not.toBe("");
    expect(reached).toEqual([]);
    await participant.close();
  }, 120_000);

  it("loads from unpkg once it is turned off, and remembers that", async () => {
    const page = await openMenu();
    await page.getByTestId("self-contained").uncheck();
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-html").click(),
    ]);
    expect(readFileSync(await file.path(), "utf8")).toContain('src="https://unpkg.com/jspsych@');
    await page.reload();
    await page.getByTestId("header-menu").click();
    expect(await page.getByTestId("self-contained").isChecked()).toBe(false);
    await page.close();
  }, 120_000);
});
