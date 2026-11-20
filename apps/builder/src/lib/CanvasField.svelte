<script lang="ts">
  import type { Asset } from "tachisto-compiler";
  import type { ParameterSchema } from "tachisto-schemas";
  import CanvasStage from "./CanvasStage.svelte";
  import { stageFor } from "./canvas.ts";
  import ListField from "./ListField.svelte";
  import { project } from "./project.svelte.ts";

  interface Props {
    name: string;
    parameter: ParameterSchema;
    assets: Asset[];
    value: unknown;
    params: Record<string, unknown> | undefined;
    onchange: (objects: unknown[]) => void;
  }

  const { name, parameter, assets, value, params, onchange }: Props = $props();

  const EMPTY: unknown[] = [];
  const objects = $derived(Array.isArray(value) ? value : EMPTY);
  const stage = $derived(stageFor(params));
  const step = $derived(project.selection?.join(".") ?? "");

  // Remembering which step the choice was made in keeps it from carrying over to the next one.
  let chosen = $state<{ step: string; index: number } | null>(null);
  const selected = $derived(
    chosen && chosen.step === step && chosen.index < objects.length ? chosen.index : null,
  );

  const select = (index: number | null) => (chosen = index === null ? null : { step, index });
</script>

<CanvasStage testId={`stage-${name}`} {stage} {objects} {selected} onselect={select} {onchange} />
<ListField
  testId={`value-${name}`}
  {parameter}
  {assets}
  values={objects}
  {onchange}
  {selected}
  onselect={select}
/>
