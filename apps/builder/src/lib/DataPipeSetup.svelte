<script lang="ts">
  import { untrack } from "svelte";
  import { dataPipeSetup, type SetupField } from "tachisto-compiler";
  import { project } from "./project.svelte.ts";

  const setup = $derived(dataPipeSetup(project.spec));

  let open = $state(untrack(() => !project.spec.data?.experiment_id));
  let copied = $state<string | undefined>();
  let copyStatus = $state("");

  const testId = (label: string) =>
    `datapipe-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;

  async function copy(field: SetupField) {
    if (!field.value) return;
    try {
      await navigator.clipboard.writeText(field.value);
      copied = field.label;
      copyStatus = `${field.label} copied`;
    } catch {
      copied = undefined;
      copyStatus = `${field.label} could not be copied; select the text instead`;
    }
  }
</script>

{#snippet setupField(field: SetupField)}
  <div class="field" data-testid={testId(field.label)}>
    <span class="label">{field.label}</span>
    {#if field.value}
      <span class="value-row">
        <code data-testid={`${testId(field.label)}-value`}>{field.value}</code>
        <button
          type="button"
          aria-label={`Copy ${field.label.replace(/\?$/, "").toLowerCase()}`}
          data-testid={`${testId(field.label)}-copy`}
          onclick={() => copy(field)}>{copied === field.label ? "copied" : "copy"}</button
        >
      </span>
    {/if}
    <span class="muted">{field.note}</span>
  </div>
{/snippet}

<details class="setup" data-testid="datapipe-setup" bind:open>
  <summary>Set up DataPipe</summary>
  <ol>
    <li>
      <h3>{setup.titles.create}</h3>
      <p>
        On
        {#if setup.link}
          <a href={setup.link} target="_blank" rel="noopener noreferrer">DataPipe</a>,
        {:else}
          DataPipe ({setup.address}),
        {/if}
        start a new experiment and choose where it stores the data:
      </p>
      <ul class="storage">
        {#each setup.storage as choice (choice.name)}
          <li><strong>{choice.name}</strong>: {choice.note}</li>
        {/each}
      </ul>
      <p class="muted">{setup.closedStorage}</p>
      {#each setup.experiment as field (field.label)}
        {@render setupField(field)}
      {/each}
    </li>
    <li>
      <h3>{setup.titles.dashboard}</h3>
      {#each setup.dashboard as setting (setting.setting)}
        <div class="setting" data-testid={testId(setting.setting)}>
          <span class="setting-name">
            {setting.setting}
            <strong
              class={`state ${setting.value}`}
              data-testid={`${testId(setting.setting)}-state`}>{setting.value}</strong
            >
          </span>
          {#if setting.warning}
            <p class="warn" data-testid={`${testId(setting.setting)}-warning`}>{setting.warning}</p>
          {/if}
          {#each setting.fields as field (field.label)}
            {@render setupField(field)}
          {/each}
          <span class="muted">{setting.note}</span>
        </div>
      {/each}
      <div class="setting">
        <span class="setting-name">{setup.titles.partialFiles}</span>
        <span class="muted" data-testid="datapipe-partial-files">{setup.partialFiles}</span>
      </div>
    </li>
    <li>
      <h3>{setup.titles.paste}</h3>
      <p class="muted">{setup.whereTheIdIs} Paste it just below.</p>
    </li>
  </ol>
  <p class="visually-hidden" role="status" data-testid="datapipe-copy-status">{copyStatus}</p>
</details>

<style>
  .setup {
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: 0.3rem 0.5rem;
    font-size: 0.8rem;
  }
  summary {
    cursor: pointer;
    font-weight: 600;
    font-size: 0.85rem;
  }
  ol {
    margin: 0.4rem 0 0;
    padding-left: 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  ol > li {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  h3 {
    margin: 0;
    font-size: 0.85rem;
  }
  p {
    margin: 0;
  }
  .storage {
    margin: 0;
    padding-left: 1rem;
  }
  .field,
  .setting {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .setting {
    padding-top: 0.35rem;
    border-top: 1px solid var(--line);
  }
  .label,
  .setting-name {
    font-weight: 600;
  }
  .setting-name {
    display: flex;
    justify-content: space-between;
    gap: 0.4rem;
  }
  .state {
    flex: none;
    font-family: var(--font-mono);
    font-weight: 700;
  }
  .state.on {
    color: var(--signal);
  }
  .state.off,
  .state.optional {
    color: var(--ink-muted);
  }
  .value-row {
    display: flex;
    gap: 0.3rem;
    align-items: flex-start;
  }
  code {
    flex: 1;
    min-width: 0;
    padding: 0.15rem 0.3rem;
    border-radius: var(--radius-sm);
    background: var(--paper-sunk);
    font-family: var(--font-mono);
    overflow-wrap: anywhere;
  }
  .value-row button {
    flex: none;
    font-size: 0.75rem;
  }
  .muted {
    color: var(--ink-muted);
  }
  .warn {
    color: var(--caution);
    font-weight: 600;
  }
</style>
