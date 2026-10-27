import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { builderLink, type Problem } from "@tachisto/compiler";
import { compile, payloadOf, unreadable, validate, type Files, type Payload } from "@tachisto/cli";
import { loadBundle } from "@tachisto/schemas/bundle";
import manifest from "../package.json" with { type: "json" };

const bundle = loadBundle();
const versions = { tachisto: manifest.version, jspsych: bundle.jspsych };

/** What a spec arrived as: written out somewhere, or handed over in the call itself. */
export interface SpecSource {
  spec?: string;
  path?: string;
}

/** Shown in messages where a path would be, for a spec that was never a file. */
export const INLINE = "(the spec in this call)";

const files = (source: SpecSource): { files: Files; label: string } => {
  if (source.path !== undefined) {
    return {
      label: source.path,
      files: {
        read: (path) => readFileSync(path, "utf8"),
        write: (path, text) => writeFileSync(path, text),
      },
    };
  }
  const spec = source.spec ?? "";
  return {
    label: INLINE,
    files: { read: () => spec, write: (path, text) => writeFileSync(path, text) },
  };
};

/** One spec per call, named one way: the alternative is guessing which of two a caller meant. */
function sourceProblem({ spec, path }: SpecSource) {
  if (spec !== undefined && path !== undefined) return "give the spec or a path to it, not both";
  if (spec === undefined && path === undefined) return "give a spec, or a path to one";
  return undefined;
}

export const spoken = (problems: Problem[]) =>
  problems
    .map(
      (problem) =>
        `${problem.severity}: ${problem.message}` +
        (problem.path ? ` (step ${problem.path.map((index) => index + 1).join(".")})` : ""),
    )
    .join("\n");

/** A tool's answer: the words for whoever is reading, and the payload for whatever is not. */
export interface Answer {
  text: string;
  payload: Payload;
  failed: boolean;
}

const answerOf = (payload: Payload, said: string): Answer => ({
  text: payload.problems.length > 0 ? `${said}\n\n${spoken(payload.problems)}` : said,
  payload,
  failed: !payload.ok,
});

const refusal = (command: "validate" | "compile", message: string): Answer =>
  answerOf(
    payloadOf(unreadable(command, message), versions),
    `Nothing was ${command}d: ${message}.`,
  );

export function validateSpecSource(source: SpecSource): Answer {
  const asked = sourceProblem(source);
  if (asked) return refusal("validate", asked);
  const { files: reading, label } = files(source);
  const payload = payloadOf(validate(label, reading, bundle), versions);
  return answerOf(
    payload,
    payload.ok
      ? `${payload.name} is a study that will run.`
      : `${payload.name ?? label} will not run as it stands.`,
  );
}

export async function compileSpecSource(source: SpecSource, out?: string): Promise<Answer> {
  const asked = sourceProblem(source);
  if (asked) return refusal("compile", asked);
  const { files: reading, label } = files(source);
  const outputPath =
    out ?? `${basename(label === INLINE ? "experiment.json" : label, ".json")}.html`;
  const payload = payloadOf(
    await compile(label, { json: true, out: outputPath }, reading, bundle),
    versions,
  );
  return answerOf(
    payload,
    payload.ok
      ? `Wrote ${payload.output}, a study using ${payload.plugins?.length} plugin(s).`
      : `${payload.name ?? label} was not compiled.`,
  );
}

/**
 * A link that opens a spec in the builder, for a person to look at what was built. Only https,
 * which is all the builder opens, so a link that cannot work is never handed back.
 */
export function linkToSpec(specUrl: string) {
  let url: URL;
  try {
    url = new URL(specUrl);
  } catch (error) {
    throw new Error(`${specUrl} is not an address`, { cause: error });
  }
  if (url.protocol !== "https:") throw new Error("the spec has to be published over https");
  return builderLink(url.href);
}
