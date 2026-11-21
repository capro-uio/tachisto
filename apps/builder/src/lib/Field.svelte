<script lang="ts">
  import type { ParameterSchema } from "tachisto-schemas";
  import { isCode, isVariableReference, takesFunction } from "tachisto-compiler";
  import CanvasField from "./CanvasField.svelte";
  import CodeInput from "./CodeInput.svelte";
  import GridField from "./GridField.svelte";
  import { firstRow } from "./grid.ts";
  import { codeHint, codeSeed } from "./code.ts";
  import ListField from "./ListField.svelte";
  import ScalarInput from "./ScalarInput.svelte";
  import type { Asset, ParameterValue } from "tachisto-compiler";

  interface Props {
    assets: Asset[];
    name: string;
    parameter: ParameterSchema;
    required: boolean;
    columns: string[];
    value: ParameterValue | undefined;
    onchange: (value: ParameterValue | undefined) => void;
    /** The step's other settings, for an editor that depends on them. */
    params?: Record<string, unknown>;
  }

  const { assets, name, parameter, required, columns, value, onchange, params }: Props = $props();

  const grid = $derived(parameter.format === "grid");
  // KEYS keeps its comma-separated control: it accepts "ALL_KEYS" as well as a list.
  const list = $derived(parameter.type === "array" && parameter.jspsychType !== "KEYS" && !grid);

  const isBound = $derived(value !== undefined && isVariableReference(value));
  // A parameter that takes a function can only be given one as code.
  const isFunction = $derived(takesFunction(parameter.jspsychType));
  // Null is how jsPsych leaves a function parameter without one.
  const unset = $derived(value === undefined || (isFunction && value === null));
  // A function parameter holding anything but code is shown as code to be written, not as a value.
  const code = $derived(isCode(value) ? value.code : isFunction && !unset ? "" : null);
  const boundValue = $derived(isBound ? (value as { var: string; wrap?: string }) : null);
  const multiline = $derived(parameter.jspsychType === "HTML_STRING");

  const numeric = $derived(parameter.jspsychType === "INT" || parameter.jspsychType === "FLOAT");

  function fixedSeed(): ParameterValue {
    if (grid) {
      return Array.isArray(parameter.default)
        ? (structuredClone(parameter.default) as unknown[][])
        : firstRow(parameter);
    }
    if (list)
      return Array.isArray(parameter.default) ? [...(parameter.default as unknown[])] : [""];
    if (parameter.jspsychType === "BOOL") return Boolean(parameter.default);
    if (numeric) {
      if (typeof parameter.default === "number") return parameter.default;
      // jsPsych's null means none, such as no width set; a 0 would hide a slider or stop a video.
      return parameter.default === null ? null : 0;
    }
    if (parameter.enum) return parameter.enum[0] as string;
    // As with numbers, jsPsych's null means none: an empty file name would be loaded as a file.
    if (parameter.default === null) return null;
    return typeof parameter.default === "string" ? parameter.default : "";
  }

  function setMode(mode: string) {
    if (mode === "column") onchange({ var: columns[0] ?? "" });
    else if (mode === "code") onchange({ code: codeSeed(parameter, value) });
    else if (mode === "unset") onchange(undefined);
    else onchange(fixedSeed());
  }

  const mode = $derived(unset ? "unset" : code !== null ? "code" : isBound ? "column" : "fixed");
</script>

<div class="field">
  <label for={`param-${name}`}>
    <span class="name">{name}</span>
    {#if required}<span class="required" title="required">*</span>{/if}
  </label>

  <select
    aria-label={`${name} source`}
    data-testid={`mode-${name}`}
    value={mode}
    onchange={(event) => setMode(event.currentTarget.value)}
  >
    <option value="unset">default</option>
    {#if !isFunction}
      <option value="fixed">fixed value</option>
      <option value="column" disabled={columns.length === 0}>from column</option>
    {/if}
    <option value="code">code</option>
  </select>

  {#if code !== null}
    <div class="wide">
      <CodeInput
        {code}
        label={`${name} code`}
        hint={codeHint(parameter)}
        id={`param-${name}`}
        testId={`code-${name}`}
        onchange={(next: string | null) => onchange(next === null ? undefined : { code: next })}
      />
    </div>
  {:else if mode === "column" && boundValue}
    <select
      data-testid={`column-${name}`}
      value={boundValue.var}
      onchange={(event) => onchange({ ...boundValue, var: event.currentTarget.value })}
    >
      {#each columns as column (column)}
        <option value={column}>{column}</option>
      {/each}
    </select>
    {#if multiline}
      <input
        data-testid={`wrap-${name}`}
        placeholder={"wrap in HTML, {} is the value"}
        value={boundValue.wrap ?? ""}
        onchange={(event) =>
          onchange(
            event.currentTarget.value
              ? { ...boundValue, wrap: event.currentTarget.value }
              : { var: boundValue.var },
          )}
      />
    {/if}
  {:else if mode === "fixed"}
    {#if grid}
      <div class="wide">
        <GridField
          {name}
          testId={`value-${name}`}
          {parameter}
          value={Array.isArray(value) ? (value as unknown[][]) : []}
          onchange={(next: unknown[][]) => onchange(next)}
        />
      </div>
    {:else if list}
      <div class="wide">
        {#if parameter.editor === "canvas"}
          <CanvasField
            {name}
            {parameter}
            {assets}
            {value}
            {params}
            onchange={(values) => onchange(values as ParameterValue)}
          />
        {:else}
          <ListField
            testId={`value-${name}`}
            {parameter}
            {assets}
            values={Array.isArray(value) ? value : []}
            onchange={(values) => onchange(values as ParameterValue)}
          />
        {/if}
      </div>
    {:else if multiline}
      <div class="wide">
        <ScalarInput
          {parameter}
          {assets}
          {value}
          testId={`value-${name}`}
          onchange={(next) => onchange(next as ParameterValue)}
        />
      </div>
    {:else}
      <ScalarInput
        {parameter}
        {assets}
        {value}
        testId={`value-${name}`}
        onchange={(next) => onchange(next as ParameterValue)}
      />
    {/if}
  {/if}

  {#if parameter.description}
    <p class="help" title={parameter.description}>{parameter.description}</p>
  {/if}
</div>

<style>
  .field {
    display: grid;
    grid-template-columns: 11rem 9rem 1fr;
    gap: 0.4rem 0.6rem;
    align-items: start;
    padding: 0.4rem 0;
    border-top: 1px solid var(--line);
  }
  label {
    font-weight: 600;
  }
  .required {
    color: var(--danger);
  }
  .wide {
    grid-column: 1 / -1;
  }
  /* A full-width control leaves no third column for its explanation to sit in. */
  .wide ~ .help {
    grid-column: 1 / -1;
  }
  .help {
    grid-column: 3;
    margin: 0;
    font-size: 0.78rem;
    color: var(--ink-muted);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
