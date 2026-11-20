import { readFileSync } from "node:fs";
import { chromium, type Browser, type Page } from "playwright";
import { build, preview, type PreviewServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let browser: Browser;
let server: PreviewServer;
let appUrl: string;

async function openFlow(page: Page, example: string) {
  await page.goto(appUrl);
  await page.getByTestId(`example-${example}`).click();
  await page.getByTestId("view-flow").click();
  await page.getByTestId("flow-diagram").waitFor();
}

const treeRowSelected = (page: Page, testId: string) =>
  page
    .getByTestId(testId)
    .evaluate((node) => node.closest(".row")?.classList.contains("selected") ?? false);

/** WCAG contrast between the fill of each text part and the fill of the shape behind it. */
function textContrasts(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((box) => {
    // Computed colours come back in whatever syntax produced them, rgb() or color(srgb …) among
    // others, so the browser paints each one and the pixel says what it is.
    const pixel = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
    const channels = (color: string) => {
      pixel.clearRect(0, 0, 1, 1);
      pixel.fillStyle = color;
      pixel.fillRect(0, 0, 1, 1);
      return [...pixel.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    };
    const luminance = (color: string) => {
      const [r, g, b] = channels(color).map((value) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (light + 0.05) / (dark + 0.05);
    };
    const background = getComputedStyle(box.querySelector(".outline")!).fill;
    return [...box.querySelectorAll("tspan")].map((line) =>
      ratio(getComputedStyle(line).fill, background),
    );
  });
}

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

describe("the flow diagram", () => {
  it("draws an example's steps, its loop and the block inside it", async () => {
    const page = await browser.newPage();
    await openFlow(page, "flanker");

    const diagram = page.getByTestId("flow-diagram");
    expect(await diagram.getAttribute("aria-label")).toBe("Study flow diagram");
    for (const key of [
      "start",
      "node-0",
      "node-1",
      "node-1-0",
      "node-1-0-0",
      "node-1-0-1",
      "end",
    ]) {
      expect(await page.getByTestId(`flow-${key}`).isVisible()).toBe(true);
    }
    expect(await page.getByTestId("flow-node-1").getAttribute("aria-label")).toBe(
      "loop · practice, repeat while accuracy under 75% on practice",
    );
    expect(await page.getByTestId("flow-node-1-0").getAttribute("aria-label")).toContain(
      "4 rows × 2 repetitions, rows in random order",
    );
    expect(await page.getByTestId("flow-repeat").count()).toBe(1);
    expect(await page.getByRole("button", { name: /^Text, answered with a key/ }).count()).toBe(3);
    await page.close();
  }, 120_000);

  it("downloads the diagram as an SVG figure named after the study", async () => {
    const page = await browser.newPage();
    await openFlow(page, "flanker");

    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByTestId("download-flow-svg").click(),
    ]);
    expect(file.suggestedFilename()).toMatch(/-flow\.svg$/);
    const svg = readFileSync(await file.path(), "utf8");
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain("block · flanker_trials");
    await page.close();
  }, 120_000);

  it("selects a step in the timeline when it is clicked or chosen from the keyboard", async () => {
    const page = await browser.newPage();
    await openFlow(page, "flanker");

    await page.getByTestId("flow-node-1-0-1").click();
    expect(await treeRowSelected(page, "node-1-0-1")).toBe(true);
    expect(await page.getByTestId("flow-node-1-0-1").getAttribute("aria-current")).toBe("true");

    await page.getByTestId("flow-node-0").focus();
    await page.keyboard.press("Enter");
    expect(await treeRowSelected(page, "node-0")).toBe(true);
    expect(await treeRowSelected(page, "node-1-0-1")).toBe(false);
    await page.close();
  }, 120_000);

  it("follows the timeline as steps are added, showing a branch's two paths", async () => {
    const page = await browser.newPage();
    await openFlow(page, "stroop");
    expect(await page.getByTestId("flow-node-1").getAttribute("aria-label")).toBe(
      "checkpoint, reached “instructions-read”",
    );

    await page.getByTestId("slot-3").click();
    await page.getByTestId("slot-3-branch").click();
    expect(await page.getByTestId("flow-node-3").getAttribute("aria-label")).toBe(
      "branch, if accuracy at least 80% on stroop",
    );
    expect(await page.getByTestId("flow-lane-3-0").getAttribute("aria-label")).toBe("if so");
    expect(await page.getByTestId("flow-empty-3-1").getAttribute("aria-label")).toBe("no steps");

    await page.getByTestId("flow-lane-3-1").click();
    expect(
      await page.getByTestId("group-3-1").evaluate((node) => node.classList.contains("selected")),
    ).toBe(true);
    await page.close();
  }, 120_000);

  it("keeps its text readable in light and dark", async () => {
    for (const scheme of ["light", "dark"] as const) {
      const page = await browser.newPage({ colorScheme: scheme });
      await openFlow(page, "stroop");
      await page.getByTestId("slot-3").click();
      await page.getByTestId("slot-3-assign").click();
      for (const key of ["start", "node-0", "node-1", "node-2", "node-2-1", "node-3", "lane-3-0"]) {
        const contrasts = await textContrasts(page, `flow-${key}`);
        expect(contrasts.length).toBeGreaterThan(0);
        for (const contrast of contrasts) {
          expect(contrast, `${scheme} ${key}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      await page.close();
    }
  }, 120_000);
});
