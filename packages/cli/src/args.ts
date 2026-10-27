/** What the command line was asked to do, or why it could not be read. */
export type Invocation =
  | { command: "validate" | "compile"; specPath: string; options: Options }
  | { command: "schema"; options: Options }
  | { command: "help" }
  | { command: "unreadable"; message: string };

export interface Options {
  /** Report as one JSON object on stdout rather than as lines for a person to read. */
  json: boolean;
  out?: string;
  base?: string;
}

export const USAGE = `usage: tachisto validate <spec.json> [--json]
       tachisto compile <spec.json> [--out <file>] [--base cdn|<path>] [--json]
       tachisto schema [--out <file>]

Exit status: 0 nothing wrong, 1 the spec has errors, 2 the command could not be read,
             70 something went wrong inside Tachisto.`;

const TAKES_VALUE = new Set(["out", "base"]);
const SPEC_COMMANDS = new Set(["validate", "compile"]);

const unreadable = (message: string): Invocation => ({ command: "unreadable", message });

/** Reads argv without acting on it, so what the command line accepts can be tested on its own. */
export function parseArgs(argv: string[]): Invocation {
  const [command, ...rest] = argv;
  if (command === undefined || command === "--help" || command === "-h") return { command: "help" };
  if (!SPEC_COMMANDS.has(command) && command !== "schema") {
    return unreadable(`unknown command "${command}"`);
  }

  const options: Options = { json: false };
  const files: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith("--")) {
      // A single dash is nobody's file name, and reading it as one hides the mistake.
      if (arg.startsWith("-") && arg !== "-") return unreadable(`unknown option "${arg}"`);
      files.push(arg);
      continue;
    }
    const [name, attached] = arg.slice(2).split(/=(.*)/s, 2);
    if (name === "json") {
      // `--json=yes` names an option that exists, so saying it does not would be a lie.
      if (attached !== undefined) return unreadable("--json takes no value");
      options.json = true;
      continue;
    }
    if (!TAKES_VALUE.has(name)) return unreadable(`unknown option "--${name}"`);
    if (attached !== undefined) {
      if (attached === "") return unreadable(`--${name} needs a value`);
      options[name as "out" | "base"] = attached;
      continue;
    }
    const value = rest[index + 1];
    // A missing value would otherwise swallow the next flag and read as a file name.
    if (value === undefined || value.startsWith("--")) return unreadable(`--${name} needs a value`);
    options[name as "out" | "base"] = value;
    index += 1;
  }

  if (command === "schema") {
    if (files.length > 0) return unreadable(`schema takes no spec file, got "${files[0]}"`);
    // The schema is already JSON; there is no envelope to put it in, so the flag would do nothing.
    if (options.json) return unreadable("schema does not take --json; its answer is JSON already");
    return { command: "schema", options };
  }
  if (files.length === 0) return unreadable(`${command} needs a spec file`);
  if (files.length > 1) return unreadable(`${command} takes one spec file, got ${files.length}`);
  return { command: command as "validate" | "compile", specPath: files[0], options };
}
