// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { Spec, TrialNode } from "tachisto-compiler";
import {
  offersGazeTracking,
  otherTargets,
  recordsStimulus,
  retargetGaze,
  setOtherTargets,
  setRecordsStimulus,
  setTracking,
  unreadableSelector,
} from "../src/lib/gaze.ts";

const STIMULUS = "#jspsych-html-keyboard-response-stimulus";
const step = (gaze?: TrialNode["gaze"]): TrialNode => ({
  kind: "trial",
  plugin: "html-keyboard-response",
  params: { stimulus: "<p>a</p>" },
  ...(gaze && { gaze }),
});
const calibrate: TrialNode = { kind: "trial", plugin: "webgazer-calibrate" };
const study = (...timeline: TrialNode[]): Spec => ({ name: "s", timeline });

describe("offering gaze tracking", () => {
  it("offers it once the study runs the eye tracker, except on the steps that run it", () => {
    expect(offersGazeTracking(study(step()), step())).toBe(false);
    expect(offersGazeTracking(study(calibrate, step()), step())).toBe(true);
    expect(offersGazeTracking(study(calibrate), calibrate)).toBe(false);
  });

  it("keeps offering it on a tracked step, so it can be turned off", () => {
    expect(offersGazeTracking(study(step()), step({}))).toBe(true);
  });
});

describe("tracking a step", () => {
  it("starts out recording where the stimulus is, if the plugin says where", () => {
    const trial = step();
    setTracking(trial, true, STIMULUS);
    expect(trial.gaze).toEqual({ targets: [STIMULUS] });
    setTracking(trial, true, undefined);
    expect(trial.gaze).toEqual({ targets: [] });
    setTracking(trial, false, STIMULUS);
    expect(trial.gaze).toBeUndefined();
  });

  it("keeps the stimulus apart from the other elements named", () => {
    const gaze = { targets: [STIMULUS, "#choice"] };
    expect(recordsStimulus(gaze, STIMULUS)).toBe(true);
    expect(otherTargets(gaze, STIMULUS)).toEqual(["#choice"]);

    setRecordsStimulus(gaze, STIMULUS, false);
    expect(gaze.targets).toEqual(["#choice"]);
    setRecordsStimulus(gaze, STIMULUS, true);
    expect(gaze.targets).toEqual([STIMULUS, "#choice"]);

    setOtherTargets(gaze, STIMULUS, ["#left", "#right"]);
    expect(gaze.targets).toEqual([STIMULUS, "#left", "#right"]);
    setRecordsStimulus(gaze, STIMULUS, false);
    setOtherTargets(gaze, STIMULUS, ["#left"]);
    expect(gaze.targets).toEqual(["#left"]);
    expect(recordsStimulus({}, STIMULUS)).toBe(false);
  });

  it("leaves a step that is not tracked untracked when its plugin changes", () => {
    const trial = step();
    retargetGaze(trial, "image-keyboard-response", STIMULUS, "#image");
    expect(trial.gaze).toBeUndefined();
  });
});

describe("changing a tracked step's plugin", () => {
  it("records the new plugin's stimulus in place of the old one's", () => {
    const trial = step({ targets: [STIMULUS, "#choice"] });
    retargetGaze(trial, "image-keyboard-response", STIMULUS, "#image");
    expect(trial.gaze?.targets).toEqual(["#image", "#choice"]);
    retargetGaze(trial, "survey-text", "#image", undefined);
    expect(trial.gaze?.targets).toEqual(["#choice"]);
  });

  it("leaves the targets alone when the stimulus was not recorded", () => {
    const trial = step({ targets: ["#choice"] });
    retargetGaze(trial, "image-keyboard-response", STIMULUS, "#image");
    expect(trial.gaze?.targets).toEqual(["#choice"]);
  });

  it("stops tracking when the step becomes one that runs the eye tracker", () => {
    const trial = step({ targets: [STIMULUS] });
    retargetGaze(trial, "webgazer-validate", STIMULUS, undefined);
    expect(trial.gaze).toBeUndefined();
  });
});

describe("unreadableSelector", () => {
  it("passes a selector the browser can read, and a blank one, which the validator names", () => {
    expect(unreadableSelector("#choice")).toBe(false);
    expect(unreadableSelector(".jspsych-btn > img")).toBe(false);
    expect(unreadableSelector("  ")).toBe(false);
  });

  it("finds one the browser cannot read", () => {
    expect(unreadableSelector("#")).toBe(true);
  });
});
