#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { format, resolveConfig } from "prettier";
import { fileURLToPath } from "node:url";
import { extractBundle, loadBundle } from "@tachisto/schemas";
import manifest from "../package.json" with { type: "json" };
import { citationCff, toYaml, zenodoMetadata } from "./citation.ts";
import { updateCodemeta, type Codemeta, type PackageManifest } from "./codemeta.ts";
import { compileReport } from "./cli-report.ts";
import { compileSpec } from "./compile.ts";
import { emitHtml } from "./targets/html.ts";
import { specSchema } from "./spec-schema.ts";
import { SpecError } from "./validate.ts";
import type { Spec } from "./types.ts";

function optionValue(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const [command, specPath] = process.argv.slice(2);

if (!["compile", "schema", "codemeta"].includes(command) || (command === "compile" && !specPath)) {
  console.error(
    "usage: tachisto compile <spec.json> [--out <file>] [--base <cdn|path>]\n" +
      "       tachisto schema [--out <file>]\n" +
      "       tachisto codemeta [--out <file>]",
  );
  process.exit(2);
}

// `schema` and `codemeta` regenerate files from the plugins installed here, so they extract
// afresh. Compiling reads the schemas shipped with the package instead, which is all an installed
// copy has: extraction imports all 49 plugin packages, and no consumer should need them.
if (command === "schema") {
  const { bundle: schemas, report } = await extractBundle();
  const outputPath = optionValue(
    "out",
    fileURLToPath(new URL("../spec-schema.json", import.meta.url)),
  );
  writeFileSync(outputPath, `${JSON.stringify(specSchema(schemas.plugins), null, 2)}\n`);
  const count = Object.keys(schemas.plugins).length;
  console.log(`spec schema for jsPsych ${report.jspsych}, ${count} plugin(s) -> ${outputPath}`);
  process.exit(0);
}

if (command === "codemeta") {
  const { report } = await extractBundle();
  const outputPath = optionValue(
    "out",
    fileURLToPath(new URL("../../../codemeta.json", import.meta.url)),
  );
  const repositoryManifest = fileURLToPath(new URL("../../../package.json", import.meta.url));
  const updated = updateCodemeta(
    JSON.parse(readFileSync(outputPath, "utf8")) as Codemeta,
    JSON.parse(readFileSync(repositoryManifest, "utf8")) as PackageManifest,
    {
      version: manifest.version,
      jspsych: report.jspsych,
      date: new Date().toISOString().slice(0, 10),
    },
  );
  const citationPath = join(dirname(outputPath), "CITATION.cff");
  const zenodoPath = join(dirname(outputPath), ".zenodo.json");
  // Formatted as the repository formats it, so a regeneration diffs only where something changed.
  const writeFormatted = async (path: string, text: string) => {
    const options = { ...(await resolveConfig(path)), filepath: path };
    writeFileSync(path, await format(text, options));
  };
  await writeFormatted(outputPath, JSON.stringify(updated));
  await writeFormatted(citationPath, toYaml(citationCff(updated)));
  await writeFormatted(zenodoPath, JSON.stringify(zenodoMetadata(updated)));
  console.log(
    `codemeta, citation and Zenodo metadata for Tachisto ${manifest.version} -> ` +
      [outputPath, citationPath, zenodoPath].join(", "),
  );
  process.exit(0);
}

const schemas = loadBundle();
const spec = JSON.parse(readFileSync(specPath, "utf8")) as Spec;

try {
  const result = compileSpec(spec, schemas);
  const { html } = await emitHtml(result, { title: spec.name, base: optionValue("base", "cdn") });
  const outputPath = optionValue("out", `${basename(specPath, ".json")}.html`);
  writeFileSync(outputPath, html);
  const report = compileReport(spec.name, result, outputPath);
  for (const warning of report.warnings) console.warn(warning);
  console.log(report.summary);
} catch (error) {
  if (!(error instanceof SpecError)) throw error;
  console.error(error.message);
  process.exit(1);
}
