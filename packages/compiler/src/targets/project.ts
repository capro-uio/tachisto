import type { SchemaBundle } from "tachisto-schemas";
import { assetPath } from "../assets.ts";
import { compileSpec } from "../compile.ts";
import { ENDING_COLUMN, ownDataPipeAddress } from "../data.ts";
import { dataPipeSetupMarkdown } from "../datapipe-setup.ts";
import {
  completionUrlOf,
  earlyEndingNames,
  endingOf,
  idParamOf,
  retentionOf,
  sampleSizeOf,
} from "../recruitment.ts";
import { formatSource } from "../format.ts";
import {
  datasetDescription,
  GENERATOR_DOI,
  generatorLabel,
  sourceHeader,
  type MetadataOptions,
} from "../metadata.ts";
import { packageFileKey, thirdPartyNotice, type PackageFile } from "../package-files.ts";
import { emitHtml, filesLoadedWhileRunning } from "./html.ts";
import type { RecruitmentSettings, Retention, Spec } from "../types.ts";

export type ProjectFile = string | Uint8Array;

const SOURCE_FILE = "experiment.js";
const PROJECT_FILE = "experiment.json";
const METADATA_FILE = "dataset_description.json";
const FIGURES_DIR = "figures";
const PACKAGES_DIR = "lib";
const NOTICE_FILE = "THIRD-PARTY.md";
const DATAPIPE_SETUP_FILE = "DATAPIPE-SETUP.md";

export interface ProjectOptions extends Partial<MetadataOptions> {
  /** Figures of the study by file name, such as the builder's flow diagram, saved under figures/. */
  figures?: Record<string, ProjectFile>;
  /**
   * Gets copies of the files the study loads from jsPsych and its plugins, keyed by
   * {@link packageFileKey}, so the download carries them under lib/ and loads nothing from
   * elsewhere. It is asked once the study is compiled, for exactly the files it needs.
   */
  packageSources?: (files: PackageFile[]) => Promise<Record<string, ProjectFile>>;
}

function decodeDataUrl(url: string) {
  const comma = url.indexOf(",");
  const header = url.slice(0, comma);
  const body = url.slice(comma + 1);
  if (!header.includes(";base64")) return new TextEncoder().encode(decodeURIComponent(body));
  const binary = atob(body);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function figuresLine(names: string[]) {
  if (names.length === 0) return "";
  const listed = names.map((name) => `\`${name}\``).join(", ");
  return `- \`${FIGURES_DIR}/\` — figures of the study for a paper or poster: ${listed}\n`;
}

function packagesLine(selfContained: boolean) {
  return selfContained
    ? `- \`${PACKAGES_DIR}/\` — jsPsych and the plugins this study uses, so it loads nothing from elsewhere; \`${PACKAGES_DIR}/${NOTICE_FILE}\` lists them with their licences\n`
    : "";
}

function runningNote(selfContained: boolean, loadsFilesWhileRunning: boolean) {
  if (!selfContained) {
    return "jsPsych and its plugins load from unpkg.com at the versions this study was built with.";
  }
  const online =
    "It carries its own copy of jsPsych and its plugins, so it runs without internet; only " +
    "sending results to a server or participants back to a recruitment platform needs a connection.";
  return loadsFilesWhileRunning
    ? `${online} Eye tracking loads its model from \`${PACKAGES_DIR}/\` as it starts, which a browser ` +
        "only allows over a web server: to try it on this computer, serve the folder locally, " +
        "for example with `python3 -m http.server`, rather than opening the file."
    : online;
}

const STREAMING_NOTE =
  " Each step's row is also sent to DataPipe as soon as it is recorded, so a participant who " +
  "closes the page partway still leaves a partial file (`.partial.json`). Your consent form " +
  "should say that data from an unfinished session is kept.";

interface ReadmeContents {
  assetCount: number;
  figureNames: string[];
  selfContained: boolean;
  loadsFilesWhileRunning: boolean;
}

function readme(spec: Spec, contents: ReadmeContents, options: MetadataOptions) {
  const { assetCount, figureNames, selfContained, loadsFilesWhileRunning } = contents;
  return `# ${spec.name}

Built with ${generatorLabel(options.tachisto)}.

Cite the tool in a methods section: ${GENERATOR_DOI}

## Running it

Open \`index.html\` in a browser to try it on this computer. To collect data, put
these files on any web host — a university server, GitHub Pages, or whatever your
department uses — and give participants the address.

${runningNote(selfContained, loadsFilesWhileRunning)}

## What is here

- \`index.html\` — the page participants open
- \`${SOURCE_FILE}\` — the experiment itself, as jsPsych. Yours to read and change
- \`${PROJECT_FILE}\` — the project file; open this in the builder to keep editing
- \`${METADATA_FILE}\` — what the data will contain, in [Psych-DS](https://psych-ds.github.io/) form
${assetCount > 0 ? `- \`assets/\` — the ${assetCount} file(s) the experiment shows\n` : ""}${figuresLine(figureNames)}${packagesLine(selfContained)}
## Where the data goes

${
  spec.data?.save === "post"
    ? `Results are uploaded to ${ownDataPipeAddress(spec.data) ?? "DataPipe"} under the experiment id \`${spec.data.experiment_id}\`. If an upload fails, the participant is asked to download the file and send it to you.${spec.data.stream ? STREAMING_NOTE : ""}\n\n[\`${DATAPIPE_SETUP_FILE}\`](${DATAPIPE_SETUP_FILE}) says how to set up the experiment on DataPipe to match this study, before anyone takes part.`
    : spec.data?.save === "download"
      ? "Each participant's results download to their own computer at the end. You will need to collect those files from them."
      : "This experiment does not keep its results. Choose where data should go in the builder before recruiting anyone."
}
${recruitmentSection(spec)}`;
}

function recruitmentSection(spec: Spec) {
  const sampleSize = sampleSizeOf(spec);
  const paragraphs: string[] = [];
  if (sampleSize !== undefined) {
    const participants = sampleSize === 1 ? "participant" : "participants";
    paragraphs.push(`The study plans to recruit ${sampleSize} ${participants}.`);
  }
  if (spec.recruitment) paragraphs.push(participantIdNote(spec.recruitment));
  if (paragraphs.length === 0) return "";
  return `
## Recruiting

${paragraphs.join("\n\n")}
${earlyEndingsNote(spec)}`;
}

function participantIdNote(recruitment: RecruitmentSettings) {
  const url = completionUrlOf(recruitment);
  return `Each participant's id is read from the \`${idParamOf(recruitment)}\` parameter of the link they arrive by, and
recorded as \`participant_id\`. Without it they are given a random id.${
    url
      ? ` Once their data is uploaded they are sent to ${url}, or, if the upload fails, shown a link
to it once their file has downloaded.`
      : ""
  }`;
}

const KEPT: Record<Retention, string> = {
  all: "all their data is kept",
  checkpoint: "only that row is kept",
  nothing: "nothing is kept or sent",
};

// Whoever hosts the study has to be able to tell an ethics board what happens to a participant
// who leaves early, without reading the code.
function earlyEndingsNote(spec: Spec) {
  const early = earlyEndingNames(spec.recruitment);
  if (early.length === 0) return "";
  const kept = early.map((name) => {
    return `- \`${name}\`: ${KEPT[retentionOf(endingOf(spec.recruitment, name))]}\n`;
  });
  return (
    `\nThe study can also end early. A participant who does gets a row naming the ending in the ` +
    `\`${ENDING_COLUMN}\` column, and then:\n\n${kept.join("")}`
  );
}

/**
 * Everything needed to host the experiment: the page, the experiment as readable jsPsych, the
 * media as real files, and the project file so it can be opened again.
 */
export async function projectFiles(
  spec: Spec,
  bundle: SchemaBundle,
  { figures = {}, packageSources: gather, ...options }: ProjectOptions = {},
) {
  const compiled = compileSpec(spec, bundle, { assets: "files" });
  const metadata: MetadataOptions = { jspsych: compiled.jspsych, ...options };
  const packageSources = gather ? await gather(compiled.files) : undefined;
  const selfContained = packageSources !== undefined;
  const missing = packageSources
    ? compiled.files.map(packageFileKey).filter((key) => packageSources[key] === undefined)
    : [];
  if (missing.length > 0) {
    throw new Error(`no copy of ${missing.join(", ")} to carry in the download`);
  }
  const { html } = await emitHtml(compiled, {
    title: spec.name,
    sourceFile: SOURCE_FILE,
    tachisto: metadata.tachisto,
    ...(selfContained && { base: `./${PACKAGES_DIR}` }),
  });

  const files: Record<string, ProjectFile> = {
    "index.html": html,
    [SOURCE_FILE]: sourceHeader(spec, metadata) + (await formatSource(compiled.source)),
    [PROJECT_FILE]: `${JSON.stringify(spec, null, 2)}\n`,
    [METADATA_FILE]: `${JSON.stringify(datasetDescription(spec, compiled.columns, metadata), null, 2)}\n`,
    "README.md": readme(
      spec,
      {
        assetCount: spec.assets?.length ?? 0,
        figureNames: Object.keys(figures),
        selfContained,
        loadsFilesWhileRunning: filesLoadedWhileRunning(compiled).length > 0,
      },
      metadata,
    ),
  };

  if (spec.data?.save === "post") files[DATAPIPE_SETUP_FILE] = dataPipeSetupMarkdown(spec);

  if (packageSources) {
    for (const key of compiled.files.map(packageFileKey)) {
      files[`${PACKAGES_DIR}/${key}`] = packageSources[key];
    }
    files[`${PACKAGES_DIR}/${NOTICE_FILE}`] = thirdPartyNotice(compiled.files);
  }

  for (const [name, contents] of Object.entries(figures)) {
    files[`${FIGURES_DIR}/${name}`] = contents;
  }

  for (const asset of spec.assets ?? []) {
    files[assetPath(asset)] = decodeDataUrl(asset.url);
  }
  return files;
}
