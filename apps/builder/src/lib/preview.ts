import {
  compileSpec,
  emitHtml,
  escapeHtmlText,
  slotsOf,
  walkNodes,
  STEP_COLUMN,
  type CompileResult,
  type Ending,
  type Spec,
  type SpecNode,
  type TrialNode,
} from "tachisto-compiler";
import { schemas } from "./schemas.ts";

/**
 * The steps leading to `path`, keeping the containers that give a step its context — a block still
 * supplies its conditions — and dropping everything beside it. A split or a branch is unwrapped to
 * the path actually taken, since the point is to see this step, not to be sent somewhere else.
 */
function trim(nodes: SpecNode[], path: number[]): SpecNode[] {
  const [index, ...rest] = path;
  const node = nodes[index];
  if (!node) return [];
  if (rest.length === 0) return [node];

  const slots = slotsOf(node);
  if (slots) {
    const [slotIndex, ...inside] = rest;
    const slot = slots[slotIndex];
    return slot ? trim(slot.children, inside) : [];
  }
  if (node.kind === "block" || node.kind === "loop") {
    return [{ ...node, children: trim(node.children, rest) }];
  }
  return [node];
}

/**
 * A preview is not a participant, so it must not take a place in the data service's count: groups
 * and orders the service would hand out are drawn in the browser instead.
 */
function drawLocally(nodes: SpecNode[]) {
  walkNodes(nodes, (node) => {
    if (node.kind === "assign" || node.kind === "counterbalance") node.method = "random";
  });
}

export interface PreviewOptions {
  /** Start from this step rather than the beginning. */
  from?: number[] | null;
}

/** Each step in a timeline, named by the path the builder selects it with. */
function stepPaths(timeline: SpecNode[]) {
  const paths = new Map<TrialNode, string>();
  walkNodes(timeline, (node, path) => {
    if (node.kind === "trial") paths.set(node, path.join("."));
  });
  return paths;
}

/**
 * The experiment as the preview should run it: never saving data or sending anyone back to a
 * recruitment platform, since a preview is not a participant, and optionally narrowed to one step.
 * Each step keeps the name of its place in the whole timeline, narrowed or not, so the builder can
 * point at the step the participant is on.
 */
export function tracedPreview(spec: Spec, options: PreviewOptions = {}) {
  const { data: _data, recruitment, ...rest } = spec;
  const whole = structuredClone(spec.timeline);
  const stepIds = stepPaths(whole);
  const timeline = options.from?.length ? trim(whole, options.from) : whole;
  drawLocally(timeline);
  const previewed: Spec = {
    ...rest,
    ...(recruitment?.endings && { recruitment: { endings: previewEndings(recruitment.endings) } }),
    timeline,
  };
  return { spec: previewed, stepIds };
}

const MESSAGE_SOURCE = "tachisto-preview";

/** A step's place in the timeline as a frame reports it, such as "2.1". */
export const isStepId = (step: unknown): step is string =>
  typeof step === "string" && /^\d+(\.\d+)*$/.test(step);

/** A narrowed study compiled to run in a frame, reporting each step through the hooks given. */
export function compilePreview(traced: ReturnType<typeof tracedPreview>, hooks: string) {
  return compileSpec(traced.spec, schemas, { initEntries: hooks, stepIds: traced.stepIds });
}

/** The page a frame runs, with the focus guard ahead of anything else it is given. */
export function previewPage(compiled: CompileResult, title: string, headScripts: string[] = []) {
  return emitHtml(compiled, { title, headScripts: [FOCUS_GUARD, ...headScripts] });
}

/** Hooks for the running study that tell the builder each time a step starts and finishes. */
export const TRACE_HOOKS =
  `on_trial_start: (trial) => { const step = trial.data?.${STEP_COLUMN}; ` +
  `if (step) window.parent.postMessage({ source: "${MESSAGE_SOURCE}", event: "start", step, ` +
  `duration: typeof trial.trial_duration === "number" ? trial.trial_duration : null }, "*"); }, ` +
  `on_trial_finish: (data) => { const step = data.${STEP_COLUMN}; ` +
  `if (step) window.parent.postMessage({ source: "${MESSAGE_SOURCE}", event: "finish", step, ` +
  `duration: null }, "*"); }`;

export interface StepEvent {
  event: "start" | "finish";
  step: string;
  /** How long the step will run, when the study knows it as the step starts. */
  duration: number | null;
}

/**
 * A message from the preview frame, if it is one the trace hooks send. The frame runs the author's
 * own code, which can post anything, so only that exact shape is read.
 */
export function readStepEvent(message: unknown): StepEvent | null {
  if (typeof message !== "object" || message === null) return null;
  const { source, event, step, duration } = message as Record<string, unknown>;
  if (source !== MESSAGE_SOURCE) return null;
  if (event !== "start" && event !== "finish") return null;
  if (!isStepId(step)) return null;
  const known = typeof duration === "number" && Number.isFinite(duration) && duration >= 0;
  if (duration !== null && !known) return null;
  return { event, step, duration: known ? duration : null };
}

// An end step has to reach an ending that exists, so the preview keeps every ending, saying where
// a participant would be sent instead of sending them.
function previewEndings(endings: Record<string, Ending>) {
  return Object.fromEntries(
    Object.entries(endings).map(([name, ending]) => [
      name,
      ending.url === undefined
        ? ending
        : { message: `<p>Here the participant is sent to ${escapeHtmlText(ending.url)}</p>` },
    ]),
  );
}

// jsPsych focuses its display at the start of every trial so keypresses reach it. Inside the
// preview that would pull the cursor out of whatever the builder is editing, so the frame may only
// move focus once it already has it: click into the preview and it behaves as it will for real.
export const FOCUS_GUARD = `(() => {
  const focus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (...args) {
    if (document.hasFocus()) focus.apply(this, args);
  };
})();`;
