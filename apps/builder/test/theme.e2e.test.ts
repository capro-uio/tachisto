import { type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { runningApp } from "./app.ts";
import { brandColour } from "./brand.ts";

const app = runningApp();

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const colorScheme = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

/** Appearance lives in the header's overflow menu, so choosing it means opening that first. */
async function chooseTheme(page: Page, choice: "system" | "light" | "dark") {
  await page.getByTestId("header-menu").click();
  await page.getByTestId(`theme-${choice}`).click();
  await page.keyboard.press("Escape");
}

const DARK = brandColour("paper", "dark");
const LIGHT = brandColour("paper", "light");

describe("appearance", () => {
  it("follows the system setting when nothing has been chosen", async () => {
    for (const [scheme, expected] of [
      ["dark", DARK],
      ["light", LIGHT],
    ] as const) {
      const page = await app.browser.newPage({ colorScheme: scheme });
      await page.goto(app.url);
      expect(await background(page)).toBe(expected);
      // Offering both lets the system pick, for native controls and scrollbars as for the page.
      expect(await colorScheme(page)).toBe("light dark");
      await page.close();
    }
  }, 120_000);

  it("lets a choice override the system, in either direction", async () => {
    const page = await app.browser.newPage({ colorScheme: "dark" });
    await page.goto(app.url);
    expect(await background(page)).toBe(DARK);

    await chooseTheme(page, "light");
    await expect.poll(() => background(page), { timeout: 5_000 }).toBe(LIGHT);
    expect(await colorScheme(page)).toBe("light");

    await chooseTheme(page, "dark");
    await expect.poll(() => background(page), { timeout: 5_000 }).toBe(DARK);
    await page.close();

    const light = await app.browser.newPage({ colorScheme: "light" });
    await light.goto(app.url);
    await chooseTheme(light, "dark");
    await expect.poll(() => background(light), { timeout: 5_000 }).toBe(DARK);
    await light.close();
  }, 120_000);

  it("remembers the choice, and can be handed back to the system", async () => {
    const context = await app.browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto(app.url);
    await chooseTheme(page, "light");
    await expect.poll(() => background(page), { timeout: 5_000 }).toBe(LIGHT);

    await page.reload();
    expect(await background(page)).toBe(LIGHT);
    await page.getByTestId("header-menu").click();
    expect(await page.getByTestId("theme-light").getAttribute("class")).toContain("active");
    await page.keyboard.press("Escape");

    await chooseTheme(page, "system");
    await expect.poll(() => background(page), { timeout: 5_000 }).toBe(DARK);
    await context.close();
  }, 120_000);

  it("keeps the experiment's own colours independent of the builder's", async () => {
    const page = await app.browser.newPage({ colorScheme: "dark" });
    await page.goto(app.url);
    await page.getByTestId("slot-0").click();
    await page.getByTestId("slot-0-trial").click();
    await page.getByTestId("mode-stimulus").selectOption("fixed");

    // The builder is dark; the participant's screen is still white.
    expect(await background(page)).toBe(DARK);
    expect(
      await page
        .getByTestId("value-stimulus")
        .evaluate((node) => getComputedStyle(node).backgroundColor),
    ).toBe("rgb(255, 255, 255)");

    await page.close();
  }, 120_000);
});
