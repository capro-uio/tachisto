import { loadBundle } from "@tachisto/schemas/bundle";
import type { ParameterSchema, Variants } from "@tachisto/schemas";
import { takesFunction } from "@tachisto/compiler";
import { codeSeed } from "./code.ts";

export const schemas = loadBundle();

/** A plugin's schema, looked up as an own property: a spec's plugin name is not to be trusted. */
export function pluginSchema(plugin: string) {
  return Object.hasOwn(schemas.plugins, plugin) ? schemas.plugins[plugin] : undefined;
}

/** What an author calls a plugin's step; the machine name for one the schemas do not know. */
export function pluginTitle(plugin: string) {
  return pluginSchema(plugin)?.title ?? plugin;
}

/** The plugins an author can choose from, grouped by what the step is for and sorted by title. */
export const pluginChoices = Object.entries(schemas.families)
  .map(([family, label]) => ({
    label,
    plugins: Object.values(schemas.plugins)
      .filter((schema) => schema.family === family)
      .sort((a, b) => a.title.localeCompare(b.title, "en"))
      .map(({ plugin, title }) => ({ plugin, title })),
  }))
  .filter((group) => group.plugins.length > 0);

const EDITABLE_TYPES = new Set([
  "BOOL",
  "STRING",
  "INT",
  "FLOAT",
  "KEY",
  "KEYS",
  "SELECT",
  "HTML_STRING",
  "IMAGE",
  "AUDIO",
  "VIDEO",
  "FUNCTION",
]);

export function editableParameters(plugin: string) {
  const schema = pluginSchema(plugin);
  if (!schema) return [];
  return Object.entries(schema.properties)
    .filter(
      ([, parameter]) =>
        EDITABLE_TYPES.has(parameter.jspsychType) || Boolean(parameter.items?.properties),
    )
    .map(([name, parameter]) => ({
      name,
      parameter,
      required: schema.required.includes(name),
    }));
}

const PLACEHOLDER_TEXT = "<p>Your text here</p>";
const PLACEHOLDER_OPTIONS = ["Option 1", "Option 2"];

/** What a required field starts as, or undefined when there is no sensible start for it. */
export function placeholderFor(field: ParameterSchema): unknown {
  if (field.enum?.length && field.type !== "array") return field.enum[0];
  if (field.jspsychType === "BOOL" && field.type !== "array") return false;
  if (field.jspsychType === "HTML_STRING") {
    return field.type === "array" ? [PLACEHOLDER_TEXT] : PLACEHOLDER_TEXT;
  }
  if (field.type === "array" && field.items?.jspsychType === "STRING" && !field.items.enum) {
    return [...PLACEHOLDER_OPTIONS];
  }
  return undefined;
}

// A list of questions starts with one, its required fields filled in, rather than empty: an empty
// list is a step that cannot run.
function starterEntry(item: ParameterSchema) {
  const entry: Record<string, unknown> = {};
  for (const name of item.required ?? []) {
    const field = item.properties?.[name];
    const value = field && placeholderFor(field);
    if (value === undefined) return undefined;
    entry[name] = value;
  }
  return entry;
}

/**
 * Required parameters start from the schema's example, from placeholders, or with one entry when
 * they are a list of objects, so a new step is not born invalid.
 */
export function startingParams(plugin: string): Record<string, unknown> {
  const schema = pluginSchema(plugin);
  if (!schema) return {};
  const params: Record<string, unknown> = {};
  for (const name of schema.required) {
    const parameter = schema.properties[name];
    if (parameter?.examples?.length) {
      params[name] = structuredClone(parameter.examples[0]);
    } else if (parameter && placeholderFor(parameter) !== undefined) {
      params[name] = placeholderFor(parameter);
    } else if (parameter && takesFunction(parameter.jspsychType)) {
      params[name] = { code: codeSeed(parameter, undefined) };
    } else if (parameter?.type === "array" && parameter.items?.properties) {
      const entry = starterEntry(parameter.items);
      if (entry) params[name] = [entry];
    }
  }
  return params;
}

/**
 * The parameters a step takes when it changes type. Settings do not carry across step types, with
 * one exception: going between kinds of question keeps the questions, and what each new kind
 * needs is filled in. The new type should arrive ready to run where it can.
 */
export function paramsForPlugin(
  params: Record<string, unknown> | undefined,
  from: string,
  to: string,
): Record<string, unknown> {
  const starting = startingParams(to);
  const questions = params?.questions;
  const before = pluginSchema(from)?.properties.questions?.items?.properties;
  const after = pluginSchema(to)?.properties.questions?.items;
  if (!before || !after?.properties || !Array.isArray(questions)) return starting;
  const starter = starterEntry(after) ?? {};
  return {
    ...starting,
    questions: questions.map((question: Record<string, unknown>) => ({
      ...starter,
      ...Object.fromEntries(Object.entries(question).filter(([name]) => name in after.properties!)),
    })),
  };
}

/** The fields an entry of a list shows: for one with variants, only those its variant reads. */
export function visibleFields(schema: ParameterSchema, value: Record<string, unknown>) {
  const fields = Object.entries(schema.properties ?? {});
  const variants = schema.variants;
  if (!variants) return fields;
  const chosen = variants.options[value[variants.by] as string];
  const shown = new Set([variants.by, ...variants.shared, ...(chosen?.properties ?? [])]);
  return fields.filter(([name]) => shown.has(name) || name in value);
}

/**
 * Changing an entry's variant drops the fields only the old one read, rather than leave them;
 * fields no variant claims, such as motion, are kept.
 */
export function switchVariant(variants: Variants, value: Record<string, unknown>, next: string) {
  const claimed = new Set(Object.values(variants.options).flatMap((option) => option.properties));
  const reads = new Set([...variants.shared, ...(variants.options[next]?.properties ?? [])]);
  const fields = Object.entries(value).filter(
    ([name]) => name !== variants.by && (!claimed.has(name) || reads.has(name)),
  );
  return { [variants.by]: next, ...Object.fromEntries(fields) };
}
