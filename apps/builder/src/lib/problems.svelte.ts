import { compileSpec, isError, SpecError, type Problem } from "tachisto-compiler";
import { unique } from "./lists.ts";
import { exportedSpec } from "./project.svelte.ts";
import { schemas } from "./schemas.ts";

/**
 * Problems found in the current experiment, so a step can say for itself what it still needs.
 * Errors stop the experiment from being built; warnings name settings worth a second look.
 */
export function currentProblems(): Problem[] {
  try {
    return compileSpec(exportedSpec(), schemas).warnings;
  } catch (error) {
    if (error instanceof SpecError) return error.problems;
    throw error;
  }
}

export function problemsAt(problems: Problem[], path: number[]) {
  const key = path.join(".");
  return problems.filter((problem) => problem.path?.join(".") === key);
}

/** Problems about the experiment as a whole rather than about one step. */
export function overallProblems(problems: Problem[]) {
  return problems.filter((problem) => !problem.path);
}

export function errorsOf(problems: Problem[]) {
  return problems.filter(isError);
}

export function warningsOf(problems: Problem[]) {
  return problems.filter((problem) => !isError(problem));
}

/** How many steps have a problem among these, counting a step once however many it has. */
export function stepCount(problems: Problem[]) {
  return unique(problems.flatMap((problem) => (problem.path ? [problem.path.join(".")] : [])))
    .length;
}
