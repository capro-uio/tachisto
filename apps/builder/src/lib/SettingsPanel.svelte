<script lang="ts">
  import { backgroundColor, textColor } from "tachisto-compiler";
  import { project } from "./project.svelte.ts";

  type Setting =
    | "default_iti"
    | "minimum_valid_rt"
    | "show_progress_bar"
    | "progress_bar_message"
    | "background_color"
    | "text_color";

  function set(field: Setting, value: number | string | boolean | undefined) {
    project.spec.settings ??= {};
    if (value === undefined || value === "" || Number.isNaN(value)) {
      delete project.spec.settings[field];
    } else {
      (project.spec.settings as Record<string, unknown>)[field] = value;
    }
    if (Object.keys(project.spec.settings).length === 0) delete project.spec.settings;
  }
</script>

<section>
  <h2>Experiment settings</h2>
  <p class="muted">Apply to every step unless a step sets its own.</p>

  <label for="setting-iti">Gap after each trial (ms)</label>
  <input
    id="setting-iti"
    data-testid="setting-default-iti"
    type="number"
    min="0"
    placeholder="0"
    value={project.spec.settings?.default_iti ?? ""}
    onchange={(event) => set("default_iti", event.currentTarget.valueAsNumber)}
  />

  <label for="setting-rt">Ignore responses faster than (ms)</label>
  <input
    id="setting-rt"
    data-testid="setting-minimum-rt"
    type="number"
    min="0"
    placeholder="0"
    value={project.spec.settings?.minimum_valid_rt ?? ""}
    onchange={(event) => set("minimum_valid_rt", event.currentTarget.valueAsNumber)}
  />

  <label for="setting-background">Experiment background</label>
  <span class="colours">
    <input
      id="setting-background"
      data-testid="setting-background"
      type="color"
      value={backgroundColor(project.spec.settings)}
      onchange={(event) => set("background_color", event.currentTarget.value)}
    />
    <input
      aria-label="Text colour"
      data-testid="setting-text-colour"
      type="color"
      value={textColor(project.spec.settings)}
      onchange={(event) => set("text_color", event.currentTarget.value)}
    />
    <button
      class="reset"
      data-testid="setting-colours-reset"
      onclick={() => {
        set("background_color", undefined);
        set("text_color", undefined);
      }}>reset</button
    >
  </span>

  <label class="check">
    <input
      type="checkbox"
      data-testid="setting-progress-bar"
      checked={Boolean(project.spec.settings?.show_progress_bar)}
      onchange={(event) => set("show_progress_bar", event.currentTarget.checked || undefined)}
    />
    Show a progress bar
  </label>
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  label {
    font-size: 0.85rem;
    color: var(--ink-muted);
  }
  .check,
  .colours {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .colours input {
    width: 2.2rem;
    height: 1.6rem;
    padding: 0;
  }
  .reset {
    border: 0;
    background: none;
    color: var(--ink-muted);
    font-size: 0.8rem;
    cursor: pointer;
  }
  .muted {
    margin: 0;
    font-size: 0.8rem;
    color: var(--ink-muted);
  }
</style>
