<script lang="ts">
  import type { ParameterSchema } from "tachisto-schemas";
  import { gridShape } from "tachisto-compiler";
  import { addColumn, addRow, removeColumn, removeRow, setCell, type Grid } from "./grid.ts";

  interface Props {
    name: string;
    testId: string;
    parameter: ParameterSchema;
    value: Grid;
    onchange: (grid: Grid) => void;
  }

  const { name, testId, parameter, value, onchange }: Props = $props();

  const shape = $derived(gridShape(parameter));
  // A whole number is still a number to whoever fills it in.
  const place = $derived(shape.place === "integer" ? "number" : shape.place);
</script>

<div class="grid-field">
  <table data-testid={testId} aria-label={`${name}: ${place}s by row`}>
    <tbody>
      {#each value as row, rowIndex (rowIndex)}
        <tr>
          {#each row as entry, columnIndex (columnIndex)}
            <td>
              {#if shape.place === "square"}
                <input
                  type="checkbox"
                  aria-label={`${place} at row ${rowIndex + 1}, column ${columnIndex + 1}`}
                  data-testid={`${testId}-${rowIndex}-${columnIndex}`}
                  checked={entry === 1}
                  onchange={(event) =>
                    onchange(
                      setCell(value, rowIndex, columnIndex, event.currentTarget.checked ? 1 : 0),
                    )}
                />
              {:else if place === "number"}
                <input
                  class="number"
                  type="number"
                  step={shape.place === "integer" ? 1 : "any"}
                  aria-label={`${place} at row ${rowIndex + 1}, column ${columnIndex + 1}`}
                  data-testid={`${testId}-${rowIndex}-${columnIndex}`}
                  value={typeof entry === "number" ? entry : ""}
                  onchange={(event) => {
                    // A cleared place is kept as cleared, for the validator to point out, rather
                    // than going on to run with the number it no longer shows.
                    const number = event.currentTarget.valueAsNumber;
                    const entered = Number.isFinite(number) ? number : "";
                    onchange(setCell(value, rowIndex, columnIndex, entered));
                  }}
                />
              {:else}
                <input
                  class="key"
                  aria-label={`${place} at row ${rowIndex + 1}, column ${columnIndex + 1}`}
                  data-testid={`${testId}-${rowIndex}-${columnIndex}`}
                  value={typeof entry === "string" ? entry : ""}
                  onchange={(event) =>
                    onchange(setCell(value, rowIndex, columnIndex, event.currentTarget.value))}
                />
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
  <div class="controls">
    <button
      type="button"
      data-testid={`${testId}-add-row`}
      onclick={() => onchange(addRow(value, parameter))}>+ row</button
    >
    <button
      type="button"
      data-testid={`${testId}-remove-row`}
      onclick={() => onchange(removeRow(value))}>− row</button
    >
    {#if shape.width === undefined}
      <button
        type="button"
        data-testid={`${testId}-add-column`}
        onclick={() => onchange(addColumn(value, parameter))}>+ column</button
      >
      <button
        type="button"
        data-testid={`${testId}-remove-column`}
        onclick={() => onchange(removeColumn(value))}>− column</button
      >
    {/if}
  </div>
</div>

<style>
  .grid-field {
    display: grid;
    gap: 0.3rem;
    justify-items: start;
  }
  table {
    border-collapse: collapse;
  }
  td {
    padding: 0.15rem;
    text-align: center;
  }
  .key {
    width: 2.5rem;
    text-align: center;
  }
  .number {
    width: 4.5rem;
  }
  .controls {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
  }
</style>
