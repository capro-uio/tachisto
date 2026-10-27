/**
 * What another package may build on. Argument parsing, exit statuses and terminal prose stay
 * inside the command line, which is the only thing that has a terminal.
 */
export { compile, nodeFiles, validate, type Files } from "./commands.ts";
export { unreadableOutcome, type Located, type Outcome, type Status } from "./outcome.ts";
export { payloadOf, problemLine, type Payload } from "./report.ts";
