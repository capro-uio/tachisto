<script lang="ts">
  import type { TrialNode } from "tachisto-compiler";
  import ListField from "./ListField.svelte";
  import {
    SELECTOR_LIST,
    otherTargets,
    recordsStimulus,
    setOtherTargets,
    setRecordsStimulus,
    setTracking,
    unreadableSelector,
  } from "./gaze.ts";

  interface Props {
    trial: TrialNode;
    /** Where the step's plugin shows its stimulus, if it gives that element an id. */
    stimulus: string | undefined;
  }

  const { trial, stimulus }: Props = $props();

  const others = $derived(trial.gaze ? otherTargets(trial.gaze, stimulus) : []);
  const unreadable = $derived(others.filter(unreadableSelector));
</script>

<h3>Eye tracking</h3>
<label class="check">
  <input
    type="checkbox"
    data-testid="track-gaze"
    checked={Boolean(trial.gaze)}
    onchange={(event) => setTracking(trial, event.currentTarget.checked, stimulus)}
  />
  track where the participant looks during this step
</label>
{#if trial.gaze}
  {@const gaze = trial.gaze}
  {#if stimulus}
    <label class="check">
      <input
        type="checkbox"
        data-testid="gaze-stimulus"
        checked={recordsStimulus(gaze, stimulus)}
        onchange={(event) => setRecordsStimulus(gaze, stimulus, event.currentTarget.checked)}
      />
      record where the stimulus is on the screen
    </label>
  {/if}
  <div class="field">
    <span class="name">record where these elements are</span>
    <ListField
      testId="gaze-targets"
      parameter={SELECTOR_LIST}
      assets={[]}
      values={others}
      onchange={(values) => setOtherTargets(gaze, stimulus, values as string[])}
    />
    <p class="help">
      Each is a CSS selector, such as <code>#choice</code> for the element with the id "choice", looked
      for among what the step shows.
    </p>
    {#each unreadable as selector, index (index)}
      <p class="problem" data-testid="gaze-target-problem">
        "{selector}" is not a CSS selector the browser can read, so where it is goes unrecorded
      </p>
    {/each}
  </div>
  <p class="help">
    Each row of this step's data holds the estimated gaze points, in pixels from the top left of the
    screen, with the time since the step began.
  </p>
{/if}

<style>
  h3 {
    margin: 1rem 0 0;
    font-size: 0.9rem;
    color: var(--ink-muted);
  }
  .check {
    display: flex;
    gap: 0.3rem;
    align-items: center;
    padding: 0.3rem 0;
  }
  .field {
    display: grid;
    gap: 0.4rem;
    padding: 0.4rem 0;
    border-top: 1px solid var(--line);
  }
  .name {
    font-weight: 600;
  }
  .help {
    margin: 0;
    font-size: 0.8rem;
    color: var(--ink-muted);
  }
  .problem {
    margin: 0;
    font-size: 0.85rem;
    color: var(--danger);
  }
</style>
