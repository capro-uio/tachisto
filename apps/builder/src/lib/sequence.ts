import { isVariableReference, nodesAlongPath, trialsOf, walkNodes } from "tachisto-compiler";
import type { ParameterValue, PlacedNode, Spec, SpecNode, TrialNode } from "tachisto-compiler";
import type { PluginSchema } from "tachisto-schemas";
import type { Playback } from "./playback.svelte.ts";

/** The shortest and longest a value can be, across the rows of a conditions table. */
export interface Span {
  min: number;
  max: number;
}

export type Timing =
  /** Ends after this long, whatever the participant does. */
  | { kind: "fixed"; ms: Span }
  /** Ends at a response, or after this long without one. */
  | { kind: "limit"; ms: Span }
  /** Waits for a response, however long it takes. */
  | { kind: "response" }
  /** Ends when the participant moves on, as from instructions or a questionnaire. */
  | { kind: "untimed" }
  /** Read from a column whose cells are not all durations. */
  | { kind: "varies"; column: string };

export type Role = "fixation" | "screen" | "stimulus" | "other" | "group" | "gap";

export interface Segment {
  /** The step's path, as the builder selects it; a gap belongs to no step. */
  path: number[] | null;
  role: Role;
  title: string;
  timing: Timing;
  /** What the participant answers with, for a step that takes a response. */
  answer?: string;
  /** How long the stimulus stays on screen, when it goes before the step ends. */
  shownFor?: Span;
  /** Its share of the strip's width: its length in milliseconds, or a stand-in for none. */
  weight: number;
}

export interface Sequence {
  path: number[];
  kind: "block" | "loop";
  segments: Segment[];
}

/** The width a step without a known length takes, as a second would. */
export const UNTIMED_WEIGHT = 1000;

type Lookup = (plugin: string) => PluginSchema | undefined;
type Row = Record<string, unknown>;

/**
 * The path of every block and loop in a timeline, outermost first, written as a selection is, so
 * each can be handed to {@link sequenceAt}: a step's index, and a slot's index after the step
 * that holds it.
 */
export function containerPaths(timeline: SpecNode[]): number[][] {
  const paths: number[][] = [];
  walkNodes(timeline, (node, path) => {
    if (node.kind === "block" || node.kind === "loop") paths.push(path);
  });
  return paths;
}

/** The step at a path, if there is one. */
export function containerNode(spec: Spec, path: number[]): SpecNode | undefined {
  return nodesAlongPath(spec.timeline, path).at(-1)?.node;
}

/**
 * What a block or loop at a path is called, for naming its figure: a block by the conditions
 * table it runs, a loop by its id, or by what it is.
 */
export function containerName(spec: Spec, path: number[]) {
  const node = containerNode(spec, path);
  if (node?.kind === "block") return node.conditions;
  if (node?.kind === "loop") return node.id ?? "loop";
  return "steps";
}

/** The conditions table a step reads from: that of the innermost block around it. */
function tableFor(along: { node: SpecNode }[]) {
  for (const { node } of [...along].reverse()) {
    if (node.kind === "block") return node.conditions;
  }
  return null;
}

/** The rows a step reads from: those of the innermost block around it. */
function rowsFor(spec: Spec, along: { node: SpecNode }[]): Row[] {
  const table = tableFor(along);
  return table === null ? [] : (spec.conditions?.[table] ?? []);
}

/** The conditions table the steps at a path read their columns from, if any. */
export function tableAt(spec: Spec, path: number[]) {
  return tableFor(nodesAlongPath(spec.timeline, path));
}

const ROW_LABEL_LENGTH = 40;

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&nbsp;": " " };

const TAG = /<\/?[a-zA-Z][^<>]*>/g;

/**
 * A cell as plain words for a list of rows, which shows it as text: entities are read first, then
 * whatever reads as a tag (a "<" with a letter or "/" after it) is taken out until none is left,
 * so a flanker's "<<<>>" stays and a tag split around another cannot come back together.
 */
function plainText(html: string) {
  let text = html.replace(/&(lt|gt|amp|nbsp);/g, (entity) => ENTITIES[entity]);
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(TAG, "");
  }
  return text.trim();
}

/**
 * Each row of the table the steps at a path read, named by its number and the first few values
 * in it, so one can be picked from a list: "2: BLUE · red · b".
 */
export function rowLabels(spec: Spec, path: number[]) {
  const table = tableAt(spec, path);
  const rows = table === null ? [] : (spec.conditions?.[table] ?? []);
  return rows.map((row, index) => {
    const values = Object.values(row)
      .filter((value) => typeof value === "string" || typeof value === "number")
      .map((value) => plainText(String(value)))
      .filter(Boolean)
      .join(" · ");
    const label = `${index + 1}: ${values}`;
    return label.length > ROW_LABEL_LENGTH ? `${label.slice(0, ROW_LABEL_LENGTH - 1)}…` : label;
  });
}

/** A value with each column it names replaced by that column's cell in the row. */
function withRow(value: unknown, row: Row): unknown {
  if (isVariableReference(value as ParameterValue)) return row[(value as { var: string }).var];
  if (Array.isArray(value)) return value.map((item) => withRow(item, row));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withRow(item, row)]),
    );
  }
  return value;
}

/**
 * What each segment's steps are given for one row of the table: their plugins and settings, with
 * the row's values in place of the columns they name. Two rows that give a segment the same show
 * the same screen, however a picture of it might come out.
 */
export function segmentInputs(spec: Spec, sequence: Sequence, row: number) {
  const table = tableAt(spec, sequence.path);
  const cells = (table === null ? [] : (spec.conditions?.[table] ?? []))[row] ?? {};
  return sequence.segments.map((segment) => {
    if (!segment.path) return "";
    const step = nodesAlongPath(spec.timeline, segment.path).at(-1)?.node;
    const trials = step ? trialsOf([step]) : [];
    return JSON.stringify(
      trials.map((trial) => ({ plugin: trial.plugin, params: withRow(trial.params ?? {}, cells) })),
    );
  });
}

/** The most conditions a figure shows side by side; a column with more is not a condition. */
export const MAX_CONDITIONS = 4;

export interface ConditionColumn {
  column: string;
  /** Each value the column takes, with the first row that holds it, in the order they appear. */
  values: { value: string; row: number }[];
}

/**
 * The columns of the table the steps at a path read that divide its rows into a few conditions,
 * two to {@link MAX_CONDITIONS} values, each with the first row that holds each value.
 */
export function conditionColumns(spec: Spec, path: number[]): ConditionColumn[] {
  const table = tableAt(spec, path);
  const rows = table === null ? [] : (spec.conditions?.[table] ?? []);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return columns.flatMap((column) => {
    const values: { value: string; row: number }[] = [];
    rows.forEach((row, index) => {
      const cell = row[column];
      if (typeof cell !== "string" && typeof cell !== "number") return;
      const value = plainText(String(cell));
      if (value && !values.some((seen) => seen.value === value)) values.push({ value, row: index });
    });
    return values.length >= 2 && values.length <= MAX_CONDITIONS ? [{ column, values }] : [];
  });
}

// Number() reads a blank cell, a missing one or `false` as 0, which would pass for a duration.
function durationOf(cell: unknown) {
  if (typeof cell === "number") return cell;
  if (typeof cell === "string" && cell.trim() !== "") return Number(cell);
  return Number.NaN;
}

function spanOf(value: ParameterValue | undefined, rows: Row[]): Span | string | null {
  if (typeof value === "number") return { min: value, max: value };
  if (value === undefined || !isVariableReference(value)) return null;
  const cells = rows.map((row) => durationOf(row[value.var]));
  if (cells.length === 0 || cells.some((cell) => !Number.isFinite(cell) || cell < 0)) {
    return value.var;
  }
  return { min: Math.min(...cells), max: Math.max(...cells) };
}

function answerOf(choices: ParameterValue | undefined, plugin: string) {
  if (choices === "ALL_KEYS") return "any key";
  if (choices !== undefined && isVariableReference(choices)) return `keys from ${choices.var}`;
  if (!Array.isArray(choices)) return undefined;
  const labels = choices.map(String);
  if (plugin.includes("button")) return labels.length === 1 ? "one button" : "a button";
  return labels.length <= 3 ? labels.join(" or ") : `one of ${labels.length} keys`;
}

// A plus sign with nothing around it but markup and space: a fixation cross, however it is styled.
const FIXATION = /^(?:\s|&nbsp;|<[^<>]*>)*\+(?:\s|&nbsp;|<[^<>]*>)*$/;

/** One step, as the strip shows it. */
export function segmentFor(trial: TrialNode, path: number[], rows: Row[], lookup: Lookup): Segment {
  const schema = lookup(trial.plugin);
  const properties = schema?.properties ?? {};
  const valueOf = (name: string) =>
    (trial.params?.[name] ?? properties[name]?.default) as ParameterValue | undefined;

  const choices = valueOf("choices");
  const takesResponse =
    choices !== "NO_KEYS" && ("choices" in properties || "response_ends_trial" in properties);
  const endsOnResponse = takesResponse && valueOf("response_ends_trial") !== false;

  const duration = "trial_duration" in properties ? spanOf(valueOf("trial_duration"), rows) : null;
  let timing: Timing;
  if (typeof duration === "string") timing = { kind: "varies", column: duration };
  else if (duration) timing = { kind: endsOnResponse ? "limit" : "fixed", ms: duration };
  else timing = { kind: takesResponse ? "response" : "untimed" };

  const shown = spanOf(valueOf("stimulus_duration"), rows);
  const stimulus = valueOf("stimulus");
  const isFixation = typeof stimulus === "string" && FIXATION.test(stimulus);
  const role: Role = isFixation
    ? "fixation"
    : takesResponse
      ? "stimulus"
      : timing.kind === "fixed"
        ? "screen"
        : "other";

  return {
    path,
    role,
    title: trial.tag ?? (isFixation ? "Fixation" : (schema?.title ?? trial.plugin)),
    timing,
    ...(takesResponse && { answer: answerOf(choices, trial.plugin) }),
    ...(shown && typeof shown !== "string" && { shownFor: shown }),
    weight:
      timing.kind === "fixed" || timing.kind === "limit"
        ? Math.max((timing.ms.min + timing.ms.max) / 2, 1)
        : UNTIMED_WEIGHT,
  };
}

function groupTitle(node: SpecNode) {
  const inside = (count: number) => `${count} ${count === 1 ? "step" : "steps"}`;
  if (node.kind === "block") return `Block · ${inside(node.children.length)}`;
  if (node.kind === "loop") return `Repeat · ${inside(node.children.length)}`;
  if (node.kind === "branch") return "Branch";
  if (node.kind === "assign") return "Groups";
  if (node.kind === "counterbalance") return "Tasks in turn";
  if (node.kind === "checkpoint") return `Checkpoint “${node.name}”`;
  if (node.kind === "end") return "End";
  return node.kind;
}

type Container = Extract<SpecNode, { kind: "block" | "loop" }>;

const isContainer = (entry: PlacedNode): entry is PlacedNode & { node: Container } =>
  entry.node.kind === "block" || entry.node.kind === "loop";

/**
 * The block or loop around the selection, laid out step by step, with the pause between steps
 * where the study has one. A selection outside any block or loop has no sequence to show.
 */
export function sequenceAt(spec: Spec, selection: number[] | null, lookup: Lookup) {
  if (!selection) return null;
  const along = nodesAlongPath(spec.timeline, selection);
  const around = [...along].reverse().find(isContainer);
  if (!around) return null;
  const { node: container, path } = around;

  const rows = rowsFor(spec, along.slice(0, along.indexOf(around) + 1));
  const gap = spec.settings?.default_iti ?? 0;
  const segments: Segment[] = [];
  container.children.forEach((child, childIndex) => {
    const childPath = [...path, childIndex];
    if (child.kind === "trial") {
      segments.push(segmentFor(child, childPath, rows, lookup));
      if (gap > 0) {
        segments.push({
          path: null,
          role: "gap",
          title: "Pause",
          timing: { kind: "fixed", ms: { min: gap, max: gap } },
          weight: gap,
        });
      }
    } else {
      segments.push({
        path: childPath,
        role: "group",
        title: groupTitle(child),
        timing: { kind: "untimed" },
        weight: UNTIMED_WEIGHT,
      });
    }
  });
  return { path, kind: container.kind, segments } satisfies Sequence;
}

const ms = (span: Span) =>
  span.min === span.max ? `${span.min} ms` : `${span.min}–${span.max} ms`;

/** How long a segment lasts, as the strip writes it under the segment. */
export function timingText(segment: Segment) {
  const { timing } = segment;
  if (timing.kind === "fixed") return ms(timing.ms);
  if (timing.kind === "limit") return `up to ${ms(timing.ms)}`;
  if (timing.kind === "varies") return `from ${timing.column}`;
  if (timing.kind === "response") return "until response";
  return segment.role === "group" ? "" : "until done";
}

/** Whether a running step is this segment's, or inside it. */
export function segmentHolds(segment: Segment, step: string) {
  if (!segment.path) return false;
  const own = segment.path.join(".");
  return step === own || step.startsWith(`${own}.`);
}

/** What else the strip says about a segment: how long its stimulus shows, and how it is answered. */
export function detailText(segment: Segment) {
  const shown = segment.shownFor && `shown ${ms(segment.shownFor)}`;
  return [shown, segment.answer].filter(Boolean).join(" · ");
}

/** The segment the preview is in: the running step's own, or the pause after it once it ends. */
export function activeSegment(sequence: Sequence, playing: Pick<Playback, "step" | "phase">) {
  const { step, phase } = playing;
  if (!step) return -1;
  const own = sequence.segments.findIndex((segment) => segmentHolds(segment, step));
  if (own === -1 || phase === "step") return own;
  return sequence.segments[own + 1]?.role === "gap" ? own + 1 : -1;
}

/**
 * How long the playhead takes to cross a segment: what the running step reported, or else the
 * segment's own length. A step with no set length holds the playhead until the participant acts.
 */
export function sweepMs(segment: Segment, reported: number | null) {
  if (segment.role !== "gap" && reported !== null) return reported;
  const { timing } = segment;
  return timing.kind === "fixed" || timing.kind === "limit" ? timing.ms.max : null;
}
