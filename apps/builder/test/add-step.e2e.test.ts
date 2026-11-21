import { type Locator } from "playwright";
import { describe, expect, it } from "vitest";
import { runningApp } from "./app.ts";
import { addStep } from "./steps.ts";

const app = runningApp();

const MIN_TARGET = 24;

async function heightOf(locator: Locator) {
  const box = await locator.boundingBox();
  return box?.height ?? 0;
}

describe("starting a blank experiment", () => {
  it("offers a labelled add-step button ahead of, and apart from, the examples", async () => {
    const page = await app.browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(app.url);

    const add = page.getByRole("button", { name: "Add step" });
    await expect.poll(() => add.isVisible()).toBe(true);
    expect(await add.getAttribute("data-testid")).toBe("slot-0");
    expect(await heightOf(add)).toBeGreaterThanOrEqual(MIN_TARGET);

    const start = page.getByTestId("start-blank");
    const examples = page.getByTestId("examples");
    expect(await start.getByRole("button", { name: "Add step" }).count()).toBe(1);
    expect(await examples.getByTestId("example-stroop").count()).toBe(1);
    expect(await start.getByTestId("example-stroop").count()).toBe(0);
    const startBox = (await start.boundingBox())!;
    const examplesBox = (await examples.boundingBox())!;
    expect(examplesBox.y).toBeGreaterThanOrEqual(startBox.y + startBox.height);

    await page.close();
  }, 120_000);

  it("opens the step menu from the button, by keyboard as well as by click", async () => {
    const page = await app.browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(app.url);

    const add = page.getByTestId("slot-0");
    await add.focus();
    const outline = await add.evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).not.toBe("none");

    await page.keyboard.press("Enter");
    expect(await add.getAttribute("aria-expanded")).toBe("true");
    await page.getByTestId("slot-0-trial").click();
    expect(await page.getByTestId("node-0").isVisible()).toBe(true);

    await page.close();
  }, 120_000);
});

describe("a timeline with steps in it", () => {
  it("ends every list with a visible add-step button", async () => {
    const page = await app.browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto(app.url);
    await page.getByTestId("example-stroop").click();

    const steps = await page.getByTestId(/^node-\d+$/).count();
    const end = page.getByTestId(`slot-${steps}`);
    expect(await end.innerText()).toContain("Add step");
    expect(await end.isVisible()).toBe(true);
    expect(await heightOf(end)).toBeGreaterThanOrEqual(MIN_TARGET);

    const nested = page.getByTestId("slot-2-1");
    expect(await nested.getAttribute("aria-label")).toBe("Add a step here");
    const endOfBlock = page.locator('[data-testid^="slot-2-"]', { hasText: "Add step" });
    expect(await endOfBlock.count()).toBe(1);

    await addStep(page, `slot-${steps}`, "checkpoint");
    expect(await page.getByTestId(`node-${steps}`).innerText()).toContain("checkpoint");

    await page.close();
  }, 120_000);
});
