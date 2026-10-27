import { conditionColumns as columnsOfTable } from "@tachisto/compiler";
import {
  childrenOf,
  earlyEndingNames,
  nodesAlongPath,
  slotsOf,
  trialsOf,
} from "@tachisto/compiler";
import { assertSpecShape, SPEC_SCHEMA_ID } from "@tachisto/compiler";
import { firstFreeColumn, usualColumn } from "@tachisto/compiler";
import { unique } from "./lists.ts";
import { addEnding, DEFAULT_EARLY_ENDING } from "./recruitment.ts";
import { DEFAULT_THRESHOLD } from "./rules.ts";
import type {
  AssignNode,
  BranchNode,
  CounterbalanceNode,
  EndNode,
  Spec,
  SpecNode,
  TrialNode,
} from "@tachisto/compiler";

export type NodePath = number[];

const emptySpec = (): Spec => ({ name: "untitled-experiment", conditions: {}, timeline: [] });

/** Where the next step goes: which list, and the position in it. Kept apart from the selection,
 *  so clicking a step to edit it does not quietly move where new steps land. */
export interface Insertion {
  path: NodePath;
  index: number;
}

export const project = $state<{
  spec: Spec;
  selection: NodePath | null;
  insertion: Insertion;
  /** The address the open spec came from, when it came from one, so a link to it can be passed
   *  on. Owned here, beside the spec, because a stale one would hand out a link to a study that
   *  is no longer open. */
  sourceUrl?: string;
}>({
  spec: emptySpec(),
  selection: null,
  insertion: { path: [], index: 0 },
});

// A path walks the tree one index per level. A node with several child lists — a split's groups,
// a branch's paths — consumes two: the node, then which list, since a list is not a step itself.
export function childrenAt(path: NodePath): SpecNode[] {
  if (path.length === 0) return project.spec.timeline;
  const last = nodesAlongPath(project.spec.timeline, path).at(-1);
  if (!last) throw new Error(`no step at ${path.join(".")}`);
  const slots = slotsOf(last.node);
  if (slots) {
    const slot = slots[path[last.path.length]];
    if (!slot) throw new Error(`a ${last.node.kind} holds its steps in paths, and none was named`);
    return slot.children;
  }
  const children = childrenOf(last.node);
  if (!children) throw new Error(`a ${last.node.kind} cannot hold other steps`);
  return children;
}

export function nodeAt(path: NodePath): SpecNode {
  const parent = childrenAt(path.slice(0, -1));
  return parent[path[path.length - 1]];
}

// A selection can point at a group, which is a place to add steps rather than a step itself.
export function selectedNode(): SpecNode | null {
  if (!project.selection) return null;
  try {
    return nodeAt(project.selection) ?? null;
  } catch {
    return null;
  }
}

export function canHoldChildren(path: NodePath) {
  try {
    childrenAt(path);
    return true;
  } catch {
    return false;
  }
}

export function addNode(parentPath: NodePath, node: SpecNode) {
  const siblings = childrenAt(parentPath);
  siblings.push(node);
  project.selection = [...parentPath, siblings.length - 1];
}

/** Puts a step where the insertion point says, then moves the point past it and selects it. */
export function addAtInsertion(node: SpecNode) {
  const { path, index } = project.insertion;
  const siblings = childrenAt(path);
  const position = Math.min(index, siblings.length);
  siblings.splice(position, 0, node);
  project.insertion = { path, index: position + 1 };
  project.selection = [...path, position];
}

export function setInsertion(path: NodePath, index: number) {
  project.insertion = { path, index };
}

export function isInsertionAt(path: NodePath, index: number) {
  return project.insertion.index === index && project.insertion.path.join(".") === path.join(".");
}

export function removeNode(path: NodePath) {
  const parent = path.slice(0, -1);
  childrenAt(parent).splice(path[path.length - 1], 1);
  project.selection = null;
  // Keep the insertion point somewhere that still exists.
  project.insertion = { path: parent, index: childrenAt(parent).length };
}

export function moveNode(path: NodePath, offset: number) {
  const siblings = childrenAt(path.slice(0, -1));
  const index = path[path.length - 1];
  const target = index + offset;
  if (target < 0 || target >= siblings.length) return;
  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  project.selection = [...path.slice(0, -1), target];
}

export function newTrial(plugin: string, params: Record<string, unknown> = {}): TrialNode {
  return { kind: "trial", plugin, params: params as TrialNode["params"] };
}

// Containers arrive holding a step: an empty one is invalid the moment it is created, which reads
// as having done something wrong rather than as having started something.
export function newBlock(conditions: string, first: SpecNode): SpecNode {
  return { kind: "block", conditions, children: [first] };
}

// Every split and counterbalance records its choice in a column of its own, so a new one starts on
// the first name no other step records under.
function freeColumn(kind: "assign" | "counterbalance") {
  const column = firstFreeColumn(kind, project.spec.timeline);
  return column === usualColumn(kind) ? {} : { record_as: column };
}

export function newAssign(first: SpecNode, second: SpecNode): AssignNode {
  return {
    kind: "assign",
    method: "random",
    ...freeColumn("assign"),
    groups: [
      { name: "group 1", children: [first] },
      { name: "group 2", children: [second] },
    ],
  };
}

export function newCounterbalance(first: SpecNode, second: SpecNode): CounterbalanceNode {
  return {
    kind: "counterbalance",
    method: "random",
    ...freeColumn("counterbalance"),
    tasks: [
      { name: "task 1", children: [first] },
      { name: "task 2", children: [second] },
    ],
  };
}

export function newBranch(first: SpecNode): BranchNode {
  // A branch judges trials that already happened, so it starts on one the experiment has.
  const [existing] = tagsInUse();
  return {
    kind: "branch",
    when: { scope: existing ?? "", accuracy_at_least: DEFAULT_THRESHOLD },
    then: [first],
    otherwise: [],
  };
}

/** An end step reaches an ending that exists, adding one that shows a message if there is none. */
export function newEnd(): EndNode {
  const [existing] = earlyEndingNames(project.spec.recruitment);
  if (existing) return { kind: "end", ending: existing };
  addEnding(project.spec, DEFAULT_EARLY_ENDING);
  return { kind: "end", ending: DEFAULT_EARLY_ENDING };
}

export function newCheckpoint(): SpecNode {
  return { kind: "checkpoint", name: "checkpoint" };
}

const PRACTICE_TAG = "practice";

export function newLoop(first: SpecNode): SpecNode {
  // The loop measures trials carrying a tag, so its own first step carries one: the relationship
  // is visible from the start instead of being discovered through an error.
  if (first.kind === "trial") first.tag = PRACTICE_TAG;
  return {
    kind: "loop",
    repeat_while: { accuracy_below: 0.75, scope: PRACTICE_TAG },
    children: [first],
  };
}

/** Tags already used earlier in the experiment, which is what a branch can judge. */
export function tagsInUse(): string[] {
  return unique(trialsOf(project.spec.timeline).flatMap((trial) => (trial.tag ? [trial.tag] : [])));
}

export function conditionTableNames() {
  return Object.keys(project.spec.conditions ?? {});
}

export function conditionColumns(table: string) {
  return columnsOfTable(project.spec, table);
}

export function assetOptions() {
  return project.spec.assets ?? [];
}

export function allConditionColumns() {
  return unique(conditionTableNames().flatMap(conditionColumns));
}

export function parseSpec(text: string): Spec {
  const parsed: unknown = JSON.parse(text);
  assertSpecShape(parsed);
  return parsed;
}

export function startNewProject() {
  project.spec = emptySpec();
  project.selection = null;
  project.insertion = { path: [], index: 0 };
  project.sourceUrl = undefined;
}

/** Nothing has been made here yet, so replacing it loses nothing. */
export function isUntouched() {
  return JSON.stringify(project.spec) === JSON.stringify(emptySpec());
}

export function loadSpec(spec: Spec, sourceUrl?: string) {
  project.spec = { conditions: {}, ...spec };
  project.selection = null;
  project.insertion = { path: [], index: spec.timeline.length };
  project.sourceUrl = sourceUrl;
}

/** Examples are shared module data, so each opening edits its own copy. */
export function openExample(spec: Spec) {
  loadSpec(structuredClone(spec));
}

export function exportedSpec(): Spec {
  // Only the fields the builder keeps empty placeholders for are pruned; everything else passes
  // through, so a field added to the spec format is never dropped from exports by omission.
  const { $schema: _opened, authors, settings, assets, conditions, ...rest } = project.spec;
  const spec: Spec = { $schema: SPEC_SCHEMA_ID, ...rest };
  const named = (authors ?? []).filter((author) => author.name.trim());
  if (named.length > 0) spec.authors = named;
  if (settings && Object.keys(settings).length > 0) spec.settings = settings;
  if (assets?.length) spec.assets = assets;
  if (Object.keys(conditions ?? {}).length > 0) spec.conditions = conditions;
  return spec;
}
