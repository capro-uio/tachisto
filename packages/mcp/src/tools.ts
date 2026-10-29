import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { builderLink } from "@tachisto/compiler";
import {
  compile,
  nodeFiles,
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
 * on it chooses which files on the machine are touched. Whoever starts the server chooses.
 */
export const rootDirectory = () => resolve(process.env.TACHISTO_MCP_ROOT ?? process.cwd());

/**
 * Where a path really lands, for a path that need not exist yet: the deepest ancestor that does
 * exist, resolved, with the rest hung back off it. Resolving only a path that already exists
 * would read a link standing over a file about to be written as though it were a directory.
 */
function settle(target: string): string {
  const rest: string[] = [];
  let at = target;
  while (!existsSync(at)) {
    const above = dirname(at);
    // A root is its own parent; there is nothing further up to resolve this against.
    if (above === at) return target;
    rest.unshift(basename(at));
    at = above;
  }
  return join(realpathSync(at), ...rest);
}

/** The path within the root, or why it is not one. */
export function withinRoot(path: string): { path: string } | { problem: string } {
  const root = rootDirectory();
  const target = resolve(root, path);
  const step = relative(root, target);
  if (step === "" || step.startsWith("..") || isAbsolute(step)) {
    return { problem: `${path} is outside ${root}` };
  }
  // A link inside the root can still point out of it, and writing follows it — including a link
  // in a directory above a file that is not there yet.
  const settled = settle(target);
  const walked = relative(realpathSync(root), settled);
  if (walked === "" || walked.startsWith("..") || isAbsolute(walked)) {
    return { problem: `${path} leads outside ${root}` };
  }
  return { path: settled };
}

/**
 * A disk seam that cannot reach outside the root, on the way in as well as out. The rule lives
 * here rather than at the one call site that first needed it, so a tool added later gets it
 * without knowing it exists.
 */
export function confinedFiles(): Files {
  const guard = (path: string) => {
    const within = withinRoot(path);
    if ("problem" in within) throw new Error(within.problem);
    return within.path;
  };
  return {
    read: (path) => nodeFiles.read(guard(path)),
    write: (path, text) => nodeFiles.write(guard(path), text),
  };
}

const sourceFiles = (source: SpecSource): { files: Files; label: string } => {
  const confined = confinedFiles();
  if (source.path !== undefined) return { label: source.path, files: confined };
  const spec = source.spec ?? "";
  return {
    label: INLINE,
    files: {
      // The seam says what it assumes: there is one spec here and no file to read beside it.
      read: (path) => {
        if (path !== INLINE) throw new Error(`there is no ${path} to read`);
        return spec;
      },
      write: (path, text) => confined.write(path, text),
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
  const outcome = validate(label, files, bundle);
  const payload = payloadOf(outcome, versions);
  // A spec that could not be read says nothing about an experiment, so it is not told that its
  // experiment will not run.
  const said =
    outcome.status === "ok"
      ? `${payload.name} is a study that will run.`
      : outcome.status === "invalid"
        ? `${payload.name ?? label} will not run as it stands.`
        : `There is no spec to check at ${label}.`;
  return answerOf(payload, said);
}

export async function compileSpecSource(source: SpecSource, requested?: string): Promise<Answer> {
  const asked = sourceProblem(source);
  if (asked) return refusal("compile", asked);
  const { files, label } = sourceFiles(source);
  // Beside the spec when there is one, so a study lands where its spec lives rather than wherever
  // the server happened to be started.
  const fallback =
    label === INLINE ? "experiment.html" : join(dirname(label), `${basename(label, ".json")}.html`);
  const out = requested === undefined || requested === "" ? fallback : requested;
  if (!out.endsWith(".html")) return refusal("compile", "the study has to be an .html file");
  // Where it may be written is the seam's rule; asking here only turns a refusal into an answer.
  const within = withinRoot(out);
  if ("problem" in within) return refusal("compile", within.problem);

  const outcome = await compile(label, { out }, files, bundle);
  const payload = payloadOf(outcome, versions);
  const said =
    outcome.status === "ok"
      ? `Wrote ${payload.output}, a study using ${payload.plugins?.length ?? 0} plugin(s).`
      : outcome.status === "invalid"
        ? `${payload.name ?? label} was not compiled.`
        : `There is no spec to compile at ${label}.`;
  return answerOf(payload, said);
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
