import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { builderLink } from "@tachisto/compiler";
import {
  compile,
  payloadOf,
  problemLine,
  unreadableOutcome,
  validate,
  type Files,
  type Payload,
} from "@tachisto/cli";
import { loadBundle } from "@tachisto/schemas/bundle";
import manifest from "../package.json" with { type: "json" };

const bundle = loadBundle();
const versions = { tachisto: manifest.version, jspsych: bundle.jspsych };

/** What a spec arrived as: written out somewhere, or handed over in the call itself. */
export interface SpecSource {
  spec?: string;
  path?: string;
}

/** Stands in for a path in messages about a spec that was never a file. */
export const INLINE = "(the spec in this call)";

/**
 * Where this server may read and write. A spec can be written by anyone — including whatever an
 * agent happened to be reading when it decided to call — so neither the spec nor the agent acting
 * on it chooses where on the machine a file lands. Whoever starts the server chooses.
 */
export const rootDirectory = () => resolve(process.env.TACHISTO_MCP_ROOT ?? process.cwd());

/** The path within the root, or why it is not one. */
export function withinRoot(path: string): { path: string } | { problem: string } {
  const root = rootDirectory();
  const target = resolve(root, path);
  const step = relative(root, target);
  if (step === "" || step.startsWith("..") || isAbsolute(step)) {
    return { problem: `${path} is outside ${root}` };
  }
  return { path: target };
}

const sourceFiles = (source: SpecSource): { files: Files; label: string } => {
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
    files: {
      // The seam says what it assumes: there is one spec here and no file to read beside it.
      read: (path) => {
        if (path !== INLINE) throw new Error(`there is no ${path} to read`);
        return spec;
      },
      write: (path, text) => writeFileSync(path, text),
    },
  };
};

/** One spec per call, named one way: the alternative is guessing which of two a caller meant. */
function sourceProblem({ spec, path }: SpecSource) {
  if (spec !== undefined && path !== undefined) return "give the spec or a path to it, not both";
  if (spec === undefined && path === undefined) return "give a spec, or a path to one";
  return undefined;
}

export const spoken = (problems: Payload["problems"]) => problems.map(problemLine).join("\n");

/** A tool's answer: the words for whoever is reading, and the payload for whatever is not. */
export interface Answer {
  text: string;
  payload: Payload;
  failed: boolean;
}

function answerOf(payload: Payload, said: string): Answer {
  // The sentinel is not a path, and every other value of `spec` is one; absence says it better.
  const { spec, ...rest } = payload;
  const answered = spec === INLINE ? rest : payload;
  return {
    text: payload.problems.length > 0 ? `${said}\n\n${spoken(payload.problems)}` : said,
    payload: answered,
    failed: !payload.ok,
  };
}

const refusal = (command: "validate" | "compile", message: string): Answer =>
  answerOf(
    payloadOf(unreadableOutcome(command, message), versions),
    `Nothing was ${command === "validate" ? "validated" : "compiled"}: ${message}.`,
  );

export function validateSpecSource(source: SpecSource): Answer {
  const asked = sourceProblem(source);
  if (asked) return refusal("validate", asked);
  const { files, label } = sourceFiles(source);
  const payload = payloadOf(validate(label, files, bundle), versions);
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
  const { files, label } = sourceFiles(source);
  // Beside the spec when there is one, so a study lands where its spec lives rather than wherever
  // the server happened to be started.
  const fallback =
    label === INLINE ? "experiment.html" : join(dirname(label), `${basename(label, ".json")}.html`);
  const within = withinRoot(out === undefined || out === "" ? fallback : out);
  if ("problem" in within) return refusal("compile", within.problem);
  if (!within.path.endsWith(".html"))
    return refusal("compile", "the study has to be an .html file");

  const payload = payloadOf(await compile(label, { out: within.path }, files, bundle), versions);
  return answerOf(
    payload,
    payload.ok
      ? `Wrote ${payload.output}, a study using ${payload.plugins?.length ?? 0} plugin(s).`
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
