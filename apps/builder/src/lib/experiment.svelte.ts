import {
  assertFitsInOnePage,
  compileSpec,
  emitHtml,
  projectFiles,
  type Spec,
} from "tachisto-compiler";
import { zipSync, strToU8 } from "fflate";
import { flowFigure } from "./flow-figure.ts";
import { fetchPackageSources } from "./package-sources.ts";
import { exportedSpec } from "./project.svelte.ts";
import { pluginSchema, schemas } from "./schemas.ts";
import type { captureScreens } from "./screen-capture.ts";
import { blockKey, type FigureChoicesState } from "./figure-choices.svelte.ts";
import { figureName, makeFigure, NO_CONDITIONS } from "./figure-making.ts";
import { containerPaths, sequenceAt, type Sequence } from "./sequence.ts";

export interface DownloadOptions {
  /** Carry jsPsych and its plugins in the download rather than loading them from unpkg. */
  selfContained: boolean;
}

export interface ProjectDownloadOptions extends DownloadOptions, StudyFigureOptions {}

/** The experiment as a single file, built on demand rather than kept in step with every edit. */
export async function buildExperimentHtml({ selfContained }: DownloadOptions) {
  const spec = exportedSpec();
  const compiled = compileSpec(spec, schemas);
  if (selfContained) assertFitsInOnePage(compiled);
  const inline = selfContained ? await fetchPackageSources(compiled.files) : undefined;
  const { html } = await emitHtml(compiled, { title: spec.name, inline });
  return html;
}

/**
 * Picturing every block's screens shares one deadline, so a study with many blocks, or one whose
 * jsPsych cannot be reached, cannot hold up its download for long.
 */
const FIGURES_DEADLINE = 60_000;

export interface FigureProgress {
  done: number;
  total: number;
}

export interface StudyFigureOptions {
  /** How each block's screens are pictured; the hidden capture frame by default. */
  capture?: typeof captureScreens;
  onProgress?: (progress: FigureProgress) => void;
  /** How the figures are made, as chosen in the Figures view; stacked, as drawn, SVG otherwise. */
  choices?: FigureChoicesState;
  /** Draws a figure as a PNG, when PNGs are chosen; the browser's canvas by default. */
  toPng?: (svg: string, pixelWidth: number) => Promise<Blob>;
}

const PLAIN_CHOICES: FigureChoicesState = {
  arrangement: "stack",
  size: "screen",
  format: "svg",
  blocks: {},
};

/**
 * The figures that describe a study in a paper: its flow, and each block and loop as screens, as
 * the participant sees them, made as chosen in the Figures view and named after the block's
 * conditions or the loop. Each is an SVG, and a PNG beside it when PNGs are chosen. Each figure
 * stands alone: one whose screens cannot be pictured is drawn with plain screens, and one that
 * cannot be drawn is left out rather than costing the rest.
 */
export async function studyFigures(
  spec: Spec,
  { capture, onProgress, choices = PLAIN_CHOICES, toPng }: StudyFigureOptions = {},
) {
  const flow = flowFigure(spec, choices.size);
  const figures: Record<string, string | Uint8Array> = { "flow.svg": flow.svg };
  const sequences = containerPaths(spec.timeline)
    .map((path) => sequenceAt(spec, path, pluginSchema))
    .filter((sequence): sequence is Sequence => sequence !== null && sequence.segments.length > 0);
  let pictureScreens: typeof captureScreens | null =
    capture ??
    (await import("./screen-capture.ts").then(
      (module) => module.captureScreens,
      () => null,
    ));
  // Not one screen pictured means the study could not run, as when jsPsych cannot be reached;
  // the blocks after it would only wait as long, so they are drawn plain.
  const watched: typeof captureScreens = async (...args) => {
    if (!pictureScreens) return [];
    const pictures = await pictureScreens(...args);
    if (!pictures.some(Boolean)) pictureScreens = null;
    return pictures;
  };
  const drawPng = toPng ?? (await import("./figure-png.ts")).figurePng;
  if (choices.format === "png") {
    try {
      const png = await drawPng(flow.svg, flow.pixelWidth);
      figures["flow.png"] = new Uint8Array(await png.arrayBuffer());
    } catch {
      // The flow's SVG is carried whatever happens to its PNG.
    }
  }
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), FIGURES_DEADLINE);
  try {
    for (const [index, sequence] of sequences.entries()) {
      onProgress?.({ done: index, total: sequences.length });
      try {
        const made = await makeFigure(
          spec,
          sequence,
          choices,
          choices.blocks[blockKey(spec, sequence.path)] ?? NO_CONDITIONS,
          {
            capture: pictureScreens && !deadline.signal.aborted ? watched : undefined,
            signal: deadline.signal,
          },
        );
        const base = figureName(spec, sequence);
        const name = `${base}.svg` in figures ? `${base}-${sequence.path.join("-")}` : base;
        figures[`${name}.svg`] = made.svg;
        if (choices.format === "png") {
          const png = await drawPng(made.svg, made.pixelWidth);
          figures[`${name}.png`] = new Uint8Array(await png.arrayBuffer());
        }
      } catch {
        // A figure that cannot be drawn is left out; the download is worth more than it.
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return figures;
}

/**
 * Everything needed to host the experiment, as a zip: page, source, media, project file, readme,
 * the figures that describe it in a paper, and, when self-contained, jsPsych and its plugins.
 */
export async function buildProjectZip({ selfContained, ...figureOptions }: ProjectDownloadOptions) {
  // A plain copy, not the builder's live state: picturing the screens copies the study into a
  // run of its own, which live state cannot be.
  const spec = $state.snapshot(exportedSpec());
  const files = await projectFiles(spec, schemas, {
    figures: await studyFigures(spec, figureOptions),
    packageSources: selfContained ? (needed) => fetchPackageSources(needed) : undefined,
  });
  const entries = Object.fromEntries(
    Object.entries(files).map(([path, contents]) => [
      path,
      typeof contents === "string" ? strToU8(contents) : contents,
    ]),
  );
  return zipSync(entries, { level: 6 });
}
