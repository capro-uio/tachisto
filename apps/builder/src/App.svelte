<script lang="ts">
  import AssetPanel from "./lib/AssetPanel.svelte";
  import ConditionsTable from "./lib/ConditionsTable.svelte";
  import AuthorsPanel from "./lib/AuthorsPanel.svelte";
  import DataPanel from "./lib/DataPanel.svelte";
  import RecruitmentPanel from "./lib/RecruitmentPanel.svelte";
  import SettingsPanel from "./lib/SettingsPanel.svelte";
  import AddStep from "./lib/AddStep.svelte";
  import PanelDivider from "./lib/PanelDivider.svelte";
  import { panels } from "./lib/panels.svelte.ts";
  import { setTheme, theme } from "./lib/theme.svelte.ts";
  import { download, specFilename } from "./lib/files.ts";
  import HeaderMenu from "./lib/HeaderMenu.svelte";
  import {
    buildExperimentHtml,
    buildProjectZip,
    type FigureProgress,
  } from "./lib/experiment.svelte.ts";
  import { downloads, setSelfContained } from "./lib/downloads.svelte.ts";
  import { figureChoices } from "./lib/figure-choices.svelte.ts";
  import { backgroundColor, textColor } from "@tachisto/compiler";
  import NodeForm from "./lib/NodeForm.svelte";
  import SequenceStrip from "./lib/SequenceStrip.svelte";
  import Preview from "./lib/Preview.svelte";
  import Tree from "./lib/Tree.svelte";
  import Tour from "./lib/Tour.svelte";
  import { startTour, TOUR_HOME_ID } from "./lib/tour.svelte.ts";
  import { TABS, ui } from "./lib/ui.svelte.ts";
  import {
    exportedSpec,
    loadSpec,
    openExample,
    parseSpec,
    startNewProject,
    project,
  } from "./lib/project.svelte.ts";
  import { examples } from "./lib/examples.ts";
  import OpenSpec from "./lib/OpenSpec.svelte";
  import { invitationFrom, isInvitation, linkTo, specFrom } from "./lib/opening.ts";

  let importError = $state("");
  let downloadError = $state("");

  let pasting = $state(false);
  let opening = $state(false);
  let copied = $state(false);
  let copyProblem = $state("");

  // A link can carry a spec from anyone. Opening it is the reader's choice to make, not the
  // link's, because a spec holds code that runs for every participant the study reaches.
  const asked = invitationFrom(window.location.search);
  let invitation = $state(isInvitation(asked) ? asked : null);
  if (asked && !isInvitation(asked)) importError = `That link cannot be opened: ${asked.problem}`;

  async function acceptInvitation() {
    if (!invitation) return;
    if (!confirmDiscard()) return;
    const accepted = invitation;
    opening = true;
    try {
      const spec = await specFrom(accepted.url);
      // Fetching takes a moment, and "Not now" is still there while it does. Loading the spec
      // after someone declined it would make the asking a formality.
      if (invitation !== accepted) return;
      loadSpec(spec, accepted.url);
      invitation = null;
      importError = "";
      ui.tab = "timeline";
    } catch (error) {
      if (invitation !== accepted) return;
      // The invitation stays, so a spec that was briefly unreachable can be tried again.
      importError = `The spec at ${accepted.url} ${(error as Error).message}`;
    } finally {
      opening = false;
    }
  }

  // Writing to the clipboard is refused outside a secure context and can be denied outright, so
  // the link is shown instead of lost.
  async function copyLink() {
    if (!project.sourceUrl) return;
    const link = linkTo(project.sourceUrl, window.location);
    try {
      await navigator.clipboard.writeText(link);
      copyProblem = "";
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      copyProblem = `Could not copy the link; it is ${link}`;
    }
  }

  // Gathering jsPsych for a self-contained download takes a moment, and a second click meanwhile
  // would only start it again.
  let preparing = $state(false);

  async function prepareDownload(build: () => Promise<void>) {
    preparing = true;
    try {
      await build();
      downloadError = "";
    } catch (error) {
      downloadError = `Not ready to download: ${(error as Error).message.split("\n")[0]}`;
    } finally {
      preparing = false;
    }
  }

  function downloadExperiment() {
    return prepareDownload(async () => {
      const html = await buildExperimentHtml(downloads);
      download(`${specFilename(project.spec)}.html`, html, "text/html");
    });
  }

  function downloadProject() {
    download(
      `${specFilename(project.spec)}.json`,
      JSON.stringify(exportedSpec(), null, 2),
      "application/json",
    );
  }

  // Picturing each block for its figure is most of the wait, so the button says how far along.
  let picturing = $state<FigureProgress | null>(null);

  function downloadEverything() {
    return prepareDownload(async () => {
      const zip = await buildProjectZip({
        ...downloads,
        choices: $state.snapshot(figureChoices),
        onProgress: (progress) => (picturing = progress),
      }).finally(() => (picturing = null));
      download(`${specFilename(project.spec)}.zip`, zip, "application/zip");
    });
  }

  // A warning that lives behind a tab is a warning nobody reads, so the tab says it is there.
  const unsavedData = $derived(!project.spec.data && project.spec.timeline.length > 0);
  const marked = (id: string) => id === "study" && unsavedData;

  // Starting over throws away whatever is open, so only ask when there is something to lose.
  function startOver() {
    if (!confirmDiscard()) return;
    startNewProject();
    // Starting over should land where an experiment begins, not wherever you happened to be.
    ui.tab = "timeline";
  }

  function confirmDiscard() {
    const empty = project.spec.timeline.length === 0;
    return empty || window.confirm("Start a new experiment? The one open here will be discarded.");
  }

  function openPastedSpec() {
    pasting = false;
    importError = "";
    ui.tab = "timeline";
  }

  async function importSpec(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      loadSpec(parseSpec(await file.text()));
      ui.tab = "timeline";
      importError = "";
    } catch (error) {
      importError = `Could not import ${file.name}: ${(error as Error).message}`;
    }
  }
</script>

<header>
  <h1>
    <a
      class="brand"
      href="../"
      target="_blank"
      rel="noopener"
      title="About Tachisto (opens in a new tab)"
    >
      <picture class="on-light">
        <source media="(max-width: 30rem)" srcset="./tachisto-icon.svg" />
        <img src="./tachisto-wordmark.svg" alt="Tachisto" loading="lazy" />
      </picture>
      <picture class="on-dark">
        <source media="(max-width: 30rem)" srcset="./tachisto-icon-dark.svg" />
        <img src="./tachisto-wordmark-dark.svg" alt="Tachisto" loading="lazy" />
      </picture>
    </a>
  </h1>
  <input
    class="experiment-name"
    aria-label="experiment name"
    data-testid="experiment-name"
    bind:value={project.spec.name}
  />
  <span class="spacer"></span>
  {#if importError || downloadError || copyProblem}
    <p class="notice" data-testid="import-error">
      {importError || downloadError || copyProblem}
    </p>
  {/if}

  <button
    class="primary"
    data-testid="download-zip"
    disabled={preparing}
    aria-busy={preparing}
    onclick={downloadEverything}
  >
    {picturing
      ? `Picturing ${picturing.done + 1} of ${picturing.total}…`
      : preparing
        ? "Preparing download…"
        : "Download experiment"}
  </button>

  <HeaderMenu label="More actions" id={TOUR_HOME_ID}>
    {#snippet children(close: () => void)}
      <button class="item" data-testid="new-project" onclick={startOver}>New experiment</button>
      <label class="item">
        Open a project…
        <input
          type="file"
          accept="application/json"
          data-testid="import-spec"
          onchange={importSpec}
        />
      </label>
      <button
        class="item"
        data-testid="paste-spec"
        onclick={() => {
          close();
          pasting = true;
        }}>Open a spec someone sent…</button
      >
      {#if project.sourceUrl}
        <button class="item" data-testid="copy-spec-link" onclick={copyLink}>
          {copied ? "Link copied" : "Copy a link to this spec"}
        </button>
      {/if}
      <button
        class="item"
        data-testid="download-html"
        disabled={preparing}
        onclick={downloadExperiment}
      >
        Download as one HTML file
      </button>
      <button class="item" data-testid="download-spec" onclick={downloadProject}>
        Download project file only
      </button>
      <button
        class="item"
        data-testid="start-tour-menu"
        onclick={() => {
          close();
          startTour();
        }}>Take the tour</button
      >
      <div class="group">
        <span>Downloads</span>
        <label
          class="check"
          title="Downloads carry jsPsych and its plugins, so the study loads nothing from elsewhere and runs without internet"
        >
          <input
            type="checkbox"
            data-testid="self-contained"
            checked={downloads.selfContained}
            onchange={(event) => setSelfContained(event.currentTarget.checked)}
          />
          Self-contained
        </label>
      </div>
      <div class="group">
        <span>Appearance</span>
        <div class="segmented">
          {#each ["system", "light", "dark"] as const as option (option)}
            <button
              class:active={theme.choice === option}
              data-testid={`theme-${option}`}
              onclick={() => setTheme(option)}>{option}</button
            >
          {/each}
        </div>
      </div>
    {/snippet}
  </HeaderMenu>
</header>

{#if invitation}
  <section class="invitation" data-testid="invitation" aria-labelledby="invitation-heading">
    <h2 id="invitation-heading">Open the spec at {invitation.host}?</h2>
    <p>
      This link asks to open a study from <strong>{invitation.host}</strong>. A spec holds the code
      and text that run for every participant, so open it if you trust whoever sent it.
    </p>
    <p class="muted">{invitation.url}</p>
    <div class="actions">
      <button data-testid="invitation-decline" onclick={() => (invitation = null)}>
        Not now
      </button>
      <button
        class="primary"
        data-testid="invitation-accept"
        disabled={opening}
        aria-busy={opening}
        onclick={acceptInvitation}>{opening ? "Opening…" : "Open it"}</button
      >
    </div>
  </section>
{/if}

{#if pasting}
  <OpenSpec onopened={openPastedSpec} onclose={() => (pasting = false)} />
{/if}

<main
  style={`--panel-widths: ${panels.widths.map((width) => `${width}fr`).join(" auto ")};` +
    `--participant-background: ${backgroundColor(project.spec.settings)};` +
    `--participant-text: ${textColor(project.spec.settings)}`}
>
  <aside>
    <div class="tabs" role="tablist">
      {#each TABS as option (option.id)}
        <button
          role="tab"
          id={`tab-${option.id}`}
          aria-selected={ui.tab === option.id}
          aria-controls={`panel-${option.id}`}
          class:active={ui.tab === option.id}
          data-testid={`tab-${option.id}`}
          onclick={() => (ui.tab = option.id)}
        >
          {option.label}
          {#if marked(option.id)}<span class="mark" title="This experiment keeps no results">•</span
            >{/if}
        </button>
      {/each}
    </div>

    <div class="panel" role="tabpanel" id={`panel-${ui.tab}`} aria-labelledby={`tab-${ui.tab}`}>
      {#if ui.tab === "timeline"}
        {#if project.spec.timeline.length === 0}
          <section class="start" aria-labelledby="start-heading" data-testid="start-blank">
            <h2 id="start-heading">Your timeline is empty</h2>
            <p class="muted">
              An experiment is a list of steps that run in order. Add the first one to begin.
            </p>
            <AddStep path={[]} index={0} variant="first" />
          </section>
          <section class="examples" aria-labelledby="examples-heading" data-testid="examples">
            <h2 id="examples-heading">Or open an example</h2>
            <p class="muted">
              Optional. Each one is a finished study to look through or adapt; opening it replaces
              this empty timeline.
            </p>
            {#each examples as example (example.id)}
              <button
                class="example"
                data-testid={`example-${example.id}`}
                onclick={() => openExample(example.spec)}
              >
                <strong>{example.title}</strong>
                <span class="muted">{example.description}</span>
              </button>
            {/each}
            <button class="tour" data-testid="start-tour" onclick={startTour}>
              New here? Take a one-minute tour
            </button>
          </section>
          <section class="sent" aria-labelledby="sent-heading">
            <h2 id="sent-heading">Or open a spec someone sent you</h2>
            <p class="muted">
              A whole study fits in one file. Paste what they sent, or the address it lives at, and
              it opens here as they built it.
            </p>
            <button class="example" data-testid="paste-spec-start" onclick={() => (pasting = true)}>
              <strong>Paste a spec</strong>
              <span class="muted">Or an https address pointing at one.</span>
            </button>
          </section>
        {:else}
          <Tree nodes={project.spec.timeline} />
        {/if}
      {:else if ui.tab === "conditions"}
        <ConditionsTable />
      {:else if ui.tab === "files"}
        <AssetPanel />
      {:else}
        <AuthorsPanel />
        <DataPanel />
        <RecruitmentPanel />
        <SettingsPanel />
      {/if}
    </div>
  </aside>

  <PanelDivider index={0} label="Resize the timeline panel" />
  <section class="form"><SequenceStrip /><NodeForm /></section>
  <PanelDivider index={1} label="Resize the settings panel" />
  <section class="preview"><Preview /></section>
</main>

<Tour />

<style>
  header {
    display: flex;
    gap: var(--space-3);
    align-items: center;
    min-height: 56px;
    padding: var(--space-2) var(--space-4);
    background: var(--paper);
    border-bottom: 1px solid var(--line);
  }
  .experiment-name {
    min-width: 0;
    border-color: transparent;
    background: transparent;
    font-family: var(--font-display);
    font-size: 16px;
    font-weight: 500;
  }
  .experiment-name:hover {
    border-color: transparent;
    border-bottom-color: var(--line-strong);
  }
  h1 {
    margin: 0;
    line-height: 0;
  }
  .brand {
    display: block;
    padding: var(--space-1);
  }
  .brand img {
    height: 28px;
    width: auto;
  }
  .spacer {
    flex: 1;
  }
  .notice {
    margin: 0;
    color: var(--danger);
    font-size: 0.85rem;
  }
  .invitation {
    margin: 0.75rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--paper-raised);
    display: grid;
    gap: 0.4rem;
  }
  .invitation h2 {
    margin: 0;
    font-size: 1rem;
  }
  .invitation p {
    margin: 0;
    font-size: 0.85rem;
  }
  .invitation .muted {
    color: var(--ink-muted);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    overflow-wrap: anywhere;
  }
  .invitation .actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.2rem;
  }
  .primary {
    border: 1px solid var(--stimulus-fill);
    border-radius: var(--radius-md);
    background: var(--stimulus-fill);
    color: var(--on-stimulus);
    font-weight: 700;
    padding: var(--space-2) var(--space-4);
  }
  .primary:hover {
    background: color-mix(in srgb, var(--stimulus-fill) 88%, var(--ink));
  }
  .item {
    display: block;
    width: 100%;
    text-align: left;
    border: 0;
    background: none;
    cursor: pointer;
    padding: 0.35rem 0.45rem;
    border-radius: var(--radius-md);
    font-size: 0.85rem;
  }
  .item:hover {
    background: var(--paper-sunk);
  }
  .item input {
    display: none;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--ink);
    font-size: 0.85rem;
    cursor: pointer;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.4rem 0.45rem 0.2rem;
    border-top: 1px solid var(--line);
    margin-top: 0.2rem;
    font-size: 0.8rem;
    color: var(--ink-muted);
  }
  .segmented {
    display: flex;
  }
  .segmented button {
    flex: 1;
    border: 1px solid var(--line);
    background: none;
    cursor: pointer;
    padding: 0.15rem 0.3rem;
    font-size: 0.75rem;
    color: var(--ink-muted);
  }
  .segmented button + button {
    border-left: 0;
  }
  .segmented button:first-child {
    border-radius: var(--radius-md) 0 0 var(--radius-md);
  }
  .segmented button:last-child {
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
  }
  .segmented button.active {
    border-color: var(--stimulus);
    color: var(--stimulus-text);
  }
  main {
    display: grid;
    grid-template-columns: 1fr;
    /* Stacked, there is nothing to drag a boundary between. */
    :global(.divider) {
      display: none;
    }
    gap: 1rem;
    padding: 1rem;
    flex: 1;
  }
  aside {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }
  .tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    border: 0;
    border-bottom: 2px solid transparent;
    background: none;
    padding: 0.3rem 0.35rem;
    cursor: pointer;
    color: var(--ink-muted);
    font-size: 0.85rem;
    /* A tab that cannot show its own name is worse than one that wraps to the next line. */
    white-space: nowrap;
  }
  .tabs button.active {
    color: inherit;
    border-bottom-color: var(--stimulus);
  }
  .mark {
    color: var(--caution);
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-height: 0;
    overflow: auto;
  }
  .start,
  .examples,
  .sent {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .start h2,
  .examples h2,
  .sent h2 {
    margin: 0;
  }
  .start h2 {
    font-size: 1rem;
  }
  .examples {
    margin-top: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
  }
  .examples h2 {
    font-size: 0.85rem;
    color: var(--ink-muted);
  }
  .tour {
    align-self: flex-start;
    font-size: 0.8rem;
  }
  .example {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    text-align: left;
    padding: 0.4rem 0.5rem;
    border: 1px solid var(--line);
    background: var(--paper-sunk);
    font-size: 0.85rem;
  }
  .example:hover {
    border-color: var(--line-strong);
  }
  .example .muted {
    font-size: 0.75rem;
  }
  .preview {
    /* Stacked, the preview has no column height to fill, so give it one worth looking at. */
    min-height: 26rem;
  }
  .muted {
    color: var(--ink-muted);
    font-size: 0.85rem;
    margin: 0;
  }
  /* Wide enough for columns side by side: the shell stops scrolling and each column scrolls
     itself, so the timeline stays put while a long form moves. Grid children need min-height: 0
     or their content forces the row taller than the viewport and the overflow is unreachable. */
  @media (min-width: 60rem) and (min-height: 34rem) {
    main :global(.divider) {
      display: block;
    }
    main {
      /* Three panels with a draggable boundary between each pair. */
      grid-template-columns: var(--panel-widths, 18fr 32fr 50fr);
      grid-auto-flow: column;
      min-height: 0;
      overflow: hidden;
    }
    aside,
    .form,
    .preview {
      min-height: 0;
      overflow: auto;
    }
    .preview {
      min-height: 0;
    }
  }
</style>
