#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { format, resolveConfig } from "prettier";
import { fileURLToPath } from "node:url";
// The repository's own extraction, imported as source: it is not published, because it needs
// every jsPsych plugin installed.
import { extractBundle } from "../../schemas/src/extract.ts";
import manifest from "../package.json" with { type: "json" };
import { citationCff, toYaml, zenodoMetadata } from "./citation.ts";
import { updateCodemeta, type Codemeta, type PackageManifest } from "./codemeta.ts";
import { specSchema } from "./spec-schema.ts";

function optionValue(name: string, fallback: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const [command] = process.argv.slice(2);

// Regenerating the files this repository commits. Compiling a spec is `tachisto`, from
// @tachisto/cli, which needs none of the plugin packages this does.
if (!["schema", "codemeta"].includes(command)) {
  console.error(
    "usage: node src/cli.ts schema [--out <file>]\n" +
      "       node src/cli.ts codemeta [--out <file>]",
  );
  process.exit(2);
}

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
