import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { ParameterValue, Spec } from "../src/types.ts";
import { recordsOf } from "./csv.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "exclusion.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

// The browser check would abort the study for a participant it turns away; named an ending, it
// sends them there instead, saving their data first.
function screening(check: Record<string, ParameterValue>): Spec {
  return {
    name: "screening",
    data: { save: "post", experiment_id: "testExperiment", endpoint: served.server.url },
    recruitment: {
      endings: { screened_out: { message: "<p>Sorry, this study needs a larger screen.</p>" } },
    },
    timeline: [
      {
        kind: "trial",
        plugin: "browser-check",
        tag: "check",
        params: { features: ["width", "height"], ...check },
        exclusion_ending: "screened_out",
      },
      {
        kind: "trial",
        plugin: "html-keyboard-response",
        params: { stimulus: "<p>the task</p>" },
      },
    ],
  };
}

async function run(spec: Spec) {
  const { html } = await emitHtml(compileSpec(spec, schemas), {
    title: spec.name,
    base: "/node_modules",
  });
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);
  const page = await served.browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${served.server.url}/${PAGE_NAME}?participant_id=p1`);
  return { page, errors };
}

afterEach(() => {
  served.server.uploads.length = 0;
});

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("a participant the browser check turns away", () => {
  it("whose window is too small is saved and sent to the ending", async () => {
    const { page, errors } = await run(screening({ minimum_width: 99_999 }));
    await page.locator("#browser-check-max-size-btn").click();

    await expect
      .poll(() => page.locator("body").innerText(), { timeout: 15_000 })
      .toContain("needs a larger screen");
    expect(await page.locator("body").innerText()).not.toContain("the task");
    expect(served.server.uploads).toHaveLength(1);
    const rows = recordsOf(served.server.uploads[0].data);
    expect(rows.find((row) => row.tag === "check")?.excluded).toBe("true");
    expect(rows.some((row) => row.ending === "screened_out")).toBe(true);
    expect(errors).toEqual([]);
    await page.close();
  });

  it("whom the inclusion rule leaves out is sent to the ending too", async () => {
    const { page } = await run(
      screening({ inclusion_function: { code: "(data) => data.width > 99999" } }),
    );
    await expect
      .poll(() => page.locator("body").innerText(), { timeout: 15_000 })
      .toContain("needs a larger screen");
    expect(served.server.uploads).toHaveLength(1);
    await page.close();
  });

  it("goes on to the task when let in", async () => {
    const { page } = await run(screening({ minimum_width: 10 }));
    await expect
      .poll(() => page.locator("body").innerText(), { timeout: 15_000 })
      .toContain("the task");
    await page.close();
  });
});
