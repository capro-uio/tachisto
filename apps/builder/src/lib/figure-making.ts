import type { Spec } from "tachisto-compiler";
import type { captureScreens } from "./screen-capture.ts";
import {
  conditionColumns,
  containerName,
  containerNode,
  segmentInputs,
  tableAt,
  type Sequence,
} from "./sequence.ts";
import type { ScreenPicture } from "./text-screen.ts";
import { sequenceFigure, varyingScreens, type FigureChoices } from "./trial-figure.ts";

/** What a block's figure shows of its conditions: a column to show side by side, or one row. */
export interface BlockChoice {
  /** The column whose conditions are shown side by side, or "" for none. */
  byColumn: string;
  /** The row pictured when no column is chosen. */
  row: number;
}

export const NO_CONDITIONS: BlockChoice = { byColumn: "", row: 0 };

export interface MadeFigure {
  svg: string;
  /** How many pixels wide a PNG of it should be. */
  pixelWidth: number;
  /** What the figure could not show that was asked of it, if anything. */
  note: string;
}

export interface MakingOptions {
  /** How the screens are pictured; without one, they are drawn plain. */
  capture?: typeof captureScreens;
  signal?: AbortSignal;
  /** Told which condition is being pictured, when there are several. */
  onProgress?: (message: string) => void;
}

const fileSafe = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "steps";

/** A figure's file name, without its extension: what it is and what it is called. */
export const figureName = (spec: Spec, sequence: Sequence) =>
  `${sequence.kind}-${fileSafe(containerName(spec, sequence.path))}`;

/**
 * A block's choice as it applies to the block now: a column it no longer divides into conditions
 * is set aside, and a row it no longer has becomes its first. What is shown, what is drawn and
 * what the download carries all read the choice through this, so they never disagree.
 */
export function resolveBlockChoice(spec: Spec, sequence: Sequence, choice: BlockChoice) {
  const columns = conditionColumns(spec, sequence.path);
  const table = tableAt(spec, sequence.path);
  const rows = table === null ? 0 : (spec.conditions?.[table]?.length ?? 0);
  return {
    byColumn: columns.some((each) => each.column === choice.byColumn) ? choice.byColumn : "",
    row: choice.row >= 0 && choice.row < rows ? choice.row : 0,
  };
}

/**
 * What a block's figure is made from: its own steps, its table, how the study looks and the
 * files it shows, and the choices it is made with. A picture taken from anything else is out of
 * date, and an edit elsewhere in the study leaves it as it is.
 */
export function figureStamp(
  spec: Spec,
  sequence: Sequence,
  choices: FigureChoices,
  block: BlockChoice,
) {
  const table = tableAt(spec, sequence.path);
  return JSON.stringify([
    containerNode(spec, sequence.path),
    table === null ? null : spec.conditions?.[table],
    spec.settings,
    spec.assets?.map((asset) => [asset.name, asset.url.length]),
    choices.arrangement,
    choices.size,
    resolveBlockChoice(spec, sequence, block),
  ]);
}

/**
 * A block's or loop's figure as chosen: pictured for the row asked, or once for each condition of
 * the column asked, with the screens that differ between them shown side by side. A choice the
 * block no longer has, such as a column since removed, is set aside. A screen that cannot be
 * pictured is drawn plain.
 */
export async function makeFigure(
  spec: Spec,
  sequence: Sequence,
  choices: FigureChoices,
  block: BlockChoice,
  { capture, signal, onProgress }: MakingOptions = {},
): Promise<MadeFigure> {
  const chosen = resolveBlockChoice(spec, sequence, block);
  const condition = conditionColumns(spec, sequence.path).find(
    (each) => each.column === chosen.byColumn,
  );
  const runs = condition ? condition.values : [{ value: "", row: chosen.row }];
  const pictured: (ScreenPicture | undefined)[][] = [];
  for (const [index, run] of runs.entries()) {
    if (condition) onProgress?.(`Picturing ${run.value}, ${index + 1} of ${runs.length}…`);
    const pictures = capture
      ? await capture(spec, sequence, { row: run.row, signal }).catch(() => [])
      : [];
    pictured.push(pictures);
    if (signal?.aborted) break;
  }
  const conditions = runs.map((run, index) => ({
    label: run.value,
    pictures: pictured[index] ?? [],
    inputs: segmentInputs(spec, sequence, run.row),
  }));
  let note = "";
  if (condition) {
    const varying = varyingScreens(sequence, conditions);
    const shown = varying.filter((index) =>
      conditions.every((each) => each.pictures[index] !== undefined),
    );
    if (varying.length === 0) {
      note = `No screen differs between the values of ${condition.column}.`;
    } else if (shown.length < varying.length) {
      note = "Some screens that differ could not be pictured, so they are left out.";
    }
  }
  const { svg, pixelWidth } = sequenceFigure(
    spec,
    sequence,
    choices,
    conditions[0].pictures,
    condition && { column: condition.column, conditions },
  );
  return { svg, pixelWidth, note };
}
