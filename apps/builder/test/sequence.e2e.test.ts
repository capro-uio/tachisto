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

async function openStroop() {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  await page.goto(appUrl);
  await page.getByTestId("example-stroop").click();
  return page;
}

const activeSegment = (page: Page) =>
  page.evaluate(
    () => document.querySelector<HTMLElement>(".segment.active")?.dataset.testid ?? null,
  );

describe("the timing strip", () => {
  it("lays out the block's steps with their timings, and only inside a block", async () => {
    const page = await openStroop();
    await page.getByTestId("node-0").click();
    expect(await page.getByTestId("sequence").count()).toBe(0);

    await page.getByTestId("node-2-1").click();
    const strip = page.getByTestId("sequence");
    await expect.poll(() => strip.count()).toBe(1);
    expect(await page.getByTestId("sequence-2-0").innerText()).toMatch(/Fixation\s+300 ms/i);
    expect(await page.getByTestId("sequence-2-1").innerText()).toMatch(
      /stroop\s+until response\s+r or b/i,
    );
    await page.close();
  }, 120_000);

  it("selects a step when its segment is clicked", async () => {
    const page = await openStroop();
    await page.getByTestId("node-2-1").click();
    await page.getByTestId("sequence-2-0").getByRole("button").click();
    const selected = await page
      .getByTestId("node-2-0")
      .evaluate((node) => node.closest(".row")?.classList.contains("selected"));
    expect(selected).toBe(true);
    await page.close();
  }, 120_000);

  it("follows the preview from step to step as it runs", async () => {
    const page = await openStroop();
    await page.getByTestId("node-2").click();
    await page.getByTestId("run-from-step").click();

    // The fixation lasts 300 ms, then the word waits for a key.
    await expect.poll(() => activeSegment(page), { timeout: 10_000 }).toBe("sequence-2-0");
    await expect.poll(() => activeSegment(page), { timeout: 10_000 }).toBe("sequence-2-1");
    await expect(page.getByTestId("sequence-live").count()).resolves.toBe(1);
    await expect.poll(() => page.getByTestId("sequence-now").textContent()).toMatch(/Now: stroop/);

    // Answering ends the word, and the next row starts with its fixation again.
    const frame = page.frameLocator('[data-testid="preview"]');
    await frame.locator("body").click();
    await page.keyboard.press("r");
    await expect.poll(() => activeSegment(page), { timeout: 10_000 }).toBe("sequence-2-0");
    await page.close();
  }, 120_000);

  it("says when a block has no steps yet", async () => {
    const page = await openStroop();
    page.on("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("delete-2-1").click();
    await page.getByTestId("delete-2-0").click();
    await page.getByTestId("node-2").click();
    await expect.poll(() => page.getByTestId("sequence-empty").count()).toBe(1);
    await page.close();
  }, 120_000);

  it("forgets where the preview was once it starts again", async () => {
    const page = await openStroop();
    await page.getByTestId("node-2").click();
    await page.getByTestId("run-from-step").click();
    await expect.poll(() => activeSegment(page), { timeout: 10_000 }).not.toBeNull();
    await page.getByTestId("view-code").click();
    expect(await activeSegment(page)).toBeNull();
    await page.close();
  }, 120_000);
});
