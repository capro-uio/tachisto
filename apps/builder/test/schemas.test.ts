import { describe, expect, it } from "vitest";
import type { ParameterSchema } from "tachisto-schemas";
import {
  paramsForPlugin,
  placeholderFor,
  pluginChoices,
  pluginTitle,
  schemas,
  startingParams,
  switchVariant,
  visibleFields,
} from "../src/lib/schemas.ts";

const canvasObject = schemas.plugins.psychophysics.properties.stimuli.items!;
const shown = (value: Record<string, unknown>) =>
  visibleFields(canvasObject, value).map(([name]) => name);

describe("startingParams", () => {
  it("starts a canvas step from the schema's example", () => {
    expect(startingParams("psychophysics")).toEqual({
      stimuli: [{ obj_type: "cross", line_length: 40 }],
    });
  });

  it("gives each new step its own copy of the example", () => {
    const first = startingParams("psychophysics").stimuli as { line_length: number }[];
    first[0].line_length = 99;
    expect(startingParams("psychophysics").stimuli).toEqual([
      { obj_type: "cross", line_length: 40 },
    ]);
  });

  it.each([
    ["survey-likert", { prompt: "<p>Your text here</p>", labels: ["Option 1", "Option 2"] }],
    ["survey-multi-choice", { prompt: "<p>Your text here</p>", options: ["Option 1", "Option 2"] }],
    ["survey-multi-select", { prompt: "<p>Your text here</p>", options: ["Option 1", "Option 2"] }],
    ["survey-text", { prompt: "<p>Your text here</p>" }],
  ])("starts %s with one question ready to run", (plugin, question) => {
    expect(startingParams(plugin)).toEqual({ questions: [question] });
  });

  it("starts each question with its own placeholder options", () => {
    const first = startingParams("survey-multi-choice").questions as { options: string[] }[];
    first[0].options.push("Option 3");
    const second = startingParams("survey-multi-choice").questions as { options: string[] }[];
    expect(second[0].options).toEqual(["Option 1", "Option 2"]);
  });

  it.each([
    "html-button-response",
    "image-button-response",
    "video-button-response",
    "audio-button-response",
  ])("starts %s with two buttons to rename", (plugin) => {
    expect(startingParams(plugin).choices).toEqual(["Option 1", "Option 2"]);
  });

  it("starts a text step answered with buttons ready to run", () => {
    expect(startingParams("html-button-response")).toEqual({
      stimulus: "<p>Your text here</p>",
      choices: ["Option 1", "Option 2"],
    });
  });

  it.each([
    ["categorize-html", { stimulus: "<p>Your text here</p>", key_answer: "f" }],
    ["same-different-html", { stimuli: ["<p>A</p>", "<p>A</p>"], answer: "same" }],
  ])("starts %s from its starting example, ready to run", (plugin, params) => {
    expect(startingParams(plugin)).toEqual(params);
  });

  it.each([
    ["cloze", { text: "<p>The cat sat on the %mat%.</p>" }],
    [
      "maxdiff",
      {
        alternatives: ["Option 1", "Option 2", "Option 3"],
        labels: ["Least important", "Most important"],
      },
    ],
    ["iat-html", { stimulus: "<p>Your text here</p>", stim_key_association: "left" }],
    ["sketchpad", {}],
    [
      "survey-html-form",
      { html: '<p><label>Your age <input name="age" type="number" min="18" required></label></p>' },
    ],
    ["resize", {}],
    ["virtual-chinrest", {}],
    ["browser-check", {}],
  ])("starts %s ready to run", (plugin, params) => {
    expect(startingParams(plugin)).toEqual(params);
  });

  it("starts a required yes or no on no", () => {
    expect(startingParams("visual-search-circle")).toEqual({ target_present: false });
  });

  it("starts a required choice from a fixed list on its first option", () => {
    expect(startingParams("same-different-image")).toEqual({ answer: "same" });
  });

  it("still fills required text with a placeholder", () => {
    expect(startingParams("html-keyboard-response")).toEqual({
      stimulus: "<p>Your text here</p>",
    });
  });
});

describe("visibleFields", () => {
  it("shows a circle only what a circle reads, plus placement", () => {
    expect(shown({ obj_type: "circle" })).toEqual(
      expect.arrayContaining(["obj_type", "startX", "startY", "radius", "fill_color"]),
    );
    expect(shown({ obj_type: "circle" })).not.toContain("content");
    expect(shown({ obj_type: "circle" })).not.toContain("tilt");
  });

  it("keeps a field that holds a value, so it can still be cleared", () => {
    expect(shown({ obj_type: "circle", content: "left over" })).toContain("content");
  });

  it("shows every field of an entry without variants", () => {
    const question = schemas.plugins["survey-likert"].properties.questions.items!;
    expect(visibleFields(question, {}).length).toBe(Object.keys(question.properties!).length);
  });
});

describe("switchVariant", () => {
  it("drops what only the old shape read and keeps the placement", () => {
    expect(
      switchVariant(
        canvasObject.variants!,
        { obj_type: "cross", line_length: 40, startX: -100 },
        "circle",
      ),
    ).toEqual({ obj_type: "circle", startX: -100 });
  });

  it("keeps a field both shapes read", () => {
    expect(
      switchVariant(
        canvasObject.variants!,
        { obj_type: "circle", radius: 5, fill_color: "red" },
        "rect",
      ),
    ).toEqual({ obj_type: "rect", fill_color: "red" });
  });

  it("keeps a field no shape claims, such as motion", () => {
    expect(
      switchVariant(
        canvasObject.variants!,
        { obj_type: "cross", line_length: 4, endX: 100 },
        "text",
      ),
    ).toEqual({ obj_type: "text", endX: 100 });
  });
});

describe("pluginTitle", () => {
  it("names a plugin the way an author would", () => {
    expect(pluginTitle("survey-likert")).toBe("Rating scale questions");
  });

  it("falls back to the machine name for a plugin the schemas do not know", () => {
    expect(pluginTitle("my-own-plugin")).toBe("my-own-plugin");
    expect(pluginTitle("constructor")).toBe("constructor");
  });
});

describe("pluginChoices", () => {
  it("offers every plugin exactly once", () => {
    const offered = pluginChoices.flatMap((group) => group.plugins.map(({ plugin }) => plugin));
    expect(offered.sort()).toEqual(Object.keys(schemas.plugins).sort());
  });

  it("groups plugins by what the step is for, in a fixed order", () => {
    expect(pluginChoices.map((group) => group.label)).toEqual([
      "Show something and record the response",
      "Ask questions",
      "Categorise or compare",
      "Draw on a canvas",
      "Set up and run",
    ]);
  });

  it("sorts each group by title", () => {
    const setup = pluginChoices.find((group) => group.label === "Set up and run");
    expect(setup?.plugins.map(({ title }) => title)).toEqual([
      "Calibrate eye tracking",
      "Calibrate screen size",
      "Check eye-tracking accuracy",
      "Check the browser",
      "Load files in advance",
      "Measure viewing distance",
      "Run a function",
      "Set up eye tracking",
      "Set up the camera",
      "Set up the microphone",
      "Show the camera",
      "Switch to full screen",
    ]);
  });
});

describe("paramsForPlugin", () => {
  it("keeps the questions going from one kind of question to another", () => {
    const likert = {
      questions: [{ prompt: "<p>Sure?</p>", name: "sure", labels: ["no", "yes"], required: true }],
    };
    expect(paramsForPlugin(likert, "survey-likert", "survey-multi-choice")).toEqual({
      questions: [
        { prompt: "<p>Sure?</p>", name: "sure", required: true, options: ["Option 1", "Option 2"] },
      ],
    });
  });

  it("starts afresh going to a step that asks no questions", () => {
    const survey = { questions: [{ prompt: "<p>Sure?</p>", options: ["a"] }] };
    expect(paramsForPlugin(survey, "survey-multi-choice", "html-keyboard-response")).toEqual({
      stimulus: "<p>Your text here</p>",
    });
  });

  it("starts afresh when the questions come from a column", () => {
    const bound = { questions: { var: "questions" } };
    expect(paramsForPlugin(bound, "survey-multi-choice", "survey-multi-select")).toEqual(
      startingParams("survey-multi-select"),
    );
  });
});

describe("placeholderFor", () => {
  const list = (items: Partial<ParameterSchema>) =>
    ({ title: "list", type: "array", jspsychType: "STRING", items }) as ParameterSchema;

  it("starts a list of plain text with two options", () => {
    expect(placeholderFor(list({ type: "string", jspsychType: "STRING" }))).toEqual([
      "Option 1",
      "Option 2",
    ]);
  });

  it("leaves a list of files to be chosen", () => {
    expect(placeholderFor(list({ type: "string", jspsychType: "VIDEO" }))).toBeUndefined();
  });

  it("leaves a list of fixed choices to be chosen", () => {
    expect(
      placeholderFor(list({ type: "string", jspsychType: "STRING", enum: ["a", "b"] })),
    ).toBeUndefined();
  });
});
