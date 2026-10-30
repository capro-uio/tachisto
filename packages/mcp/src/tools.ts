import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
 * Whether a step from the root climbs out of it. The whole step, or its first part, has to be
 * the way up: a directory is allowed to be called `..archive`, and refusing it is not safety.
 */
const climbs = (step: string) => step === ".." || step.startsWith(`..${sep}`);

/** As far as a study reaches when it is written where there was none; umask narrows it further. */
const REACH = 0o666;

/**
 * The path within the root, or why it is not one.
 *
 * Only the directory meant to hold a study is resolved, and it has to be there to be resolved —
 * which is what makes this answerable rather than guessed at. Working out where a path that is
 * not there yet would land means predicting the kernel's walk, and a prediction wrong by one
 * link is a way out of the root. A directory that is there can simply be asked.
 *
 * A link at the end is not followed. Where it points is not where the caller asked to write, and
 * a study landing somewhere other than the name it was given is worth refusing even when that
 * somewhere is inside the root.
 *
 * What is left is the gap between asking and writing: another process with the run of the root
 * could swap a directory for a link in between. Node offers no openat or O_NOFOLLOW to close it,
 * and the exclusive create and the rename already hold the last step of the path.
 */
export function withinRoot(path: string): { path: string } | { problem: string } {
  const root = rootDirectory();
  const target = resolve(root, path);
  const step = relative(root, target);
  // isAbsolute is Windows, where a path on another drive is not relative to this one at all.
  if (step === "" || climbs(step) || isAbsolute(step)) {
    return { problem: `${path} is outside ${root}` };
  }
  let real: string;
  try {
    real = realpathSync(root);
  } catch {
    // Said once, about the root, rather than as a problem with whichever spec arrived first.
    return { problem: `${root} is not a directory this server can read and write` };
  }
  let holder: string;
  try {
    holder = realpathSync(dirname(target));
  } catch {
    return { problem: `there is no ${dirname(path)} in ${root} to hold ${basename(path)}` };
  }
  // The holder is the root itself for most studies, so standing still is not going outside.
  const walked = relative(real, holder);
  if (climbs(walked) || isAbsolute(walked)) {
    return { problem: `${path} leads outside ${root}` };
  }
  const settled = join(holder, basename(target));
  let standing;
  try {
    standing = lstatSync(settled, { throwIfNoEntry: false });
  } catch {
    // Only a missing one is quiet; a name too long, a file where a directory was wanted or a
    // byte that cannot be in a name are all answers about the path, not faults to throw.
    return { problem: `${path} is not a name this server can use` };
  }
  if (standing?.isSymbolicLink()) {
    return { problem: `${path} is a link, and a study is neither written nor read through one` };
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
    // Written beside where it is going and moved into place: a rename replaces the name rather
    // than the file it stands for, so a link or a second hard link already sitting there keeps
    // whatever it pointed at, and a study that fails half way through leaves nothing behind.
    write: (path, text) => {
      const settled = guard(path);
      // This name is new, so it has no resolved form to be judged within: nothing above can
      // vouch for it. Hence a name nobody can guess, and `wx`, which refuses rather than
      // follows if anything is already sitting there — a planted link included.
      const temp = join(dirname(settled), `.tachisto-${randomUUID()}.part`);
      // What a study replaces lends it its reach, so one that was kept close stays close. Only
      // the read and write bits travel, and only as far as a study written where there was none
      // would reach anyway, so this never opens one up and nothing else rides along. Set as it
      // is created rather than after, or the contents would sit there open for the moment in
      // between.
      // lstat, not stat: this is the last look at a name the guard has already judged, and
      // between the two a link could have been put there. A link's own mode is not a study's
      // to inherit, and following it would take the reach of a file outside the root.
      const had = lstatSync(settled, { throwIfNoEntry: false });
      const reach = ((had?.isSymbolicLink() ? undefined : had?.mode) ?? REACH) & REACH;
      try {
        writeFileSync(temp, text, { encoding: "utf8", flag: "wx", mode: reach });
        renameSync(temp, settled);
      } catch (error) {
        // Whatever went wrong is the thing worth reporting, so clearing up must not speak over
        // it: a plant at this name is told by the error from the write, not by the tidying.
        try {
          rmSync(temp, { force: true });
        } catch {
          // Nothing to say: the error below is the one that matters.
        }
        throw error;
      }
    },
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
