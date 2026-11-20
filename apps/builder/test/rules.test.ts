import { describe, expect, it } from "vitest";
import type { AccuracyRule, BranchNode, ResponseRule } from "tachisto-compiler";
import {
  accuracyComparisonOf,
  branchBasis,
  describeAccuracy,
  describeBranchRule,
  setAccuracyComparison,
  setAnswer,
  setBranchBasis,
  setQuestion,
  setThreshold,
  thresholdOf,
} from "../src/lib/rules.ts";

const branch = (when: BranchNode["when"]): BranchNode => ({ kind: "branch", when, then: [] });

describe("what a branch decides on", () => {
  it("switches to an answer, keeping the trials it reads", () => {
    const node = branch({ scope: "consent", accuracy_at_least: 0.8 });
    setBranchBasis(node, "response");
    expect(node.when).toEqual({ scope: "consent", response_equals: "" });
    expect(branchBasis(node.when)).toBe("response");
  });

  it("switches back to accuracy with a starting threshold", () => {
    const node = branch({ scope: "consent", response_equals: "no", question: "q" });
    setBranchBasis(node, "accuracy");
    expect(node.when).toEqual({ scope: "consent", accuracy_at_least: 0.8 });
  });

  it("leaves the rule alone when the basis does not change", () => {
    const node = branch({ scope: "consent", response_equals: "no" });
    setBranchBasis(node, "response");
    expect(node.when).toEqual({ scope: "consent", response_equals: "no" });
  });
});

describe("an accuracy rule", () => {
  it("keeps its threshold when the comparison flips", () => {
    const rule: AccuracyRule = { scope: "s", accuracy_below: 0.6 };
    expect(accuracyComparisonOf(rule)).toBe("below");
    setAccuracyComparison(rule, "at_least");
    expect(rule).toEqual({ scope: "s", accuracy_at_least: 0.6 });
    setAccuracyComparison(rule, "below");
    expect(rule).toEqual({ scope: "s", accuracy_below: 0.6 });
  });

  it("sets the threshold on whichever comparison it makes", () => {
    const rule: AccuracyRule = { scope: "s", accuracy_at_least: 0.5 };
    setThreshold(rule, 0.9);
    expect(rule.accuracy_at_least).toBe(0.9);
    setAccuracyComparison(rule, "below");
    setThreshold(rule, 0.3);
    expect(rule).toEqual({ scope: "s", accuracy_below: 0.3 });
    expect(thresholdOf({ scope: "s" })).toBe(0.8);
  });

  it("reads as a percentage", () => {
    expect(describeAccuracy({ scope: "practice", accuracy_below: 0.75 })).toBe(
      "under 75% on practice",
    );
    expect(describeBranchRule({ scope: "", accuracy_at_least: 0.5 })).toBe(
      "if accuracy at least 50% on …",
    );
  });
});

describe("an answer rule", () => {
  it("keeps the answer as typed, less surrounding spaces", () => {
    const rule: ResponseRule = { scope: "consent", response_equals: "" };
    setAnswer(rule, " 1 ");
    expect(rule.response_equals).toBe("1");
  });

  it("names a survey question only when one is given", () => {
    const rule: ResponseRule = { scope: "consent", response_equals: "No" };
    setQuestion(rule, " agree ");
    expect(rule.question).toBe("agree");
    expect(describeBranchRule(rule)).toBe("if consent › agree answered “No”");
    setQuestion(rule, "");
    expect(rule).not.toHaveProperty("question");
    expect(describeBranchRule(rule)).toBe("if consent answered “No”");
  });
});
