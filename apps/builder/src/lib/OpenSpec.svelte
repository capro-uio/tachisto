<script lang="ts">
  import { specFromPasted } from "./opening.ts";
  import { loadSpec } from "./project.svelte.ts";

  const { onopened, onclose }: { onopened: () => void; onclose: () => void } = $props();

  let pasted = $state("");
  let problem = $state("");
  let opening = $state(false);
  let sheet: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (sheet && !sheet.open) sheet.showModal();
  });

  async function open() {
    opening = true;
    const text = pasted.trim();
    try {
      const opened = await specFromPasted(text);
      // Fetching takes a moment, and the dialog can be dismissed while it does. Loading the spec
      // anyway would put a study someone just cancelled in front of them, over whatever was open.
      if (!sheet?.open) return;
      loadSpec(opened.spec, opened.url);
      onopened();
    } catch (error) {
      if (!sheet?.open) return;
      problem = `Could not open that: ${(error as Error).message}`;
    } finally {
      opening = false;
    }
  }
</script>

<dialog
  class="sheet"
  bind:this={sheet}
  aria-labelledby="open-spec-title"
  data-testid="open-spec"
  {onclose}
  onclick={(event) => !opening && event.target === sheet && sheet.close()}
>
  <h2 id="open-spec-title">Open a spec someone sent you</h2>
  <p class="muted">
    Paste the spec itself, or the https address it lives at. A spec is the whole study, so what
    opens here is what they built.
  </p>
  <textarea
    bind:value={pasted}
    data-testid="open-spec-text"
    autofocus
    aria-label="the spec, or its address"
    spellcheck="false"
    placeholder={'{ "name": "my-experiment", … }  or  https://…/study.json'}></textarea>
  {#if problem}
    <p class="notice" data-testid="open-spec-problem" role="alert">{problem}</p>
  {/if}
  <div class="actions">
    <button data-testid="open-spec-cancel" disabled={opening} onclick={() => sheet?.close()}
      >Cancel</button
    >
    <span class="spacer"></span>
    <button
      class="primary"
      data-testid="open-spec-confirm"
      disabled={opening || pasted.trim() === ""}
      onclick={open}>{opening ? "Opening…" : "Open"}</button
    >
  </div>
</dialog>

<style>
  .sheet::backdrop {
    background: color-mix(in srgb, black 40%, transparent);
  }
  .sheet {
    width: min(42rem, calc(100vw - 24px));
    padding: 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--paper-raised);
    color: var(--ink);
    box-shadow: var(--shadow-pop);
    display: grid;
    gap: 0.6rem;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  p {
    margin: 0;
    font-size: 0.85rem;
  }
  .muted {
    color: var(--ink-muted);
  }
  .notice {
    color: var(--danger);
  }
  textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 9rem;
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.4;
    resize: vertical;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .spacer {
    flex: 1;
  }
</style>
