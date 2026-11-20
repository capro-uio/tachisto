<script lang="ts">
  import { isError, slotsOf } from "tachisto-compiler";
  import AddStep from "./AddStep.svelte";
  import { usesCode } from "./code.ts";
  import { pluginTitle } from "./schemas.ts";
  import { currentProblems, problemsAt } from "./problems.svelte.ts";
  import type { SpecNode } from "tachisto-compiler";
  import Tree from "./Tree.svelte";
  import { moveNode, project, removeNode, type NodePath } from "./project.svelte.ts";
  import { describeAccuracy, describeBranchRule } from "./rules.ts";

  interface Props {
    nodes: SpecNode[];
    path?: NodePath;
  }

  const { nodes, path = [] }: Props = $props();

  function label(node: SpecNode) {
    if (node.kind === "trial") return pluginTitle(node.plugin) + (node.tag ? ` · ${node.tag}` : "");
    if (node.kind === "block") {
      const rows = (project.spec.conditions?.[node.conditions] ?? []).length;
      const repeats = node.repetitions && node.repetitions > 1 ? ` × ${node.repetitions}` : "";
      return `once for each of ${rows} rows${repeats} · ${node.conditions}`;
    }
    if (node.kind === "checkpoint") return `reached “${node.name}”`;
    if (node.kind === "end") return `finish as “${node.ending || "…"}”`;
    if (node.kind === "assign") {
      return `${node.groups.map((group) => group.name).join(" or ")} · ${node.method}`;
    }
    if (node.kind === "counterbalance") {
      const order = node.method === "random" ? "random" : "Latin-square";
      return `${node.tasks.map((task) => task.name).join(", ")} · ${order} order`;
    }
    if (node.kind === "branch") return describeBranchRule(node.when);
    return `repeat while accuracy ${describeAccuracy(node.repeat_while)}`;
  }

  const problems = $derived(currentProblems());

  const isSelected = (childPath: NodePath) => project.selection?.join(".") === childPath.join(".");
</script>

<ul>
  {#each nodes as node, index (node)}
    <AddStep {path} {index} variant="between" />
    {@const childPath = [...path, index]}
    {@const here = problemsAt(problems, childPath)}
    {@const error = here.find(isError)}
    {@const warning = here.find((problem) => !isError(problem))}
    <li>
      <div class="row" class:selected={isSelected(childPath)}>
        <button
          class="label"
          data-testid={`node-${childPath.join("-")}`}
          onclick={() => (project.selection = childPath)}
        >
          <span class="kind">{node.kind}</span>
          {label(node)}
          {#if usesCode(node)}
            <span class="code-badge" title="Runs code written for this study">code</span>
          {/if}
          {#if error}
            <span class="issue" data-testid={`issue-${childPath.join("-")}`} title={error.message}
              >needs attention</span
            >
          {:else if warning}
            <span
              class="caution"
              data-testid={`caution-${childPath.join("-")}`}
              title={warning.message}><span aria-hidden="true">⚠</span> worth checking</span
            >
          {/if}
        </button>
        <span class="controls">
          <button title="move up" onclick={() => moveNode(childPath, -1)}>↑</button>
          <button title="move down" onclick={() => moveNode(childPath, 1)}>↓</button>
          <button
            title="delete"
            data-testid={`delete-${childPath.join("-")}`}
            onclick={() => removeNode(childPath)}>✕</button
          >
        </span>
      </div>
      {#if slotsOf(node)}
        {#each slotsOf(node) ?? [] as slot, slotIndex (slotIndex)}
          <div class="group">
            <button
              class="group-name"
              class:selected={isSelected([...childPath, slotIndex])}
              data-testid={`group-${[...childPath, slotIndex].join("-")}`}
              onclick={() => (project.selection = [...childPath, slotIndex])}
            >
              {slot.name}
            </button>
            <Tree nodes={slot.children} path={[...childPath, slotIndex]} />
          </div>
        {/each}
      {:else if node.kind === "block" || node.kind === "loop"}
        <Tree nodes={node.children} path={childPath} />
      {/if}
    </li>
  {/each}
  <AddStep {path} index={nodes.length} />
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding-left: 0.9rem;
  }
  .row {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    border-radius: var(--radius-md);
    padding: 0.1rem 0.2rem;
  }
  .row.selected {
    background: var(--stimulus-tint);
  }
  .code-badge {
    font-family: var(--font-mono);
    font-size: 0.68rem;
    padding: 0 0.3rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    color: var(--ink-muted);
  }
  .issue {
    display: block;
    font-size: 0.7rem;
    color: var(--danger);
  }
  .caution {
    display: block;
    font-size: 0.7rem;
    color: var(--caution);
  }
  .group {
    border-left: 2px solid var(--line);
    margin-left: 0.5rem;
    padding-left: 0.2rem;
  }
  .group-name {
    font-size: 0.75rem;
    color: var(--ink-muted);
    background: none;
    border: 0;
    cursor: pointer;
    padding: 0.1rem 0.4rem;
    border-radius: var(--radius-sm);
  }
  .group-name.selected {
    background: var(--stimulus-tint);
    color: inherit;
  }
  .label {
    flex: 1;
    text-align: left;
    background: none;
    border: 0;
    padding: 0.2rem;
    cursor: pointer;
    color: inherit;
    font: inherit;
  }
  .kind {
    font-size: 0.7rem;
    text-transform: uppercase;
    color: var(--ink-muted);
    margin-right: 0.35rem;
  }
  .controls button {
    background: none;
    border: 0;
    cursor: pointer;
    color: var(--ink-muted);
    padding: 0.1rem 0.2rem;
  }
  .controls button:hover {
    color: var(--ink);
  }
</style>
