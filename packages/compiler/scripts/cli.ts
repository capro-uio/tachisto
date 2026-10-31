#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import {
  askedVersion,
  bumpedManifests,
  optionValue,
  releaseNotes,
  versionDisagreements,
  versionFromTag,
  workspaceVersions,
} from "./release.ts";

/**
 * The checks and chores a release leans on. Kept apart from src/cli.ts, which reaches the plugin
 * schemas through packages that have to be built first: these commands run from a bare `npm ci`,
 * which is what the release workflow and the pull request check both have.
 */
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

const argv = process.argv.slice(2);
const [command] = argv;

if (!["versions", "notes", "bump"].includes(command)) {
  console.error(
    "usage: node scripts/cli.ts versions [--expect <version> | --tag <tag>]\n" +
      "       node scripts/cli.ts notes [--version <version> | --tag <tag>]\n" +
      "       node scripts/cli.ts bump --to <version>",
  );
  process.exit(2);
}

/** Stops with what went wrong, rather than with a stack trace a release log has to be read past. */
function fail(error: unknown, code: number): never {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(code);
}

/** The version the compiler's manifest carries, read as JSON so no build is needed. */
function thisVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as { version: string };
  return manifest.version;
}

/** A flag's value, or a one-line stop when it was given without one. */
function option(name: string) {
  try {
    return optionValue(argv, name);
  } catch (error) {
    fail(error, 2);
  }
}

/** The version a release is for, or a one-line stop when what was given does not name one. */
function version() {
  try {
    return askedVersion(argv);
  } catch (error) {
    fail(error, 2);
  }
}

if (command === "versions") {
  const workspaces = workspaceVersions(repositoryRoot);
  const problems = versionDisagreements(workspaces, version());
  if (problems.length > 0) {
    console.error(`${problems.length} workspace(s) disagree about the version:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`${workspaces.length} workspaces agree on ${workspaces[0].version}`);
  process.exit(0);
}

if (command === "notes") {
  // Defaults to the version this checkout carries, so the pull request check can run it bare.
  const asked = version() ?? thisVersion();
  const news = readFileSync(join(repositoryRoot, "NEWS.md"), "utf8");
  try {
    // To stdout alone, so a release workflow can take the body straight from it.
    console.log(releaseNotes(news, asked));
  } catch (error) {
    fail(error, 1);
  }
  process.exit(0);
}

if (command === "bump") {
  const to = option("to");
  if (to === undefined) fail("bump needs --to <version>", 2);
  // Checked as a tag would be, so a bump cannot set a version a release could not name.
  try {
    versionFromTag(`v${to}`);
  } catch {
    fail(`"${to}" is not a version; expected 1.2.3`, 2);
  }
  for (const [path, text] of bumpedManifests(repositoryRoot, to)) {
    const options = { ...(await resolveConfig(path)), filepath: path };
    writeFileSync(path, await format(text, options));
    console.log(`${path.slice(repositoryRoot.length)} -> ${to}`);
  }
  console.log("now run: npm install --package-lock-only && npm run codemeta");
  process.exit(0);
}
