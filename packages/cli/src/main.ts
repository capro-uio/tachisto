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

const invocation = parseArgs(process.argv.slice(2));

if (invocation.command === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (invocation.command === "unreadable") {
  console.error(`${invocation.message}\n\n${USAGE}`);
  process.exit(EXIT_CODES.unreadable);
}

const bundle = loadBundle();
const versions = { tachisto: manifest.version, jspsych: bundle.jspsych };

if (invocation.command === "schema") {
  const { out } = invocation.options;
  if (out === undefined) {
    process.stdout.write(specSchemaDocument());
  } else {
    files.write(out, specSchemaDocument());
    const report = reportOf(
      { command: "schema", status: "ok", problems: [], output: out },
      versions,
      invocation.options.json,
    );
    process.stdout.write(report.stdout);
  }
  process.exit(0);
}

// Anything the compiler throws that is not a spec problem is a fault here, not in the spec, and
// exiting 1 for it would tell a caller the experiment is wrong.
let report;
try {
  const outcome =
    invocation.command === "validate"
      ? validate(invocation.specPath, files, bundle)
      : await compile(invocation.specPath, invocation.options, files, bundle);
  report = reportOf(outcome, versions, invocation.options.json);
} catch (error) {
  console.error(`tachisto: ${(error as Error).message}`);
  process.exit(EXIT_BROKEN);
}
if (report.stderr) process.stderr.write(report.stderr);
if (report.stdout) process.stdout.write(report.stdout);
process.exit(report.exitCode);
