import { NODE_KINDS } from "./spec-schema.ts";
import type { Spec, SpecNode } from "./types.ts";
import { slotsOf } from "./variables.ts";

const KNOWN_KINDS = new Set<string>(NODE_KINDS);

function assertNodes(nodes: unknown, where: string): asserts nodes is SpecNode[] {
  if (!Array.isArray(nodes)) throw new Error(`${where} must be a list of steps`);
  for (const node of nodes as SpecNode[]) {
    const kind = node?.kind;
    if (!KNOWN_KINDS.has(kind)) throw new Error(`${where} holds a step of unknown kind "${kind}"`);
    if (kind === "trial") {
      if (typeof (node as { plugin?: unknown }).plugin !== "string") {
        throw new Error(`${where} holds a trial with no plugin`);
      }
    } else if (kind === "block" || kind === "loop") {
      assertNodes((node as { children?: unknown }).children, `${where} › ${kind}`);
    } else if (kind !== "checkpoint" && kind !== "end") {
      const slots: unknown = slotsOf(node);
      if (!Array.isArray(slots)) throw new Error(`${where} › ${kind} holds no list of paths`);
      for (const slot of slots as { name?: unknown; children?: unknown }[]) {
        assertNodes(slot?.children, `${where} › ${kind} › ${String(slot?.name)}`);
      }
    }
  }
}

/**
 * Whether this is a spec at all, before anything asks whether it is a good one. Shared by
 * everything that takes a spec from outside — a pasted one, a file, a call — so a wrong document
 * gets the same answer wherever it arrives, rather than one of them reaching the validator and
 * being told something puzzling about an experiment that was never there.
 */
export function assertSpecShape(parsed: unknown): asserts parsed is Spec {
  if (typeof (parsed as Spec | undefined)?.name !== "string") {
    throw new Error("it has no experiment name");
  }
  assertNodes((parsed as Spec).timeline, "timeline");
}
