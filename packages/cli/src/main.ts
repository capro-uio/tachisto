#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { loadBundle } from "@tachisto/schemas/bundle";
import manifest from "../package.json" with { type: "json" };
import { parseArgs, USAGE } from "./args.ts";
import { compile, specSchemaDocument, validate, type Files } from "./commands.ts";
import { reportOf } from "./report.ts";
import { EXIT_BROKEN, EXIT_CODES } from "./outcome.ts";

const files: Files = {
  read: (path) => readFileSync(path, "utf8"),
  write: (path, text) => writeFileSync(path, text),
};

/**
 * Written, never exited on. `process.exit` discards whatever of stdout has not drained, and a
 * pipe drains asynchronously — exiting after writing the 533 kB spec schema handed the reader
 * 128 kB of it and a success. Setting the code lets Node leave once the writes are through.
 */
function leave(code: number) {
  process.exitCode = code;
}

/** Thrown to leave the work behind once the status and the reason are already written. */
class Leave extends Error {}

const invocation = parseArgs(process.argv.slice(2));

if (invocation.command === "help") {
  process.stdout.write(`${USAGE}\n`);
  leave(0);
} else if (invocation.command === "unreadable") {
  process.stderr.write(`${invocation.message}\n\n${USAGE}\n`);
  leave(EXIT_CODES.unreadable);
} else {
  const bundle = loadBundle();
  const versions = { tachisto: manifest.version, jspsych: bundle.jspsych };
  // Everything the commands can throw that is not a spec problem is a fault here, and exiting 1
  // for it would tell a caller their experiment is wrong.
  try {
    if (invocation.command === "schema") {
      const { out } = invocation.options;
      if (out === undefined) {
        process.stdout.write(specSchemaDocument());
        leave(0);
      } else {
        // A path that cannot be written to is the caller's input, as a missing spec file is.
        try {
          files.write(out, specSchemaDocument());
        } catch (error) {
          process.stderr.write(`${out}: ${(error as Error).message}\n`);
          leave(EXIT_CODES.unreadable);
          throw new Leave();
        }
        process.stdout.write(`spec schema -> ${out}\n`);
        leave(0);
      }
    } else {
      const outcome =
        invocation.command === "validate"
          ? validate(invocation.specPath, files, bundle)
          : await compile(invocation.specPath, invocation.options, files, bundle);
      const report = reportOf(outcome, versions, invocation.options.json);
      if (report.stderr) process.stderr.write(report.stderr);
      if (report.stdout) process.stdout.write(report.stdout);
      leave(report.exitCode);
    }
  } catch (error) {
    if (!(error instanceof Leave)) {
      process.stderr.write(`tachisto: ${(error as Error).message}\n`);
      leave(EXIT_BROKEN);
    }
  }
}
