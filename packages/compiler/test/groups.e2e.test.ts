import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { AssignNode, Spec, SpecNode } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "groups.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

type Row = Record<string, string | undefined>;

const study = (
  method: "random" | "balanced",
  data: Partial<NonNullable<Spec["data"]>> = {},
): Spec => ({
  name: "between-subjects",
  data:
    method === "balanced"
      ? { save: "post", experiment_id: "testExperiment", endpoint: served.server.url, ...data }
      : undefined,
  timeline: [
    {
      kind: "assign",
      method,
      record_as: "condition",
      groups: ["alpha", "beta"].map((name) => ({
        name,
        children: [
          {
            kind: "trial",
            plugin: "html-keyboard-response",
            tag: name,
            params: { stimulus: `<p>${name} group</p>` },
          },
        ],
      })),
    },
  ],
});

async function run(spec: Spec, expected = "group") {
  const { page, errors, rowsSoFar } = await openStudy(spec);
  // The display is legitimately empty while an asynchronous assignment is in flight, so wait for
  // content rather than for the element to become visible.
  await expect
    .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 20_000 })
    .toContain(expected);
  const shown = await page.locator("#jspsych-content").innerText();
  await page.keyboard.press("Space");
  const rows = await rowsSoFar();
  await page.close();
  return { shown, rows, errors };
}

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("a study that splits participants between groups", () => {
  it("runs exactly one group and records which", async () => {
    const { shown, rows, errors } = await run(study("random"));
    const seen = rows.filter((row) => row.tag);

    expect(errors).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(["alpha", "beta"]).toContain(seen[0].tag);
    expect(shown).toContain(`${seen[0].tag} group`);
    expect(seen[0].condition).toBe(seen[0].tag);
  }, 120_000);

  it("takes the group the data service hands out", async () => {
    served.server.nextCondition = 1;
    const second = await run(study("balanced"));
    expect(second.rows.find((row) => row.tag)?.tag).toBe("beta");

    served.server.nextCondition = 0;
    const first = await run(study("balanced"));
    expect(first.rows.find((row) => row.tag)?.tag).toBe("alpha");
  }, 120_000);

  it("stops with a message, running no group and uploading nothing, when no group comes back", async () => {
    served.server.failConditions = true;
    const uploadsBefore = served.server.uploads.length;
    try {
      const { shown, rows, errors } = await run(study("balanced"), "cannot start");
      expect(errors).toEqual([]);
      expect(shown).toContain("let the researcher know");
      expect(shown).not.toContain("group");
      expect(rows.filter((row) => row.tag)).toEqual([]);
      expect(served.server.uploads.length).toBe(uploadsBefore);
    } finally {
      served.server.failConditions = false;
    }
  }, 120_000);

  it("keeps its message on screen once a study that saves as it goes has uploaded", async () => {
    served.server.failConditions = true;
    const uploadsBefore = served.server.uploads.length;
    try {
      const { html } = await emitHtml(compileSpec(study("balanced", { stream: true }), schemas), {
        title: "between-subjects",
        base: "/node_modules",
      });
      writeFileSync(join(workspaceRoot, PAGE_NAME), html);
      const page = await served.browser.newPage();
      await page.goto(`${served.server.url}/${PAGE_NAME}`);
      await expect
        .poll(() => served.server.uploads.length, { timeout: 20_000 })
        .toBe(uploadsBefore + 1);
      await expect
        .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 5_000 })
        .toContain("cannot start");
      await page.close();
    } finally {
      served.server.failConditions = false;
    }
  }, 120_000);

  it("draws a group in the browser instead when the study opts in", async () => {
    served.server.failConditions = true;
    try {
      const { rows, errors } = await run(study("balanced", { condition_fallback: "random" }));
      expect(errors).toEqual([]);
      const seen = rows.filter((row) => row.tag);
      expect(seen).toHaveLength(1);
      expect(["alpha", "beta"]).toContain(seen[0].tag);
    } finally {
      served.server.failConditions = false;
    }
  }, 120_000);
});

const PASSES = ["f", "f", "j", "j"];

const scored = (text: string): SpecNode => ({
  kind: "trial",
  plugin: "html-keyboard-response",
  tag: "practice",
  score: { correct_if_response_equals: "j" },
  params: { stimulus: `<p>${text}</p>`, choices: ["f", "j"] },
});

const split = (
  record_as: string,
  method: AssignNode["method"],
  groups: [string, SpecNode[]][],
): AssignNode => ({
  kind: "assign",
  method,
  record_as,
  groups: groups.map(([name, children]) => ({ name, children })),
});

// Two wrong answers and then two right ones keep accuracy below a half until the fourth pass, so
// the loop runs once for each key in PASSES.
const looped = (node: AssignNode): Spec => ({
  name: "split-in-a-loop",
  data:
    node.method === "balanced"
      ? { save: "post", experiment_id: "testExperiment", endpoint: served.server.url }
      : undefined,
  timeline: [
    {
      kind: "loop",
      repeat_while: { scope: "practice", accuracy_below: 0.5 },
      children: [node],
    },
  ],
});

async function openStudy(spec: Spec) {
  const { html } = await emitHtml(
    compileSpec(spec, schemas, {
      initEntries: "on_finish: () => { window.studioExperiment.finished = true; }",
    }),
    { title: spec.name, base: "/node_modules" },
  );
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);
  const page = await served.browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${served.server.url}/${PAGE_NAME}`);
  const rowsSoFar = async () =>
    (await page.evaluate(() => window.studioExperiment.jsPsych.data.get().values())) as Row[];
  const practiceRows = async () => (await rowsSoFar()).filter((row) => row.tag === "practice");
  return { page, errors, rowsSoFar, practiceRows };
}

async function runPasses(spec: Spec) {
  const { page, errors, practiceRows } = await openStudy(spec);
  for (const [pass, key] of PASSES.entries()) {
    await expect
      .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("group");
    await page.keyboard.press(key);
    await expect
      .poll(async () => (await practiceRows()).length, { timeout: 20_000 })
      .toBe(pass + 1);
  }
  await expect
    .poll(() => page.evaluate(() => window.studioExperiment.finished === true), {
      timeout: 20_000,
    })
    .toBe(true);
  const rows = await practiceRows();
  await page.close();
  return { rows, errors };
}

const GROUPS = ["alpha", "beta", "gamma", "delta"];

const groupSplit = (method: AssignNode["method"]) =>
  split(
    "condition",
    method,
    GROUPS.map((name) => [name, [scored(`${name} group`)]]),
  );

describe("a split that a loop runs more than once", () => {
  it("keeps the group it drew on every pass", async () => {
    const { rows, errors } = await runPasses(looped(groupSplit("random")));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(PASSES.length);
    const group = rows[0].condition;
    expect(GROUPS).toContain(group);
    expect(rows.map((row) => row.condition)).toEqual(PASSES.map(() => group));
    expect(rows.map((row) => row.stimulus)).toEqual(PASSES.map(() => `<p>${group} group</p>`));
  }, 120_000);

  it("asks the data service once, and keeps the group it handed out", async () => {
    served.server.nextCondition = 2;
    const before = served.server.conditionRequests;
    const { rows, errors } = await runPasses(looped(groupSplit("balanced")));
    expect(errors).toEqual([]);
    expect(served.server.conditionRequests - before).toBe(1);
    expect(rows.map((row) => row.condition)).toEqual(PASSES.map(() => "gamma"));
  }, 120_000);

  it("keeps two splits' groups apart, even when they share group names", async () => {
    served.server.nextCondition = 0;
    const before = served.server.conditionRequests;
    const inner = split("dose", "balanced", [
      ["treatment", [scored("inner treatment group")]],
      ["control", [scored("inner control group")]],
    ]);
    const outer = split("arm", "balanced", [
      ["control", [inner]],
      ["treatment", [scored("outer treatment group")]],
    ]);
    const { rows, errors } = await runPasses(looped(outer));
    expect(errors).toEqual([]);
    expect(served.server.conditionRequests - before).toBe(2);
    expect(rows.map((row) => row.stimulus)).toEqual(
      PASSES.map(() => "<p>inner treatment group</p>"),
    );
    expect(rows.map((row) => `${row.arm}/${row.dose}`)).toEqual(
      PASSES.map(() => "control/treatment"),
    );
  }, 120_000);

  it("still stops on the first pass when no group comes back", async () => {
    served.server.failConditions = true;
    const before = served.server.conditionRequests;
    try {
      const { page, errors, practiceRows } = await openStudy(looped(groupSplit("balanced")));
      await expect
        .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 20_000 })
        .toContain("cannot start");
      const rows = await practiceRows();
      await page.close();
      expect(errors).toEqual([]);
      expect(rows).toEqual([]);
      expect(served.server.conditionRequests - before).toBe(1);
    } finally {
      served.server.failConditions = false;
    }
  }, 120_000);
});
