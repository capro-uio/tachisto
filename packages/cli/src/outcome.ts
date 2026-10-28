import type { Problem } from "@tachisto/compiler";

/** A problem with where it is in words, which needs the spec the path points into. */
export interface Located extends Problem {
  place?: string;
}

/**
 * How a command ended. `unreadable` is kept apart from `invalid` because they mean different
 * things to whoever called: an unreadable spec never reached the validator, so its problems say
 * nothing about the experiment.
 */
export type Status = "ok" | "invalid" | "unreadable";

export interface Outcome {
  command: "validate" | "compile";
  status: Status;
  problems: Located[];
  /** The spec file as it was named on the command line, not resolved. */
  spec?: string;
  name?: string;
  output?: string;
  plugins?: string[];
}

export const EXIT_CODES: Record<Status, number> = { ok: 0, invalid: 1, unreadable: 2 };

/** Something went wrong inside Tachisto, which is a different thing from a spec being wrong. */
export const EXIT_BROKEN = 70;

export const unreadableOutcome = (
  command: Outcome["command"],
  message: string,
  spec?: string,
): Outcome => ({
  command,
  status: "unreadable",
  problems: [{ message, severity: "error" }],
  ...(spec === undefined ? {} : { spec }),
});
