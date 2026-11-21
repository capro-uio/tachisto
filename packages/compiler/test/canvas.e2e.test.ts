import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Spec } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAMES = { numbers: "canvas.e2e.html", text: "canvas-text.e2e.html" };
const EMPTY = "rgba(0, 0, 0, 0)";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

// The builder's conditions table holds every cell as text, so the offsets arrive as "-120" too.
const canvasSpec = (offsets: [unknown, unknown]): Spec => ({
  name: "canvas",
  conditions: {
    rows: [
      { colour: "rgb(255, 0, 0)", offset: offsets[0] },
      { colour: "rgb(0, 0, 255)", offset: offsets[1] },
    ],
  },
  timeline: [
    {
      kind: "block",
      conditions: "rows",
      children: [
        {
          kind: "trial",
          plugin: "psychophysics",
          params: {
            canvas_width: 400,
            canvas_height: 300,
            background_color: "white",
            stimuli: [
              { obj_type: "cross", line_length: 20, line_width: 4 },
              {
                obj_type: "circle",
                radius: 30,
                fill_color: { var: "colour" },
                startX: { var: "offset" },
              },
            ],
          },
        },
      ],
    },
  ],
});

// Reads the canvas in its own pixels, which the plugin scales by the device pixel ratio. The
// background is the element's CSS, so an empty spot reads as transparent.
async function colourAt(page: Page, x: number, y: number) {
  return page.evaluate(
    ([cssX, cssY]) => {
      const canvas = document.getElementById("myCanvas") as HTMLCanvasElement;
      const ratio = canvas.width / canvas.clientWidth;
      const [r, g, b, a] = canvas
        .getContext("2d")!
        .getImageData(cssX * ratio, cssY * ratio, 1, 1).data;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    },
    [x, y],
  );
}

beforeAll(async () => {
  const pages: [string, [unknown, unknown]][] = [
    [PAGE_NAMES.numbers, [-120, 120]],
    [PAGE_NAMES.text, ["-120", "120"]],
  ];
  for (const [name, offsets] of pages) {
    const compiled = compileSpec(canvasSpec(offsets), schemas, {
      initEntries: "on_finish: () => { window.studioExperiment.finished = true; }",
    });
    const { html } = await emitHtml(compiled, { title: "canvas", base: "/node_modules" });
    writeFileSync(join(workspaceRoot, name), html);
  }
}, 120_000);

afterAll(() => {
  for (const name of Object.values(PAGE_NAMES)) rmSync(join(workspaceRoot, name), { force: true });
});

describe("a compiled canvas step", () => {
  it.each(Object.entries(PAGE_NAMES))(
    "draws each row's objects where and how the row says, with offsets as %s",
    async (_, pageName) => {
      const page = await served.browser.newPage();
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") problems.push(message.text());
      });
      // The plugin reports a broken object with a blocking alert, which would stall a participant.
      page.on("dialog", async (dialog) => {
        problems.push(`alert: ${dialog.message()}`);
        await dialog.dismiss();
      });

      await page.goto(`${served.server.url}/${pageName}`);
      await page.locator("#myCanvas").waitFor();
      await page.waitForTimeout(200);
      expect(await colourAt(page, 200 - 120, 150)).toBe("rgba(255, 0, 0, 255)");
      expect(await colourAt(page, 200 + 120, 150)).toBe(EMPTY);
      expect(await colourAt(page, 200, 150)).toBe("rgba(0, 0, 0, 255)");

      await page.keyboard.press("Space");
      await page.waitForTimeout(200);
      expect(await colourAt(page, 200 + 120, 150)).toBe("rgba(0, 0, 255, 255)");
      expect(await colourAt(page, 200 - 120, 150)).toBe(EMPTY);

      await page.keyboard.press("Space");
      await page.waitForFunction(() => Boolean(window.studioExperiment?.finished));
      expect(problems).toEqual([]);
      await page.close();
    },
    120_000,
  );
});
