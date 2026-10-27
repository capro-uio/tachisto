import { basename } from "node:path";
import { compileSpec, emitHtml, placeOf, SpecError, validateSpec } from "@tachisto/compiler";
import specSchema from "@tachisto/compiler/spec-schema.json" with { type: "json" };
import type { Problem, Spec } from "@tachisto/compiler";
import type { SchemaBundle } from "@tachisto/schemas";
import type { Outcome } from "./outcome.ts";
import { unreadableOutcome } from "./outcome.ts";

/** Reading and writing files, kept behind a seam so the commands can be tested without any. */
export interface Files {
  read(path: string): string;
  write(path: string, text: string): void;
}

type Read = { read: true; spec: Spec } | { read: false; failure: Outcome };

function readSpec(command: Outcome["command"], specPath: string, files: Files): Read {
  let text: string;
  try {
    text = files.read(specPath);
  } catch (error) {
    return { read: false, failure: unreadableOutcome(command, (error as Error).message, specPath) };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      read: false,
      failure: unreadableOutcome(command, `not JSON: ${(error as Error).message}`, specPath),
    };
  }
  // The schema and the validator check what a spec holds; this only checks it is a spec at all,
  // so a wrong file gives its own answer rather than a validator's puzzling one.
  const spec = parsed as Spec;
  if (typeof spec?.name !== "string" || !Array.isArray(spec.timeline)) {
    return {
      read: false,
      failure: unreadableOutcome(command, "not a spec: it needs a name and a timeline", specPath),
    };
  }
  return { read: true, spec };
}

const problemsOf = (error: unknown) => {
  if (error instanceof SpecError) return error.problems;
  throw error;
};

/** Says where each problem is, which only a reader holding the spec can work out. */
const located = (problems: Problem[], spec: Spec) =>
  problems.map((problem) =>
    problem.path === undefined ? problem : { ...problem, place: placeOf(spec, problem.path) },
  );

export function validate(specPath: string, files: Files, bundle: SchemaBundle): Outcome {
  const read = readSpec("validate", specPath, files);
  if (!read.read) return read.failure;
  const { spec } = read;
  try {
    const warnings = validateSpec(spec, bundle.plugins);
    return {
      command: "validate",
      status: "ok",
      problems: located(warnings, spec),
      spec: specPath,
      name: spec.name,
    };
  } catch (error) {
    return {
      command: "validate",
      status: "invalid",
      problems: located(problemsOf(error), spec),
      spec: specPath,
      name: spec.name,
    };
  }
}

export async function compile(
  specPath: string,
  options: { out?: string; base?: string },
  files: Files,
  bundle: SchemaBundle,
): Promise<Outcome> {
  const read = readSpec("compile", specPath, files);
  if (!read.read) return read.failure;
  const { spec } = read;
  // Beside whoever ran the command, not beside the spec, which is where the compiler has always
  // written it.
  const outputPath = options.out ?? `${basename(specPath, ".json")}.html`;
  try {
    const result = compileSpec(spec, bundle);
    const { html } = await emitHtml(result, { title: spec.name, base: options.base ?? "cdn" });
    try {
      files.write(outputPath, html);
    } catch (error) {
      return unreadableOutcome("compile", (error as Error).message, specPath);
    }
    return {
      command: "compile",
      status: "ok",
      problems: located(result.warnings, spec),
      spec: specPath,
      name: spec.name,
      output: outputPath,
      plugins: result.plugins,
    };
  } catch (error) {
    return {
      command: "compile",
      status: "invalid",
      problems: located(problemsOf(error), spec),
      spec: specPath,
      name: spec.name,
    };
  }
}

/** The spec schema this release was built against, as it is published. */
export const specSchemaDocument = () => `${JSON.stringify(specSchema, null, 2)}\n`;
