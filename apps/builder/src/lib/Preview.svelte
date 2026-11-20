<script lang="ts">
  import {
    checksDevices,
    compileSpec,
    formatSource,
    SpecError,
    usesDevices,
  } from "tachisto-compiler";
  import type { Problem, Spec } from "tachisto-compiler";
  import { exportedSpec, project } from "./project.svelte.ts";
  import {
    compilePreview,
    previewPage,
    readStepEvent,
    TRACE_HOOKS,
    tracedPreview,
  } from "./preview.ts";
  import { followPreview, resetPlayback } from "./playback.svelte.ts";
  import { errorsOf, overallProblems, stepCount, warningsOf } from "./problems.svelte.ts";
  import { schemas } from "./schemas.ts";
  import Figures from "./Figures.svelte";
  import Flow from "./Flow.svelte";

  type View = "experiment" | "flow" | "figures" | "code" | "spec";

  const VIEWS = [
    { id: "experiment", label: "Experiment", hint: "What a participant sees" },
    { id: "flow", label: "Flow", hint: "How the study runs, step by step" },
    { id: "figures", label: "Figures", hint: "The study's flow and trials, for a paper" },
    { id: "code", label: "Code", hint: "The jsPsych this builds, as it will be exported" },
    { id: "spec", label: "Project file", hint: "What the download and import use" },
  ] as const;

  let view = $state<View>("experiment");
  let html = $state("");
  let source = $state("");
  let exportedSource = $state("");
  let error = $state("");
  let runToken = $state(0);
  let latestCompile = 0;
  let fromSelected = $state(false);

  const REBUILD_DELAY_MS = 150;

  // The preview's frame has no origin of its own, which keeps study code away from the builder,
  // and browsers give such a frame no camera or microphone.
  const needsDevices = $derived(usesDevices(project.spec));
  const looksForDevices = $derived(checksDevices(project.spec));

  // The rebuild compiles the experiment anyway, so its problems are kept from there.
  let problems = $state<Problem[]>([]);
  const errors = $derived(errorsOf(problems));
  const warnings = $derived(warningsOf(problems));

  const specJson = $derived(JSON.stringify(exportedSpec(), null, 2));
  const selectionKey = $derived(project.selection?.join(".") ?? "");
  // Built from the key so the compiler gets plain numbers, and reselecting a step does not rebuild.
  const runningFrom = $derived(
    fromSelected && selectionKey ? selectionKey.split(".").map(Number) : null,
  );

  function rebuild(spec: Spec, from: number[] | null) {
    const compileId = ++latestCompile;
    try {
      // The experiment as it will be exported decides what is valid and what the code view shows.
      // What runs in the frame is a preview of it, which never saves data.
      const exported = compileSpec(spec, schemas);
      const running = compilePreview(
        tracedPreview(spec, { from }),
        `on_finish: () => { window.studioExperiment.finished = true; }, ${TRACE_HOOKS}`,
      );
      error = "";
      problems = exported.warnings;
      exportedSource = exported.source;
      previewPage(running, spec.name).then(
        (output) => {
          if (compileId !== latestCompile) return;
          html = output.html;
        },
        (problem: unknown) => {
          if (compileId !== latestCompile) return;
          const reason = problem instanceof Error ? problem.message : String(problem);
          error = `The preview could not be built: ${reason}`;
          html = "";
        },
      );
    } catch (problem) {
      if (!(problem instanceof SpecError)) throw problem;
      error = problem.message;
      problems = problem.problems;
      html = "";
      exportedSource = "";
    }
  }

  // Depending on the serialised spec does two jobs: it reads the whole tree, so edits nested deep
  // inside a timeline still invalidate the effect (a bare `exportedSpec()` only reads the top
  // level), and it hands the compiler plain objects rather than state proxies. Rebuilding once the
  // edit settles keeps the preview from recompiling and reformatting on every keystroke.
  $effect(() => {
    const json = specJson;
    const from = runningFrom;
    const timer = setTimeout(() => rebuild(JSON.parse(json) as Spec, from), REBUILD_DELAY_MS);
    return () => clearTimeout(timer);
  });

  let frame = $state<HTMLIFrameElement>();

  // The frame says which step is on screen, so the timing strip can follow along. Only messages
  // from this frame count, and only in the shape its hooks send.
  $effect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame || event.source !== frame.contentWindow) return;
      const step = readStepEvent(event.data);
      if (step) followPreview(step);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  });

  // A rebuilt, restarted or hidden preview has nothing on screen.
  $effect(() => {
    void html;
    void runToken;
    void view;
    resetPlayback();
  });

  // Formatting is only worth doing when someone is looking at the code.
  $effect(() => {
    if (view !== "code" || !exportedSource) return;
    const wanted = exportedSource;
    // Unformatted code is still the right code, so a formatter failure shows it as it is.
    formatSource(wanted).then(
      (formatted) => {
        if (wanted === exportedSource) source = formatted;
      },
      () => {
        if (wanted === exportedSource) source = wanted;
      },
    );
  });
</script>

<section>
  <div class="views" role="tablist">
    {#each VIEWS as option (option.id)}
      <button
        role="tab"
        aria-selected={view === option.id}
        class:active={view === option.id}
        data-testid={`view-${option.id}`}
        title={option.hint}
        onclick={() => (view = option.id)}>{option.label}</button
      >
    {/each}
  </div>

  {#if view === "experiment"}
    <div class="runbar">
      <div class="segmented" role="group" aria-label="What to run">
        <button
          class:active={!fromSelected}
          data-testid="run-whole"
          onclick={() => (fromSelected = false)}>Whole experiment</button
        >
        <button
          class:active={fromSelected}
          data-testid="run-from-step"
          disabled={!project.selection}
          title={project.selection
            ? "Run only the selected step, with the blocks it sits in"
            : "Select a step first"}
          onclick={() => (fromSelected = true)}>Selected step</button
        >
      </div>
      <button class="restart" data-testid="restart" onclick={() => (runToken += 1)}>
        ↻ Start again
      </button>
      <span class="spacer"></span>
      <span class="note" data-testid="preview-note"
        >Click into it to answer with keys. Nothing is saved from a preview</span
      >
    </div>
  {/if}

  {#if view === "experiment" && needsDevices}
    <p class="device-note" data-testid="device-note">
      The preview cannot reach a camera or microphone, so their steps wait there. Download the
      experiment and open it to try them.
    </p>
  {/if}

  {#if view === "experiment" && looksForDevices}
    <p class="device-note" data-testid="device-check-note">
      The preview cannot reach a camera or microphone, so a browser check there records both as
      missing. Download the experiment and open it to check them.
    </p>
  {/if}

  {#if error}
    {@const steps = stepCount(errors)}
    <div class="error" data-testid="compile-error">
      {#if errors.length === 0}
        <p>{error}</p>
      {/if}
      {#each overallProblems(errors) as problem (problem.message)}
        <p>{problem.message}</p>
      {/each}
      {#if steps > 0}
        <p data-testid="steps-need-attention">
          {steps === 1 ? "1 step needs" : `${steps} steps need`} attention; each one says what it needs.
        </p>
      {/if}
    </div>
  {/if}

  {#if warnings.length > 0}
    {@const steps = stepCount(warnings)}
    <div class="warnings" data-testid="compile-warnings">
      <p class="warnings-title"><span aria-hidden="true">⚠</span> Worth checking</p>
      {#each overallProblems(warnings) as problem (problem.message)}
        <p>{problem.message}</p>
      {/each}
      {#if steps > 0}
        <p data-testid="steps-worth-checking">
          {steps === 1 ? "1 step has" : `${steps} steps have`} settings that may not do what you meant;
          each one says why. The experiment still runs.
        </p>
      {/if}
    </div>
  {/if}

  {#if view === "experiment"}
    {#if html}
      {#key `${html}-${runToken}`}
        <iframe
          bind:this={frame}
          title="experiment preview"
          data-testid="preview"
          sandbox="allow-scripts allow-forms allow-modals"
          allow="autoplay"
          srcdoc={html}
        ></iframe>
      {/key}
    {:else}
      <p class="placeholder">Nothing to run yet.</p>
    {/if}
  {:else if view === "flow"}
    <Flow />
  {:else if view === "figures"}
    <Figures />
  {:else if view === "code"}
    <pre data-testid="generated-code">{source}</pre>
  {:else}
    <pre data-testid="spec-json">{specJson}</pre>
  {/if}
</section>

<style>
  section {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
  }
  /* Switching what you look at, and acting on what you see, are different things and look it. */
  .views {
    display: flex;
    gap: 0.15rem;
    border-bottom: 1px solid var(--line);
  }
  .views button {
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    padding: 0.3rem 0.5rem;
    cursor: pointer;
    color: var(--ink-muted);
    font-size: 0.85rem;
  }
  .views button.active {
    color: inherit;
    border-bottom-color: var(--stimulus);
  }
  .runbar {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.4rem 0;
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    border: 1px solid var(--line);
    background: none;
    cursor: pointer;
    padding: 0.2rem 0.5rem;
    font-size: 0.8rem;
    color: var(--ink-muted);
  }
  .segmented button:first-child {
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }
  .segmented button:last-child {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    border-left: 0;
  }
  .segmented button.active {
    border-color: var(--stimulus);
    color: var(--stimulus-text);
  }
  .restart {
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
    font-size: 0.8rem;
  }
  .spacer {
    flex: 1;
  }
  .note {
    font-size: 0.75rem;
    color: var(--ink-muted);
  }
  .note {
    margin: 0 0 0.35rem;
    font-size: 0.78rem;
    color: var(--ink-muted);
  }
  .device-note {
    margin: 0 0 0.35rem;
    padding: 0.3rem 0.5rem;
    font-size: 0.8rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }
  iframe {
    flex: 1;
    width: 100%;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--participant-background, #fff);
  }
  pre {
    flex: 1;
    overflow: auto;
    margin: 0;
    padding: 0.6rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: 0.78rem;
    white-space: pre-wrap;
  }
  .error {
    flex: 0 0 auto;
    max-height: 9rem;
    overflow: auto;
    margin-bottom: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--danger);
    border-radius: var(--radius-md);
    color: var(--danger);
  }
  .error p {
    margin: 0 0 0.25rem;
  }
  .warnings {
    flex: 0 0 auto;
    max-height: 9rem;
    overflow: auto;
    margin-bottom: 0.4rem;
    padding: 0.5rem;
    border: 1px solid var(--caution);
    border-radius: var(--radius-md);
    color: var(--ink);
  }
  .warnings p {
    margin: 0 0 0.25rem;
  }
  .warnings-title {
    color: var(--caution);
    font-weight: 600;
  }
  .placeholder {
    color: var(--ink-muted);
  }
</style>
