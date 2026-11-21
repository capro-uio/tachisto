<script lang="ts">
  import {
    addAtInsertion,
    conditionTableNames,
    isInsertionAt,
    newBlock,
    newBranch,
    newCheckpoint,
    newCounterbalance,
    newEnd,
    newLoop,
    newTrial,
    setInsertion,
    type NodePath,
  } from "./project.svelte.ts";
  import type { SpecNode } from "tachisto-compiler";
  import { newAssign } from "./project.svelte.ts";
  import { startingParams } from "./schemas.ts";

  interface Props {
    path: NodePath;
    index: number;
    variant?: "between" | "end" | "first";
  }

  const { path, index, variant = "end" }: Props = $props();

  const DEFAULT_PLUGIN = "html-keyboard-response";
  const testId = $derived(`slot-${[...path, index].join("-")}`);

  let open = $state(false);
  const active = $derived(isInsertionAt(path, index) || open);

  const tables = $derived(conditionTableNames());
  const trial = () => newTrial(DEFAULT_PLUGIN, startingParams(DEFAULT_PLUGIN));

  const choices = $derived([
    { id: "trial", label: "Trial", hint: "show something and collect a response", make: trial },
    {
      id: "block",
      label: "Block",
      hint: tables.length > 0 ? "repeat steps once per row of a table" : "needs a conditions table",
      disabled: tables.length === 0,
      make: () => newBlock(tables[0], trial()),
    },
    {
      id: "loop",
      label: "Loop",
      hint: "repeat steps until performance is good enough",
      make: () => newLoop(trial()),
    },
    {
      id: "assign",
      label: "Split",
      hint: "send each participant down one of several paths",
      make: () => newAssign(trial(), trial()),
    },
    {
      id: "counterbalance",
      label: "Counterbalance",
      hint: "run several tasks in an order that differs between participants",
      make: () => newCounterbalance(trial(), trial()),
    },
    {
      id: "branch",
      label: "Branch",
      hint: "choose a path based on how they did",
      make: () => newBranch(trial()),
    },
    {
      id: "checkpoint",
      label: "Checkpoint",
      hint: "record that they got this far",
      make: newCheckpoint,
    },
    {
      id: "end",
      label: "End",
      hint: "finish the study here, e.g. when consent is declined",
      make: newEnd,
    },
  ]);

  function toggle() {
    setInsertion(path, index);
    open = !open;
  }

  function add(make: () => SpecNode) {
    setInsertion(path, index);
    addAtInsertion(make());
    open = false;
  }
</script>

{#if variant === "between"}
  <div class="slot-row">
    <button
      class="slot"
      class:active
      data-testid={testId}
      title="Add a step here"
      aria-label="Add a step here"
      aria-expanded={open}
      onclick={toggle}><span class="mark slot-mark" aria-hidden="true">+</span></button
    >
  </div>
{:else}
  <button
    class="add"
    class:primary={variant === "first"}
    class:active
    data-testid={testId}
    aria-expanded={open}
    onclick={toggle}><span class="mark add-mark" aria-hidden="true">+</span>Add step</button
  >
{/if}

{#if open}
  <div class="menu" data-testid={`${testId}-menu`}>
    {#each choices as choice (choice.id)}
      <button
        data-testid={`${testId}-${choice.id}`}
        disabled={choice.disabled}
        onclick={() => add(choice.make)}
      >
        <strong>{choice.label}</strong>
        <span>{choice.hint}</span>
      </button>
    {/each}
    <button class="cancel" data-testid={`${testId}-cancel`} onclick={() => (open = false)}>
      cancel
    </button>
  </div>
{/if}

<style>
  .slot-row {
    height: 0.9rem;
    display: flex;
    align-items: center;
  }
  .slot {
    position: relative;
    flex: 1;
    height: 100%;
    border: 0;
    border-radius: 0;
    background: none;
    cursor: copy;
    padding: 0;
    border-top: 2px solid transparent;
  }
  .mark {
    display: grid;
    place-items: center;
    border-radius: 50%;
    background: var(--stimulus-fill);
    color: var(--on-stimulus);
    line-height: 1;
  }
  .slot-mark {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-60%);
    width: 1.1rem;
    height: 1.1rem;
    font-size: 0.8rem;
    opacity: 0;
  }
  .slot:hover,
  .slot:focus-visible,
  .slot.active {
    border-top-color: color-mix(in srgb, var(--stimulus) 45%, transparent);
  }
  .slot.active {
    border-top-color: var(--stimulus);
  }
  .slot:hover .slot-mark,
  .slot:focus-visible .slot-mark,
  .slot.active .slot-mark {
    opacity: 1;
  }
  .add {
    display: inline-flex;
    align-self: flex-start;
    align-items: center;
    gap: var(--space-2);
    min-height: 2rem;
    margin: var(--space-3) 0 var(--space-1);
    padding: var(--space-1) var(--space-3) var(--space-1) var(--space-2);
    border-style: dashed;
    color: var(--stimulus-text);
    font-size: 0.85rem;
    font-weight: 600;
  }
  .add:hover,
  .add.active {
    border-style: solid;
    border-color: var(--stimulus);
    background: var(--stimulus-tint);
  }
  .add-mark {
    width: 1.2rem;
    height: 1.2rem;
    font-size: 0.95rem;
  }
  .add.primary {
    border: 1px solid var(--stimulus-fill);
    background: var(--stimulus-fill);
    color: var(--on-stimulus);
    min-height: 2.5rem;
    margin-top: var(--space-1);
    padding-inline: var(--space-3) var(--space-4);
    font-size: 0.95rem;
  }
  .add.primary .add-mark {
    background: var(--on-stimulus);
    color: var(--stimulus-fill);
  }
  .add.primary:hover,
  .add.primary.active {
    background: color-mix(in srgb, var(--stimulus-fill) 85%, var(--ink));
  }
  .menu {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 0.25rem;
    margin: 0.15rem 0;
  }
  .menu button {
    display: flex;
    flex-direction: column;
    text-align: left;
    border: 0;
    background: none;
    cursor: pointer;
    padding: 0.25rem;
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
  }
  .menu button:hover:not(:disabled) {
    background: var(--paper-sunk);
  }
  .menu button span {
    color: var(--ink-muted);
    font-size: 0.75rem;
  }
  .menu button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cancel {
    color: var(--ink-muted);
    font-size: 0.75rem;
  }
</style>
