import { chromium, type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOUR_STEPS } from "../src/lib/tour.svelte.ts";
import { brandColour } from "./brand.ts";

const VIEWPORTS = [
  { name: "desktop", width: 1500, height: 900, columns: true },
  { name: "phone", width: 420, height: 780, columns: false },
];

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

/** Where the callout, the highlight and the thing it is meant to highlight are on screen. */
function layout(page: Page, target: string | undefined) {
  return page.evaluate((selector) => {
    const box = (element: Element | null) => {
      if (!element) return null;
      const { top, left, bottom, right } = element.getBoundingClientRect();
      return { top, left, bottom, right };
    };
    return {
      callout: box(document.querySelector('[data-testid="tour"]'))!,
      spot: box(document.querySelector('[data-testid="tour-spot"]')),
      target: selector ? box(document.querySelector(selector)) : null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  }, target);
}

type Edges = { top: number; left: number; bottom: number; right: number };

const overlaps = (a: Edges, b: Edges) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

// Settles the short move between steps before anything is measured.
async function settledOn(page: Page, id: string) {
  await expect.poll(() => page.getByTestId("tour").getAttribute("data-step")).toBe(id);
  await page.waitForTimeout(250);
}

describe.each(VIEWPORTS)("at $name ($width×$height)", ({ width, height, columns }) => {
  it("walks through every part of the builder from an empty start", async () => {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(appUrl);
    await page.getByTestId("start-tour").click();

    // An empty project has nothing to point at, so the tour opens an example to show.
    await expect.poll(() => page.getByTestId("node-0").count()).toBe(1);

    for (const [index, step] of TOUR_STEPS.entries()) {
      await settledOn(page, step.id);
      expect(await page.getByTestId("tour-count").innerText()).toBe(
        `${index + 1} of ${TOUR_STEPS.length}`,
      );
      if (step.tab) {
        expect(await page.getByTestId(`tab-${step.tab}`).getAttribute("aria-selected")).toBe(
          "true",
        );
      }

      const { callout, spot, target, viewport } = await layout(page, step.target);
      expect(callout.top).toBeGreaterThanOrEqual(0);
      expect(callout.left).toBeGreaterThanOrEqual(0);
      expect(callout.bottom).toBeLessThanOrEqual(viewport.height);
      expect(callout.right).toBeLessThanOrEqual(viewport.width);

      if (step.target) {
        expect(target, `${step.id} has nothing to point at`).not.toBeNull();
        expect(spot, `${step.id} highlights nothing`).not.toBeNull();
        expect(overlaps(spot!, target!)).toBe(true);
        // With columns there is always room beside the target; stacked, a panel can fill the
        // screen and the callout has to sit over part of it.
        if (columns) expect(overlaps(callout, target!), `${step.id} hides its target`).toBe(false);
      } else {
        expect(spot).toBeNull();
      }

      await page.getByTestId("tour-next").click();
    }

    expect(await page.getByTestId("tour").count()).toBe(0);
    await page.close();
  }, 120_000);
});

describe("the tour", () => {
  it("starts from the menu without replacing the experiment that is open", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("example-stroop").click();
    const name = await page.getByTestId("experiment-name").inputValue();

    await page.getByTestId("header-menu").click();
    await page.getByTestId("start-tour-menu").click();

    expect(await page.getByTestId("header-menu-items").count()).toBe(0);
    await settledOn(page, "welcome");
    expect(await page.getByTestId("experiment-name").inputValue()).toBe(name);
    await page.close();
  }, 120_000);

  it("follows the arrow keys and leaves on Escape", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("start-tour").click();
    await settledOn(page, "welcome");

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await settledOn(page, TOUR_STEPS[2].id);
    await page.keyboard.press("ArrowLeft");
    await settledOn(page, TOUR_STEPS[1].id);

    await page.keyboard.press("Escape");
    expect(await page.getByTestId("tour").count()).toBe(0);
    await page.close();
  }, 120_000);

  it("keeps keyboard focus inside the callout", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("start-tour").click();
    await settledOn(page, "welcome");
    await page.keyboard.press("ArrowRight");
    await settledOn(page, TOUR_STEPS[1].id);

    const focusedInsideTour = () =>
      page.evaluate(() => !!document.activeElement?.closest('[data-testid="tour"]'));
    expect(await focusedInsideTour()).toBe(true);
    for (let press = 0; press < 5; press += 1) {
      await page.keyboard.press("Tab");
      expect(await focusedInsideTour()).toBe(true);
    }
    await page.close();
  }, 120_000);

  it("hands focus to the menu it can be reopened from when it closes", async () => {
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    await page.goto(appUrl);
    await page.getByTestId("start-tour").click();
    await settledOn(page, "welcome");
    await page.keyboard.press("Escape");

    expect(await page.getByTestId("tour").count()).toBe(0);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).toBe(
      "header-menu",
    );
    await page.close();
  }, 120_000);

  it("reads well in dark mode", async () => {
    const page = await browser.newPage({ colorScheme: "dark" });
    await page.goto(appUrl);
    await page.getByTestId("start-tour").click();
    await settledOn(page, "welcome");
    const colours = await page.evaluate(() => {
      const style = getComputedStyle(document.querySelector('[data-testid="tour"]')!);
      return { background: style.backgroundColor, text: style.color };
    });
    expect(colours).toEqual({
      background: brandColour("paper-raised", "dark"),
      text: brandColour("ink", "dark"),
    });
    await page.close();
  }, 120_000);
});
