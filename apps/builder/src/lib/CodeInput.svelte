<script lang="ts">
  import { codeProblem } from "tachisto-compiler";

  interface Props {
    code: string;
    id: string;
    label: string;
    hint: string;
    testId: string;
    /** Called with the code when the box is left, or with null when it was emptied. */
    onchange: (code: string | null) => void;
  }

  const { code, id, label, hint, testId, onchange }: Props = $props();

  // The draft follows the saved code, and is saved when the author leaves the box, so a half-typed
  // expression does not rebuild the preview on every key.
  let draft = $derived(code);
  const problem = $derived(draft.trim() === "" ? null : codeProblem(draft));
  const rows = $derived(Math.min(12, Math.max(3, draft.split("\n").length)));
</script>

<div class="code">
  <textarea
    {id}
    data-testid={testId}
    aria-label={label}
    aria-invalid={problem !== null}
    aria-describedby={`${testId}-note`}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
    {rows}
    value={draft}
    oninput={(event) => (draft = event.currentTarget.value)}
    onchange={() => onchange(draft.trim() ? draft : null)}></textarea>
  <p id={`${testId}-note`} class:problem data-testid={`${testId}-note`}>
    {problem ? `This code ${problem}.` : hint}
  </p>
</div>

<style>
  .code {
    display: grid;
    gap: 0.2rem;
  }
  textarea {
    font-family: var(--font-mono);
    font-size: 0.82rem;
    line-height: 1.4;
    tab-size: 2;
    resize: vertical;
    width: 100%;
    box-sizing: border-box;
  }
  textarea[aria-invalid="true"] {
    border-color: var(--danger);
  }
  p {
    margin: 0;
    font-size: 0.75rem;
    color: var(--ink-muted);
  }
  p.problem {
    color: var(--danger);
  }
</style>
