import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Page } from "playwright";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { servedWorkspace } from "./served.ts";
import { compileSpec } from "../src/compile.ts";
import { emitHtml } from "../src/targets/html.ts";
import type { Spec, SpecNode } from "../src/types.ts";
import { recordsOf } from "./csv.ts";
import { schemas } from "./schemas.ts";

const served = servedWorkspace({
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const PAGE_NAME = "gaze.e2e.html";
const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const STIMULUS = "#jspsych-html-keyboard-response-stimulus";

// WebGazer only lets a participant on once it sees a face, which Chrome's stand-in camera never
// shows. This stands in for it with WebGazer's own interface and its ways: it sees a face at once;
// running, it estimates the same point every frame and hands it to its gaze listener; paused, it
// estimates from the frame it saw last, (1, 1); and an estimate never says when it was made.
const STAND_IN_WEBGAZER = `let paused = true;
let listener = () => {};
const loop = () => {
  if (paused) return;
  listener({ x: 100.4, y: 200.6 });
  requestAnimationFrame(loop);
};
window.webgazer = {
  params: {},
  saveDataAcrossSessions() { return this; },
  begin: async () => {
    const box = document.createElement("div");
    box.id = "webgazerFaceFeedbackBox";
    box.style.borderColor = "green";
    document.body.append(box);
    paused = false;
    loop();
  },
  getCurrentPrediction: async () => (paused ? { x: 1, y: 1 } : { x: 100.4, y: 200.6 }),
  setGazeListener(callback) { listener = callback; return this; },
  clearGazeListener() { listener = () => {}; return this; },
  getTracker: () => ({ predictionReady: true }),
  pause() { paused = true; return this; },
  async resume() { if (paused) { paused = false; loop(); } return this; },
  clearData() {}, setRegression() {}, recordScreenPosition() {},
  showVideo() {}, showFaceOverlay() {}, showFaceFeedbackBox() {}, showPredictionPoints() {},
  addMouseEventListeners() {}, removeMouseEventListeners() {},
};`;

const setUp: SpecNode = { kind: "trial", plugin: "webgazer-init-camera" };

const eyeTrackingStudy = (): Spec => ({
  name: "gaze",
  data: { save: "post", experiment_id: "testExperiment", endpoint: served.server.url },
  timeline: [
    setUp,
    {
      kind: "trial",
      plugin: "webgazer-calibrate",
      params: {
        calibration_points: [
          [25, 50],
          [75, 50],
        ],
      },
    },
    {
      kind: "trial",
      plugin: "webgazer-validate",
      params: { validation_points: [[50, 50]], time_to_saccade: 50, validation_duration: 300 },
    },
    {
      kind: "trial",
      plugin: "html-keyboard-response",
      tag: "looked",
      params: { stimulus: "<p>look here</p>", trial_duration: 400 },
      // A selector the browser cannot read, before one it can.
      gaze: { targets: ["#", STIMULUS] },
    },
    {
      kind: "trial",
      plugin: "html-keyboard-response",
      tag: "unwatched",
      params: { stimulus: "<p>not tracked</p>", trial_duration: 100 },
    },
  ],
});

async function open(spec: Spec, webgazer?: string, watch?: (page: Page) => void) {
  const { html } = await emitHtml(compileSpec(spec, schemas), {
    title: spec.name,
    base: "/node_modules",
  });
  writeFileSync(join(workspaceRoot, PAGE_NAME), html);
  const page = await served.browser.newPage();
  if (webgazer) {
    await page.route("**/node_modules/webgazer/dist/webgazer.js", (route) =>
      route.fulfill({ contentType: "text/javascript", body: webgazer }),
    );
  }
  watch?.(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
  await page.goto(`${served.server.url}/${PAGE_NAME}?participant_id=p1`);
  return { page, errors };
}

async function continuePastSetUp(page: Page) {
  const button = page.locator("#jspsych-wg-cont");
  await expect.poll(() => button.isEnabled(), { timeout: 15_000 }).toBe(true);
  await button.click();
}

afterEach(() => {
  served.server.uploads.length = 0;
});

afterAll(() => {
  rmSync(join(workspaceRoot, PAGE_NAME), { force: true });
});

describe("a study that tracks gaze", () => {
  it("records the gaze, and where the stimulus was, only on the steps that ask", async () => {
    const { page, errors } = await open(eyeTrackingStudy(), STAND_IN_WEBGAZER);
    await continuePastSetUp(page);
    for (let point = 0; point < 2; point++) {
      await page.locator("#calibration-point").click({ timeout: 15_000 });
    }

    await expect.poll(() => served.server.uploads.length, { timeout: 20_000 }).toBe(1);
    const rows = recordsOf(served.server.uploads[0].data);
    const looked = rows.find((row) => row.tag === "looked")!;
    const samples = JSON.parse(looked.webgazer_data) as { x: number; y: number; t: number }[];
    // Every sample live, none taken from the frame calibration ended on, and each timed.
    expect(samples.length).toBeGreaterThan(0);
    expect(samples.every(({ x, y }) => x === 100 && y === 201)).toBe(true);
    expect(samples.every(({ t }) => Number.isInteger(t) && t >= 0)).toBe(true);
    // About one sample per 34 ms of the 400 ms step, not one per frame.
    expect(samples.length).toBeLessThan(20);
    const targets = JSON.parse(looked.webgazer_targets) as Record<string, { width: number }>;
    expect(Object.keys(targets)).toEqual([STIMULUS]);
    expect(targets[STIMULUS].width).toBeGreaterThan(0);

    expect(rows.find((row) => row.tag === "unwatched")?.webgazer_data).toBe("");
    const checked = rows.find((row) => row.trial_type === "webgazer-validate")!;
    expect(JSON.parse(checked.percent_in_roi)).toHaveLength(1);
    const checkedGaze = (JSON.parse(checked.raw_gaze) as { x: number }[][]).flat();
    expect(checkedGaze.length).toBeGreaterThan(0);
    expect(checkedGaze.every(({ x }) => x === 100)).toBe(true);
    expect(Number(checked.samples_per_sec)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});

describe("the real WebGazer", () => {
  // Loading its face model from beside the page, where the export does not put it, would leave
  // the participant on a set-up screen that never lets them on.
  it("starts, with its face model loaded from beside its own script", async () => {
    const models: { url: string; status: number }[] = [];
    const { page, errors } = await open({ name: "real", timeline: [setUp] }, undefined, (page) =>
      page.on("response", (response) => {
        if (response.url().includes("face_mesh")) {
          models.push({ url: response.url(), status: response.status() });
        }
      }),
    );

    await page.locator("#jspsych-wg-cont").waitFor({ timeout: 60_000 });
    await expect
      .poll(() => models.some((model) => model.url.endsWith(".wasm")), { timeout: 60_000 })
      .toBe(true);
    expect(models.every((model) => model.status === 200)).toBe(true);
    expect(models[0].url).toContain("/node_modules/webgazer/dist/mediapipe/face_mesh/");
    expect(await page.locator("body").innerText()).not.toContain("failed to start");
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});
