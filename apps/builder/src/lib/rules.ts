import { accuracyComparison, isResponseRule } from "tachisto-compiler";
import type { AccuracyRule, BranchNode, ResponseRule } from "tachisto-compiler";

export type BranchBasis = "accuracy" | "response";
export type AccuracyComparison = "at_least" | "below";

export const DEFAULT_THRESHOLD = 0.8;

export function branchBasis(rule: BranchNode["when"]): BranchBasis {
  return isResponseRule(rule) ? "response" : "accuracy";
}

/** Switching what a branch decides on keeps the trials it reads, and starts the rest afresh. */
export function setBranchBasis(branch: BranchNode, basis: BranchBasis) {
  if (basis === branchBasis(branch.when)) return;
  const { scope } = branch.when;
  branch.when =
    basis === "response"
      ? { scope, response_equals: "" }
      : { scope, accuracy_at_least: DEFAULT_THRESHOLD };
}

export function accuracyComparisonOf(rule: AccuracyRule): AccuracyComparison {
  return accuracyComparison(rule).operator === ">=" ? "at_least" : "below";
}

export function thresholdOf(rule: AccuracyRule) {
  return rule.accuracy_at_least ?? rule.accuracy_below ?? DEFAULT_THRESHOLD;
}

export function setAccuracyComparison(rule: AccuracyRule, comparison: AccuracyComparison) {
  const threshold = thresholdOf(rule);
  delete rule.accuracy_below;
  delete rule.accuracy_at_least;
  if (comparison === "at_least") rule.accuracy_at_least = threshold;
  else rule.accuracy_below = threshold;
}

export function setThreshold(rule: AccuracyRule, threshold: number) {
  if (accuracyComparisonOf(rule) === "at_least") rule.accuracy_at_least = threshold;
  else rule.accuracy_below = threshold;
}

/** Answers are compared as text, so what was typed is kept as typed, less surrounding spaces. */
export function setAnswer(rule: ResponseRule, value: string) {
  rule.response_equals = value.trim();
}

export function setQuestion(rule: ResponseRule, value: string) {
  const question = value.trim();
  if (question) rule.question = question;
  else delete rule.question;
}

export function describeAccuracy(rule: AccuracyRule) {
  const { operator, threshold } = accuracyComparison(rule);
  return `${operator === "<" ? "under" : "at least"} ${Math.round(threshold * 100)}% on ${rule.scope || "…"}`;
}

export function describeBranchRule(rule: BranchNode["when"]) {
  if (!isResponseRule(rule)) return `if accuracy ${describeAccuracy(rule)}`;
  const scope = rule.scope || "…";
  const asked = rule.question ? `${scope} › ${rule.question}` : scope;
  return `if ${asked} answered “${String(rule.response_equals)}”`;
}
