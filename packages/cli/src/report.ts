import { isError } from "@tachisto/compiler";
import type { Problem } from "@tachisto/compiler";
import type { Outcome } from "./outcome.ts";
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
  problems: Problem[];
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

const counted = (problems: Problem[], severity: "error" | "warning") =>
  problems.filter((problem) => (severity === "error" ? isError(problem) : !isError(problem)));

/** Where a problem is, in the words the builder uses for a step's place in the timeline. */
const at = (problem: Problem) =>
  problem.path === undefined ? "" : ` (step ${problem.path.map((index) => index + 1).join(".")})`;

export function payloadOf(outcome: Outcome, versions: Versions): Payload {
  const { command, status, problems, ...rest } = outcome;
  return { ...versions, command, ok: status === "ok", ...rest, problems };
}

function lines(outcome: Outcome): { stdout: string[]; stderr: string[] } {
  const warnings = counted(outcome.problems, "warning");
  const errors = counted(outcome.problems, "error");
  const stderr = [
    ...warnings.map((problem) => `warning: ${problem.message}${at(problem)}`),
    ...errors.map((problem) => `error: ${problem.message}${at(problem)}`),
  ];
  const subject = outcome.name ?? outcome.spec ?? outcome.command;
  if (outcome.status !== "ok") return { stdout: [], stderr };
  if (outcome.command === "compile") {
    return {
      stdout: [`${subject}: ${outcome.plugins?.length} plugin(s) -> ${outcome.output}`],
      stderr,
    };
  }
  if (outcome.command === "schema") {
    return { stdout: [`spec schema -> ${outcome.output}`], stderr };
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
  const joined = (text: string[]) =>
    text.length === 0 ? "" : `${text.filter(Boolean).join("\n")}\n`;
  return { stdout: joined(stdout), stderr: joined(stderr), exitCode };
}
