import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { latinSquareOrders } from "../src/counterbalance.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { CounterbalanceNode, Spec, SpecNode } from "../src/types.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace();
const PAGE_NAME = "counterbalance.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const TASKS = ["alpha", "beta", "gamma"];

const screen = (task: string, text: string): SpecNode => ({
  kind: "trial",
  plugin: "html-keyboard-response",
  tag: task,
  params: { stimulus: text },
});

// The middle task runs its own conditions table, so its rows have to keep reading their own
// columns while the order is chosen by the timeline around them.
const taskSteps = (task: string): SpecNode[] =>
  task === "beta"
    ? [
        {
          kind: "block",
          conditions: "words",
          children: [
            {
              kind: "trial",
              plugin: "html-keyboard-response",
              tag: task,
              params: { stimulus: { var: "word", wrap: "<p>beta task: {}</p>" } },
            },
          ],
        },
      ]
    : [screen(task, `<p>${task} task</p>`)];

const study = (method: CounterbalanceNode["method"]): Spec => ({
  name: "task-order",
  data:
    method === "latin_square"
      ? { save: "post", experiment_id: "testExperiment", endpoint: served.server.url }
      : undefined,
  conditions: { words: [{ word: "RED" }, { word: "BLUE" }] },
  timeline: [
    {
      kind: "counterbalance",
      method,
      tasks: TASKS.map((name) => ({ name, children: taskSteps(name) })),
    },
  ],
});

const repeated = (spec: Spec): Spec => ({
  ...spec,
  conditions: { ...spec.conditions, rounds: [{ round: 1 }] },
  timeline: [{ kind: "block", conditions: "rounds", repetitions: 2, children: spec.timeline }],
});

async function run(spec: Spec, screens = TASKS.length + 1) {
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

  const shown: string[] = [];
  for (let count = 0; count < screens; count += 1) {
    // The display is legitimately empty while an asynchronous order is in flight, so wait for the
    // next task's screen rather than for the element to become visible.
    await expect
      .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toMatch(/task/);
    shown.push(await page.locator("#jspsych-content").innerText());
    await page.keyboard.press("Space");
    await expect
      .poll(() => page.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .not.toBe(shown[shown.length - 1]);
  }
  await expect
    .poll(() => page.evaluate(() => window.studioExperiment?.finished === true), {
      timeout: 20_000,
    })
    .toBe(true);

  const rows = (await page.evaluate(() => window.studioExperiment.jsPsych.data.get().values())) as {
    tag?: string;
    order?: string;
  }[];
  await page.close();
  const tasksRun = rows.flatMap((row) => (row.tag ? [row.tag] : []));
  const visited = tasksRun.filter((tag, index) => tag !== tasksRun[index - 1]);
  return { shown, rows, visited, tasksRun, errors };
}

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("a study that counterbalances the order of its tasks", () => {
  it("runs every task once, in the order it records", async () => {
    const { shown, rows, visited, tasksRun, errors } = await run(study("random"));

    expect(errors).toEqual([]);
    expect([...visited].sort()).toEqual(TASKS);
    expect(tasksRun.filter((tag) => tag === "beta")).toHaveLength(2);
    expect(shown.filter((text) => text.startsWith("beta task"))).toEqual([
      "beta task: RED",
      "beta task: BLUE",
    ]);
    expect(new Set(rows.map((row) => row.order))).toEqual(new Set([visited.join(" > ")]));
  }, 120_000);

  it("takes the row of the Latin square the data service hands out", async () => {
    const square = latinSquareOrders(TASKS);
    for (const condition of [4, 1]) {
      served.server.nextCondition = condition;
      const { visited, rows, errors } = await run(study("latin_square"));
      expect(errors).toEqual([]);
      expect(visited).toEqual(square[condition]);
      expect(rows[0].order).toBe(square[condition].join(" > "));
    }
  }, 120_000);

  it("keeps a participant's order, and their place in the count, when the step runs again", async () => {
    served.server.nextCondition = 2;
    const before = served.server.conditionRequests;
    const { visited, rows, errors } = await run(
      repeated(study("latin_square")),
      2 * (TASKS.length + 1),
    );
    const order = latinSquareOrders(TASKS)[2];
    expect(errors).toEqual([]);
    expect(served.server.conditionRequests - before).toBe(1);
    expect(visited).toEqual([...order, ...order]);
    expect(new Set(rows.map((row) => row.order))).toEqual(new Set([order.join(" > ")]));
  }, 120_000);

  it("still runs a row of the square when the data service fails, if the study opts in", async () => {
    served.server.failConditions = true;
    try {
      const spec = study("latin_square");
      const { visited, errors } = await run({
        ...spec,
        data: { ...spec.data!, condition_fallback: "random" },
      });
      expect(errors).toEqual([]);
      expect(latinSquareOrders(TASKS)).toContainEqual(visited);
    } finally {
      served.server.failConditions = false;
    }
  }, 120_000);
});
