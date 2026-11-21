import type { ParameterSchema, PluginSchema, PluginSchemas } from "tachisto-schemas";
import {
  ENDING_NAME_PATTERN,
  RECRUITMENT_PLATFORMS,
  RETENTIONS,
  SECURE_URL_PATTERN,
  VISIBLE_TEXT_PATTERN,
} from "./recruitment.ts";
import { CONDITION_FALLBACKS, STUDY_COLUMNS } from "./data.ts";
import { COLOR_PATTERN } from "./appearance.ts";
import { takesFunction } from "./code.ts";
import type { SpecNode } from "./types.ts";

/** Where the schema is published, so a spec can name it in `$schema` and editors can fetch it. */
export const SPEC_SCHEMA_ID = "https://www.capro.dev/tachisto/spec-schema.json";

// Draft-07 rather than a later draft: it is the dialect VS Code, Positron and the JetBrains IDEs
// implement completely, and the newer keywords buy nothing a spec needs.
const DIALECT = "http://json-schema.org/draft-07/schema#";

type JsonSchema = Record<string, unknown>;

const reference = (name: string): JsonSchema => ({ $ref: `#/definitions/${name}` });

const KEY_LIST_KEYWORDS = ["ALL_KEYS", "NO_KEYS"];

const RECIPE_SUPPLIED_PARAMETERS = ["data", "on_finish"];

const CARRIED_KEYS = [
  "title",
  "description",
  "default",
  "examples",
  "enum",
  "format",
  "minItems",
  "maxItems",
] as const;

// Documentation only. `enum` and `format` stay on the literal branch, because a parameter fed
// from a conditions column holds a `{ var }` object that no enum of literals admits.
const DOCUMENTED_KEYS = ["title", "description", "default", "examples"] as const;

function carry(parameter: ParameterSchema, keys: readonly (keyof ParameterSchema)[]): JsonSchema {
  const carried: JsonSchema = {};
  for (const key of keys) {
    if (parameter[key] !== undefined) carried[key] = parameter[key];
  }
  return carried;
}

// The extractor's parameter schemas are already JSON Schema shaped, minus the jsPsych-specific
// fields and the variant rules, which the compiler checks imperatively because they are
// conditional on a sibling field's value. Fields nested inside a parameter go back through
// `parameterValueSchema`, because a survey question's prompt can read a column as readily as the
// parameter holding it can.
function parameterSchema(parameter: ParameterSchema): JsonSchema {
  const shape: JsonSchema = { ...carry(parameter, CARRIED_KEYS) };
  if (parameter.type) shape.type = parameter.type;
  if (parameter.items) shape.items = parameterSchema(parameter.items);
  if (parameter.properties) {
    shape.properties = Object.fromEntries(
      Object.entries(parameter.properties).map(([name, field]) => [
        name,
        parameterValueSchema(field),
      ]),
    );
  }
  if (parameter.required?.length) shape.required = parameter.required;
  return shape;
}

// Any parameter can be fed from a conditions column or computed by code instead of a literal, and
// a KEYS parameter also accepts the two keywords that stand for every key and for none. A
// parameter that takes a function takes only code, or null for none, as jsPsych's own defaults do.
function parameterValueSchema(parameter: ParameterSchema): JsonSchema {
  if (takesFunction(parameter.jspsychType)) {
    return {
      ...carry(parameter, DOCUMENTED_KEYS),
      anyOf: [reference("code"), { type: "null" }],
    };
  }
  const literal = parameterSchema(parameter);
  const alternatives: JsonSchema[] = [literal, reference("variableReference"), reference("code")];
  if (parameter.default === null) alternatives.push({ type: "null" });
  if (parameter.jspsychType === "KEYS" && parameter.format !== "grid") {
    alternatives.push({ enum: KEY_LIST_KEYWORDS });
  }
  return { ...carry(parameter, DOCUMENTED_KEYS), anyOf: alternatives.map(stripDocumentation) };
}

// The titles and descriptions sit on the parameter itself so an editor shows them on hover,
// instead of once per branch of the `anyOf`.
function stripDocumentation(schema: JsonSchema): JsonSchema {
  const copy = { ...schema };
  for (const key of DOCUMENTED_KEYS) delete copy[key];
  return copy;
}

function pluginParameters(plugin: PluginSchema): JsonSchema {
  const properties: JsonSchema = Object.fromEntries(
    Object.entries(plugin.properties).map(([name, parameter]) => [
      name,
      parameterValueSchema(parameter),
    ]),
  );
  for (const name of RECIPE_SUPPLIED_PARAMETERS) properties[name] = {};
  return {
    type: "object",
    properties,
    required: plugin.required,
    additionalProperties: false,
  };
}

const nodeList = (title: string): JsonSchema => ({
  title,
  type: "array",
  items: reference("node"),
});

const NODE_DEFINITIONS = {
  trial: {
    title: "One step the participant sees, run by a jsPsych plugin.",
    required: ["plugin"],
    properties: {
      plugin: { title: "The jsPsych plugin that runs this step.", type: "string" },
      tag: {
        title: "A label other steps can refer to, such as a loop judging these trials' accuracy.",
        type: "string",
      },
      params: { title: "The plugin's parameters.", type: "object" },
      record: {
        title: "Extra columns written to the data file for this trial.",
        type: "object",
        propertyNames: { not: { enum: STUDY_COLUMNS } },
        additionalProperties: reference("parameterValue"),
      },
      score: reference("scoringRule"),
      exclusion_ending: {
        title:
          "The ending a participant this step turns away is sent to, for a step that can, such as a browser check.",
        type: "string",
      },
      gaze: {
        title:
          "Records where the participant looks during this step, once eye tracking is calibrated.",
        type: "object",
        properties: {
          targets: {
            title:
              "CSS selectors of elements whose place on the screen is recorded with the gaze, such as the stimulus.",
            type: "array",
            items: { type: "string", minLength: 1 },
          },
        },
        additionalProperties: false,
      },
    },
  },
  block: {
    title: "Runs its steps once per row of a conditions table.",
    required: ["conditions", "children"],
    properties: {
      conditions: {
        title: "The name of the conditions table this block runs over.",
        type: "string",
      },
      randomize_order: { title: "Shuffle the rows for every participant.", type: "boolean" },
      repetitions: {
        title: "How many times to go through the whole table.",
        type: "integer",
        minimum: 1,
      },
      children: nodeList("The steps run for each row."),
    },
  },
  loop: {
    title: "Repeats its steps while a tagged set of trials stays below an accuracy threshold.",
    required: ["repeat_while", "children"],
    properties: {
      id: { type: "string" },
      repeat_while: reference("accuracyRule"),
      children: nodeList("The steps that repeat."),
    },
  },
  assign: {
    title: "Splits participants between groups: a between-subjects manipulation.",
    required: ["method", "groups"],
    properties: {
      method: {
        title: "How a group is chosen.",
        description:
          "`random` decides in the browser; `balanced` asks the data service for the next group, " +
          "which requires uploading data with an experiment id.",
        enum: ["random", "balanced"],
      },
      record_as: {
        title: "Column name the chosen group is recorded under.",
        type: "string",
        not: { enum: STUDY_COLUMNS },
      },
      groups: {
        title: "The groups participants are split between.",
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          required: ["name", "children"],
          properties: {
            name: { type: "string", minLength: 1 },
            children: nodeList("The group's steps."),
          },
          additionalProperties: false,
        },
      },
    },
  },
  counterbalance: {
    title: "Runs every task for every participant, in an order that varies between participants.",
    required: ["method", "tasks"],
    properties: {
      method: {
        title: "How each participant's order is chosen.",
        description:
          "`random` shuffles the tasks in the browser; `latin_square` asks the data service for " +
          "the participant's row of a balanced Latin square, which requires uploading data with " +
          "an experiment id. With data downloaded, only `random` is available.",
        enum: ["random", "latin_square"],
      },
      record_as: {
        title: 'Column name the order used is recorded under, as "first > second".',
        type: "string",
      },
      tasks: {
        title: "The tasks whose order is counterbalanced.",
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          required: ["name", "children"],
          properties: {
            name: { type: "string", minLength: 1 },
            children: nodeList("The task's steps."),
          },
          additionalProperties: false,
        },
      },
    },
  },
  branch: {
    title:
      "Sends a participant down one of two paths depending on how they did or what they answered.",
    required: ["when", "then"],
    properties: {
      when: { oneOf: [reference("accuracyRule"), reference("responseRule")] },
      then: nodeList("Steps run when the rule holds."),
      otherwise: nodeList("Steps run when it does not."),
    },
  },
  checkpoint: {
    title: "Records that a participant reached a point in the study, for drop-out analysis.",
    required: ["name"],
    properties: { name: { type: "string", minLength: 1 } },
  },
  end: {
    title:
      "Ends the study here, the way one of the recruitment endings says, after saving the data.",
    required: ["ending"],
    properties: {
      ending: {
        title: "The name of an ending in `recruitment.endings`, such as `no_consent`.",
        type: "string",
        pattern: ENDING_NAME_PATTERN,
      },
    },
  },
} satisfies Record<SpecNode["kind"], JsonSchema>;

type NodeKind = keyof typeof NODE_DEFINITIONS;

/** Every kind of step a spec can hold. */
export const NODE_KINDS = Object.keys(NODE_DEFINITIONS) as NodeKind[];

function nodeDefinition(kind: NodeKind, extra: JsonSchema = {}): JsonSchema {
  const definition = NODE_DEFINITIONS[kind] as JsonSchema;
  const properties = {
    kind: { const: kind },
    ...(definition.properties as JsonSchema),
    ...((extra.properties as JsonSchema) ?? {}),
  };
  return {
    title: definition.title,
    type: "object",
    required: ["kind", ...(definition.required as string[])],
    properties,
    additionalProperties: false,
  };
}

// A spec node is discriminated by `kind`, so each branch is applied only to the node that claims
// it. Listing the alternatives as `anyOf` instead would report every branch's failures at once.
function nodeSchema(): JsonSchema {
  return {
    title: "A step in the timeline.",
    type: "object",
    required: ["kind"],
    properties: { kind: { title: "What this step is.", enum: NODE_KINDS } },
    allOf: NODE_KINDS.map((kind) => ({
      if: { properties: { kind: { const: kind } }, required: ["kind"] },
      then: reference(kind),
    })),
  };
}

function trialDefinition(schemas: PluginSchemas): JsonSchema {
  const plugins = Object.keys(schemas).sort();
  const trial = nodeDefinition("trial", {
    properties: { plugin: { title: "The jsPsych plugin that runs this step.", enum: plugins } },
  });
  return {
    ...trial,
    allOf: plugins.map((plugin) => ({
      if: { properties: { plugin: { const: plugin } }, required: ["plugin"] },
      then: {
        properties: { params: pluginParameters(schemas[plugin]) },
        // A plugin that writes its own correct column takes no scoring rule over it.
        ...(schemas[plugin].records.includes("correct") && {
          not: { title: "This step scores its answers itself.", required: ["score"] },
        }),
      },
    })),
  };
}

/**
 * The JSON Schema for a Tachisto project spec, built against the plugins the schemas package
 * extracted, so a spec file gets completion and parameter documentation in any editor.
 */
export function specSchema(schemas: PluginSchemas): JsonSchema {
  return {
    $schema: DIALECT,
    $id: SPEC_SCHEMA_ID,
    title: "Tachisto experiment spec",
    description:
      "A declarative experiment the Tachisto compiler turns into jsPsych source. Edit it here or " +
      "open it in the builder at https://www.capro.dev/tachisto/app/.",
    type: "object",
    required: ["name", "timeline"],
    properties: {
      $schema: { title: "This schema, so an editor knows how to check the file.", type: "string" },
      name: { title: "What the experiment is called.", type: "string", minLength: 1 },
      authors: {
        title: "Whoever made the experiment, in the shape Psych-DS expects for a person.",
        type: "array",
        items: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            identifier: {
              title: "A URL that identifies them across datasets, usually an ORCID.",
              type: "string",
            },
            affiliation: {
              title: "The institution they belong to, such as their university.",
              type: "string",
            },
          },
          additionalProperties: false,
        },
      },
      sample_size: {
        title: "How many participants the study plans to recruit.",
        type: "integer",
        minimum: 1,
      },
      settings: reference("experimentSettings"),
      data: reference("dataSettings"),
      recruitment: reference("recruitmentSettings"),
      assets: {
        title: "Files the experiment shows, carried in the spec so it stays self-contained.",
        type: "array",
        items: reference("asset"),
      },
      conditions: {
        title: "Conditions tables, each a list of rows a block can run over.",
        type: "object",
        additionalProperties: {
          type: "array",
          items: { type: "object" },
        },
      },
      timeline: nodeList("The steps of the experiment, in order."),
    },
    additionalProperties: false,
    definitions: {
      node: nodeSchema(),
      trial: trialDefinition(schemas),
      block: nodeDefinition("block"),
      loop: nodeDefinition("loop"),
      assign: nodeDefinition("assign"),
      counterbalance: nodeDefinition("counterbalance"),
      branch: nodeDefinition("branch"),
      checkpoint: nodeDefinition("checkpoint"),
      end: nodeDefinition("end"),
      variableReference: {
        title: "A value read from a column of the enclosing conditions table.",
        type: "object",
        required: ["var"],
        properties: {
          var: { title: "The column name.", type: "string" },
          wrap: {
            title: "Markup the column's value is placed inside, with the value where `%s` is.",
            type: "string",
          },
        },
        additionalProperties: false,
      },
      code: {
        title:
          "JavaScript the author wrote: the function itself for a parameter that takes one, or an expression worked out when the trial starts. `jsPsych` is in scope.",
        type: "object",
        required: ["code"],
        properties: {
          code: { title: "A single JavaScript expression.", type: "string", minLength: 1 },
        },
        additionalProperties: false,
      },
      parameterValue: {
        anyOf: [
          reference("variableReference"),
          { type: ["string", "number", "boolean", "null"] },
          { type: "array" },
        ],
      },
      scoringRule: {
        title: "What counts as a correct response on this trial.",
        type: "object",
        required: ["correct_if_response_equals"],
        properties: {
          correct_if_response_equals: {
            anyOf: [reference("variableReference"), { type: ["string", "number"] }],
          },
        },
        additionalProperties: false,
      },
      accuracyRule: {
        title: "A threshold applied to the trials carrying one tag.",
        type: "object",
        required: ["scope"],
        properties: {
          scope: { title: "The tag whose trials are measured.", type: "string", minLength: 1 },
          accuracy_below: { type: "number", minimum: 0, maximum: 1 },
          accuracy_at_least: { type: "number", minimum: 0, maximum: 1 },
        },
        additionalProperties: false,
        not: {
          title: "A rule compares accuracy one way, not both at once.",
          required: ["accuracy_below", "accuracy_at_least"],
        },
      },
      responseRule: {
        title: "Holds when the latest answer on the trials carrying one tag matches.",
        type: "object",
        required: ["scope", "response_equals"],
        properties: {
          scope: {
            title: "The tag whose most recent trial is read.",
            type: "string",
            minLength: 1,
          },
          response_equals: {
            title: "The answer looked for, compared as text: `1` matches the second button.",
            anyOf: [{ type: "string", minLength: 1 }, { type: ["number", "boolean"] }],
          },
          question: {
            title: "The question to read when a trial asks several, as a survey does.",
            type: "string",
            minLength: 1,
          },
        },
        additionalProperties: false,
      },
      experimentSettings: {
        title: "Settings that apply to the whole experiment rather than to one step.",
        type: "object",
        properties: {
          default_iti: {
            title: "Gap in milliseconds after every trial, unless a step sets its own.",
            type: "number",
            minimum: 0,
          },
          minimum_valid_rt: {
            title: "Responses faster than this are ignored, in milliseconds.",
            type: "number",
            minimum: 0,
          },
          show_progress_bar: { type: "boolean" },
          progress_bar_message: { type: "string" },
          background_color: {
            title: "What the participant's screen looks like behind the stimulus.",
            type: "string",
            pattern: COLOR_PATTERN,
          },
          text_color: { type: "string", pattern: COLOR_PATTERN },
        },
        additionalProperties: false,
      },
      dataSettings: {
        title: "Where a participant's results go.",
        type: "object",
        required: ["save"],
        properties: {
          save: {
            title: "`download` saves a CSV on the participant's machine, `post` uploads it.",
            enum: ["download", "post"],
          },
          endpoint: {
            title:
              "The address of the DataPipe to upload to, a path prefix allowed; defaults to pipe.jspsych.org. It starts with https://, or http:// only for localhost, and holds no login, ? or #.",
            type: "string",
          },
          experiment_id: {
            title: "The experiment id the endpoint files the data under.",
            type: "string",
          },
          filename_prefix: { type: "string" },
          stream: {
            title: "Also send each step's row to DataPipe as it is recorded.",
            description:
              "A participant who leaves partway then still leaves a partial file, which DataPipe " +
              "keeps. Only for uploaded data, and only when every ending keeps all of it.",
            type: "boolean",
          },
          condition_fallback: {
            title: "What happens when DataPipe cannot hand out a condition.",
            description:
              "`stop` (the default) ends the study with a message to the participant. `random` " +
              "draws a group or task order in the browser instead, which keeps the session " +
              "running but may leave groups unbalanced. Only for uploaded data.",
            enum: [...CONDITION_FALLBACKS],
          },
        },
        additionalProperties: false,
        allOf: [
          {
            if: { properties: { save: { const: "post" } }, required: ["save"] },
            then: {
              title: "Uploading needs an experiment id from the service receiving the data.",
              required: ["experiment_id"],
            },
          },
          {
            if: { properties: { stream: { const: true } }, required: ["stream"] },
            then: {
              title: "Saving data as it goes needs it uploaded to DataPipe.",
              properties: { save: { const: "post" } },
            },
          },
          {
            if: { required: ["condition_fallback"] },
            then: {
              title: "What to do when no condition comes back needs data uploaded to DataPipe.",
              properties: { save: { const: "post" } },
            },
          },
        ],
      },
      recruitmentSettings: {
        title: "How the study meets the platform participants are recruited from.",
        type: "object",
        properties: {
          platform: { enum: [...RECRUITMENT_PLATFORMS] },
          id_param: {
            title: "The URL parameter the platform passes the participant's id in.",
            type: "string",
            minLength: 1,
          },
          endings: {
            title: "What happens when the study ends each way it can.",
            description:
              "`complete` is how the study ends once every step has run; any other ending is " +
              "reached through an `end` step, such as `no_consent` for a participant who declines.",
            type: "object",
            propertyNames: { pattern: ENDING_NAME_PATTERN },
            properties: {
              complete: {
                allOf: [
                  reference("ending"),
                  {
                    title: "A completed study keeps all its data.",
                    properties: { keep: { const: "all" } },
                  },
                ],
              },
            },
            additionalProperties: reference("ending"),
          },
        },
        additionalProperties: false,
      },
      ending: {
        title: "Where the participant goes, or what they are shown, once their data is saved.",
        type: "object",
        properties: {
          url: {
            title: "The platform's return URL; `{participant_id}` is replaced with the id.",
            type: "string",
            pattern: SECURE_URL_PATTERN,
          },
          message: {
            title: "Shown to the participant, who stays on the page, instead of a return URL.",
            type: "string",
            pattern: VISIBLE_TEXT_PATTERN,
          },
          keep: {
            title: "What is saved on reaching this ending.",
            description:
              "`all` saves every row, `checkpoint` only the row saying which ending was reached, " +
              "and `nothing` saves and sends nothing at all. Only an early ending can keep less " +
              "than `all`.",
            enum: [...RETENTIONS],
            default: "all",
          },
        },
        additionalProperties: false,
        oneOf: [{ required: ["url"] }, { required: ["message"] }],
      },
      asset: {
        type: "object",
        required: ["name", "url"],
        properties: {
          name: {
            title: 'The name the spec refers to this file by, e.g. "face.png".',
            type: "string",
            minLength: 1,
          },
          url: {
            title: "A data URL holding the file.",
            type: "string",
            pattern: "^data:",
          },
        },
        additionalProperties: false,
      },
    },
  };
}
