import type { Library } from "tachisto-schemas";
import type { PackageFile } from "./package-files.ts";
import type { Problem } from "./validate.ts";

export interface VariableReference {
  var: string;
  wrap?: string;
}

/**
 * A JavaScript expression written by the author. For a parameter that takes a function it is the
 * function itself; for any other it is worked out when the trial starts.
 */
export interface CodeValue {
  code: string;
}

/** A value written into the data file: fixed, or read from a conditions column. */
export type RecordedValue = VariableReference | string | number | boolean | null | unknown[];

export type ParameterValue = RecordedValue | CodeValue;

export interface CorrectIfRule {
  correct_if_response_equals: VariableReference | string | number;
}

export interface AccuracyRule {
  /** The tag whose trials are measured. */
  scope: string;
  accuracy_below?: number;
  accuracy_at_least?: number;
}

/** Holds when the latest answer on the tagged trials matches, such as a consent question's "no". */
export interface ResponseRule {
  /** The tag whose most recent trial is read. */
  scope: string;
  /** Compared as text, so `1` matches the second button and `"no"` a survey answer. */
  response_equals: string | number | boolean;
  /** The question to read when a trial asks several, as a survey does. */
  question?: string;
}

export interface TrialNode {
  kind: "trial";
  plugin: string;
  tag?: string;
  params?: Record<string, ParameterValue>;
  record?: Record<string, RecordedValue>;
  score?: CorrectIfRule;
  /**
   * The ending a participant this step turns away is sent to, for a step that can turn people away
   * such as a browser check: the study saves what that ending keeps and ends its way.
   */
  exclusion_ending?: string;
  /** Records where the participant looks during this step, once eye tracking is calibrated. */
  gaze?: GazeTracking;
}

export interface GazeTracking {
  /**
   * CSS selectors of elements whose place on the screen is recorded with the gaze, so where the
   * participant looked can be compared with where the stimulus was.
   */
  targets?: string[];
}

export interface BlockNode {
  kind: "block";
  conditions: string;
  randomize_order?: boolean;
  repetitions?: number;
  children: SpecNode[];
}

export interface Group {
  name: string;
  children: SpecNode[];
}

/** Splits participants between groups: a between-subjects manipulation. */
export interface AssignNode {
  kind: "assign";
  /** `"random"` decides in the browser; `"balanced"` asks the data service for the next group. */
  method: "random" | "balanced";
  /** Column name the chosen group is recorded under. */
  record_as?: string;
  groups: Group[];
}

/** Runs every task for every participant, in an order that varies between participants. */
export interface CounterbalanceNode {
  kind: "counterbalance";
  /**
   * `"random"` shuffles the tasks in the browser; `"latin_square"` asks the data service for the
   * participant's row of a balanced Latin square.
   */
  method: "random" | "latin_square";
  /** Column name the order used is recorded under. */
  record_as?: string;
  tasks: Group[];
}

/** Sends a participant down one of two paths depending on how they did or what they answered. */
export interface BranchNode {
  kind: "branch";
  when: AccuracyRule | ResponseRule;
  then: SpecNode[];
  otherwise?: SpecNode[];
}

/** Records that a participant reached a point in the study, for drop-out analysis. */
export interface CheckpointNode {
  kind: "checkpoint";
  name: string;
}

export interface LoopNode {
  kind: "loop";
  id?: string;
  repeat_while: AccuracyRule;
  children: SpecNode[];
}

/** Ends the study here, the way one of the recruitment endings says, after saving the data. */
export interface EndNode {
  kind: "end";
  /** The name of an ending in `recruitment.endings`. */
  ending: string;
}

export type SpecNode =
  | TrialNode
  | BlockNode
  | LoopNode
  | AssignNode
  | CounterbalanceNode
  | BranchNode
  | CheckpointNode
  | EndNode;

/** A named list of steps inside a node, such as a group or a branch's path. */
export interface Slot {
  name: string;
  children: SpecNode[];
}

export interface DataSettings {
  /** `"download"` saves a CSV on the participant's machine, `"post"` uploads it. */
  save: "download" | "post";
  /**
   * The address of the DataPipe to upload to, a path prefix allowed; defaults to pipe.jspsych.org.
   * It starts with https://, or http:// only for localhost, and holds no login, ? or #.
   */
  endpoint?: string;
  /** The experiment id the endpoint files the data under. */
  experiment_id?: string;
  filename_prefix?: string;
  /**
   * Also send each step's row to DataPipe as it is recorded, so a participant who leaves partway
   * still leaves a partial file. Only with `"post"`, and only when every ending keeps all the data.
   */
  stream?: boolean;
  /**
   * What happens when DataPipe cannot hand out a condition for balanced groups or a Latin-square
   * order: the study stops and tells the participant (`"stop"`, the default), or draws one in the
   * browser (`"random"`), which keeps the session running but may leave groups unbalanced.
   */
  condition_fallback?: ConditionFallback;
}

export type ConditionFallback = "stop" | "random";

export type RecruitmentPlatform = "prolific" | "sona" | "connect" | "custom";

/** What happens when the study ends a particular way: a return address, or a message. */
export interface Ending {
  /** The platform's return URL; `{participant_id}` is replaced with the participant's id. */
  url?: string;
  /** Shown to the participant, who stays on the page, instead of being sent anywhere. */
  message?: string;
  /**
   * What is saved on reaching it: every row (the default), only the row saying which ending it
   * was, or nothing at all. Only an early ending can keep less than everything.
   */
  keep?: Retention;
}

export type Retention = "all" | "checkpoint" | "nothing";

/** How the study meets the platform participants are recruited from. */
export interface RecruitmentSettings {
  platform?: RecruitmentPlatform;
  /** The URL parameter the platform passes the participant's id in, if not the platform's usual one. */
  id_param?: string;
  /**
   * `complete` is how the study ends once every step has run; any other ending is reached through
   * an `end` step, such as `no_consent` for a participant who declines.
   */
  endings?: Record<string, Ending>;
}

export interface Asset {
  /** The name the spec refers to this file by, e.g. "face.png". */
  name: string;
  /** A data URL holding the file, so a project and its export stay self-contained. */
  url: string;
}

/** Settings that apply to the whole experiment rather than to one step. */
export interface ExperimentSettings {
  /** Gap in milliseconds after every trial, unless a step sets its own. */
  default_iti?: number;
  /** Responses faster than this are ignored, in milliseconds. */
  minimum_valid_rt?: number;
  show_progress_bar?: boolean;
  progress_bar_message?: string;
  /** What the participant's screen looks like; the editor shows text against the same backdrop. */
  background_color?: string;
  text_color?: string;
}

/** Whoever made the experiment, in the shape Psych-DS expects for a person. */
export interface Author {
  name: string;
  /** A URL that identifies them across datasets, usually an ORCID. */
  identifier?: string;
  /** The institution they belong to, such as their university. */
  affiliation?: string;
}

export interface Spec {
  /** The published JSON Schema, so an editor can check and complete a spec file. */
  $schema?: string;
  name: string;
  authors?: Author[];
  /** How many participants the study plans to recruit. */
  sample_size?: number;
  settings?: ExperimentSettings;
  data?: DataSettings;
  recruitment?: RecruitmentSettings;
  assets?: Asset[];
  conditions?: Record<string, Record<string, unknown>[]>;
  timeline: SpecNode[];
}

export interface CompileResult {
  source: string;
  /** CSS for the participant's page, from the experiment's appearance settings. */
  styles: string;
  plugins: string[];
  /** jsPsych release and npm package name + version per plugin, so exports can pin exactly. */
  jspsych: string;
  packages: Record<string, { name: string; version: string }>;
  /** Scripts loaded after jsPsych and before the plugins, such as an extension and its library. */
  scripts: Library[];
  /** Every file the page loads from those packages, and any they load as they run. */
  files: PackageFile[];
  /** Every column the experiment's data will have, from its plugins and its own additions. */
  columns: string[];
  /** Settings that run but may not do what was meant; errors stop the compile instead. */
  warnings: Problem[];
}
