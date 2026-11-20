import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import type { ValidateFunction } from "ajv";
import { describe, expect, it } from "vitest";
import bundle from "tachisto-schemas/plugin-schemas.json" with { type: "json" };
import { SPEC_SCHEMA_ID, specSchema } from "../src/spec-schema.ts";
import type { SchemaBundle } from "tachisto-schemas";
import type { Spec } from "../src/types.ts";

const { plugins } = bundle as unknown as SchemaBundle;

// jsPsych's own parameter formats ("html", "keyboard-key") are documentation for the editor, not
// constraints ajv can apply.
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const validate: ValidateFunction = ajv.compile(specSchema(plugins));

function problems(spec: unknown) {
  return validate(spec) ? [] : (validate.errors ?? []).map((error) => error.message ?? "");
}

const examplesDirectory = fileURLToPath(new URL("../../../examples/", import.meta.url));
const files = readdirSync(examplesDirectory).filter((name) => name.endsWith(".json"));

function example(file: string) {
  return JSON.parse(readFileSync(join(examplesDirectory, file), "utf8")) as Spec;
}

describe("the spec JSON Schema", () => {
  it("compiles as a schema editors can use", () => {
    expect(specSchema(plugins).$id).toBe(SPEC_SCHEMA_ID);
  });

  // A schema that rejects the reference specs would flag correct files in the editor, which is
  // worse than having no schema at all.
  it.each(files)("accepts %s", (file) => {
    expect(problems(example(file))).toEqual([]);
  });

  it.each(files)("%s names the schema, so an editor finds it unprompted", (file) => {
    expect(example(file).$schema).toBe(SPEC_SCHEMA_ID);
  });

  it("knows every kind of step", () => {
    const kinds = (specSchema(plugins).definitions as Record<string, { properties?: unknown }>)
      .node as { properties: { kind: { enum: string[] } } };
    expect(kinds.properties.kind.enum).toEqual([
      "trial",
      "block",
      "loop",
      "assign",
      "counterbalance",
      "branch",
      "checkpoint",
      "end",
    ]);
  });
});

const flanker = () => example("flanker.json");

describe("what the schema catches before anything runs", () => {
  it("a misspelled plugin parameter", () => {
    const spec = flanker();
    const trial = spec.timeline[0] as { params: Record<string, unknown> };
    trial.params.stimulus_text = "hello";
    expect(problems(spec)).toContain("must NOT have additional properties");
  });

  it("an unknown plugin", () => {
    const spec = flanker();
    (spec.timeline[0] as { plugin: string }).plugin = "html-keyboard-respones";
    expect(problems(spec)).toContain("must be equal to one of the allowed values");
  });

  it("a step with no kind", () => {
    const spec = flanker();
    spec.timeline.push({ plugin: "html-keyboard-response" } as never);
    expect(problems(spec)).toContain("must have required property 'kind'");
  });

  it("a number written as text", () => {
    const spec = flanker();
    (spec.timeline[0] as { params: Record<string, unknown> }).params.trial_duration = "500";
    expect(problems(spec).length).toBeGreaterThan(0);
  });

  it("uploading data with no experiment id", () => {
    const spec = flanker();
    spec.data = { save: "post" };
    expect(problems(spec)).toContain("must have required property 'experiment_id'");
  });

  it("a recruitment return address that is not https", () => {
    const spec = flanker();
    spec.recruitment = { endings: { complete: { url: "http://app.prolific.com/done" } } };
    expect(problems(spec)).toContain('must match pattern "^https://"');
  });

  it("but accepts a platform's id parameter and return address", () => {
    const spec = flanker();
    spec.data = { save: "post", experiment_id: "abc" };
    spec.recruitment = {
      platform: "sona",
      id_param: "id",
      endings: { complete: { url: "https://u.sona-systems.com/c?survey_code={participant_id}" } },
    };
    expect(problems(spec)).toEqual([]);
  });

  it("an accuracy rule compared both ways at once", () => {
    const spec: Spec = {
      name: "both ways",
      timeline: [
        {
          kind: "loop",
          repeat_while: { scope: "practice", accuracy_below: 0.75, accuracy_at_least: 0.5 },
          children: [{ kind: "trial", plugin: "html-keyboard-response", tag: "practice" }],
        },
      ],
    };
    expect(problems(spec)).toContain("must NOT be valid");
  });

  it("an ending that both redirects and shows a message", () => {
    const spec = flanker();
    spec.recruitment = {
      endings: { no_consent: { url: "https://app.prolific.com/x", message: "<p>bye</p>" } },
    };
    expect(problems(spec)).toContain("must match exactly one schema in oneOf");
  });

  it("a completed study that keeps less than all its data", () => {
    const spec = flanker();
    spec.recruitment = { endings: { complete: { message: "<p>Done.</p>", keep: "nothing" } } };
    expect(problems(spec)).toContain("must be equal to constant");
  });

  it("an ending that keeps something unknown", () => {
    const spec = flanker();
    spec.recruitment = {
      endings: { no_consent: { message: "<p>bye</p>", keep: "some" as never } },
    };
    expect(problems(spec)).toContain("must be equal to one of the allowed values");
  });

  it("a trial recording a column the study writes itself", () => {
    const spec = flanker();
    (spec.timeline[0] as { record?: unknown }).record = { ending: "no_consent" };
    expect(problems(spec)).toContain("must NOT be valid");
  });

  it("but accepts an early ending that keeps nothing", () => {
    const spec = flanker();
    spec.recruitment = { endings: { no_consent: { message: "<p>bye</p>", keep: "nothing" } } };
    expect(problems(spec)).toEqual([]);
  });

  it("gaze tracking with anything but its targets", () => {
    const spec = flanker();
    (spec.timeline[0] as { gaze?: unknown }).gaze = { targets: [""], every: 10 };
    expect(problems(spec)).toEqual(
      expect.arrayContaining([
        "must NOT have additional properties",
        "must NOT have fewer than 1 characters",
      ]),
    );
  });

  it("but accepts a step that tracks gaze and records where its stimulus is", () => {
    const spec = flanker();
    (spec.timeline[0] as { gaze?: unknown }).gaze = { targets: ["#stimulus"] };
    expect(problems(spec)).toEqual([]);
  });

  it("an end step that names no ending", () => {
    const spec = flanker();
    spec.timeline.push({ kind: "end" } as never);
    expect(problems(spec)).toContain("must have required property 'ending'");
  });

  it("but accepts an end step and a message ending", () => {
    const spec = flanker();
    spec.recruitment = { endings: { no_consent: { message: "<p>Thank you anyway.</p>" } } };
    spec.timeline.push({ kind: "end", ending: "no_consent" });
    expect(problems(spec)).toEqual([]);
  });

  it("a branch rule that mixes accuracy with an answer", () => {
    const spec: Spec = {
      name: "mixed rule",
      timeline: [
        { kind: "trial", plugin: "html-button-response", tag: "consent" },
        {
          kind: "branch",
          when: { scope: "consent", response_equals: 1, accuracy_below: 0.5 } as never,
          then: [{ kind: "trial", plugin: "preload" }],
        },
      ],
    };
    expect(problems(spec)).toContain("must match exactly one schema in oneOf");
  });

  it("but accepts a branch on a survey answer", () => {
    const spec: Spec = {
      name: "consent",
      timeline: [
        { kind: "trial", plugin: "html-button-response", tag: "consent" },
        {
          kind: "branch",
          when: { scope: "consent", response_equals: "No", question: "consent" },
          then: [{ kind: "trial", plugin: "preload" }],
        },
      ],
    };
    expect(problems(spec)).toEqual([]);
  });

  it("a split with only one group", () => {
    const spec: Spec = {
      name: "one group",
      timeline: [
        {
          kind: "assign",
          method: "random",
          groups: [{ name: "only", children: [{ kind: "trial", plugin: "preload" }] }],
        },
      ],
    };
    expect(problems(spec)).toContain("must NOT have fewer than 2 items");
  });

  const counterbalanced = (method: string, names: string[]) =>
    ({
      name: "task order",
      timeline: [
        {
          kind: "counterbalance",
          method,
          tasks: names.map((name) => ({
            name,
            children: [{ kind: "trial", plugin: "preload" }],
          })),
        },
      ],
    }) as Spec;

  it("a counterbalance with only one task", () => {
    expect(problems(counterbalanced("random", ["only"]))).toContain(
      "must NOT have fewer than 2 items",
    );
  });

  it("a counterbalance ordered some other way", () => {
    expect(problems(counterbalanced("alphabetical", ["a", "b"]))).toContain(
      "must be equal to one of the allowed values",
    );
  });

  it("but accepts tasks in random or Latin-square order", () => {
    expect(problems(counterbalanced("random", ["a", "b"]))).toEqual([]);
    expect(problems(counterbalanced("latin_square", ["a", "b"]))).toEqual([]);
  });

  // Any parameter can read a conditions column instead of holding a literal, so the schema has to
  // admit a `{ var }` object wherever a value is expected — including where the literal is typed.
  it("but allows a column reference in place of any value", () => {
    const spec = flanker();
    const trial = spec.timeline[0] as { params: Record<string, unknown> };
    trial.params.trial_duration = { var: "duration" };
    expect(problems(spec)).toEqual([]);
  });

  it("and allows a column reference where an enum is expected", () => {
    const spec: Spec = {
      name: "likert from a column",
      timeline: [
        {
          kind: "trial",
          plugin: "survey-likert",
          params: { questions: [{ prompt: { var: "prompt" }, labels: { var: "labels" } }] },
        },
      ],
    };
    expect(problems(spec)).toEqual([]);
  });

  it("and allows code in place of any value", () => {
    const spec = flanker();
    const trial = spec.timeline[0] as { params: Record<string, unknown> };
    trial.params.trial_duration = { code: "500 + 100" };
    expect(problems(spec)).toEqual([]);
  });
});

describe("parameters that take a function", () => {
  const buttons = (button_html: unknown): Spec => ({
    name: "buttons",
    timeline: [
      {
        kind: "trial",
        plugin: "html-button-response",
        params: { stimulus: "<p>pick</p>", choices: ["a"], button_html } as never,
      },
    ],
  });

  it("accept code", () => {
    expect(problems(buttons({ code: "(choice) => `<button>${choice}</button>`" }))).toEqual([]);
  });

  it("reject text, which the plugin would try to call", () => {
    expect(problems(buttons("<button>%choice%</button>"))).toContain(
      "must match a schema in anyOf",
    );
  });

  it("reject code with stray fields", () => {
    expect(problems(buttons({ code: "() => ''", lang: "js" }))).toContain(
      "must NOT have additional properties",
    );
  });
});
