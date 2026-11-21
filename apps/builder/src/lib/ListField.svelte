<script lang="ts">
  import type { Asset } from "tachisto-compiler";
  import type { ParameterSchema } from "tachisto-schemas";
  import ObjectField from "./ObjectField.svelte";
  import ScalarInput from "./ScalarInput.svelte";

  interface Props {
    testId: string;
    parameter: ParameterSchema;
    assets: Asset[];
    values: unknown[];
    onchange: (values: unknown[]) => void;
    selected?: number | null;
    onselect?: (index: number) => void;
  }

  const { testId, parameter, assets, values, onchange, selected, onselect }: Props = $props();

  const item = $derived(parameter.items ?? parameter);
  const entriesAreObjects = $derived(Boolean(item.properties));

  function update(index: number, value: unknown) {
    onchange(values.map((existing, position) => (position === index ? value : existing)));
  }

  function add() {
    onchange([...values, entriesAreObjects ? {} : ""]);
  }

  function remove(index: number) {
    onchange(values.filter((_, position) => position !== index));
  }

  function move(index: number, offset: number) {
    const target = index + offset;
    if (target < 0 || target >= values.length) return;
    const reordered = [...values];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    onchange(reordered);
  }
</script>

<div class="list">
  {#each values as entry, index (index)}
    <div class="entry" class:selected={selected === index} onfocusin={() => onselect?.(index)}>
      <span class="position">{index + 1}</span>
      {#if entriesAreObjects}
        <ObjectField
          schema={item}
          {assets}
          value={(entry ?? {}) as Record<string, unknown>}
          testId={`${testId}-${index}`}
          onchange={(next) => update(index, next)}
        />
      {:else}
        <ScalarInput
          parameter={item}
          {assets}
          value={entry}
          testId={`${testId}-${index}`}
          onchange={(next) => update(index, next)}
        />
      {/if}
      <span class="controls">
        <button title="move up" onclick={() => move(index, -1)}>↑</button>
        <button title="move down" onclick={() => move(index, 1)}>↓</button>
        <button
          title="remove"
          data-testid={`remove-${testId}-${index}`}
          onclick={() => remove(index)}>✕</button
        >
      </span>
    </div>
  {/each}
  <button class="add" data-testid={`add-${testId}`} onclick={add}>+ add</button>
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .entry {
    display: flex;
    gap: 0.3rem;
    align-items: start;
  }
  .entry.selected :global(.object) {
    border-color: var(--stimulus);
  }
  .entry > :global(.rich) {
    flex: 1;
  }
  .entry :global(textarea),
  .entry :global(input),
  .entry :global(select) {
    flex: 1;
  }
  .position {
    color: var(--ink-muted);
    font-size: 0.75rem;
    padding-top: 0.35rem;
    min-width: 1rem;
  }
  .controls button {
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
    padding: 0.1rem 0.2rem;
  }
  .add {
    align-self: start;
    font-size: 0.8rem;
    color: var(--ink-muted);
  }
</style>
