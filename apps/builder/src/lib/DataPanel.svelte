<script lang="ts">
  import {
    conditionFallbackNote,
    conditionFallbackOf,
    conditionSteps,
    DATAPIPE_URL,
    usesRecordings,
  } from "tachisto-compiler";
  import DataPipeSetup from "./DataPipeSetup.svelte";
  import { project } from "./project.svelte.ts";

  const mode = $derived(project.spec.data?.save ?? "none");
  const records = $derived(usesRecordings(project.spec));
  const asksForConditions = $derived(conditionSteps(project.spec).length > 0);
  const drawsLocally = $derived(conditionFallbackOf(project.spec.data) === "random");

  function setMode(value: string) {
    if (value === "none") delete project.spec.data;
    else if (value === "download") project.spec.data = { save: "download" };
    else project.spec.data = { save: "post", experiment_id: "" };
  }

  function setField(field: "experiment_id" | "endpoint", value: string) {
    if (!project.spec.data) return;
    if (value) project.spec.data[field] = value;
    else delete project.spec.data[field];
  }

  function setStreaming(stream: boolean) {
    if (!project.spec.data) return;
    if (stream) project.spec.data.stream = true;
    else delete project.spec.data.stream;
  }

  function setDrawsLocally(random: boolean) {
    if (!project.spec.data) return;
    if (random) project.spec.data.condition_fallback = "random";
    else delete project.spec.data.condition_fallback;
  }
</script>

<section>
  <h2>Data</h2>
  <select data-testid="data-mode" value={mode} onchange={(e) => setMode(e.currentTarget.value)}>
    <option value="none">not saved anywhere</option>
    <option value="download">download a CSV to the participant's computer</option>
    <option value="post">upload to DataPipe</option>
  </select>

  {#if mode === "none"}
    <p class="warn" data-testid="data-warning">
      This experiment keeps no results. Choose where data should go before you recruit anyone.
    </p>
  {/if}

  {#if mode === "post"}
    <DataPipeSetup />
    <label for="data-experiment-id">Experiment ID</label>
    <input
      id="data-experiment-id"
      data-testid="data-experiment-id"
      placeholder="from your DataPipe dashboard"
      value={project.spec.data?.experiment_id ?? ""}
      onchange={(e) => setField("experiment_id", e.currentTarget.value)}
    />
    <label for="data-endpoint">DataPipe address</label>
    <input
      id="data-endpoint"
      data-testid="data-endpoint"
      placeholder={DATAPIPE_URL}
      value={project.spec.data?.endpoint ?? ""}
      onchange={(e) => setField("endpoint", e.currentTarget.value)}
    />
    <p class="muted">
      If the upload fails, the participant is asked to download the file and send it to you, so
      nothing is lost.
    </p>
    <label class="check">
      <input
        type="checkbox"
        data-testid="data-stream"
        checked={project.spec.data?.stream === true}
        onchange={(e) => setStreaming(e.currentTarget.checked)}
      />
      Save each step as it is recorded
    </label>
    {#if project.spec.data?.stream}
      <p class="warn" data-testid="data-stream-consent">
        A participant who closes the page partway, withdrawing included, still leaves a partial file
        on DataPipe, recordings and all. Say so in your consent form. Every ending then keeps all
        the data.
      </p>
    {/if}
    {#if asksForConditions}
      <label class="check">
        <input
          type="checkbox"
          data-testid="data-condition-fallback"
          checked={drawsLocally}
          onchange={(e) => setDrawsLocally(e.currentTarget.checked)}
        />
        If DataPipe cannot hand out a group or order, draw one in the browser
      </label>
      <p class={drawsLocally ? "warn" : "muted"} data-testid="data-condition-fallback-note">
        {conditionFallbackNote(project.spec.data)}
      </p>
    {/if}
    {#if records}
      <p class="muted" data-testid="data-recordings">
        Each recording is uploaded as a sound or video file of its own, and the data names it. Turn
        on base64 data for this experiment in DataPipe; a recording that cannot be uploaded stays
        inside the data instead.
      </p>
    {/if}
  {:else if mode === "download" && records}
    <p class="muted" data-testid="data-recordings">
      Recordings stay inside the downloaded file, as text, so the participant sends you one file.
    </p>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  label {
    font-size: 0.85rem;
    color: var(--ink-muted);
  }
  .check {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .muted,
  .warn {
    margin: 0;
    font-size: 0.8rem;
  }
  .muted {
    color: var(--ink-muted);
  }
  .warn {
    color: var(--caution);
  }
</style>
