import { isEyeTrackingStep, usesEyeTracking } from "tachisto-compiler";
import type { GazeTracking, Spec, TrialNode } from "tachisto-compiler";
import type { ParameterSchema } from "tachisto-schemas";

/**
 * Whether a step is offered gaze tracking: once the study runs the eye tracker, any step but the
 * ones that run it, and any step tracked already so it can be turned off.
 */
export function offersGazeTracking(spec: Spec, trial: TrialNode) {
  if (trial.gaze) return true;
  return !isEyeTrackingStep(trial.plugin) && usesEyeTracking(spec);
}

/** Tracking starts out recording where the stimulus is, where the step's plugin says. */
export function setTracking(trial: TrialNode, tracked: boolean, stimulus: string | undefined) {
  if (tracked) trial.gaze = { targets: stimulus ? [stimulus] : [] };
  else delete trial.gaze;
}

export function recordsStimulus(gaze: GazeTracking, stimulus: string) {
  return gaze.targets?.includes(stimulus) ?? false;
}

/** The elements recorded besides the stimulus, which the author names by CSS selector. */
export function otherTargets(gaze: GazeTracking, stimulus: string | undefined) {
  return (gaze.targets ?? []).filter((target) => target !== stimulus);
}

function setTargets(gaze: GazeTracking, stimulus: string | undefined, others: string[]) {
  gaze.targets = stimulus ? [stimulus, ...others] : others;
}

export function setRecordsStimulus(gaze: GazeTracking, stimulus: string, recorded: boolean) {
  setTargets(gaze, recorded ? stimulus : undefined, otherTargets(gaze, stimulus));
}

export function setOtherTargets(
  gaze: GazeTracking,
  stimulus: string | undefined,
  others: string[],
) {
  const kept = stimulus !== undefined && recordsStimulus(gaze, stimulus);
  setTargets(gaze, kept ? stimulus : undefined, others);
}

/**
 * Keeps a tracked step's targets right for the plugin it is changed to: its stimulus is somewhere
 * else, and a step that runs the eye tracker tracks nothing.
 */
export function retargetGaze(
  trial: TrialNode,
  plugin: string,
  previous: string | undefined,
  next: string | undefined,
) {
  if (!trial.gaze) return;
  if (isEyeTrackingStep(plugin)) {
    delete trial.gaze;
    return;
  }
  if (previous === undefined || !recordsStimulus(trial.gaze, previous)) return;
  setTargets(trial.gaze, next, otherTargets(trial.gaze, previous));
}

export const SELECTOR_LIST: ParameterSchema = {
  title: "elements",
  type: "array",
  jspsychType: "STRING",
  items: { title: "CSS selector", type: "string", jspsychType: "STRING" },
};

// The validator, which has no browser to ask, says when one is blank; the study leaves out one
// the browser cannot read, so its place is not recorded, which the author should know.
export function unreadableSelector(selector: string) {
  if (selector.trim() === "") return false;
  try {
    document.createDocumentFragment().querySelector(selector);
    return false;
  } catch {
    return true;
  }
}
