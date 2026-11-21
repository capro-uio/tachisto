import {
  containsCode,
  isCode,
  isVariableReference,
  takesFunction,
  trialsOf,
  type ParameterValue,
  type SpecNode,
} from "tachisto-compiler";
import type { ParameterSchema } from "tachisto-schemas";

const BLANK_FUNCTION = "() => {\n}";

/**
 * The code a parameter starts from when its author switches it to code: the plugin's own default
 * function where it has one, otherwise whatever the parameter holds now, written as code.
 */
export function codeSeed(parameter: ParameterSchema, current: ParameterValue | undefined) {
  const example = parameter.examples?.find(isCode);
  if (example) return example.code;
  if (takesFunction(parameter.jspsychType)) return BLANK_FUNCTION;
  if (current !== undefined && isVariableReference(current)) {
    const read = `jsPsych.evaluateTimelineVariable(${JSON.stringify(current.var)})`;
    return current.wrap ? `${JSON.stringify(current.wrap)}.replace("{}", () => ${read})` : read;
  }
  // A value holding code of its own, such as a canvas object's motion, would lose it as text.
  const start = containsCode(current) ? undefined : current;
  return JSON.stringify(start ?? parameter.default ?? "");
}

/** What an author is told about the code a parameter holds. */
export function codeHint(parameter: ParameterSchema) {
  return takesFunction(parameter.jspsychType)
    ? "A JavaScript function the plugin calls. `jsPsych` is available."
    : "A JavaScript expression worked out when the trial starts. `jsPsych` is available.";
}

/** Whether a step, or any step inside it, runs code its author wrote. */
export function usesCode(node: SpecNode): boolean {
  return trialsOf([node]).some((trial) => Object.values(trial.params ?? {}).some(containsCode));
}
