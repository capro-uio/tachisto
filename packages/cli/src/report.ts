import { isError } from "@tachisto/compiler";
import type { Located, Outcome } from "./outcome.ts";
import { EXIT_CODES } from "./outcome.ts";

/**
 * What a command prints as JSON. This is the shape other programs read, so a field is added
 * rather than renamed or repurposed, and every command answers with the same envelope.
 */
export interface Payload {
  tachisto: string;
  jspsych: string;
  command: Outcome["command"];
  ok: boolean;
  spec?: string;
  name?: string;
  output?: string;
  plugins?: string[];
  problems: Located[];
}

export interface Versions {
  tachisto: string;
  jspsych: string;
}

export interface Report {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** One problem as a line, with where it is when that is known. Shared, so nothing else writes
 *  its own wording for the same thing. */
export const problemLine = (problem: Located) =>
  `${problem.severity}: ${problem.message}${problem.place ? ` (${problem.place})` : ""}`;

export function payloadOf(outcome: Outcome, versions: Versions): Payload {
  const { command, status, problems, ...rest } = outcome;
  return { ...versions, command, ok: status === "ok", ...rest, problems };
}

function lines(outcome: Outcome): { stdout: string[]; stderr: string[] } {
  const warnings = outcome.problems.filter((problem) => !isError(problem));
  const errors = outcome.problems.filter(isError);
  const stderr = [...warnings, ...errors].map(problemLine);
  const subject = outcome.name ?? outcome.command;
  if (outcome.status !== "ok") return { stdout: [], stderr };
  if (outcome.command === "compile") {
    return {
      stdout: [`${subject}: ${outcome.plugins?.length} plugin(s) -> ${outcome.output}`],
      stderr,
    };
  }
  const summary = warnings.length === 0 ? "nothing to report" : `${warnings.length} warning(s)`;
  return { stdout: [`${subject}: ${summary}`], stderr };
}

/** The whole of what a command writes and the status it leaves behind. */
export function reportOf(outcome: Outcome, versions: Versions, json: boolean): Report {
  const exitCode = EXIT_CODES[outcome.status];
  if (json) {
    return {
      stdout: `${JSON.stringify(payloadOf(outcome, versions), null, 2)}\n`,
      stderr: "",
      exitCode,
    };
  }
  const { stdout, stderr } = lines(outcome);
  const joined = (text: string[]) => (text.length === 0 ? "" : `${text.join("\n")}\n`);
  return { stdout: joined(stdout), stderr: joined(stderr), exitCode };
}
