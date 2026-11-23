import manifest from "../package.json" with { type: "json" };
import { orderColumn } from "./counterbalance.ts";
import { ENDING_COLUMN } from "./data.ts";
import { groupColumn } from "./groups.ts";
import { linkParamsOf, needsParticipantId } from "./recruitment.ts";
import { walkNodes } from "./variables.ts";
import { EXCLUDED_COLUMN } from "./exclusions.ts";
import type { Author, Spec } from "./types.ts";

/** The version every workspace carries until a release sets a real one. */
const UNRELEASED = "0.0.0";

export const GENERATOR = "Tachisto";
export const GENERATOR_URL = "https://github.com/capro-uio/tachisto";

/**
 * Tachisto's concept DOI, which always resolves to the newest release.
 *
 * The concept rather than a version DOI, because Zenodo mints a release's own DOI only once the
 * GitHub release is published — after the code being compiled here was built, so a build cannot
 * know its own. Together with `softwareVersion` this still names one release exactly, which is
 * what a methods section needs.
 *
 * Pinned against codemeta.json by a test, so the two cannot drift.
 */
export const GENERATOR_DOI = "https://doi.org/10.5281/zenodo.23669791";
export const JSPSYCH_URL = "https://www.jspsych.org/";

/**
 * Which Tachisto produced the output, or undefined until the first release. The workspaces sit at
 * 0.0.0 before then, and a dataset claiming to come from "Tachisto 0.0.0" identifies
 * nothing; provenance leaves the version out while that is true and starts carrying it the moment
 * a release bumps the manifest.
 */
export const GENERATOR_VERSION: string | undefined =
  manifest.version === UNRELEASED ? undefined : manifest.version;

/** The generator as people and parsers should see it: "Tachisto 1.2.0", or the bare name. */
export function generatorLabel(version = GENERATOR_VERSION) {
  return version ? `${GENERATOR} ${version}` : GENERATOR;
}

/** Columns jsPsych writes for every trial, whatever the experiment does. */
const ALWAYS_RECORDED = ["trial_type", "trial_index", "time_elapsed", "plugin_version"];

/**
 * The columns this experiment's data will have. Psych-DS asks for every variable in the dataset:
 * each plugin the experiment runs declares the columns it writes, and the spec says which ones the
 * experiment adds of its own.
 */
export function dataColumns(spec: Spec, recorded: Iterable<string>): string[] {
  const columns = new Set([...ALWAYS_RECORDED, ...recorded]);
  if (needsParticipantId(spec)) {
    columns.add("participant_id");
    columns.add("experiment");
    for (const param of linkParamsOf(spec.recruitment)) columns.add(param);
  }

  walkNodes(spec.timeline, (node) => {
    if (node.kind === "trial") {
      if (node.tag) columns.add("tag");
      if (node.score) columns.add("correct");
      for (const field of Object.keys(node.record ?? {})) columns.add(field);
      if (node.exclusion_ending !== undefined) {
        columns.add(EXCLUDED_COLUMN);
        columns.add(ENDING_COLUMN);
      }
    }
    if (node.kind === "checkpoint") columns.add("checkpoint");
    if (node.kind === "end") columns.add(ENDING_COLUMN);
    if (node.kind === "assign") columns.add(groupColumn(node));
    if (node.kind === "counterbalance") columns.add(orderColumn(node));
  });
  return [...columns].sort();
}

/**
 * The columns a link parameter may not write, recorded under a prefix instead. The parameters the
 * platform sends, its participant's id among them, keep their own names.
 */
export function reservedLinkColumns(spec: Spec, columns: string[]) {
  const linkParams = new Set(linkParamsOf(spec.recruitment));
  return columns.filter((column) => !linkParams.has(column));
}

export interface MetadataOptions {
  /** When the files were produced; given explicitly so output can be reproduced. */
  generatedAt?: string;
  jspsych: string;
  /** Which Tachisto built it; defaults to this build's own version. */
  tachisto?: string;
}

/** The authors who have given a name; a row left blank in the builder names no one. */
export function namedAuthors(spec: Spec) {
  return (spec.authors ?? []).filter((author) => author.name.trim());
}

/** An author's affiliation, or undefined when it is missing, blank or not text. */
export function affiliationOf(author: Author) {
  const affiliation: unknown = author.affiliation;
  return (typeof affiliation === "string" && affiliation.trim()) || undefined;
}

function person(author: Author) {
  const affiliation = affiliationOf(author);
  return {
    "@type": "Person",
    name: author.name,
    ...(author.identifier ? { identifier: author.identifier } : {}),
    ...(affiliation ? { affiliation: { "@type": "Organization", name: affiliation } } : {}),
  };
}

/** One sentence saying what the data is, wherever the dataset is described. */
export function datasetSummary(spec: Spec) {
  return `Behavioural data from "${spec.name}", an experiment built with ${GENERATOR}.`;
}

/** Psych-DS metadata, so the data arrives described rather than as a bare CSV. */
export function datasetDescription(spec: Spec, columns: string[], options: MetadataOptions) {
  const authors = namedAuthors(spec);
  const tachisto = options.tachisto ?? GENERATOR_VERSION;
  return {
    "@context": "https://schema.org/",
    "@type": "Dataset",
    name: spec.name,
    description: datasetSummary(spec),
    variableMeasured: columns,
    dateCreated: options.generatedAt ?? new Date().toISOString().slice(0, 10),
    // The people who made the experiment. Software belongs under isBasedOn, not here: author and
    // producer mean a person or an organisation, and a tool is neither.
    ...(authors.length > 0 ? { author: authors.map(person) } : {}),
    // Both tools, in the order they acted: Tachisto generated the experiment, jsPsych ran it and
    // wrote the rows. Each carries its version, so a dataset says what produced it.
    isBasedOn: [
      {
        "@type": "SoftwareApplication",
        name: GENERATOR,
        url: GENERATOR_URL,
        identifier: GENERATOR_DOI,
        ...(tachisto ? { softwareVersion: tachisto } : {}),
      },
      {
        "@type": "SoftwareApplication",
        name: "jsPsych",
        url: JSPSYCH_URL,
        softwareVersion: options.jspsych,
      },
    ],
  };
}

export type DatasetDescription = ReturnType<typeof datasetDescription>;

// The name sits inside a block comment, which a `*/` in it would end early.
function commentSafe(text: string) {
  return text.replace(/\*\//g, "* /").replace(/\s+/g, " ");
}

/** A note at the top of the generated experiment saying where it came from. */
export function sourceHeader(spec: Spec, options: MetadataOptions) {
  const date = options.generatedAt ?? new Date().toISOString().slice(0, 10);
  return (
    `/*\n` +
    ` * ${commentSafe(spec.name)}\n` +
    ` *\n` +
    ` * Built with ${generatorLabel(options.tachisto)} on ${date}, for jsPsych ${options.jspsych}.\n` +
    ` * ${GENERATOR_URL}\n` +
    ` * Cite the tool: ${GENERATOR_DOI}\n` +
    ` *\n` +
    ` * This file is generated from experiment.json. Open that file in the builder to keep\n` +
    ` * editing there, or edit this file directly and keep it as the experiment from now on.\n` +
    ` */\n\n`
  );
}
