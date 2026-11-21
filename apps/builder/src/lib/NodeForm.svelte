<script lang="ts">
  import {
    canExcludeParticipants,
    isResponseRule,
    latinSquareOrders,
    questionNames,
  } from "tachisto-compiler";
  import type { AssignNode, CounterbalanceNode, ParameterValue } from "tachisto-compiler";
  import Field from "./Field.svelte";
  import GazeSection from "./GazeSection.svelte";
  import { offersGazeTracking, retargetGaze } from "./gaze.ts";
  import { COLUMN_SETTINGS, earlyEndingNames } from "tachisto-compiler";
  import {
    accuracyComparisonOf,
    branchBasis,
    setAccuracyComparison,
    setAnswer,
    setBranchBasis,
    setQuestion,
    setThreshold,
    thresholdOf,
    type AccuracyComparison,
    type BranchBasis,
  } from "./rules.ts";
  import {
    allConditionColumns,
    assetOptions,
    conditionTableNames,
    conditionColumns,
    project,
    selectedNode,
  } from "./project.svelte.ts";
  import { editableParameters, paramsForPlugin, pluginChoices, pluginSchema } from "./schemas.ts";
  import { currentProblems, errorsOf, problemsAt, warningsOf } from "./problems.svelte.ts";

  const node = $derived(selectedNode());
  const stepProblems = $derived(
    project.selection ? problemsAt(currentProblems(), project.selection) : [],
  );
  const stepErrors = $derived(errorsOf(stepProblems));
  const stepWarnings = $derived(warningsOf(stepProblems));
  const trial = $derived(node?.kind === "trial" ? node : null);
  const block = $derived(node?.kind === "block" ? node : null);
  const loop = $derived(node?.kind === "loop" ? node : null);
  const assign = $derived(node?.kind === "assign" ? node : null);
  const counterbalance = $derived(node?.kind === "counterbalance" ? node : null);
  const checkpoint = $derived(node?.kind === "checkpoint" ? node : null);
  const branch = $derived(node?.kind === "branch" ? node : null);
  const end = $derived(node?.kind === "end" ? node : null);
  const endingChoices = $derived(earlyEndingNames(project.spec.recruitment));

  const accuracyRule = $derived(branch && !isResponseRule(branch.when) ? branch.when : null);
  const responseRule = $derived(branch && isResponseRule(branch.when) ? branch.when : null);
  // The questions the judged trials ask: null when they ask none, empty when they are not known.
  const askedQuestions = $derived(
    responseRule ? questionNames(project.spec.timeline, responseRule.scope) : null,
  );
  const columns = $derived(allConditionColumns());
  const assets = $derived(assetOptions());

  let showAllParameters = $state(false);

  const trialSchema = $derived(trial ? pluginSchema(trial.plugin) : undefined);
  // A plugin that writes its own correct column takes no scoring rule; the validator says so too.
  const scoresItself = $derived(trialSchema?.records.includes("correct") ?? false);
  const parameters = $derived(trial ? editableParameters(trial.plugin) : []);
  const visibleParameters = $derived(
    showAllParameters
      ? parameters
      : parameters.filter(({ name, required }) => required || trial?.params?.[name] !== undefined),
  );

  function setParameter(name: string, value: ParameterValue | undefined) {
    if (!trial) return;
    trial.params ??= {};
    if (value === undefined) delete trial.params[name];
    else trial.params[name] = value;
  }

  function setScoreColumn(column: string) {
    if (!trial) return;
    if (column === "") delete trial.score;
    else trial.score = { correct_if_response_equals: { var: column } };
  }

  function toggleRecordedColumn(column: string, recorded: boolean) {
    if (!trial) return;
    trial.record ??= {};
    if (recorded) trial.record[column] = { var: column };
    else delete trial.record[column];
    if (Object.keys(trial.record).length === 0) delete trial.record;
  }
</script>

{#if stepErrors.length > 0}
  <ul class="problems" data-testid="step-problems">
    {#each stepErrors as problem (problem.message)}
      <li>{problem.message}</li>
    {/each}
  </ul>
{/if}
{#if stepWarnings.length > 0}
  <div class="warnings" data-testid="step-warnings">
    <p class="warnings-title"><span aria-hidden="true">⚠</span> Worth checking</p>
    <ul>
      {#each stepWarnings as problem (problem.message)}
        <li>{problem.message}</li>
      {/each}
    </ul>
  </div>
{/if}

{#if !node}
  <p class="empty">Select a step in the timeline, or add one.</p>
  {#if project.selection}
    <p class="help">Steps you add now go into the selected group.</p>
  {/if}
{:else if trial}
  <h2>Trial</h2>
  <div class="field">
    <label for="trial-plugin"><span class="name">step type</span></label>
    <select
      id="trial-plugin"
      data-testid="trial-plugin"
      value={trial.plugin}
      onchange={(event) => {
        const chosen = event.currentTarget.value;
        if (chosen === trial.plugin) return;
        retargetGaze(
          trial,
          chosen,
          pluginSchema(trial.plugin)?.stimulusSelector,
          pluginSchema(chosen)?.stimulusSelector,
        );
        trial.params = paramsForPlugin(trial.params, trial.plugin, chosen) as typeof trial.params;
        trial.plugin = chosen;
        // A step that scores itself takes no scoring rule over its own, and only a step that can
        // turn participants away has somewhere to send them.
        if (pluginSchema(chosen)?.records.includes("correct")) delete trial.score;
        if (!canExcludeParticipants(chosen)) delete trial.exclusion_ending;
      }}
    >
      {#each pluginChoices as group (group.label)}
        <optgroup label={group.label}>
          {#each group.plugins as { plugin, title } (plugin)}
            <option value={plugin}>{title}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
    {#if trialSchema}
      <p class="help plugin-summary" data-testid="plugin-summary">
        {trialSchema.summary}
        <span class="plugin-name" title="The jsPsych plugin that runs this step"
          >{trial.plugin}</span
        >
      </p>
    {/if}
  </div>

  <div class="field">
    <label for="trial-tag"><span class="name">tag</span></label>
    <input
      id="trial-tag"
      data-testid="trial-tag"
      placeholder="groups rows in the data, e.g. practice"
      value={trial.tag ?? ""}
      onchange={(event) => {
        const value = event.currentTarget.value;
        if (value) trial.tag = value;
        else delete trial.tag;
      }}
    />
  </div>

  {#if canExcludeParticipants(trial.plugin)}
    <div class="field">
      <label for="trial-exclusion"><span class="name">send those it turns away to</span></label>
      <select
        id="trial-exclusion"
        data-testid="trial-exclusion"
        value={trial.exclusion_ending ?? ""}
        onchange={(event) => {
          const ending = event.currentTarget.value;
          if (ending) trial.exclusion_ending = ending;
          else delete trial.exclusion_ending;
        }}
      >
        <option value="">no one is turned away</option>
        {#each endingChoices as name (name)}
          <option value={name}>{name}</option>
        {/each}
      </select>
    </div>
    <p class="help">
      A participant this step turns away has their data saved as that ending keeps it, then sees its
      message or is sent back. Endings are set in the Study tab.
    </p>
  {/if}

  {#each visibleParameters as { name, parameter, required } (name)}
    <Field
      {assets}
      {name}
      {parameter}
      {required}
      {columns}
      value={trial.params?.[name]}
      onchange={(value: ParameterValue | undefined) => setParameter(name, value)}
      params={trial.params}
    />
  {/each}

  <button
    class="toggle"
    data-testid="toggle-parameters"
    onclick={() => (showAllParameters = !showAllParameters)}
  >
    {showAllParameters ? "show only what is set" : `show all ${parameters.length} parameters`}
  </button>

  {#if offersGazeTracking(project.spec, trial)}
    <GazeSection {trial} stimulus={trialSchema?.stimulusSelector} />
  {/if}

  {#if scoresItself || columns.length > 0}
    <h3>Scoring and data</h3>
    {#if scoresItself}
      <p class="help" data-testid="scores-itself">
        This step scores its answers itself, from the right answer set above, into its own
        <code>correct</code> column, which a loop or branch on accuracy reads.
      </p>
      {#if trial.score}
        <button class="toggle" data-testid="remove-score" onclick={() => delete trial.score}>
          remove the scoring rule this step was given
        </button>
      {/if}
    {:else}
      <div class="field">
        <label for="score-column"><span class="name">correct when response equals</span></label>
        <select
          id="score-column"
          data-testid="score-column"
          value={typeof trial.score?.correct_if_response_equals === "object"
            ? trial.score.correct_if_response_equals.var
            : ""}
          onchange={(event) => setScoreColumn(event.currentTarget.value)}
        >
          <option value="">not scored</option>
          {#each columns as column (column)}
            <option value={column}>{column}</option>
          {/each}
        </select>
      </div>
    {/if}
    {#if columns.length > 0}
      <div class="field">
        <span class="name">record columns in the data</span>
        <div class="checks">
          {#each columns as column (column)}
            <label class="check">
              <input
                type="checkbox"
                data-testid={`record-${column}`}
                checked={Boolean(trial.record?.[column])}
                onchange={(event) => toggleRecordedColumn(column, event.currentTarget.checked)}
              />
              {column}
            </label>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
{:else if block}
  <h2>Block</h2>
  <p class="help">
    The steps inside run once for every row of the table. To make a step differ between rows, set
    one of its settings to <em>from column</em>.
  </p>
  <div class="field">
    <label for="block-conditions"><span class="name">conditions table</span></label>
    <select
      id="block-conditions"
      data-testid="block-conditions"
      value={block.conditions}
      onchange={(event) => (block.conditions = event.currentTarget.value)}
    >
      {#each conditionTableNames() as table (table)}
        <option value={table}>{table} ({conditionColumns(table).length} columns)</option>
      {/each}
    </select>
  </div>
  <div class="field">
    <label for="block-repetitions"><span class="name">repetitions</span></label>
    <input
      id="block-repetitions"
      data-testid="block-repetitions"
      type="number"
      min="1"
      value={block.repetitions ?? 1}
      onchange={(event) => {
        const value = event.currentTarget.valueAsNumber;
        if (value > 1) block.repetitions = value;
        else delete block.repetitions;
      }}
    />
  </div>
  <div class="field">
    <label for="block-randomize"><span class="name">randomise order</span></label>
    <input
      id="block-randomize"
      data-testid="block-randomize"
      type="checkbox"
      checked={Boolean(block.randomize_order)}
      onchange={(event) => {
        if (event.currentTarget.checked) block.randomize_order = true;
        else delete block.randomize_order;
      }}
    />
  </div>
{:else if assign}
  <h2>Split participants</h2>
  <p class="help">
    Each participant runs one group. Everything else in the timeline runs for everybody.
  </p>
  <div class="field">
    <label for="assign-method"><span class="name">how to choose</span></label>
    <select
      id="assign-method"
      data-testid="assign-method"
      value={assign.method}
      onchange={(event) => (assign.method = event.currentTarget.value as AssignNode["method"])}
    >
      <option value="random">at random, in the browser</option>
      <option value="balanced">balanced, counted by the data service</option>
    </select>
  </div>
  <div class="field">
    <label for="assign-column"><span class="name">{COLUMN_SETTINGS.assign}</span></label>
    <input
      id="assign-column"
      data-testid="assign-column"
      placeholder="group"
      value={assign.record_as ?? ""}
      onchange={(event) => {
        const value = event.currentTarget.value;
        if (value) assign.record_as = value;
        else delete assign.record_as;
      }}
    />
  </div>
  {#each assign.groups as group, index (index)}
    <div class="field">
      <label for={`group-${index}`}><span class="name">group {index + 1}</span></label>
      <span class="group-row">
        <input
          id={`group-${index}`}
          data-testid={`group-name-${index}`}
          value={group.name}
          onchange={(event) => (group.name = event.currentTarget.value)}
        />
        <button
          data-testid={`remove-group-${index}`}
          disabled={assign.groups.length <= 2}
          onclick={() => assign.groups.splice(index, 1)}>✕</button
        >
      </span>
    </div>
  {/each}
  <button
    class="toggle"
    data-testid="add-group"
    onclick={() => assign.groups.push({ name: `group ${assign.groups.length + 1}`, children: [] })}
  >
    add a group
  </button>
{:else if counterbalance}
  <h2>Counterbalance</h2>
  <p class="help">
    Every participant runs every task, in an order that differs between participants. The order used
    is recorded on every row of their data.
  </p>
  <div class="field">
    <label for="counterbalance-method"><span class="name">how to order</span></label>
    <select
      id="counterbalance-method"
      data-testid="counterbalance-method"
      value={counterbalance.method}
      onchange={(event) =>
        (counterbalance.method = event.currentTarget.value as CounterbalanceNode["method"])}
    >
      <option value="random">at random, in the browser</option>
      <option value="latin_square">Latin square, counted by the data service</option>
    </select>
  </div>
  {#if counterbalance.method === "latin_square"}
    <p class="help" data-testid="counterbalance-orders">
      The square has {latinSquareOrders(counterbalance.tasks).length} orders. Set the number of conditions
      for this experiment on the data service to match, so each order is handed out in turn.
    </p>
  {/if}
  <div class="field">
    <label for="counterbalance-column"
      ><span class="name">{COLUMN_SETTINGS.counterbalance}</span></label
    >
    <input
      id="counterbalance-column"
      data-testid="counterbalance-column"
      placeholder="order"
      value={counterbalance.record_as ?? ""}
      onchange={(event) => {
        const value = event.currentTarget.value;
        if (value) counterbalance.record_as = value;
        else delete counterbalance.record_as;
      }}
    />
  </div>
  {#each counterbalance.tasks as task, index (index)}
    <div class="field">
      <label for={`task-${index}`}><span class="name">task {index + 1}</span></label>
      <span class="group-row">
        <input
          id={`task-${index}`}
          data-testid={`task-name-${index}`}
          value={task.name}
          onchange={(event) => (task.name = event.currentTarget.value)}
        />
        <button
          data-testid={`remove-task-${index}`}
          disabled={counterbalance.tasks.length <= 2}
          onclick={() => counterbalance.tasks.splice(index, 1)}>✕</button
        >
      </span>
    </div>
  {/each}
  <button
    class="toggle"
    data-testid="add-task"
    onclick={() =>
      counterbalance.tasks.push({ name: `task ${counterbalance.tasks.length + 1}`, children: [] })}
  >
    add a task
  </button>
{:else if branch}
  <h2>Branch</h2>
  <p class="help">
    Sends participants down one of two paths depending on how they did or what they answered
    earlier. The trials being judged must come before this step.
  </p>
  <div class="field">
    <label for="branch-basis"><span class="name">decide on</span></label>
    <select
      id="branch-basis"
      data-testid="branch-basis"
      value={branchBasis(branch.when)}
      onchange={(event) => setBranchBasis(branch, event.currentTarget.value as BranchBasis)}
    >
      <option value="accuracy">how accurate they were</option>
      <option value="response">what they answered</option>
    </select>
  </div>
  <div class="field">
    <label for="branch-scope"><span class="name">judge trials tagged</span></label>
    <input
      id="branch-scope"
      data-testid="branch-scope"
      value={branch.when.scope}
      onchange={(event) => (branch.when.scope = event.currentTarget.value)}
    />
  </div>
  {#if accuracyRule}
    <div class="field">
      <label for="branch-comparison"><span class="name">take the first path when</span></label>
      <select
        id="branch-comparison"
        data-testid="branch-comparison"
        value={accuracyComparisonOf(accuracyRule)}
        onchange={(event) =>
          setAccuracyComparison(accuracyRule, event.currentTarget.value as AccuracyComparison)}
      >
        <option value="at_least">accuracy is at least</option>
        <option value="below">accuracy is below</option>
      </select>
    </div>
    <div class="field">
      <label for="branch-threshold"><span class="name">threshold</span></label>
      <input
        id="branch-threshold"
        data-testid="branch-threshold"
        type="number"
        min="0"
        max="1"
        step="0.05"
        value={thresholdOf(accuracyRule)}
        onchange={(event) => setThreshold(accuracyRule, event.currentTarget.valueAsNumber)}
      />
    </div>
  {:else if responseRule}
    <div class="field">
      <label for="branch-answer"
        ><span class="name">take the first path when the answer is</span></label
      >
      <input
        id="branch-answer"
        data-testid="branch-answer"
        placeholder="e.g. no, or 1 for the second button"
        value={String(responseRule.response_equals)}
        onchange={(event) => setAnswer(responseRule, event.currentTarget.value)}
      />
    </div>
    {#if askedQuestions?.length}
      <div class="field">
        <label for="branch-question"><span class="name">question</span></label>
        <select
          id="branch-question"
          data-testid="branch-question"
          value={responseRule.question ?? ""}
          onchange={(event) => setQuestion(responseRule, event.currentTarget.value)}
        >
          <option value="" disabled>choose the question to read</option>
          {#each askedQuestions as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
      </div>
    {:else if askedQuestions || responseRule.question !== undefined}
      <div class="field">
        <label for="branch-question"><span class="name">question</span></label>
        <input
          id="branch-question"
          data-testid="branch-question"
          placeholder="the question's name, or Q0 for the first"
          value={responseRule.question ?? ""}
          onchange={(event) => setQuestion(responseRule, event.currentTarget.value)}
        />
      </div>
    {/if}
    <p class="help">
      The latest answer on those trials is compared as text. Buttons count from 0, so the second
      button is 1, and a slider's answer is the number it was left at, so only that exact number
      matches. Questions are read by name, Q0 being the first unnamed one; a checkbox question takes
      the first path when the option was among those ticked.
    </p>
  {/if}
{:else if end}
  <h2>End</h2>
  <p class="help">
    Finishes the study here: the data is saved, then the participant sees the ending's message or is
    sent where it says. Endings are set in the Study tab.
  </p>
  <div class="field">
    <label for="end-ending"><span class="name">ending</span></label>
    <select
      id="end-ending"
      data-testid="end-ending"
      value={end.ending}
      onchange={(event) => (end.ending = event.currentTarget.value)}
    >
      {#if !endingChoices.includes(end.ending)}
        <option value={end.ending}>{end.ending || "choose an ending"}</option>
      {/if}
      {#each endingChoices as name (name)}
        <option value={name}>{name}</option>
      {/each}
    </select>
  </div>
{:else if checkpoint}
  <h2>Checkpoint</h2>
  <p class="help">Records that the participant got this far, for drop-out analysis.</p>
  <div class="field">
    <label for="checkpoint-name"><span class="name">name</span></label>
    <input
      id="checkpoint-name"
      data-testid="checkpoint-name"
      value={checkpoint.name}
      onchange={(event) => (checkpoint.name = event.currentTarget.value)}
    />
  </div>
{:else if loop}
  <h2>Loop</h2>
  <p class="help">Repeats its contents while accuracy on the tagged trials stays below a cutoff.</p>
  <div class="field">
    <label for="loop-accuracy"><span class="name">repeat while accuracy below</span></label>
    <input
      id="loop-accuracy"
      data-testid="loop-accuracy"
      type="number"
      min="0"
      max="1"
      step="0.05"
      value={loop.repeat_while.accuracy_below}
      onchange={(event) => (loop.repeat_while.accuracy_below = event.currentTarget.valueAsNumber)}
    />
  </div>
  <div class="field">
    <label for="loop-scope"><span class="name">measured on tag</span></label>
    <input
      id="loop-scope"
      data-testid="loop-scope"
      value={loop.repeat_while.scope}
      onchange={(event) => (loop.repeat_while.scope = event.currentTarget.value)}
    />
  </div>
  <div class="field">
    <label for="loop-id"><span class="name">name</span></label>
    <input
      id="loop-id"
      data-testid="loop-id"
      value={loop.id ?? ""}
      onchange={(event) => {
        const value = event.currentTarget.value;
        if (value) loop.id = value;
        else delete loop.id;
      }}
    />
  </div>
{/if}

<style>
  h2 {
    margin: 0 0 0.5rem;
    font-size: 1rem;
  }
  h3 {
    margin: 1rem 0 0;
    font-size: 0.9rem;
    color: var(--ink-muted);
  }
  .field {
    display: grid;
    grid-template-columns: 11rem 1fr;
    gap: 0.4rem 0.6rem;
    align-items: center;
    padding: 0.4rem 0;
    border-top: 1px solid var(--line);
  }
  .name {
    font-weight: 600;
  }
  .group-row {
    display: flex;
    gap: 0.3rem;
  }
  .group-row input {
    flex: 1;
  }
  .group-row button {
    border: 0;
    background: none;
    color: var(--ink-muted);
    cursor: pointer;
  }
  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .check {
    display: flex;
    gap: 0.3rem;
    align-items: center;
  }
  .toggle {
    margin-top: 0.6rem;
    border: 0;
    padding: 0.2rem 0;
    color: var(--ink-muted);
    text-decoration: underline;
  }
  .problems {
    margin: 0 0 0.5rem;
    padding-left: 1rem;
    color: var(--danger);
    font-size: 0.85rem;
  }
  .warnings {
    margin: 0 0 0.5rem;
    padding: 0.3rem 0.5rem;
    border-left: 3px solid var(--caution);
    font-size: 0.85rem;
  }
  .warnings ul {
    margin: 0;
    padding-left: 1rem;
  }
  .warnings-title {
    margin: 0;
    color: var(--caution);
    font-weight: 600;
  }
  .empty,
  .help {
    color: var(--ink-muted);
  }
  .plugin-summary {
    grid-column: 2;
    margin: 0;
    font-size: 0.8rem;
  }
  .plugin-name {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    margin-left: 0.3rem;
    white-space: nowrap;
  }
</style>
