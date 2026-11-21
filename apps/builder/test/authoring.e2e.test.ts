import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Page } from "playwright";
import { describe, expect, it } from "vitest";
import { runningApp } from "./app.ts";
import { addStep, addTrial } from "./steps.ts";
import { brandColour } from "./brand.ts";
import type { Spec, SpecNode } from "tachisto-compiler";

const CONDITIONS_CSV = [
  "stim,correct_key,congruency",
  "<<<<<,f,congruent",
  ">>>>>,j,congruent",
  "<<><<,j,incongruent",
  ">><>>,f,incongruent",
].join("\n");

const INSTRUCTIONS =
  "<p>Press <b>f</b> for a left-pointing centre arrow, <b>j</b> for right.</p>" +
  "<p>Press any key to begin.</p>";

const app = runningApp();

async function setText(page: Page, testId: string, value: string) {
  const field = page.getByTestId(testId);
  await field.fill(value);
  await field.blur();
}

/** The project file the builder would download, as shown in its spec view. */
async function authoredSpec(page: Page) {
  return JSON.parse(await page.getByTestId("spec-json").innerText()) as Spec;
}

/** The step at a place in the spec, checked to be the kind the test expects. */
function stepOfKind<K extends SpecNode["kind"]>(node: SpecNode | undefined, kind: K) {
  expect(node?.kind).toBe(kind);
  return node as Extract<SpecNode, { kind: K }>;
}

function trialParams(node: SpecNode | undefined) {
  return stepOfKind(node, "trial").params ?? {};
}

/** The sidebar is tabbed, so reaching conditions, files or study settings means opening that tab. */
async function openTab(page: Page, id: "timeline" | "conditions" | "files" | "study") {
  await page.getByTestId(`tab-${id}`).click();
}

/** New, open and the project download live in the header's overflow menu. */
async function headerAction(page: Page, testId: string) {
  await page.getByTestId("header-menu").click();
  await page.getByTestId(testId).click();
}

async function showAllParameters(page: Page) {
  const toggle = page.getByTestId("toggle-parameters");
  if ((await toggle.innerText()).startsWith("show all")) await toggle.click();
}

async function setFixed(page: Page, parameter: string, value: string) {
  await showAllParameters(page);
  await page.getByTestId(`mode-${parameter}`).selectOption("fixed");

  // A rich text field takes markup through its HTML view, the way a person pasting a snippet
  // would; typing into the formatted surface would insert the tags as literal text.
  const markupToggle = page.getByTestId(`value-${parameter}-markup`);
  if ((await markupToggle.count()) > 0) {
    await markupToggle.click();
    await setText(page, `value-${parameter}-html`, value);
    await markupToggle.click();
    return;
  }
  await setText(page, `value-${parameter}`, value);
}

async function buildFlanker(page: Page) {
  await setText(page, "experiment-name", "flanker-practice");

  await openTab(page, "conditions");
  await page.getByTestId("add-by-paste").click();
  await setText(page, "table-name", "flanker_trials");
  await setText(page, "table-rows", CONDITIONS_CSV);
  await page.getByTestId("add-table").click();
  await openTab(page, "timeline");

  await addTrial(page, "html-keyboard-response", "slot-0");
  await setFixed(page, "stimulus", INSTRUCTIONS);

  // A loop arrives holding a step; the block goes inside it and that first step is removed.
  await addStep(page, "slot-1", "loop");
  await setText(page, "loop-id", "practice");
  await addStep(page, "slot-1-1", "block");
  await page.getByTestId("delete-1-0").click();

  await page.getByTestId("node-1-0").click();
  await setText(page, "block-repetitions", "2");
  await page.getByTestId("block-randomize").check();

  // The block's own first step becomes the fixation.
  await page.getByTestId("node-1-0-0").click();
  await setFixed(page, "stimulus", "<p style='font-size:48px'>+</p>");
  await setFixed(page, "choices", "NO_KEYS");
  await setFixed(page, "trial_duration", "50");

  await addTrial(page, "html-keyboard-response", "slot-1-0-1");
  await setText(page, "trial-tag", "practice");
  await showAllParameters(page);
  await page.getByTestId("mode-stimulus").selectOption("column");
  await page.getByTestId("column-stimulus").selectOption("stim");
  await setText(page, "wrap-stimulus", "<p style='font-size:48px'>{}</p>");
  await setFixed(page, "choices", "f,j");
  await page.getByTestId("score-column").selectOption("correct_key");
  await page.getByTestId("record-congruency").check();
}

describe("authoring the flanker task through the UI", () => {
  it("produces the reference spec and a running preview", async () => {
    const page = await app.browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto(app.url);

    await buildFlanker(page);

    await page.getByTestId("view-spec").click();
    const authored = await authoredSpec(page);
    const reference = JSON.parse(
      readFileSync(new URL("../../../examples/flanker.json", import.meta.url), "utf8"),
    ) as Spec;
    expect(authored).toEqual(reference);

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(async () => preview.locator("#jspsych-content").innerText(), { timeout: 15_000 })
      .toContain("Press any key to begin");

    expect(pageErrors).toEqual([]);
    await page.close();
  }, 180_000);
});

describe("recruiting from a platform", () => {
  it("fills in the platform's id parameter and sends participants back once data is saved", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-keyboard-response", "slot-0");
    await setFixed(page, "stimulus", "<p>hello</p>");

    await openTab(page, "study");
    await page.getByTestId("recruitment-platform").selectOption("prolific");
    expect(await page.getByTestId("recruitment-id-param").getAttribute("placeholder")).toBe(
      "PROLIFIC_PID",
    );
    expect(await page.getByTestId("recruitment-hint").innerText()).toContain("completion URL");

    const completion = "https://app.prolific.com/submissions/complete?cc=C1A2B3";
    await setText(page, "recruitment-complete", completion);
    // Sending someone away before their data is uploaded would leave it on their computer.
    await expect
      .poll(() => page.getByTestId("compile-error").innerText(), { timeout: 5_000 })
      .toContain("needs data uploaded first");

    await page.getByTestId("data-mode").selectOption("post");
    await setText(page, "data-experiment-id", "abc123DEF456");
    await expect.poll(() => page.getByTestId("compile-error").count(), { timeout: 5_000 }).toBe(0);

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.recruitment).toEqual({
      platform: "prolific",
      endings: { complete: { url: completion } },
    });

    await page.getByTestId("view-code").click();
    await expect
      .poll(() => page.getByTestId("generated-code").innerText(), { timeout: 5_000 })
      .toContain('linkParameters.get("PROLIFIC_PID")');

    await page.getByTestId("recruitment-platform").selectOption("none");
    await page.getByTestId("view-spec").click();
    await expect.poll(async () => (await authoredSpec(page)).recruitment).toBeUndefined();
    await page.close();
  }, 120_000);
});

describe("choosing where data goes", () => {
  it("warns when nothing is saved, and records the upload settings once chosen", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-keyboard-response", "slot-0");
    await setFixed(page, "stimulus", "<p>hello</p>");

    // The tab carries a mark while nothing is being kept, so the warning is not hidden behind it.
    expect(await page.getByTestId("tab-study").innerText()).toContain("•");

    await openTab(page, "study");
    expect(await page.getByTestId("data-warning").count()).toBe(1);
    await page.getByTestId("data-mode").selectOption("post");
    await expect
      .poll(() => page.getByTestId("compile-error").innerText(), { timeout: 5_000 })
      .toContain("needs an experiment id");

    await setText(page, "data-experiment-id", "abc123DEF456");
    await expect.poll(() => page.getByTestId("compile-error").count(), { timeout: 5_000 }).toBe(0);

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.data).toEqual({ save: "post", experiment_id: "abc123DEF456" });

    await page.getByTestId("view-code").click();
    await expect
      .poll(() => page.getByTestId("generated-code").innerText(), { timeout: 5_000 })
      .toContain("pipe.jspsych.org/api/data/");

    await page.close();
  }, 120_000);

  it("saves each step as it goes only when asked, saying what that means for consent", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-keyboard-response", "slot-0");
    await setFixed(page, "stimulus", "<p>hello</p>");

    await openTab(page, "study");
    await page.getByTestId("data-mode").selectOption("post");
    await setText(page, "data-experiment-id", "abc123DEF456");
    expect(await page.locator('label[for="data-endpoint"]').innerText()).toBe("DataPipe address");
    expect(await page.getByTestId("data-stream").isChecked()).toBe(false);
    expect(await page.getByTestId("data-stream-consent").count()).toBe(0);

    await page.getByTestId("data-stream").check();
    expect(await page.getByTestId("data-stream-consent").innerText()).toContain("consent form");
    await page.getByTestId("view-spec").click();
    expect((await authoredSpec(page)).data).toEqual({
      save: "post",
      experiment_id: "abc123DEF456",
      stream: true,
    });

    await page.getByTestId("data-stream").uncheck();
    expect(await page.getByTestId("data-stream-consent").count()).toBe(0);
    await page.getByTestId("view-spec").click();
    await expect
      .poll(async () => (await authoredSpec(page)).data)
      .toEqual({ save: "post", experiment_id: "abc123DEF456" });

    await page.close();
  }, 120_000);
});

describe("using an image file", () => {
  it("embeds an added file and shows it in the running preview", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await openTab(page, "files");
    await page
      .getByTestId("add-assets")
      .setInputFiles(fileURLToPath(new URL("./fixtures/square.png", import.meta.url)));
    await expect
      .poll(() => page.getByTestId("asset-message").innerText(), { timeout: 5_000 })
      .toContain("square.png");

    await openTab(page, "timeline");
    await addTrial(page, "image-keyboard-response", "slot-0");
    await showAllParameters(page);
    await page.getByTestId("mode-stimulus").selectOption("fixed");
    await page.getByTestId("value-stimulus").selectOption("square.png");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.assets).toHaveLength(1);
    expect(spec.assets?.[0]?.name).toBe("square.png");
    expect(spec.assets?.[0]?.url).toMatch(/^data:image\/png;base64,/);
    expect(trialParams(spec.timeline[0]).stimulus).toBe("square.png");

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    // The plugin draws onto a canvas by default rather than inserting an <img>, so the proof that
    // the embedded file reached the participant is a canvas with the image's pixels on it.
    await expect
      .poll(() => preview.locator("#jspsych-content canvas").count(), { timeout: 20_000 })
      .toBe(1);
    await expect
      .poll(
        () =>
          preview.locator("#jspsych-content canvas").evaluate((element) => {
            const canvas = element as HTMLCanvasElement;
            const context = canvas.getContext("2d")!;
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            return [data[0], data[1], data[2], data[3]].join(",");
          }),
        { timeout: 20_000 },
      )
      .toBe("220,50,47,255");

    await page.close();
  }, 180_000);
});

describe("a parameter that takes a list", () => {
  it("builds instruction pages in the formatted editor and steps through them", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "instructions", "slot-0");

    await page.getByTestId("mode-pages").selectOption("fixed");

    // Each page is written in the same formatted editor as any other text, so markup goes in
    // through its HTML view.
    const writePage = async (index: number, markup: string) => {
      await page.getByTestId(`value-pages-${index}-markup`).click();
      await setText(page, `value-pages-${index}-html`, markup);
      await page.getByTestId(`value-pages-${index}-markup`).click();
    };
    await writePage(0, "<p>Welcome to the study.</p>");
    await page.getByTestId("add-value-pages").click();
    await writePage(1, "<p>Press Enter to start.</p>");

    await showAllParameters(page);
    await page.getByTestId("mode-show_clickable_nav").selectOption("fixed");
    await page.getByTestId("value-show_clickable_nav").check();

    // Every page gets the formatted editor, not a bare one-line box.
    expect(await page.getByTestId("value-pages-0-bold").count()).toBe(1);
    expect(
      await page
        .getByTestId("value-pages-0")
        .evaluate((node) => node.getBoundingClientRect().height),
    ).toBeGreaterThan(80);

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(trialParams(spec.timeline[0]).pages).toEqual([
      "<p>Welcome to the study.</p>",
      "<p>Press Enter to start.</p>",
    ]);
    expect(trialParams(spec.timeline[0]).show_clickable_nav).toBe(true);

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("Welcome to the study");

    await preview.locator("#jspsych-instructions-next").click();
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 10_000 })
      .toContain("Press Enter to start");

    await page.close();
  }, 180_000);
});

describe("a list whose entries are objects", () => {
  it("builds a Likert question and renders its scale in the preview", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "survey-likert", "slot-0");

    // A new question step arrives with one question, ready to edit rather than empty.
    expect(await page.getByTestId("mode-questions").inputValue()).toBe("fixed");
    await setText(page, "value-questions-0-prompt", "I enjoyed this task");
    await setText(page, "value-questions-0-labels-0", "disagree");
    await setText(page, "value-questions-0-labels-1", "agree");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(trialParams(spec.timeline[0]).questions).toEqual([
      { prompt: "<p>I enjoyed this task</p>", labels: ["disagree", "agree"] },
    ]);

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("I enjoyed this task");
    expect(await preview.locator('input[type="radio"]').count()).toBe(2);

    await page.close();
  }, 180_000);
});

describe("a multiple-choice question", () => {
  it("arrives ready to run and offers its options in the preview", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "survey-multi-choice", "slot-0");

    await setText(page, "value-questions-0-prompt", "Which colour?");
    await setText(page, "value-questions-0-options-0", "red");
    await setText(page, "value-questions-0-options-1", "blue");
    expect(await page.getByTestId("step-problems").count()).toBe(0);

    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("Which colour?");
    expect(await preview.locator('input[type="radio"]').count()).toBe(2);
    expect(await preview.getByLabel("blue").count()).toBe(1);

    await page.close();
  }, 180_000);

  it("offers its questions to a branch on the answer, and follows the one chosen", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "survey-multi-choice", "slot-0");
    await setText(page, "trial-tag", "colour");
    await setText(page, "value-questions-0-options-0", "red");
    await setText(page, "value-questions-0-options-1", "blue");

    await addStep(page, "slot-1", "branch");
    await page.getByTestId("branch-basis").selectOption("response");
    await setText(page, "branch-scope", "colour");
    await setText(page, "branch-answer", "blue");
    await expect
      .poll(() => page.getByTestId("step-problems").innerText())
      .toContain("needs the question it reads (questions: Q0)");

    const question = page.getByTestId("branch-question");
    expect(
      await question
        .locator("option:not([disabled])")
        .evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)),
    ).toEqual(["Q0"]);
    await question.selectOption("Q0");
    await expect.poll(() => page.getByTestId("step-problems").count()).toBe(0);

    await page.getByTestId("node-1-0-0").click();
    await setFixed(page, "stimulus", "<p>blue it is</p>");

    const preview = page.frameLocator('[data-testid="preview"]');
    await expect.poll(() => preview.getByLabel("blue").count(), { timeout: 20_000 }).toBe(1);
    await preview.getByLabel("blue").check();
    await preview.locator("#jspsych-survey-multi-choice-next").click();
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 10_000 })
      .toContain("blue it is");
    await page.close();
  }, 180_000);

  it("keeps its question when it becomes a checkbox question", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "survey-multi-choice", "slot-0");
    await setText(page, "value-questions-0-prompt", "Which colours?");
    await page.getByTestId("trial-plugin").selectOption("survey-multi-select");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(trialParams(spec.timeline[0]).questions).toEqual([
      { prompt: "<p>Which colours?</p>", options: ["Option 1", "Option 2"] },
    ]);
    await page.close();
  }, 180_000);
});

describe("a slider step", () => {
  it("takes a list of videos, offers only video files for it, and shows its slider", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await openTab(page, "files");
    await page
      .getByTestId("add-assets")
      .setInputFiles([
        fileURLToPath(new URL("./fixtures/square.png", import.meta.url)),
        fileURLToPath(
          new URL("../../../packages/compiler/test/fixtures/clip.webm", import.meta.url),
        ),
      ]);
    await expect
      .poll(() => page.getByTestId("asset-message").innerText(), { timeout: 5_000 })
      .toContain("clip.webm");
    expect(await page.locator(".asset video.thumb").count()).toBe(1);

    await openTab(page, "timeline");
    await addTrial(page, "video-slider-response", "slot-0");
    await page.getByTestId("mode-stimulus").selectOption("fixed");
    const video = page.getByTestId("value-stimulus-0");
    expect(
      await video
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
        ),
    ).toEqual(["clip.webm"]);
    await video.selectOption("clip.webm");

    await page.getByTestId("view-spec").click();
    expect(trialParams((await authoredSpec(page)).timeline[0]).stimulus).toEqual(["clip.webm"]);

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator('#jspsych-content input[type="range"]').count(), {
        timeout: 20_000,
      })
      .toBe(1);
    expect(await preview.locator("#jspsych-content video").count()).toBe(1);
    await page.close();
  }, 180_000);

  it("leaves a width with no default blank, and a cleared number unset", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-slider-response", "slot-0");
    await showAllParameters(page);

    await page.getByTestId("mode-slider_width").selectOption("fixed");
    expect(await page.getByTestId("value-slider_width").inputValue()).toBe("");
    await page.getByTestId("view-spec").click();
    expect(trialParams((await authoredSpec(page)).timeline[0]).slider_width).toBeNull();
    await page.getByTestId("view-experiment").click();

    await page.getByTestId("value-slider_width").fill("300");
    await page.getByTestId("value-slider_width").blur();
    await page.getByTestId("value-slider_width").fill("");
    await page.getByTestId("value-slider_width").blur();
    expect(await page.getByTestId("mode-slider_width").inputValue()).toBe("unset");
    await page.close();
  }, 180_000);
});

describe("a step that scores itself", () => {
  it("arrives ready to run and says it needs no scoring rule", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "categorize-html", "slot-0");

    expect(await page.getByTestId("scores-itself").count()).toBe(1);
    expect(await page.getByTestId("score-column").count()).toBe(0);
    expect(await page.getByTestId("step-problems").count()).toBe(0);
    await page.close();
  }, 180_000);

  it("drops the scoring rule a step had when it becomes one that scores itself", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();
    const practice = async () => {
      const loop = stepOfKind((await authoredSpec(page)).timeline[1], "loop");
      const block = stepOfKind(loop.children[0], "block");
      return stepOfKind(block.children[1], "trial");
    };
    await page.getByTestId("view-spec").click();
    expect((await practice()).score).toBeDefined();

    await page.getByTestId("node-1-0-1").click();
    await page.getByTestId("trial-plugin").selectOption("categorize-html");
    expect(await page.getByTestId("scores-itself").count()).toBe(1);
    await expect.poll(() => page.getByTestId("step-problems").count()).toBe(0);
    expect((await practice()).score).toBeUndefined();
    await page.close();
  }, 180_000);
});

describe("a setting jsPsych leaves empty", () => {
  it("starts empty rather than as an empty file name", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "sketchpad", "slot-0");
    await showAllParameters(page);
    await page.getByTestId("mode-background_image").selectOption("fixed");

    await page.getByTestId("view-spec").click();
    expect(trialParams((await authoredSpec(page)).timeline[0]).background_image).toBeNull();
    expect(await page.getByTestId("step-problems").count()).toBe(0);
    await page.close();
  }, 180_000);
});

describe("a browser check that turns people away", () => {
  it("is asked where to send them, and drops that if it becomes another step", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    const spec = {
      name: "screening",
      recruitment: { endings: { screened_out: { message: "<p>Sorry.</p>" } } },
      timeline: [{ kind: "trial", plugin: "browser-check", params: { minimum_width: 800 } }],
    };
    await page.getByTestId("header-menu").click();
    await page.getByTestId("import-spec").setInputFiles({
      name: "screening.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
    await page.getByTestId("node-0").click();
    await expect
      .poll(() => page.getByTestId("step-problems").innerText())
      .toContain("needs an ending to send them to");

    await page.getByTestId("trial-exclusion").selectOption("screened_out");
    await expect.poll(() => page.getByTestId("step-problems").count()).toBe(0);

    await page.getByTestId("trial-plugin").selectOption("html-keyboard-response");
    expect(await page.getByTestId("trial-exclusion").count()).toBe(0);
    await page.getByTestId("view-spec").click();
    expect(
      stepOfKind((await authoredSpec(page)).timeline[0], "trial").exclusion_ending,
    ).toBeUndefined();
    await page.close();
  }, 180_000);
});

describe("settings worth checking", () => {
  const spec = {
    name: "drawing",
    timeline: [
      { kind: "trial", plugin: "browser-check" },
      { kind: "trial", plugin: "sketchpad", params: { show_finished_button: false } },
    ],
  };

  async function openDrawing(page: Page) {
    await page.goto(app.url);
    await page.getByTestId("header-menu").click();
    await page.getByTestId("import-spec").setInputFiles({
      name: "drawing.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(spec)),
    });
  }

  const colourOf = (page: Page, selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => getComputedStyle(element).color);

  it("are shown apart from errors, and leave the experiment to run", async () => {
    const page = await app.browser.newPage();
    await openDrawing(page);

    await expect
      .poll(() => page.getByTestId("compile-warnings").innerText(), { timeout: 5_000 })
      .toContain("1 step has settings that may not do what you meant");
    await expect.poll(() => page.getByTestId("compile-error").count(), { timeout: 5_000 }).toBe(0);
    await expect.poll(() => page.getByTestId("preview").count(), { timeout: 15_000 }).toBe(1);

    expect(await page.getByTestId("caution-1").innerText()).toContain("worth checking");
    expect(await page.getByTestId("issue-1").count()).toBe(0);

    await page.getByTestId("node-1").click();
    expect(await page.getByTestId("step-warnings").innerText()).toContain("has nothing to end it");
    expect(await page.getByTestId("step-problems").count()).toBe(0);
    await page.close();
  }, 120_000);

  it("are marked in the caution colour, in light and in dark", async () => {
    for (const scheme of ["light", "dark"] as const) {
      const page = await app.browser.newPage({ colorScheme: scheme });
      await openDrawing(page);
      await page.getByTestId("node-1").click();
      const caution = brandColour("caution", scheme);
      expect(await colourOf(page, '[data-testid="caution-1"]')).toBe(caution);
      expect(await colourOf(page, '[data-testid="step-warnings"] .warnings-title')).toBe(caution);
      expect(await colourOf(page, '[data-testid="compile-warnings"] .warnings-title')).toBe(
        caution,
      );
      await page.close();
    }
  }, 120_000);

  it("include that a browser check in the preview finds no camera or microphone", async () => {
    const page = await app.browser.newPage();
    await openDrawing(page);
    expect(await page.getByTestId("device-check-note").innerText()).toContain(
      "records both as missing",
    );
    await page.getByTestId("node-0").click();
    await page.getByTestId("trial-plugin").selectOption("html-keyboard-response");
    expect(await page.getByTestId("device-check-note").count()).toBe(0);
    await page.close();
  }, 120_000);
});

describe("a grid of squares", () => {
  it("is edited as a grid, and has to keep a key for every square", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "serial-reaction-time", "slot-0");
    await showAllParameters(page);
    await page.getByTestId("mode-grid").selectOption("fixed");
    expect(await page.getByTestId("value-grid-0-3").isChecked()).toBe(true);

    await page.getByTestId("value-grid-add-row").click();
    await page.getByTestId("value-grid-1-2").uncheck();
    await page.getByTestId("view-spec").click();
    expect(trialParams((await authoredSpec(page)).timeline[0]).grid).toEqual([
      [1, 1, 1, 1],
      [1, 1, 0, 1],
    ]);
    await expect
      .poll(() => page.getByTestId("step-problems").innerText())
      .toContain("needs one key in its choices for each place in its grid");

    await page.getByTestId("value-grid-remove-row").click();
    await expect.poll(() => page.getByTestId("step-problems").count()).toBe(0);
    await page.close();
  }, 180_000);
});

describe("a canvas step", () => {
  it("offers each shape its own fields and draws it in the preview", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "psychophysics", "slot-0");

    expect(await page.getByTestId("value-stimuli-0-obj_type").inputValue()).toBe("cross");
    expect(await page.getByTestId("value-stimuli-0-radius").count()).toBe(0);

    await page.getByTestId("value-stimuli-0-obj_type").selectOption("circle");
    await expect
      .poll(() => page.getByTestId("step-problems").innerText())
      .toContain('(circle) needs "radius"');
    await page.getByTestId("value-stimuli-0-radius").fill("50");
    await page.getByTestId("value-stimuli-0-radius").blur();
    await setText(page, "value-stimuli-0-fill_color", "red");
    expect(await page.getByTestId("value-stimuli-0-content").count()).toBe(0);

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(trialParams(spec.timeline[0]).stimuli).toEqual([
      { obj_type: "circle", radius: 50, fill_color: "red" },
    ]);

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect.poll(() => preview.locator("#myCanvas").count(), { timeout: 20_000 }).toBe(1);

    await page.close();
  }, 180_000);

  it("places objects by dragging them on the stage", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "psychophysics", "slot-0");

    // Objects are measured from the centre unless they say otherwise, and the form says so too.
    expect(await page.getByTestId("value-stimuli-0-origin_center").isChecked()).toBe(true);

    const stage = page.getByTestId("stage-stimuli");
    const onScreen = (x: number, y: number) =>
      stage.evaluate(
        (svg, point) => {
          const screen = new DOMPoint(point.x, point.y).matrixTransform(
            (svg as SVGSVGElement).getScreenCTM()!,
          );
          return { x: screen.x, y: screen.y };
        },
        { x, y },
      );
    const dragOnStage = async (from: [number, number], to: [number, number]) => {
      await stage.scrollIntoViewIfNeeded();
      const start = await onScreen(...from);
      const end = await onScreen(...to);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    };
    const firstObject = async () => {
      await page.getByTestId("view-spec").click();
      return (trialParams((await authoredSpec(page)).timeline[0]).stimuli as unknown[])[0];
    };

    // The step starts with a cross at the centre of the 800 × 600 stand-in for the window.
    await dragOnStage([400, 300], [550, 200]);
    expect(await firstObject()).toMatchObject({ startX: 150, startY: -100 });

    // Dropping it a few pixels off centre lands it exactly on centre.
    await dragOnStage([550, 200], [404, 297]);
    expect(await firstObject()).toMatchObject({ startX: 0, startY: 0 });

    const object = page.getByTestId("stage-stimuli-object-0");
    await object.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    expect(await firstObject()).toMatchObject({ startX: 1, startY: 10 });

    // Selecting on the stage and in the form are one selection.
    await object.click();
    await expect.poll(() => page.locator(".entry.selected").count()).toBe(1);
    await page.getByTestId("add-value-stimuli").click();
    await page.getByTestId("value-stimuli-1-obj_type").focus();
    await page.getByTestId("value-stimuli-1-obj_type").selectOption("rect");
    await expect
      .poll(() => page.getByTestId("stage-stimuli-object-1").getAttribute("aria-pressed"))
      .toBe("true");

    // A selection belongs to its step, so moving to another canvas step shows nothing selected.
    await addTrial(page, "psychophysics", "slot-1");
    await page.getByTestId("node-0").click();
    await page.getByTestId("stage-stimuli-object-0").focus();
    await page.getByTestId("node-1").click();
    expect(await page.locator(".entry.selected").count()).toBe(0);
    await page.getByTestId("node-0").click();
    await page.getByTestId("stage-stimuli-object-1").focus();

    // Removing the selected object leaves nothing selected rather than its neighbour.
    await page.getByTestId("remove-value-stimuli-1").click();
    await expect.poll(() => page.locator(".entry.selected").count()).toBe(0);

    await page.close();
  }, 180_000);
});

describe("splitting participants between groups", () => {
  it("builds two groups and runs exactly one of them", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addStep(page, "slot-0", "assign");
    await setText(page, "group-name-0", "wide");
    await setText(page, "group-name-1", "narrow");
    await setText(page, "assign-column", "spacing");

    // Each group arrives with a step in it, so they only need their text.
    for (const [index, label] of ["wide", "narrow"].entries()) {
      await page.getByTestId(`node-0-${index}-0`).click();
      await setFixed(page, "stimulus", `<p>${label} condition</p>`);
    }

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    const split = stepOfKind(spec.timeline[0], "assign");
    expect(split.record_as).toBe("spacing");
    expect(split.groups.map((group) => group.name)).toEqual(["wide", "narrow"]);
    expect(split.groups[0].children).toHaveLength(1);

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toMatch(/wide condition|narrow condition/);

    const shown = await preview.locator("#jspsych-content").innerText();
    const other = shown.includes("wide") ? "narrow condition" : "wide condition";
    expect(shown).not.toContain(other);

    await page.close();
  }, 180_000);
});

describe("counterbalancing the order of tasks", () => {
  it("builds two tasks and runs both, one after the other", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addStep(page, "slot-0", "counterbalance");
    await setText(page, "task-name-0", "flanker");
    await setText(page, "task-name-1", "stroop");
    await setText(page, "counterbalance-column", "task_order");

    // Without uploading there is nobody to count participants, and the step says so.
    await page.getByTestId("counterbalance-method").selectOption("latin_square");
    expect(await page.getByTestId("counterbalance-orders").innerText()).toContain("2 orders");
    await expect
      .poll(() => page.getByTestId("step-problems").innerText())
      .toContain("only random order");
    await page.getByTestId("counterbalance-method").selectOption("random");
    await expect.poll(() => page.getByTestId("step-problems").count()).toBe(0);

    for (const [index, label] of ["flanker", "stroop"].entries()) {
      await page.getByTestId(`node-0-${index}-0`).click();
      await setFixed(page, "stimulus", `<p>${label} task</p>`);
    }

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    const counterbalance = stepOfKind(spec.timeline[0], "counterbalance");
    expect(counterbalance.method).toBe("random");
    expect(counterbalance.record_as).toBe("task_order");
    expect(counterbalance.tasks.map((task) => task.name)).toEqual(["flanker", "stroop"]);

    await page.getByTestId("view-experiment").click();
    const content = page.frameLocator('[data-testid="preview"]').locator("#jspsych-content");
    await expect
      .poll(() => content.innerText(), { timeout: 20_000 })
      .toMatch(/flanker task|stroop task/);
    const first = await content.innerText();
    const second = first.includes("flanker") ? "stroop task" : "flanker task";

    await content.click();
    await page.keyboard.press("Space");
    await expect.poll(() => content.innerText(), { timeout: 5_000 }).toContain(second);

    await page.close();
  }, 180_000);
});

describe("routing on performance", () => {
  it("builds a branch with a step on each path", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addTrial(page, "html-keyboard-response", "slot-0");
    await setText(page, "trial-tag", "screening");
    await setFixed(page, "stimulus", "<p>screening</p>");

    await addStep(page, "slot-1", "branch");
    await setText(page, "branch-scope", "screening");
    await page.getByTestId("branch-comparison").selectOption("at_least");
    await setText(page, "branch-threshold", "0.75");

    // The first path arrives with a step; the other is empty until something is put in it.
    await page.getByTestId("node-1-0-0").click();
    await setFixed(page, "stimulus", "<p>continue</p>");

    await addTrial(page, "html-keyboard-response", "slot-1-1-0");
    await setFixed(page, "stimulus", "<p>stop</p>");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.timeline[1]).toMatchObject({
      kind: "branch",
      when: { scope: "screening", accuracy_at_least: 0.75 },
    });
    const branch = stepOfKind(spec.timeline[1], "branch");
    expect(branch.then).toHaveLength(1);
    expect(branch.otherwise).toHaveLength(1);

    // The preview rebuilds a moment after the last edit, so it can still show the empty path.
    await expect.poll(() => page.getByTestId("compile-error").count(), { timeout: 5_000 }).toBe(0);
    await page.close();
  }, 180_000);

  it("builds a branch on what the participant answered", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addTrial(page, "html-keyboard-response", "slot-0");
    await setText(page, "trial-tag", "consent");
    await setFixed(page, "stimulus", "<p>press y to agree, n to decline</p>");

    await addStep(page, "slot-1", "branch");
    await page.getByTestId("branch-basis").selectOption("response");
    await setText(page, "branch-scope", "consent");
    await setText(page, "branch-answer", "n");
    await page.getByTestId("node-1-0-0").click();
    await setFixed(page, "stimulus", "<p>thank you anyway</p>");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.timeline[1]).toMatchObject({
      kind: "branch",
      when: { scope: "consent", response_equals: "n" },
    });
    expect(await page.getByTestId("node-1").innerText()).toContain("if consent answered “n”");

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("press y to agree");
    await preview.locator("#jspsych-content").click();
    await page.keyboard.press("n");
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 10_000 })
      .toContain("thank you anyway");
    await page.close();
  }, 180_000);
});

describe("ending the study early", () => {
  it("ends a declined consent with the ending's message, in the preview too", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addTrial(page, "html-keyboard-response", "slot-0");
    await setText(page, "trial-tag", "consent");
    await setFixed(page, "stimulus", "<p>press y to agree, n to decline</p>");
    await addTrial(page, "html-keyboard-response", "slot-1");
    await setFixed(page, "stimulus", "<p>the task</p>");

    await openTab(page, "study");
    await setText(page, "new-ending-name", "no_consent");
    await page.getByTestId("add-ending").click();
    await setText(page, "ending-message-no_consent", "<p>Thank you anyway.</p>");
    await page.getByTestId("ending-keep-no_consent").selectOption("nothing");
    await openTab(page, "timeline");

    await addStep(page, "slot-1", "branch");
    await page.getByTestId("branch-basis").selectOption("response");
    await setText(page, "branch-scope", "consent");
    await setText(page, "branch-answer", "n");
    await page.getByTestId("delete-1-0-0").click();
    await addStep(page, "slot-1-0-0", "end");
    expect(await page.getByTestId("end-ending").inputValue()).toBe("no_consent");
    expect(await page.getByTestId("node-1-0-0").innerText()).toContain("finish as “no_consent”");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(stepOfKind(spec.timeline[1], "branch").then).toEqual([
      { kind: "end", ending: "no_consent" },
    ]);
    expect(spec.recruitment).toEqual({
      endings: { no_consent: { message: "<p>Thank you anyway.</p>", keep: "nothing" } },
    });

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("press y to agree");
    await preview.locator("#jspsych-content").click();
    await page.keyboard.press("n");
    await expect
      .poll(() => preview.locator("body").innerText(), { timeout: 10_000 })
      .toContain("Thank you anyway.");
    expect(await preview.locator("body").innerText()).not.toContain("the task");
    await page.close();
  }, 180_000);
});

describe("opening an example", () => {
  it("fills the timeline and runs it straight away", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await page.getByTestId("example-stroop").click();

    await expect
      .poll(() => page.getByTestId("node-0").innerText(), { timeout: 5_000 })
      .toContain("Instruction pages");
    await expect.poll(() => page.getByTestId("compile-error").count(), { timeout: 5_000 }).toBe(0);

    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("colour words");

    await page.close();
  }, 180_000);
});

describe("working with what is already there", () => {
  it("opens a conditions table, edits a cell, and starts over", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();

    await openTab(page, "conditions");
    await page.getByTestId("open-table-flanker_trials").click();
    await page.getByTestId("grid-flanker_trials").waitFor({ timeout: 5_000 });
    expect(await page.getByTestId("cell-flanker_trials-0-congruency").inputValue()).toBe(
      "congruent",
    );

    await setText(page, "cell-flanker_trials-0-stim", "^^^^^");
    await page.getByTestId("add-row-flanker_trials").click();

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.conditions?.flanker_trials?.[0].stim).toBe("^^^^^");
    expect(spec.conditions?.flanker_trials).toHaveLength(5);

    page.on("dialog", (dialog) => dialog.accept());
    await headerAction(page, "new-project");
    await expect
      .poll(() => page.getByTestId("example-flanker").count(), { timeout: 5_000 })
      .toBe(1);

    await page.close();
  }, 120_000);

  it("carries experiment-wide settings into the generated code", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();

    await openTab(page, "study");
    await setText(page, "setting-default-iti", "250");
    await page.getByTestId("setting-progress-bar").check();

    await page.getByTestId("view-code").click();
    await expect
      .poll(() => page.getByTestId("generated-code").innerText(), { timeout: 5_000 })
      .toContain("default_iti: 250");
    expect(await page.getByTestId("generated-code").innerText()).toContain(
      "show_progress_bar: true",
    );

    await page.close();
  }, 120_000);
});

describe("writing stimulus text", () => {
  it("formats without typing HTML, and still lets you edit the markup", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-keyboard-response", "slot-0");
    await page.getByTestId("mode-stimulus").selectOption("fixed");

    const surface = page.getByTestId("value-stimulus");
    await surface.click();
    await page.keyboard.type("Welcome");
    await page.keyboard.press("ControlOrMeta+a");
    await page.getByTestId("value-stimulus-bold").click();
    await page.getByTestId("value-stimulus-size").selectOption("48px");

    await page.getByTestId("view-spec").click();
    const authored = await authoredSpec(page);
    const stimulus = trialParams(authored.timeline[0]).stimulus as string;
    expect(stimulus).toContain("Welcome");
    expect(stimulus).toMatch(/<b>|font-weight|<strong>/);
    expect(stimulus).toContain("48px");

    // The preview shows it the way the participant will see it.
    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("Welcome");

    // The markup is still reachable for anyone who wants it.
    await page.getByTestId("value-stimulus-markup").click();
    const html = page.getByTestId("value-stimulus-html");
    expect(await html.inputValue()).toContain("Welcome");
    await html.fill("<p>typed as markup</p>");
    await html.blur();
    await page.getByTestId("view-spec").click();
    const edited = await authoredSpec(page);
    expect(trialParams(edited.timeline[0]).stimulus).toBe("<p>typed as markup</p>");

    await page.close();
  }, 180_000);

  it("colours text even though the picker takes the focus away", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-keyboard-response", "slot-0");
    await page.getByTestId("mode-stimulus").selectOption("fixed");

    await page.getByTestId("value-stimulus").click();
    await page.keyboard.type("colour me");

    // The native colour picker moves focus out of the editor before the change is reported,
    // which is what used to lose the selection and silently apply nothing.
    await page.getByTestId("trial-tag").click();
    await page.getByTestId("value-stimulus-colour").evaluate((node) => {
      (node as HTMLInputElement).value = "#cc0000";
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    const stimulus = trialParams(spec.timeline[0]).stimulus as string;
    expect(stimulus).toContain("colour me");
    expect(stimulus).toMatch(/color: rgb\(204, 0, 0\)|#cc0000/i);

    await page.close();
  }, 120_000);

  it("writes text against the backdrop the participant will see", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-keyboard-response", "slot-0");
    await page.getByTestId("mode-stimulus").selectOption("fixed");

    const surfaceBackground = () =>
      page.getByTestId("value-stimulus").evaluate((node) => getComputedStyle(node).backgroundColor);

    // Default: jsPsych runs on white, so the editor is white whatever the builder's own theme is.
    expect(await surfaceBackground()).toBe("rgb(255, 255, 255)");

    await openTab(page, "study");
    await page.getByTestId("setting-background").evaluate((node) => {
      (node as HTMLInputElement).value = "#101014";
      node.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The editor follows the experiment, so light text on a dark stimulus screen stays readable.
    await expect.poll(surfaceBackground, { timeout: 5_000 }).toBe("rgb(16, 16, 20)");

    await page.getByTestId("view-experiment").click();
    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(
        () => preview.locator("body").evaluate((node) => getComputedStyle(node).backgroundColor),
        { timeout: 20_000 },
      )
      .toBe("rgb(16, 16, 20)");

    await page.close();
  }, 120_000);

  it("gives the field room to show more than a line or two", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await addTrial(page, "html-keyboard-response", "slot-0");
    await page.getByTestId("mode-stimulus").selectOption("fixed");

    const height = await page
      .getByTestId("value-stimulus")
      .evaluate((node) => node.getBoundingClientRect().height);
    expect(height).toBeGreaterThan(80);

    await page.close();
  }, 120_000);
});

describe("finding things in the sidebar", () => {
  it("keeps each group of settings on its own tab", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();

    // A long timeline no longer pushes everything else out of sight.
    expect(await page.getByTestId("data-mode").count()).toBe(0);
    expect(await page.getByTestId("node-0").count()).toBe(1);

    await openTab(page, "study");
    expect(await page.getByTestId("data-mode").count()).toBe(1);
    expect(await page.getByTestId("node-0").count()).toBe(0);

    await openTab(page, "conditions");
    expect(await page.getByTestId("open-table-flanker_trials").count()).toBe(1);

    await openTab(page, "files");
    expect(await page.getByTestId("add-assets").count()).toBe(1);

    await page.close();
  }, 120_000);

  it("marks the study tab while results are going nowhere", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    // An empty project has nothing to lose, so there is nothing to warn about.
    expect(await page.getByTestId("tab-study").innerText()).not.toContain("•");

    // The flanker example does not say where its data goes, and the mark says so.
    await page.getByTestId("example-flanker").click();
    await expect
      .poll(() => page.getByTestId("tab-study").innerText(), { timeout: 5_000 })
      .toContain("•");

    // The Stroop example downloads its results, so it is not flagged.
    page.on("dialog", (dialog) => dialog.accept());
    await headerAction(page, "new-project");
    await page.getByTestId("example-stroop").click();
    await expect
      .poll(() => page.getByTestId("tab-study").innerText(), { timeout: 5_000 })
      .not.toContain("•");

    await page.close();
  }, 120_000);
});

describe("building a conditions table from a design", () => {
  it("crosses factors into rows without anyone writing a table", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await openTab(page, "conditions");

    await setText(page, "factor-table-name", "stroop_trials");
    await setText(page, "factor-name-0", "word");
    await setText(page, "factor-levels-0", "RED, BLUE");
    await setText(page, "factor-name-1", "ink");
    await setText(page, "factor-levels-1", "red, blue");

    // It says what it is about to make before making it.
    await expect
      .poll(() => page.getByTestId("factor-preview").innerText(), { timeout: 5_000 })
      .toContain("4 rows: word, ink");

    await page.getByTestId("build-table").click();

    // The new table opens so you can see what you got.
    await page.getByTestId("grid-stroop_trials").waitFor({ timeout: 5_000 });
    expect(await page.getByTestId("cell-stroop_trials-0-word").inputValue()).toBe("RED");
    expect(await page.getByTestId("cell-stroop_trials-3-ink").inputValue()).toBe("blue");

    await openTab(page, "timeline");
    await addStep(page, "slot-0", "block");
    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.conditions?.stroop_trials).toHaveLength(4);
    expect(spec.conditions?.stroop_trials?.[0]).toEqual({ word: "RED", ink: "red" });

    await page.close();
  }, 120_000);

  it("explains what is missing rather than building an empty table", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await openTab(page, "conditions");

    await setText(page, "factor-name-0", "word");
    await setText(page, "factor-levels-0", "RED, BLUE");
    await page.getByTestId("build-table").click();

    await expect
      .poll(() => page.getByTestId("factor-problem").first().innerText(), { timeout: 5_000 })
      .toContain("needs a name");
    expect(await page.getByTestId("grid-stroop_trials").count()).toBe(0);

    await page.close();
  }, 120_000);
});

describe("deciding where a step goes", () => {
  it("puts the next step at the chosen gap, not beside whatever is selected", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addTrial(page, "html-keyboard-response", "slot-0");
    await setFixed(page, "stimulus", "<p>first</p>");
    await addTrial(page, "html-keyboard-response", "slot-1");
    await setFixed(page, "stimulus", "<p>third</p>");

    // The gap between them, chosen while the last step added is the one being edited.
    await addTrial(page, "html-keyboard-response", "slot-1");
    await setFixed(page, "stimulus", "<p>second</p>");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.timeline.map((step) => trialParams(step).stimulus)).toEqual([
      "<p>first</p>",
      "<p>second</p>",
      "<p>third</p>",
    ]);

    await page.close();
  }, 120_000);

  it("adds steps that are ready to run, and containers that already hold one", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addStep(page, "slot-0", "trial");
    // Nothing is half-built: a new step has text in it and the preview runs. The preview rebuilds
    // once an edit settles, so the empty project's own error takes a moment to clear.
    const settled = () => page.getByTestId("compile-error").count();
    await expect.poll(settled, { timeout: 5_000 }).toBe(0);

    await addStep(page, "slot-1", "loop");
    await expect.poll(settled, { timeout: 5_000 }).toBe(0);
    expect(await page.getByTestId("node-1-0").count()).toBe(1);

    const preview = page.frameLocator('[data-testid="preview"]');
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("Your text here");

    await page.close();
  }, 120_000);

  it("says what each step does rather than what it is", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();

    expect(await page.getByTestId("node-1").innerText()).toContain("repeat while accuracy under");
    expect(await page.getByTestId("node-1-0").innerText()).toContain("once for each of 4 rows");
    expect(await page.getByTestId("node-1-0").innerText()).toContain("× 2");

    await page.close();
  }, 120_000);
});

describe("a step that is not ready says so itself", () => {
  it("marks the step rather than only shouting in the preview", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await addTrial(page, "html-keyboard-response", "slot-0");
    expect(await page.getByTestId("issue-0").count()).toBe(0);

    // An image step cannot know which picture to show until a file is chosen.
    await page.getByTestId("trial-plugin").selectOption("image-keyboard-response");
    await expect.poll(() => page.getByTestId("issue-0").count(), { timeout: 5_000 }).toBe(1);
    expect(await page.getByTestId("issue-0").getAttribute("title")).toContain("requires parameter");

    // The one that is fine is not marked.
    await addTrial(page, "html-keyboard-response", "slot-1");
    expect(await page.getByTestId("issue-1").count()).toBe(0);

    await page.close();
  }, 120_000);

  it("offers the kinds of step at the gap, and says why one is unavailable", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);

    await page.getByTestId("slot-0").click();
    const menu = page.getByTestId("slot-0-menu");
    await menu.waitFor({ timeout: 5_000 });
    expect(await menu.innerText()).toContain("Trial");
    expect(await menu.innerText()).toContain("repeat steps until performance is good enough");

    // A block needs a table to repeat over, so it is offered but not usable yet.
    expect(await page.getByTestId("slot-0-block").isDisabled()).toBe(true);
    expect(await menu.innerText()).toContain("needs a conditions table");

    await page.getByTestId("slot-0-cancel").click();
    expect(await page.getByTestId("slot-0-menu").count()).toBe(0);

    await page.close();
  }, 120_000);
});

describe("seeing one step without clicking through the rest", () => {
  it("runs the selected step, in the block it belongs to", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-stroop").click();

    const preview = page.frameLocator('[data-testid="preview"]');
    // From the start, the instructions come first.
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("colour words");

    // Pick the scored trial, deep inside the block, and run only that.
    await page.getByTestId("node-2-1").click();
    await page.getByTestId("run-from-step").click();

    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toMatch(/RED|BLUE/);
    expect(await page.getByTestId("preview-note").innerText()).toContain("Nothing is saved");

    // Back to the whole thing.
    await page.getByTestId("run-whole").click();
    await expect
      .poll(() => preview.locator("#jspsych-content").innerText(), { timeout: 20_000 })
      .toContain("colour words");

    await page.close();
  }, 180_000);

  it("never uploads from a preview, however the experiment saves data", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();

    await openTab(page, "study");
    await page.getByTestId("data-mode").selectOption("post");
    await setText(page, "data-experiment-id", "realExperiment");

    await page.getByTestId("view-code").click();
    const generated = await page.getByTestId("generated-code").innerText();
    expect(generated).not.toContain("pipe.jspsych.org");
    expect(generated).not.toContain("realExperiment");

    // The exported file is the one that saves.
    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.data).toEqual({ save: "post", experiment_id: "realExperiment" });

    await page.close();
  }, 120_000);
});

describe("saying who made the experiment", () => {
  it("records authors and hands them to the data description", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();
    await openTab(page, "study");

    await page.getByTestId("add-author").click();
    await setText(page, "author-name-0", "A Researcher");
    await setText(page, "author-id-0", "https://orcid.org/0000-0002-1825-0097");

    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.authors).toEqual([
      { name: "A Researcher", identifier: "https://orcid.org/0000-0002-1825-0097" },
    ]);

    await page.close();
  }, 120_000);

  it("leaves authors out entirely when nobody is named", async () => {
    const page = await app.browser.newPage();
    await page.goto(app.url);
    await page.getByTestId("example-flanker").click();
    await openTab(page, "study");

    await page.getByTestId("add-author").click();
    await page.getByTestId("view-spec").click();
    const spec = await authoredSpec(page);
    expect(spec.authors).toBeUndefined();

    await page.close();
  }, 120_000);
});
