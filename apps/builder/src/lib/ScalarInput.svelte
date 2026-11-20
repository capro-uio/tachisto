<script lang="ts">
  import { isMediaType } from "tachisto-compiler";
  import type { Asset } from "tachisto-compiler";
  import type { ParameterSchema } from "tachisto-schemas";
  import { fileChoices } from "./files.ts";
  import RichText from "./RichText.svelte";
  import { asText } from "./text.ts";

  interface Props {
    parameter: ParameterSchema;
    assets: Asset[];
    value: unknown;
    testId: string;
    onchange: (value: unknown) => void;
  }

  const { parameter, assets, value, testId, onchange }: Props = $props();

  const media = $derived(isMediaType(parameter.jspsychType));
  const files = $derived(media ? fileChoices(assets, parameter.jspsychType, value) : []);
  const placeholder = $derived(
    typeof parameter.default === "string" || typeof parameter.default === "number"
      ? String(parameter.default)
      : undefined,
  );
  const numeric = $derived(parameter.jspsychType === "INT" || parameter.jspsychType === "FLOAT");

  function parseKeys(raw: string) {
    const trimmed = raw.trim();
    if (trimmed === "ALL_KEYS" || trimmed === "NO_KEYS") return trimmed;
    return trimmed
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
  }
</script>

{#if parameter.jspsychType === "BOOL"}
  <input
    data-testid={testId}
    type="checkbox"
    checked={Boolean(value ?? parameter.default)}
    onchange={(event) => onchange(event.currentTarget.checked)}
  />
{:else if numeric}
  <input
    data-testid={testId}
    type="number"
    value={value as number}
    {placeholder}
    onchange={(event) =>
      onchange(
        Number.isNaN(event.currentTarget.valueAsNumber)
          ? undefined
          : event.currentTarget.valueAsNumber,
      )}
  />
{:else if files.length > 0}
  <select
    data-testid={testId}
    value={value as string}
    onchange={(event) => onchange(event.currentTarget.value)}
  >
    <option value="">choose a file</option>
    {#each files as file (file)}
      <option value={file}>{file}</option>
    {/each}
  </select>
{:else if parameter.enum}
  <select
    data-testid={testId}
    value={value as string}
    onchange={(event) => onchange(event.currentTarget.value)}
  >
    {#each parameter.enum as option (option)}
      <option value={option as string}>{option as string}</option>
    {/each}
  </select>
{:else if parameter.jspsychType === "KEYS"}
  <input
    data-testid={testId}
    value={Array.isArray(value) ? value.join(",") : asText(value)}
    placeholder="f,j or ALL_KEYS"
    onchange={(event) => onchange(parseKeys(event.currentTarget.value))}
  />
{:else if parameter.jspsychType === "HTML_STRING"}
  <RichText {testId} value={(value as string) ?? ""} {onchange} />
{:else}
  <input
    data-testid={testId}
    value={value as string}
    {placeholder}
    onchange={(event) => onchange(event.currentTarget.value)}
  />
{/if}

<style>
  input:not([type="checkbox"]),
  select {
    width: 100%;
  }
</style>
