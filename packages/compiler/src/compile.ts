import type { ParameterSchema, SchemaBundle } from "tachisto-schemas";
import { compileAppearance } from "./appearance.ts";
import { filesOfPackages } from "./package-files.ts";
import {
  NAME_FILES_IN_DATA,
  compileAssetMap,
  compilePreloadStep,
  isMediaParameter,
  isMediaType,
} from "./assets.ts";
import { compileAccuracyPredicate, compileBranchPredicate } from "./conditions.ts";
import {
  compileParticipantProperties,
  compileStreaming,
  DATA_PIPE,
  savesAsItGoes,
  UPLOAD_HELPERS,
} from "./data.ts";
import { compileCompletion, compileEndStep } from "./endings.ts";
import { dataColumns, reservedLinkColumns } from "./metadata.ts";
import { idParamOf, needsParticipantId } from "./recruitment.ts";
import {
  GROUPS_VARIABLE,
  compileAssignmentStep,
  compileCheckpointStep,
  compileGroupGate,
} from "./groups.ts";
import { literal } from "./emit.ts";
import { BROWSER_BUNDLE, pluginIdentifier } from "./identifiers.ts";
import { WAS_EXCLUDED, compileExcludingPlugin, excludingIdentifier } from "./exclusions.ts";
import { RECORDING_HELPERS, usesRecordings } from "./recordings.ts";
import {
  EYE_TRACKER,
  EYE_TRACKER_EXTENSION,
  eyeTrackerSetup,
  gazeExtension,
  tracksGaze,
  usesEyeTracking,
} from "./gaze.ts";
import {
  ORDERS_VARIABLE,
  compileCounterbalancedTasks,
  compileOrderStep,
} from "./counterbalance.ts";
import { isPlainObject, isVariableReference } from "./variables.ts";
import { codeExpression, isCode, takesFunction } from "./code.ts";
import { SpecError, validateSpec } from "./validate.ts";
import type {
  AssignNode,
  BlockNode,
  BranchNode,
  CompileResult,
  CounterbalanceNode,
  LoopNode,
  ParameterValue,
  Spec,
  SpecNode,
  TrialNode,
  VariableReference,
} from "./types.ts";

export { pluginIdentifier } from "./identifiers.ts";

// Inside a function body a timeline variable must be read with evaluateTimelineVariable:
// jsPsych.timelineVariable() returns a placeholder object there, which renders as [object Object].
function variableInsideFunction(reference: VariableReference) {
  return `jsPsych.evaluateTimelineVariable(${literal(reference.var)})`;
}

/** What a parameter or field takes, as far as how its value is written out goes. */
interface ValueShape {
  /** Names a file, resolved through the asset map. */
  media?: boolean;
  /** Takes a list, so a single value read from a column or computed by code becomes one. */
  list?: boolean;
  /** Takes a function, which code is rather than computes. */
  isFunction?: boolean;
  /** Takes a list of numbers, which a conditions cell holds as text such as "0,1". */
  numbers?: boolean;
  /** Takes a grid of rows, which a conditions cell holds as text such as "[[1,0],[0,1]]". */
  grid?: boolean;
  /** Takes a number, which a conditions cell holds as text such as "100". */
  number?: boolean;
  /** Takes null for none, as jsPsych's default, which a blank conditions cell then means. */
  blankIsNone?: boolean;
}

function shapeOf(parameter: ParameterSchema | undefined, media: boolean): ValueShape {
  const grid = parameter?.format === "grid";
  return {
    media,
    // A KEYS list also takes the words "ALL_KEYS" and "NO_KEYS", which must stay words.
    list: parameter?.type === "array" && parameter.jspsychType !== "KEYS" && !grid,
    isFunction: takesFunction(parameter?.jspsychType),
    numbers:
      parameter?.type === "array" &&
      !grid &&
      (parameter.items?.type === "integer" || parameter.items?.type === "number"),
    grid,
    number: parameter?.type === "integer" || parameter?.type === "number",
    blankIsNone: parameter?.default === null,
  };
}

// Conditions cells are text, so a value read from one is turned into what the parameter takes.
const AS_NUMBERS = (read: string) =>
  `((cell) => (Array.isArray(cell) ? cell : String(cell).split(",")).map(Number))(${read})`;
// A plugin adding to a number read as text joins the two instead: "100" + 400 is "100400". A blank
// cell is none where jsPsych's own default is none, and jsPsych times out on "" as on 0.
const AS_NUMBER = (read: string, blankIsNone = false) =>
  `((cell) => (${blankIsNone ? 'cell === "" ? null : ' : ""}typeof cell === "string" && cell.trim() !== "" && Number.isFinite(Number(cell)) ? Number(cell) : cell))(${read})`;
const AS_GRID = (read: string) =>
  `((cell) => (typeof cell === "string" ? JSON.parse(cell) : cell))(${read})`;

// Media parameters resolve through the asset map, so a spec can name a file rather than carry a
// data URL in every parameter and every conditions cell.
function parameterExpression(value: ParameterValue, shape: ValueShape = {}): string {
  if (isCode(value)) {
    return shape.isFunction
      ? codeExpression(value.code)
      : `() => ${valueInsideFunction(value, shape)}`;
  }
  if (!isVariableReference(value)) {
    if (!shape.media) return literal(value);
    if (Array.isArray(value)) {
      return `[${value.map((entry) => `asset(${literal(entry)})`).join(", ")}]`;
    }
    return `asset(${literal(value)})`;
  }
  if (value.wrap || shape.media || shape.list || shape.grid || shape.number) {
    return `() => ${valueInsideFunction(value, shape)}`;
  }
  return `jsPsych.timelineVariable(${literal(value.var)})`;
}

function valueInsideFunction(value: ParameterValue, shape: ValueShape): string {
  if (!isCode(value) && !isVariableReference(value)) {
    return shape.media ? `asset(${literal(value)})` : literal(value);
  }
  let read = isCode(value) ? codeExpression(value.code) : variableInsideFunction(value);
  if (isVariableReference(value) && value.wrap) {
    read = `${literal(value.wrap)}.replace("{}", () => ${read})`;
  }
  if (isVariableReference(value) && shape.grid) return AS_GRID(read);
  if (isVariableReference(value) && shape.numbers) return AS_NUMBERS(read);
  if (isVariableReference(value) && shape.number) return AS_NUMBER(read, shape.blankIsNone);
  // A conditions cell holds one value, and a plugin that takes a list would read a lone string
  // one character at a time.
  if (shape.list) read = `[].concat(${read})`;
  return shape.media ? `asset(${read})` : read;
}

function isFieldSet(entry: unknown): entry is Record<string, ParameterValue> {
  return isPlainObject(entry);
}

// jsPsych resolves timeline variables and computed values inside a list's entries only for the
// fields a plugin declares, and the psychophysics plugin declares few of an object's fields. A list
// holding any bound or computed field is therefore built by a function when the trial starts. A
// field that takes a function holds its code as the function, so it needs no such building.
function entriesExpression(entries: unknown[], item: ParameterSchema, hasAssets: boolean) {
  const isMediaField = (name: string) =>
    hasAssets && isMediaType(item.properties?.[name]?.jspsychType);
  const fieldShape = (name: string) => shapeOf(item.properties?.[name], isMediaField(name));
  const isFunctionField = (name: string) => takesFunction(item.properties?.[name]?.jspsychType);
  const fields = entries.filter(isFieldSet).flatMap((entry) => Object.entries(entry));
  const bound = fields.some(
    ([name, value]) => isVariableReference(value) || (isCode(value) && !isFunctionField(name)),
  );
  if (!bound && !fields.some(([name, value]) => isMediaField(name) || isCode(value))) {
    return literal(entries);
  }

  const compiled = entries.map((entry) => {
    if (!isFieldSet(entry)) return literal(entry);
    const fields = Object.entries(entry).map(
      ([name, value]) => `${literal(name)}: ${valueInsideFunction(value, fieldShape(name))}`,
    );
    return `{ ${fields.join(", ")} }`;
  });
  const list = `[${compiled.join(", ")}]`;
  return bound ? `() => ${list}` : list;
}

/**
 * The data column a traced build writes each step's place in the timeline to, so whatever runs
 * the study can tell which step is on screen. Only the builder's preview asks for it.
 */
export const STEP_COLUMN = "tachisto_step";

function dataExpression(trial: TrialNode, step: string | undefined) {
  // The step's place comes last, so a column of the author's with the same name cannot replace it.
  const entries = [
    ...(trial.tag ? [`tag: ${literal(trial.tag)}`] : []),
    ...Object.entries(trial.record ?? {}).map(
      ([key, value]) => `${literal(key)}: ${parameterExpression(value)}`,
    ),
    ...(step !== undefined ? [`${STEP_COLUMN}: ${literal(step)}`] : []),
  ];
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : null;
}

function scoreExpression(trial: TrialNode) {
  const expected = trial.score?.correct_if_response_equals;
  if (expected === undefined) return null;
  const comparison =
    typeof expected === "object" ? variableInsideFunction(expected) : literal(expected);
  // Conditions cells are text, while a button or a slider records a number, so both are compared
  // as text, as a branch on an answer is.
  return `(data) => { data.correct = String(data.response) === String(${comparison}); }`;
}

function compileTrial(trial: TrialNode, context: CompileContext) {
  context.plugins.add(trial.plugin);
  const properties = context.bundle.plugins[trial.plugin]?.properties ?? {};
  const excluding = trial.exclusion_ending !== undefined;
  if (excluding) context.excludingPlugins.add(trial.plugin);
  const type = excluding ? excludingIdentifier(trial.plugin) : pluginIdentifier(trial.plugin);
  const entries = [`type: ${type}`];
  for (const [name, value] of Object.entries(trial.params ?? {})) {
    const item = properties[name]?.items;
    if (item?.properties && Array.isArray(value)) {
      entries.push(`${name}: ${entriesExpression(value, item, context.hasAssets)}`);
      continue;
    }
    const media =
      context.hasAssets && isMediaParameter(trial.plugin, name, properties[name]?.jspsychType);
    entries.push(`${name}: ${parameterExpression(value, shapeOf(properties[name], media))}`);
  }
  const data = dataExpression(trial, context.stepIds?.get(trial));
  if (data) entries.push(`data: ${data}`);
  const score = scoreExpression(trial);
  if (score) entries.push(`on_finish: ${score}`);
  const extensions = gazeExtension(trial);
  if (extensions) entries.push(`extensions: ${extensions}`);
  const step = `{\n${entries.map((entry) => `  ${entry},`).join("\n")}\n}`;
  if (!excluding) return step;
  // A participant the step turned away goes to its ending, as an end step would send them.
  const end = compileEndStep({ kind: "end", ending: trial.exclusion_ending! }, context.spec);
  context.plugins.add(end.plugin);
  return `{\n  timeline: [${step}, {\n  timeline: [${end.source}],\n  conditional_function: ${WAS_EXCLUDED},\n}],\n}`;
}

function compileBlock(block: BlockNode, context: CompileContext) {
  const entries = [
    `timeline: [${block.children.map((child) => compileNode(child, context)).join(", ")}]`,
    `timeline_variables: ${literal(context.spec.conditions?.[block.conditions] ?? [])}`,
  ];
  if (block.randomize_order) entries.push("randomize_order: true");
  if (block.repetitions) entries.push(`repetitions: ${literal(block.repetitions)}`);
  return `{\n${entries.map((entry) => `  ${entry},`).join("\n")}\n}`;
}

function compileLoop(loop: LoopNode, context: CompileContext) {
  const timeline = loop.children.map((child) => compileNode(child, context)).join(", ");
  const condition = compileAccuracyPredicate(loop.repeat_while);
  return `{
  timeline: [${timeline}],
  loop_function: ${condition},
}`;
}

interface CompileContext {
  spec: Spec;
  bundle: SchemaBundle;
  plugins: Set<string>;
  hasAssets: boolean;
  usesGroups: boolean;
  usesCounterbalance: boolean;
  /** Plugins whose excluding form the study defines, for steps that send excluded people on. */
  excludingPlugins: Set<string>;
  stepIds?: Map<TrialNode, string>;
}

function callFunctionStep(step: { async: boolean; body: string }) {
  return `{\n  type: jsPsychCallFunction,\n  async: ${step.async},\n  func: ${step.body},\n}`;
}

function compileAssign(node: AssignNode, context: CompileContext) {
  context.plugins.add("call-function");
  context.usesGroups = true;

  const step = compileAssignmentStep(node, context.spec.data);
  const gates = node.groups.map((group) => {
    const timeline = group.children.map((child) => compileNode(child, context)).join(", ");
    return compileGroupGate(node, group.name, timeline);
  });

  return [callFunctionStep(step), ...gates].join(",\n");
}

function compileCounterbalance(node: CounterbalanceNode, context: CompileContext) {
  context.plugins.add("call-function");
  context.usesCounterbalance = true;

  const step = compileOrderStep(node, context.spec.data);
  const timelines = node.tasks.map((task) =>
    task.children.map((child) => compileNode(child, context)).join(", "),
  );

  return [callFunctionStep(step), compileCounterbalancedTasks(node, timelines)].join(",\n");
}

function compileBranch(node: BranchNode, context: CompileContext) {
  const predicate = compileBranchPredicate(node.when);
  const paths: string[] = [];
  const gate = (children: SpecNode[], taken: boolean) => {
    if (children.length === 0) return;
    const timeline = children.map((child) => compileNode(child, context)).join(", ");
    const test = taken ? `(${predicate})()` : `!(${predicate})()`;
    paths.push(`{\n  timeline: [${timeline}],\n  conditional_function: () => ${test},\n}`);
  };
  gate(node.then, true);
  gate(node.otherwise ?? [], false);
  return paths.join(",\n");
}

function compileNode(node: SpecNode, context: CompileContext): string {
  if (node.kind === "trial") return compileTrial(node, context);
  if (node.kind === "block") return compileBlock(node, context);
  if (node.kind === "loop") return compileLoop(node, context);
  if (node.kind === "branch") return compileBranch(node, context);
  if (node.kind === "counterbalance") return compileCounterbalance(node, context);
  if (node.kind === "checkpoint") {
    context.plugins.add("call-function");
    return compileCheckpointStep(node);
  }
  if (node.kind === "end") {
    const step = compileEndStep(node, context.spec);
    context.plugins.add(step.plugin);
    return step.source;
  }
  return compileAssign(node, context);
}

export interface CompileOptions {
  /** Extra entries for the `initJsPsych` object, e.g. a finish hook for the preview iframe. */
  initEntries?: string;
  /** `"inline"` embeds media in the page; `"files"` points at files beside it. */
  assets?: "inline" | "files";
  /** Names for steps, written to each one's data under {@link STEP_COLUMN} as it runs. */
  stepIds?: Map<TrialNode, string>;
}

const SETTING_KEYS = [
  "default_iti",
  "minimum_valid_rt",
  "show_progress_bar",
  "progress_bar_message",
] as const;

function initOptions(spec: Spec, extensions: string[], extra: string | undefined) {
  const entries = SETTING_KEYS.filter((key) => spec.settings?.[key] !== undefined).map(
    (key) => `${key}: ${literal(spec.settings![key])}`,
  );
  if ((spec.assets ?? []).length > 0) entries.push(NAME_FILES_IN_DATA);
  if (extensions.length > 0) entries.push(`extensions: [${extensions.join(", ")}]`);
  if (extra) entries.push(extra);
  return entries.length > 0 ? `{ ${entries.join(", ")} }` : "";
}

function extensionOf(spec: Spec, bundle: SchemaBundle, name: string) {
  const extension = bundle.extensions[name];
  if (!extension) {
    throw new SpecError(spec.name, [
      { message: `the schema bundle has no entry for extension "${name}"`, severity: "error" },
    ]);
  }
  return extension;
}

export function compileSpec(
  spec: Spec,
  bundle: SchemaBundle,
  options: CompileOptions = {},
): CompileResult {
  const warnings = validateSpec(spec, bundle.plugins);
  const plugins = new Set<string>();
  const assets = spec.assets ?? [];
  const context: CompileContext = {
    spec,
    bundle,
    plugins,
    hasAssets: assets.length > 0,
    usesGroups: false,
    usesCounterbalance: false,
    excludingPlugins: new Set(),
    stepIds: options.stepIds,
  };
  const steps = spec.timeline.map((node) => compileNode(node, context));

  const preload = compilePreloadStep(assets);
  if (preload) {
    plugins.add(preload.plugin);
    steps.unshift(preload.source);
  }
  const completion = compileCompletion(spec);
  if (completion) {
    plugins.add(completion.plugin);
    steps.push(completion.source);
  }
  const timeline = steps.join(",\n");
  const packages = Object.fromEntries(
    [...plugins].map((plugin) => {
      const schema = bundle.plugins[plugin];
      if (!schema) {
        throw new SpecError(spec.name, [
          { message: `the schema bundle has no entry for plugin "${plugin}"`, severity: "error" },
        ]);
      }
      return [plugin, { name: schema.package, version: schema.version }];
    }),
  );
  const eyeTracker = usesEyeTracking(spec) ? extensionOf(spec, bundle, EYE_TRACKER) : undefined;
  const dataPipe = savesAsItGoes(spec) ? extensionOf(spec, bundle, DATA_PIPE) : undefined;
  const streaming = savesAsItGoes(spec) ? compileStreaming(spec.data, spec.name) : undefined;
  const scripts = [
    ...(eyeTracker?.libraries ?? []),
    ...[eyeTracker, dataPipe]
      .filter((extension) => extension !== undefined)
      .map((extension) => ({
        package: extension.package,
        version: extension.version,
        file: BROWSER_BUNDLE,
      })),
  ];
  const extensions = [
    ...(eyeTracker ? [EYE_TRACKER_EXTENSION] : []),
    ...(streaming ? [streaming.extension] : []),
  ];
  const columns = dataColumns(spec, [
    // Every plugin has a schema by now: one without stopped the compile above.
    ...[...plugins].flatMap((plugin) => bundle.plugins[plugin].records),
    ...(eyeTracker && tracksGaze(spec) ? eyeTracker.records : []),
  ]);
  const uploads = spec.data?.save === "post";
  const recordings = uploads && usesRecordings(spec);
  const source =
    (eyeTracker ? `${eyeTrackerSetup(eyeTracker.libraries[0].package)}\n\n` : "") +
    (streaming ? `${streaming.declaration}\n` : "") +
    `const jsPsych = initJsPsych(${initOptions(spec, extensions, options.initEntries)});\n\n` +
    (context.usesGroups ? `const ${GROUPS_VARIABLE} = {};\n\n` : "") +
    (context.usesCounterbalance ? `const ${ORDERS_VARIABLE} = {};\n\n` : "") +
    [...context.excludingPlugins].map((plugin) => `${compileExcludingPlugin(plugin)}\n`).join("") +
    (assets.length > 0 ? `${compileAssetMap(assets, options.assets ?? "inline")}\n` : "") +
    // The DataPipe extension uploads the data itself, so a study that saves as it goes posts only
    // its recordings.
    ((uploads && !streaming) || recordings ? `${UPLOAD_HELPERS}\n` : "") +
    (recordings ? `${RECORDING_HELPERS}\n` : "") +
    (needsParticipantId(spec)
      ? `${compileParticipantProperties({
          experimentName: spec.name,
          idParam: idParamOf(spec.recruitment),
          reserved: reservedLinkColumns(spec, columns),
        })}\n`
      : "") +
    `jsPsych.run([\n${timeline},\n]);\n`;
  return {
    source,
    styles: compileAppearance(spec.settings),
    plugins: [...plugins],
    columns,
    warnings,
    jspsych: bundle.jspsych,
    packages,
    scripts,
    files: filesOfPackages(bundle, [
      { name: "jspsych", version: bundle.jspsych },
      ...scripts.map((script) => ({ name: script.package, version: script.version })),
      ...Object.values(packages),
    ]),
  };
}
