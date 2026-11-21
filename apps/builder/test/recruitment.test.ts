import { describe, expect, it } from "vitest";
import { earlyEndingNames, idParamOf, retentionOf } from "tachisto-compiler";
import type { Spec } from "tachisto-compiler";
import {
  addEnding,
  choosePlatform,
  endingKind,
  guideFor,
  platformChoice,
  PLATFORMS,
  removeEnding,
  RETENTION_CHOICES,
  setCompletionUrl,
  setEndingKind,
  setEndingTarget,
  setIdParam,
  setRetention,
  setSampleSize,
} from "../src/lib/recruitment.ts";

const blank = (): Spec => ({ name: "study", timeline: [] });
const PROLIFIC = "https://app.prolific.com/submissions/complete?cc=C1A2B3";

describe("recruiting from a platform", () => {
  it("leaves the id parameter to the platform it names", () => {
    const spec = blank();
    choosePlatform(spec, "prolific");
    expect(spec.recruitment).toEqual({ platform: "prolific" });
    expect(idParamOf(spec.recruitment)).toBe("PROLIFIC_PID");
  });

  it("forgets a parameter typed for the last platform when the platform changes", () => {
    const spec = blank();
    choosePlatform(spec, "custom");
    setIdParam(spec, "workerId");
    choosePlatform(spec, "sona");
    expect(idParamOf(spec.recruitment)).toBe("id");
  });

  it("keeps the return address when the platform changes", () => {
    const spec = blank();
    choosePlatform(spec, "prolific");
    setCompletionUrl(spec, PROLIFIC);
    choosePlatform(spec, "custom");
    expect(spec.recruitment?.endings?.complete?.url).toBe(PROLIFIC);
  });

  it("removes the hand-off when participants open the link directly", () => {
    const spec = blank();
    choosePlatform(spec, "prolific");
    choosePlatform(spec, "none");
    expect(spec.recruitment).toBeUndefined();
  });

  it("stores a parameter only when it differs from the platform's own", () => {
    const spec = blank();
    choosePlatform(spec, "connect");
    setIdParam(spec, " workerId ");
    expect(spec.recruitment?.id_param).toBe("workerId");
    setIdParam(spec, "participantId");
    expect(spec.recruitment?.id_param).toBeUndefined();
    setIdParam(spec, "workerId");
    setIdParam(spec, "  ");
    expect(spec.recruitment?.id_param).toBeUndefined();
  });

  it("drops the ending when its address is cleared", () => {
    const spec = blank();
    choosePlatform(spec, "prolific");
    setCompletionUrl(spec, ` ${PROLIFIC} `);
    expect(spec.recruitment?.endings).toEqual({ complete: { url: PROLIFIC } });
    setCompletionUrl(spec, "");
    expect(spec.recruitment?.endings).toBeUndefined();
  });

  it("leaves a spec without recruitment alone", () => {
    const spec = blank();
    setIdParam(spec, "PROLIFIC_PID");
    setCompletionUrl(spec, PROLIFIC);
    expect(spec.recruitment).toBeUndefined();
  });

  it("guides a spec that names no platform as an unnamed one", () => {
    expect(guideFor(undefined)).toBe(guideFor("custom"));
    for (const platform of PLATFORMS) expect(platform.hint.length).toBeGreaterThan(0);
  });

  it("counts a hand-written spec as an unnamed platform only when it hands participants off", () => {
    expect(platformChoice(blank())).toBe("none");
    expect(platformChoice({ ...blank(), recruitment: { id_param: "workerId" } })).toBe("custom");
    expect(
      platformChoice({ ...blank(), recruitment: { endings: { complete: { url: PROLIFIC } } } }),
    ).toBe("custom");
    expect(
      platformChoice({ ...blank(), recruitment: { endings: { no: { message: "<p>bye</p>" } } } }),
    ).toBe("none");
  });

  it("keeps early endings when the completion address changes", () => {
    const spec = blank();
    choosePlatform(spec, "prolific");
    addEnding(spec, "no_consent");
    setCompletionUrl(spec, PROLIFIC);
    setCompletionUrl(spec, "");
    expect(earlyEndingNames(spec.recruitment)).toEqual(["no_consent"]);
    expect(spec.recruitment?.endings).not.toHaveProperty("complete");
  });
});

describe("ending the study early", () => {
  const blankWithEnding = () => {
    const spec = blank();
    addEnding(spec, " no_consent ");
    return spec;
  };

  it("adds an ending that shows a message, even without a platform", () => {
    const spec = blankWithEnding();
    expect(earlyEndingNames(spec.recruitment)).toEqual(["no_consent"]);
    const ending = spec.recruitment!.endings!.no_consent;
    expect(endingKind(ending)).toBe("message");
    expect(ending.message).toMatch(/Thank you/);
    expect(platformChoice(spec)).toBe("none");
  });

  it.each([
    ["no_consent", /already an ending called no_consent/],
    ["complete", /already ends this way/],
    ["  ", /start with a letter/],
    ["no consent", /start with a letter/],
    ["__proto__", /start with a letter/],
  ])("refuses to add an ending called %j", (name, problem) => {
    const spec = blankWithEnding();
    expect(addEnding(spec, name)).toMatch(problem);
    expect(Object.keys(spec.recruitment?.endings ?? {})).toEqual(["no_consent"]);
  });

  it("switches between a message and a return address", () => {
    const spec = blankWithEnding();
    setEndingKind(spec, "no_consent", "url");
    setEndingTarget(spec, "no_consent", ` ${PROLIFIC} `);
    expect(spec.recruitment?.endings?.no_consent).toEqual({ url: PROLIFIC });
    setEndingKind(spec, "no_consent", "url");
    expect(spec.recruitment?.endings?.no_consent).toEqual({ url: PROLIFIC });
    setEndingKind(spec, "no_consent", "message");
    setEndingTarget(spec, "no_consent", "<p>bye</p>");
    expect(spec.recruitment?.endings?.no_consent).toEqual({ message: "<p>bye</p>" });
  });

  it("ignores endings that do not exist", () => {
    const spec = blank();
    setEndingKind(spec, "missing", "url");
    setEndingTarget(spec, "missing", PROLIFIC);
    expect(spec.recruitment).toBeUndefined();
  });

  it("keeps message endings, and drops return addresses, when there is no platform", () => {
    const spec = blankWithEnding();
    choosePlatform(spec, "prolific");
    setCompletionUrl(spec, PROLIFIC);
    addEnding(spec, "screened_out");
    setEndingKind(spec, "screened_out", "url");
    choosePlatform(spec, "none");
    expect(Object.keys(spec.recruitment ?? {})).toEqual(["endings"]);
    expect(Object.keys(spec.recruitment?.endings ?? {})).toEqual(["no_consent"]);
  });

  it("removes the recruitment settings with the last ending", () => {
    const spec = blankWithEnding();
    removeEnding(spec, "no_consent");
    expect(spec.recruitment).toBeUndefined();
  });
});

describe("what an early ending keeps", () => {
  it("keeps everything unless told otherwise, and stores that as no setting", () => {
    const spec = blank();
    addEnding(spec, "no_consent");
    const ending = () => spec.recruitment!.endings!.no_consent;
    expect(retentionOf(ending())).toBe("all");
    setRetention(spec, "no_consent", "nothing");
    expect(ending().keep).toBe("nothing");
    setRetention(spec, "no_consent", "all");
    expect(ending()).not.toHaveProperty("keep");
  });

  it("remembers what is kept when the ending switches to a return address", () => {
    const spec = blank();
    addEnding(spec, "no_consent");
    setRetention(spec, "no_consent", "checkpoint");
    setEndingKind(spec, "no_consent", "url");
    expect(spec.recruitment?.endings?.no_consent).toEqual({ url: "", keep: "checkpoint" });
  });

  it("offers every choice the compiler knows, each described", () => {
    expect(RETENTION_CHOICES.map((choice) => choice.id)).toEqual(["all", "checkpoint", "nothing"]);
    for (const choice of RETENTION_CHOICES) expect(choice.label).toMatch(/^keep /);
  });

  it("ignores an ending that does not exist", () => {
    const spec = blank();
    setRetention(spec, "missing", "nothing");
    expect(spec.recruitment).toBeUndefined();
  });

  it("leaves a completed study keeping everything", () => {
    const spec = blank();
    choosePlatform(spec, "prolific");
    setCompletionUrl(spec, PROLIFIC);
    setRetention(spec, "complete", "nothing");
    expect(spec.recruitment?.endings?.complete).toEqual({ url: PROLIFIC });
  });
});

describe("the planned sample size", () => {
  it("stores the number typed, and nothing for an empty field", () => {
    const spec = blank();
    setSampleSize(spec, " 120 ");
    expect(spec.sample_size).toBe(120);
    setSampleSize(spec, "");
    expect(spec).not.toHaveProperty("sample_size");
  });

  it("keeps a number the checks reject, so they can say what is wrong with it", () => {
    const spec = blank();
    setSampleSize(spec, "2.5");
    expect(spec.sample_size).toBe(2.5);
  });
});
