<script lang="ts">
  import { isCode, takesFunction, type Asset } from "tachisto-compiler";
  import type { ParameterSchema } from "tachisto-schemas";
  import CodeInput from "./CodeInput.svelte";
  import { codeHint } from "./code.ts";
  import ListField from "./ListField.svelte";
  import ScalarInput from "./ScalarInput.svelte";
  import { switchVariant, visibleFields } from "./schemas.ts";

  interface Props {
    schema: ParameterSchema;
    assets: Asset[];
    value: Record<string, unknown>;
    testId: string;
    onchange: (value: Record<string, unknown>) => void;
  }

  const { schema, assets, value, testId, onchange }: Props = $props();

  const fields = $derived(visibleFields(schema, value));
  const isRequired = (name: string) => (schema.required ?? []).includes(name);

  function update(name: string, next: unknown) {
    if (schema.variants && name === schema.variants.by && typeof next === "string") {
      onchange(switchVariant(schema.variants, value, next));
      return;
    }
    const merged = { ...value };
    if ((next === "" || next === undefined) && !isRequired(name)) delete merged[name];
    else merged[name] = next;
    onchange(merged);
  }
</script>

<div class="object">
  {#each fields as [name, field] (name)}
    <label for={`${testId}-${name}`}>
      {name}{#if isRequired(name)}<span class="required">*</span>{/if}
    </label>
    <div class="control">
      {#if takesFunction(field.jspsychType) || isCode(value[name])}
        {@const current = value[name]}
        <CodeInput
          code={isCode(current) ? current.code : ""}
          label={`${name} code`}
          hint={codeHint(field)}
          id={`${testId}-${name}`}
          testId={`${testId}-${name}`}
          onchange={(next: string | null) => update(name, next === null ? "" : { code: next })}
        />
      {:else if field.type === "array" && field.jspsychType !== "KEYS"}
        <ListField
          testId={`${testId}-${name}`}
          parameter={field}
          {assets}
          values={Array.isArray(value[name]) ? (value[name] as unknown[]) : []}
          onchange={(entries) => update(name, entries)}
        />
      {:else}
        <ScalarInput
          parameter={field}
          {assets}
          value={value[name]}
          testId={`${testId}-${name}`}
          onchange={(next) => update(name, next)}
        />
      {/if}
    </div>
  {/each}
</div>

<style>
  .object {
    display: grid;
    grid-template-columns: 7rem 1fr;
    gap: 0.3rem 0.5rem;
    align-items: start;
    flex: 1;
    padding: 0.4rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }
  label {
    font-size: 0.8rem;
    color: var(--ink-muted);
    padding-top: 0.3rem;
  }
  .required {
    color: var(--danger);
  }
</style>
