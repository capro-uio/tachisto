import type { ParameterSchema, PluginSchema, PluginSchemas, Variants } from "tachisto-schemas";
import type {
  Asset,
  AccuracyRule,
  AssignNode,
  BranchNode,
  CounterbalanceNode,
  EndNode,
  ParameterValue,
  Spec,
  SpecNode,
  ResponseRule,
  TrialNode,
} from "./types.ts";
import {
  conditionFallbackProblems,
  dataPipeAddressProblems,
  STUDY_COLUMNS,
  streamingProblems,
} from "./data.ts";
import { isMediaType, mediaListOf, preloadListOf, type PreloadList } from "./assets.ts";
import { ORDER_SEPARATOR, TASK_VARIABLE } from "./counterbalance.ts";
import { choiceColumn, choiceNodes, COLUMN_SETTINGS, type ChoiceNode } from "./choices.ts";
import { accuracyComparison, answersBySide, isResponseRule, questionNames } from "./conditions.ts";
import { endingNames, recruitmentProblems, sampleSizeProblems } from "./recruitment.ts";
import { conditionColumns, isVariableReference, slotsOf, trialsOf } from "./variables.ts";
import { codeProblem, containsCode, isCode, takesFunction } from "./code.ts";
import { gapCount, pluginRuleProblems, pluginRuleWarnings } from "./plugin-rules.ts";
import { gridShape, type GridPlace } from "./grids.ts";
import { setupOrderProblems } from "./setup-order.ts";
import { sharedConditionProblems } from "./datapipe-setup.ts";
import { gazeProblems } from "./gaze.ts";
import { canExcludeParticipants, excludesParticipants } from "./exclusions.ts";
import { appearanceProblems } from "./appearance.ts";

/**
 * An error stops the study from being built; a warning names settings that run, but may not do
 * what was meant, such as a step nothing ends, which some designs want.
 */
export type Severity = "error" | "warning";

/** Where a problem is, as a path of indices through the timeline; absent when it is the whole spec. */
export interface Problem {
  message: string;
  path?: number[];
  severity: Severity;
}

export function isError(problem: Problem) {
  return problem.severity === "error";
}

/** Thrown when a spec has errors; its problems hold its warnings too, so nothing goes unsaid. */
export class SpecError extends Error {
  readonly problems: Problem[];

  constructor(name: string, problems: Problem[]) {
    const errors = problems.filter(isError);
    super(
      `${name}: ${errors.length} problem(s)\n  - ${errors.map((p) => p.message).join("\n  - ")}`,
    );
    this.problems = problems;
  }
}

const STUDY_COLUMN = "which is a column the study writes itself";

const RECIPE_SUPPLIED_PARAMETERS = new Set(["data", "on_finish"]);

function collectTags(nodes: SpecNode[]): string[] {
  return trialsOf(nodes).flatMap((trial) => (trial.tag ? [trial.tag] : []));
}

const KEY_LIST_KEYWORDS = new Set(["ALL_KEYS", "NO_KEYS"]);

// Only the types the extractor resolved unambiguously. A KEYS parameter is a list that also
// accepts the strings "ALL_KEYS" and "NO_KEYS", so it is checked on its own terms.
function literalTypeProblem(value: ParameterValue, parameter: ParameterSchema) {
  // jsPsych's own null means none, such as no width set, wherever it is the default.
  if (value === null && parameter.default === null) return null;
  if (parameter.enum && !parameter.enum.includes(value)) {
    return `expects one of ${parameter.enum.map((option) => JSON.stringify(option)).join(", ")}`;
  }
  if (parameter.format === "grid") return gridProblem(value, parameter);
  if (parameter.type === "array") {
    if (Array.isArray(value)) {
      const options = parameter.items?.enum;
      if (!options || value.every((entry) => options.includes(entry))) return null;
      return `expects each entry to be one of ${options.map((option) => JSON.stringify(option)).join(", ")}`;
    }
    if (parameter.jspsychType === "KEYS" && KEY_LIST_KEYWORDS.has(value as string)) return null;
    return "expects a list of values";
  }
  if (parameter.type === "integer" || parameter.type === "number") {
    return typeof value === "number" ? null : "expects a number";
  }
  if (parameter.type === "boolean") {
    return typeof value === "boolean" ? null : "expects true or false";
  }
  return null;
}

// Code is compiled only where it stands for a whole parameter or a whole field of a list entry;
// anywhere deeper it would reach the plugin as an object holding text.
function isCodeSlot(value: ParameterValue, parameter: ParameterSchema) {
  return (
    isCode(value) ||
    (takesFunction(parameter.jspsychType) && value !== null) ||
    (!parameter.items?.properties && containsCode(value))
  );
}

// A function parameter compiled from a plain string would hand the plugin text where it calls a
// function, which fails only once a participant reaches the trial.
function codeSlotProblem(value: ParameterValue): string | null {
  if (!isCode(value)) {
    return containsCode(value)
      ? "holds code inside it, but only a whole parameter or a whole field of a list entry can be code"
      : `takes a function, written as code ({ "code": "..." }), but the spec holds ${JSON.stringify(value)}`;
  }
  const extra = Object.keys(value).filter((key) => key !== "code");
  if (extra.length > 0) {
    return `holds code alongside ${extra.map((key) => `"${key}"`).join(", ")}, which code does not take`;
  }
  const problem = codeProblem(value.code);
  return problem ? `holds code that ${problem}` : null;
}

// A step that scores itself compares the key pressed with its right answer, so an answer no
// participant can press makes every trial wrong, and a loop on accuracy repeat for ever. Only
// keys written out are checked; one read from a column or computed is known only at run time.
function answerKeyProblems(trial: TrialNode, schema: PluginSchema) {
  const valueOf = (name: string) => trial.params?.[name] ?? schema.properties[name]?.default;
  const key = (value: unknown) => (typeof value === "string" ? value.toLowerCase() : null);
  const problems: string[] = [];
  const answer = key(valueOf("key_answer"));
  const choices = valueOf("choices");
  if (answer && Array.isArray(choices) && choices.every((choice) => typeof choice === "string")) {
    if (!choices.some((choice) => key(choice) === answer)) {
      problems.push(
        `takes "${String(valueOf("key_answer"))}" as the right answer, but only ${choices.map((choice) => `"${choice}"`).join(", ")} can be pressed`,
      );
    }
  }
  for (const [first, second] of schema.distinctKeys ?? []) {
    const shared = key(valueOf(first));
    if (shared && shared === key(valueOf(second))) {
      problems.push(`uses "${String(valueOf(first))}" for both ${first} and ${second}`);
    }
  }
  return problems;
}

// A scoring rule compares the whole response with one answer, as text. A step that keeps an answer
// for each question, each end of a scale, or each gap records them together, so its response as
// text equals no single answer, except where a list holds just one.
function scoringProblem(trial: TrialNode, schema: PluginSchema) {
  const answersByName = trial.plugin === "survey-html-form" || "questions" in schema.properties;
  if (answersByName || answersBySide(trial.plugin)) {
    return "records several answers together, so a scoring rule, which compares a single answer, never matches";
  }
  if (trial.plugin === "cloze" && (gapCount(trial.params?.text) ?? 0) > 1) {
    return "records the answers to all its gaps together, so a scoring rule, which compares a single answer, only works with one gap";
  }
  return null;
}

// A plugin that reads a fixed number of entries, such as a same/different pair, shows nothing
// useful for one fewer and ignores the rest.
function listLengthProblem(value: ParameterValue, parameter: ParameterSchema) {
  if (!Array.isArray(value)) return null;
  const { minItems = 0, maxItems = Infinity } = parameter;
  if (value.length >= minItems && value.length <= maxItems) return null;
  const wanted =
    minItems === maxItems
      ? `exactly ${minItems}`
      : maxItems === Infinity
        ? `at least ${minItems}`
        : `${minItems} to ${maxItems}`;
  return `takes ${wanted} entries, but the spec holds ${value.length}`;
}

const PLACE_RULES: Record<GridPlace, { holds: (place: unknown) => boolean; expected: string }> = {
  square: {
    holds: (place) => place === 0 || place === 1,
    expected: "1 for a square or 0 for a gap",
  },
  integer: { holds: (place) => Number.isInteger(place), expected: "a whole number" },
  number: {
    holds: (place) => typeof place === "number" && Number.isFinite(place),
    expected: "a number",
  },
  key: { holds: (place) => typeof place === "string", expected: "a key" },
};

// A grid is rows of places; the plugins draw nothing for an empty row and crash on a word such as
// ALL_KEYS where rows belong.
function gridProblem(value: unknown, parameter: ParameterSchema) {
  const rows = "expects a grid: a list of rows, each a list of at least one place";
  if (!Array.isArray(value) || value.length === 0) return rows;
  if (!value.every((row) => Array.isArray(row) && row.length > 0)) return rows;
  const { place, width } = gridShape(parameter);
  if (width !== undefined && !(value as unknown[][]).every((row) => row.length === width)) {
    return `expects each row of its grid to hold exactly ${width} places`;
  }
  const { holds, expected } = PLACE_RULES[place];
  return (value as unknown[][]).flat().every(holds)
    ? null
    : `expects each place of its grid to be ${expected}`;
}

// What a conditions cell must hold for a parameter that takes a grid or a list of numbers, which
// a cell can only give as text.
function cellProblem(cell: unknown, parameter: ParameterSchema) {
  if (parameter.format === "grid") {
    let parsed = cell;
    if (typeof cell === "string") {
      try {
        parsed = JSON.parse(cell);
      } catch {
        return "which is not a grid written as rows, such as [[1, 0], [0, 1]]";
      }
    }
    return gridProblem(parsed, parameter)
      ? "which is not a grid written as rows, such as [[1, 0], [0, 1]]"
      : null;
  }
  if (parameter.type === "integer" || parameter.type === "number") {
    if (cell === "" && parameter.default === null) return null;
    const number = typeof cell === "string" && cell.trim() !== "" ? Number(cell) : cell;
    return typeof number === "number" && Number.isFinite(number) ? null : "which is not a number";
  }
  const numbers =
    parameter.type === "array" && ["integer", "number"].includes(parameter.items?.type ?? "");
  if (!numbers) return null;
  const entries = Array.isArray(cell) ? cell : String(cell).split(",");
  return entries.length > 0 &&
    entries.every((entry) => String(entry).trim() !== "" && Number.isFinite(Number(entry)))
    ? null
    : "which is not numbers separated by commas, such as 0,1";
}

function checkColumnCells(
  spec: Spec,
  column: string,
  parameter: ParameterSchema,
  report: (message: string) => void,
  where: string,
) {
  for (const [table, rows] of Object.entries(spec.conditions ?? {})) {
    for (const row of rows) {
      if (!(column in row)) continue;
      const problem = cellProblem(row[column], parameter);
      if (problem) {
        report(
          `${where} reads column "${column}", whose cell in table "${table}" holds ${JSON.stringify(row[column])}, ${problem}`,
        );
        return;
      }
    }
  }
}

function looksLikePath(value: string) {
  return value.includes("/") || value.includes(":");
}

function checkTrial(
  trial: TrialNode,
  spec: Spec,
  schemas: PluginSchemas,
  columns: Set<string>,
  problems: Problem[],
  path: number[],
) {
  const report = (message: string) => problems.push({ message, path, severity: "error" });
  const warn = (message: string) => problems.push({ message, path, severity: "warning" });
  const assets = spec.assets ?? [];
  const schema = schemas[trial.plugin];
  if (!schema) {
    report(`unknown plugin "${trial.plugin}"`);
    return;
  }

  // The title is what the builder shows; the plugin's name is what a spec file holds.
  const where = `step "${schema.title}" (${trial.plugin})`;
  const supplied = Object.entries(trial.params ?? {});

  for (const [name, value] of supplied) {
    const parameter = schema.properties[name];
    if (!parameter && !RECIPE_SUPPLIED_PARAMETERS.has(name)) {
      report(`${where} has no parameter "${name}"`);
      continue;
    }
    if (!parameter) {
      if (containsCode(value)) {
        report(`${where}, parameter "${name}" holds code, but the study sets "${name}" itself`);
      }
      continue;
    }
    const kind = mediaListOf(trial.plugin, name, parameter.jspsychType);
    if (isCodeSlot(value, parameter)) {
      const problem = codeSlotProblem(value);
      if (problem) report(`${where}, parameter "${name}" ${problem}`);
    } else if (isVariableReference(value)) {
      checkColumn(value.var, columns, `${where}, parameter "${name}"`, problems, path);
      checkColumnCells(spec, value.var, parameter, report, `${where}, parameter "${name}"`);
    } else if (kind) {
      const lengthProblem = listLengthProblem(value, parameter);
      if (lengthProblem) report(`${where}, parameter "${name}" ${lengthProblem}`);
      if (parameter.type === "array" && !Array.isArray(value)) {
        report(
          `${where}, parameter "${name}" expects a list of files, but the spec holds ${JSON.stringify(value)}`,
        );
      }
      checkFiles(value, assets, kind, `${where}, parameter "${name}"`, report);
    } else if (parameter.items?.properties) {
      const problem = literalTypeProblem(value, parameter);
      if (problem) {
        report(
          `${where}, parameter "${name}" ${problem} but the spec holds ${JSON.stringify(value)}`,
        );
      } else {
        checkObjectEntries(value, parameter, `${where}, parameter "${name}"`, {
          columns,
          assets,
          problems,
          path,
        });
      }
    } else {
      const problem = literalTypeProblem(value, parameter);
      if (problem) {
        report(
          `${where}, parameter "${name}" ${problem} but the spec holds ${JSON.stringify(value)}`,
        );
      }
      const lengthProblem = listLengthProblem(value, parameter);
      if (lengthProblem) report(`${where}, parameter "${name}" ${lengthProblem}`);
    }
  }

  for (const name of schema.required) {
    const value = trial.params?.[name];
    if (value === undefined) {
      report(`${where} requires parameter "${name}"`);
    } else if (
      mediaListOf(trial.plugin, name, schema.properties[name]?.jspsychType) &&
      namesNoFile(value)
    ) {
      report(`${where} requires a file for parameter "${name}"`);
    }
  }

  // A plugin that writes its own correct column, from its key_answer say, would have it written
  // over by a second rule.
  if (trial.score && schema.records.includes("correct")) {
    report(`${where} scores its answers itself, so it takes no scoring rule`);
  } else if (trial.score) {
    const problem = scoringProblem(trial, schema);
    if (problem) report(`${where} ${problem}`);
  }
  for (const problem of answerKeyProblems(trial, schema)) report(`${where} ${problem}`);
  for (const problem of pluginRuleProblems(trial)) report(`${where} ${problem}`);
  for (const warning of pluginRuleWarnings(trial)) warn(`${where} ${warning}`);
  for (const problem of exclusionProblems(trial, spec)) report(`${where} ${problem}`);
  for (const problem of gazeProblems(trial)) report(`${where} ${problem}`);
  const expected = trial.score?.correct_if_response_equals;
  if (expected !== undefined && typeof expected === "object") {
    checkColumn(expected.var, columns, `${where}, scoring rule`, problems, path);
  }
  for (const [field, value] of Object.entries(trial.record ?? {})) {
    if (STUDY_COLUMNS.includes(field)) report(`${where} records "${field}", ${STUDY_COLUMN}`);
    if (isCode(value)) {
      report(`${where}, recorded field "${field}" holds code, but a recorded field takes a value`);
    } else if (isVariableReference(value)) {
      checkColumn(value.var, columns, `${where}, recorded field "${field}"`, problems, path);
    }
  }
}

// A file picker left on its blank choice leaves an empty name, which plays nothing.
function namesNoFile(value: ParameterValue) {
  return value === "" || (Array.isArray(value) && value.every((entry) => entry === ""));
}

const KIND_OF_LIST: Record<PreloadList, string> = {
  images: "an image",
  audio: "a sound",
  video: "a video",
};

function checkFiles(
  value: ParameterValue,
  assets: Asset[],
  kind: PreloadList | null,
  where: string,
  report: (message: string) => void,
) {
  const named = (Array.isArray(value) ? value : [value]).filter(
    (entry): entry is string => typeof entry === "string" && entry !== "",
  );
  for (const entry of named) {
    const asset = assets.find((candidate) => candidate.name === entry);
    if (!asset) {
      if (looksLikePath(entry)) continue;
      report(
        `${where} names "${entry}", which is neither an added file nor a path` +
          (assets.length > 0
            ? ` (files added: ${assets.map((added) => added.name).join(", ")})`
            : ""),
      );
      continue;
    }
    const actual = preloadListOf(asset);
    if (kind && actual && actual !== kind) {
      report(
        `${where} names "${entry}", which is ${KIND_OF_LIST[actual]}, where ${KIND_OF_LIST[kind]} belongs`,
      );
    }
  }
}

interface EntryContext {
  columns: Set<string>;
  assets: Asset[];
  problems: Problem[];
  path: number[];
}

// A variant's rules mirror the checks its plugin makes when the trial starts, which it reports
// with a blocking alert in front of the participant rather than an error.
function checkVariant(
  entry: Record<string, unknown>,
  variants: Variants,
  position: string,
  report: (message: string) => void,
) {
  const chosen = entry[variants.by];
  if (typeof chosen !== "string") return;
  const variant = variants.options[chosen];
  if (!variant) return;
  const list = (names: string[]) => names.map((name) => `"${name}"`).join(", ");
  for (const name of variant.required) {
    if (!(name in entry)) report(`${position} (${chosen}) needs "${name}"`);
  }
  for (const group of variant.any_of ?? []) {
    if (!group.some((name) => name in entry)) {
      report(`${position} (${chosen}) needs one of ${list(group)}`);
    }
  }
  for (const group of variant.at_most_one_of ?? []) {
    if (group.filter((name) => name in entry).length > 1) {
      report(`${position} (${chosen}) takes only one of ${list(group)}`);
    }
  }
}

// Entries of a list of objects (a survey's questions, say) carry their own required fields, and a
// misspelled key there would otherwise be handed to the plugin and ignored at run time.
function checkObjectEntries(
  value: ParameterValue,
  parameter: ParameterSchema,
  where: string,
  context: EntryContext,
) {
  const report = (message: string) =>
    context.problems.push({ message, path: context.path, severity: "error" });
  const item = parameter.items;
  if (!item?.properties || !Array.isArray(value)) return;
  const fields = item.properties;

  value.forEach((entry, index) => {
    const position = `${where}, entry ${index + 1}`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      report(`${position} should be a set of fields`);
      return;
    }
    const fieldSet = entry as Record<string, ParameterValue>;
    for (const [name, field] of Object.entries(fieldSet)) {
      const schema = fields[name];
      if (!schema) {
        report(`${position} has no field "${name}"`);
      } else if (isCodeSlot(field, schema)) {
        const problem = codeSlotProblem(field);
        if (problem) report(`${position}, field "${name}" ${problem}`);
      } else if (isVariableReference(field)) {
        checkColumn(
          field.var,
          context.columns,
          `${position}, field "${name}"`,
          context.problems,
          context.path,
        );
      } else if (isMediaType(schema.jspsychType)) {
        checkFiles(
          field,
          context.assets,
          mediaListOf("", name, schema.jspsychType),
          `${position}, field "${name}"`,
          report,
        );
      } else {
        const problem = literalTypeProblem(field, schema);
        if (problem) {
          report(
            `${position}, field "${name}" ${problem} but the spec holds ${JSON.stringify(field)}`,
          );
        }
      }
    }
    for (const name of item.required ?? []) {
      if (!(name in fieldSet)) report(`${position} is missing "${name}"`);
    }
    if (item.variants) checkVariant(fieldSet, item.variants, position, report);
  });
}

function checkAssign(node: AssignNode, spec: Spec, problems: Problem[], path: number[]) {
  const report = (message: string) => problems.push({ message, path, severity: "error" });
  if (node.record_as && STUDY_COLUMNS.includes(node.record_as)) {
    report(`a split cannot record its group as "${node.record_as}", ${STUDY_COLUMN}`);
  }
  if (node.groups.length < 2) {
    report("splitting participants needs at least two groups");
  }
  const names = node.groups.map((group) => group.name);
  if (names.some((name) => !name)) report("every group needs a name");
  if (new Set(names).size !== names.length) report("group names must be different");
  for (const group of node.groups) {
    if (group.children.length === 0) report(`group "${group.name}" has no steps inside it`);
  }
  if (node.method === "balanced" && !(spec.data?.save === "post" && spec.data.experiment_id)) {
    report("balanced groups need data uploading to a service, which is what keeps the count");
  }
  checkOwnColumn(node, spec, report);
}

const CHOICE_STEP = { assign: "split", counterbalance: "counterbalance" };

function choiceStepName(node: ChoiceNode) {
  const names = (node.kind === "assign" ? node.groups : node.tasks)
    .map((slot) => `"${slot.name}"`)
    .join(", ");
  return `the ${CHOICE_STEP[node.kind]} ${node.kind === "assign" ? "into" : "of"} ${names}`;
}

// Two steps recording into one column overwrite each other in the data, and two splits, or two
// counterbalanced steps, remember their choice by that column too, so they would share it. Each
// step reports the problem, so the builder marks every one of them.
function checkOwnColumn(node: ChoiceNode, spec: Spec, report: (message: string) => void) {
  const column = choiceColumn(node);
  const others = choiceNodes(spec.timeline).filter(
    (other) => other !== node && choiceColumn(other) === column,
  );
  if (others.length === 0) return;
  const settings = [...new Set([node, ...others].map((step) => `"${COLUMN_SETTINGS[step.kind]}"`))];
  report(
    `this ${CHOICE_STEP[node.kind]} and ${others.map(choiceStepName).join(" and ")} ` +
      `${others.length > 1 ? "all" : "both"} record their choice in the column "${column}", so ` +
      `they would overwrite each other's: give one of them a different column name in its ` +
      `${settings.join(" or ")} setting`,
  );
}

function checkCounterbalance(
  node: CounterbalanceNode,
  spec: Spec,
  columns: Set<string>,
  problems: Problem[],
  path: number[],
) {
  const report = (message: string) => problems.push({ message, path, severity: "error" });
  if (node.tasks.length < 2) report("counterbalancing needs at least two tasks");
  const names = node.tasks.map((task) => task.name);
  if (names.some((name) => !name)) report("every task needs a name");
  if (new Set(names).size !== names.length) report("task names must be different");
  // The order is recorded as the names joined by the separator, so a name holding it would make
  // the recorded order impossible to read back.
  for (const name of names.filter((name) => name.includes(ORDER_SEPARATOR))) {
    report(
      `task "${name}" contains "${ORDER_SEPARATOR}", which the recorded order uses between tasks`,
    );
  }
  if (columns.has(TASK_VARIABLE)) {
    report(
      `an enclosing conditions table has a column named "${TASK_VARIABLE}", which the ` +
        "counterbalanced step uses itself: rename that column",
    );
  }
  for (const task of node.tasks) {
    if (task.children.length === 0) report(`task "${task.name}" has no steps inside it`);
  }
  if (node.method === "latin_square" && !(spec.data?.save === "post" && spec.data.experiment_id)) {
    report(
      "a Latin-square order needs data uploading to a service, which is what counts " +
        "participants; when data is downloaded, only random order is available",
    );
  }
  checkOwnColumn(node, spec, report);
}

const ANSWER_TYPES = new Set(["string", "number", "boolean"]);

// The compiler never runs the JSON Schema, so a hand-edited rule reaches this unfiltered.
// Every value the compiler writes into the experiment is escaped, but a threshold that is not a
// number would still compare as text, so it is caught here with a message rather than at run time.
function thresholdProblem(rule: AccuracyRule, step: string) {
  const { threshold } = accuracyComparison(rule);
  return typeof threshold === "number" && threshold >= 0 && threshold <= 1
    ? null
    : `${step} compares accuracy with ${JSON.stringify(threshold)}, which is not between 0 and 1`;
}

function branchRuleProblem(rule: BranchNode["when"]) {
  if (!isResponseRule(rule)) {
    return rule.accuracy_below !== undefined && rule.accuracy_at_least !== undefined
      ? "a branch compares accuracy one way, not both at once"
      : thresholdProblem(rule, "a branch");
  }
  if ("accuracy_below" in rule || "accuracy_at_least" in rule) {
    return "a branch decides on accuracy or on an answer, not both at once";
  }
  if (!ANSWER_TYPES.has(typeof rule.response_equals) || rule.response_equals === "") {
    return "a branch deciding on an answer needs the answer it looks for";
  }
  if (rule.question !== undefined && (typeof rule.question !== "string" || !rule.question)) {
    return "a branch reading one question of a survey needs that question's name";
  }
  return null;
}

// A question step records every answer under its question's name, even when it asks only one, so
// a branch on it has to say which question it reads, and one that reads none of them never holds.
function questionProblem(rule: ResponseRule, names: string[] | null) {
  const listed = names?.length ? ` (questions: ${names.join(", ")})` : "";
  if (names === null) {
    return rule.question === undefined
      ? null
      : `a branch reads question "${rule.question}", but the trials tagged "${rule.scope}" ask no questions`;
  }
  if (rule.question === undefined) {
    return `a branch on the answers to "${rule.scope}" needs the question it reads${listed}`;
  }
  if (names.length > 0 && !names.includes(rule.question)) {
    return `a branch reads question "${rule.question}", which the trials tagged "${rule.scope}" do not ask${listed}`;
  }
  return null;
}

function checkBranch(node: BranchNode, spec: Spec, problems: Problem[], path: number[]) {
  const report = (message: string) => problems.push({ message, path, severity: "error" });
  if (node.then.length === 0 && (node.otherwise ?? []).length === 0) {
    report("a branch needs steps on at least one of its paths");
  }
  const ruleProblem = branchRuleProblem(node.when);
  if (ruleProblem) report(ruleProblem);
  else if (isResponseRule(node.when)) {
    const problem = questionProblem(node.when, questionNames(spec.timeline, node.when.scope));
    if (problem) report(problem);
  }
  // The trials being judged have to have happened already, so they cannot live inside the branch.
  const earlier = new Set(collectTags(spec.timeline).filter(Boolean));
  const inside = new Set(collectTags(slotsOf(node)?.flatMap((slot) => slot.children) ?? []));
  const available = [...earlier].filter((tag) => !inside.has(tag));
  if (!node.when.scope) {
    report(
      "a branch needs to know which trials it judges: tag them, then name that tag here" +
        (available.length > 0 ? ` (tags available: ${available.join(", ")})` : ""),
    );
  } else if (!available.includes(node.when.scope)) {
    report(
      `a branch judges "${node.when.scope}", but no trial before it carries that tag` +
        (available.length > 0 ? ` (tags available: ${available.join(", ")})` : ""),
    );
  }
}

// A step that turns participants away would otherwise end the study on the spot, unsaved and with
// no way back to the platform, so it has to say where they go, and the ending's own message is
// what they then see.
function exclusionProblems(trial: TrialNode, spec: Spec) {
  const ending = trial.exclusion_ending;
  if (ending === undefined) {
    return excludesParticipants(trial)
      ? ["can turn participants away, so it needs an ending to send them to (exclusion_ending)"]
      : [];
  }
  if (!canExcludeParticipants(trial.plugin))
    return ["turns no one away, so it takes no exclusion_ending"];
  const names = endingNames(spec.recruitment);
  const known = names.length > 0 ? ` (endings: ${names.join(", ")})` : "";
  const problems: string[] = [];
  if (!names.includes(ending)) {
    problems.push(
      `sends excluded participants to "${ending}", which the study does not have${known}`,
    );
  }
  if (trial.params?.exclusion_message !== undefined) {
    problems.push(
      "shows its ending's message to excluded participants, so it takes no exclusion_message",
    );
  }
  return problems;
}

function checkEnd(node: EndNode, spec: Spec, report: (message: string) => void) {
  const names = endingNames(spec.recruitment);
  const known = names.length > 0 ? ` (endings: ${names.join(", ")})` : "";
  if (!node.ending) {
    report(`an end step needs to name the ending it reaches${known}`);
  } else if (!names.includes(node.ending)) {
    report(
      `an end step reaches the ending "${node.ending}", which the study does not have${known}`,
    );
  }
}

function checkColumn(
  column: string,
  columns: Set<string>,
  where: string,
  problems: Problem[],
  path: number[],
) {
  const report = (message: string) => problems.push({ message, path, severity: "error" });
  if (columns.has(column)) return;
  const available = [...columns];
  report(
    `${where} reads column "${column}", which no enclosing conditions table provides` +
      (available.length > 0 ? ` (available: ${available.join(", ")})` : ""),
  );
}

function checkNodes(
  nodes: SpecNode[],
  spec: Spec,
  schemas: PluginSchemas,
  columns: Set<string>,
  problems: Problem[],
  path: number[],
) {
  nodes.forEach((node, index) => {
    const here = [...path, index];
    const report = (message: string) => problems.push({ message, path: here, severity: "error" });

    if (node.kind === "checkpoint") {
      if (!node.name) report("a checkpoint needs a name");
      return;
    }
    if (node.kind === "end") {
      checkEnd(node, spec, report);
      return;
    }
    if (node.kind === "assign" || node.kind === "counterbalance" || node.kind === "branch") {
      if (node.kind === "assign") checkAssign(node, spec, problems, here);
      else if (node.kind === "counterbalance")
        checkCounterbalance(node, spec, columns, problems, here);
      else checkBranch(node, spec, problems, here);
      (slotsOf(node) ?? []).forEach((slot, slotIndex) => {
        checkNodes(slot.children, spec, schemas, columns, problems, [...here, slotIndex]);
      });
      return;
    }
    if (node.kind === "trial") {
      checkTrial(node, spec, schemas, columns, problems, here);
      return;
    }

    if (node.children.length === 0) report(`${node.kind} has no steps inside it`);

    let inner = columns;
    if (node.kind === "block") {
      const repetitions = node.repetitions;
      if (repetitions !== undefined && !(Number.isInteger(repetitions) && repetitions >= 1)) {
        report(
          `a block repeats ${JSON.stringify(repetitions)} times, but it needs a whole number of at least 1`,
        );
      }
      if (!spec.conditions?.[node.conditions]) {
        report(
          `block refers to conditions table "${node.conditions}", which the spec does not define`,
        );
      } else {
        inner = new Set([...columns, ...conditionColumns(spec, node.conditions)]);
      }
    }
    if (node.kind === "loop") {
      const problem = thresholdProblem(node.repeat_while, "a loop");
      if (problem) report(problem);
      const tags = collectTags(node.children);
      if (!tags.includes(node.repeat_while.scope)) {
        report(
          `loop repeats on tag "${node.repeat_while.scope}", but no trial inside it carries ` +
            `that tag, so it would never repeat` +
            (tags.length > 0 ? ` (tags present: ${[...new Set(tags)].join(", ")})` : ""),
        );
      }
    }
    checkNodes(node.children, spec, schemas, inner, problems, here);
  });
}

/** Throws a SpecError when the spec has errors; otherwise returns its warnings, if any. */
export function validateSpec(spec: Spec, schemas: PluginSchemas): Problem[] {
  // jsPsych throws on an empty timeline, so an experiment with nothing in it is not runnable.
  const problems: Problem[] =
    spec.timeline.length === 0 ? [{ message: "the timeline has no steps", severity: "error" }] : [];
  if (spec.data?.save === "post" && !spec.data.experiment_id) {
    problems.push({
      message: "uploading data needs an experiment id from the service receiving it",
      severity: "error",
    });
  }
  problems.push(...dataPipeAddressProblems(spec));
  problems.push(...recruitmentProblems(spec));
  problems.push(...sampleSizeProblems(spec));
  problems.push(...streamingProblems(spec));
  problems.push(...conditionFallbackProblems(spec));
  problems.push(...sharedConditionProblems(spec));
  problems.push(...appearanceProblems(spec.settings));
  problems.push(...setupOrderProblems(spec));
  checkNodes(spec.timeline, spec, schemas, new Set(), problems, []);

  if (problems.some(isError)) throw new SpecError(spec.name, problems);
  return problems;
}
