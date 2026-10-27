import type { Spec, SpecNode } from "./types.ts";
import { childrenOf, slotsOf } from "./variables.ts";

/**
 * Where a problem is, in words. A problem's path is indices into the spec, and a reader counts
 * steps from one — but not every index is a step: a branch or a split spends one on which of its
 * paths, so "step 2.1.1" would name a step that does not exist. Those segments are named instead.
 */
export function placeOf(spec: Spec, path: number[]): string {
  const parts: string[] = [];
  let nodes: SpecNode[] = spec.timeline;
  for (let position = 0; position < path.length; position += 1) {
    const index = path[position];
    const node: SpecNode | undefined = nodes[index];
    parts.push(`step ${index + 1}`);
    if (!node) return parts.join(", ");
    const slots = slotsOf(node);
    if (!slots) {
      nodes = childrenOf(node) ?? [];
      continue;
    }
    position += 1;
    if (position >= path.length) break;
    const slot = slots[path[position]];
    if (!slot) return parts.join(", ");
    parts.push(slot.name);
    nodes = slot.children;
  }
  return parts.join(", ");
}
