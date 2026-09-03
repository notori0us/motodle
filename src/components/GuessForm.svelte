<!-- Make/model dropdowns + year + submit/give-up (§5.3, §5.4, §4.3 locking). Two cascading native
     <select>s: DOM contract is frozen (§5.3.1) so the e2e workstream can address #mtd-make /
     #mtd-model by id and catalog id, independent of anything else here.
     Layout: one two-column grid at every width (§5.11.2) — the DOM changes are markup/CSS only,
     the DOM contract itself (ids, option values, label texts, accessible names) is unchanged. -->
<script lang="ts">
  import type { CatalogIndex, TodayState } from '../../schema/types';
  import { getMake, getModel, listMakes, modelsForMake } from '../lib/catalog';
  import type { SubmitGuessInput } from '../lib/game';
  import YearInput from './YearInput.svelte';

  const MAX_YEAR = new Date().getFullYear() + 1;

  interface Props {
    today: TodayState;
    catalog: CatalogIndex;
    /** Catalog failed to load (§5.1): the form is disabled entirely. */
    disabled?: boolean;
    onsubmit: (input: SubmitGuessInput) => void;
    ongiveup: () => void;
  }
  let { today, catalog, disabled = false, onsubmit, ongiveup }: Props = $props();

  let selectedMakeId = $state(''); // '' = placeholder
  let selectedModelId = $state(''); // '' = placeholder
  // Initialized null, not from `today.locks.year` (§10.7 gotcha #8) — the $effect below runs on
  // mount too and sets it correctly for a resumed (e.g. practice) game that is already locked.
  let yearValue = $state<number | null>(null);
  let attemptedInvalid = $state(false);
  let confirmingGiveUp = $state(false);

  const gameOver = $derived(today.status !== 'in_progress');
  const formDisabled = $derived(disabled || gameOver);

  const makeLocked = $derived(today.locks.makeId !== null);
  const modelLocked = $derived(today.locks.modelId !== null);

  const effectiveMakeId = $derived(today.locks.makeId ?? selectedMakeId);
  const effectiveModelId = $derived(today.locks.modelId ?? selectedModelId);

  const makeOptions = $derived(listMakes(catalog));
  const modelOptions = $derived(effectiveMakeId ? modelsForMake(catalog, effectiveMakeId) : []);

  const lockedMakeName = $derived(today.locks.makeId ? getMake(catalog, today.locks.makeId).name : null);
  const lockedModelName = $derived(today.locks.modelId ? getModel(catalog, today.locks.modelId).name : null);

  // Resumed / locked game pre-fill. `$state(prop)` captures only the INITIAL value (§10.7
  // gotcha #8), so the prefill is an $effect — it runs on mount too, which is what makes a
  // resumed practice or reloaded in-progress game come back with its locked make/model already
  // selected.
  $effect(() => {
    if (today.locks.makeId !== null) selectedMakeId = today.locks.makeId;
  });
  $effect(() => {
    if (today.locks.modelId !== null) selectedModelId = today.locks.modelId;
  });
  // Defensive re-sync: once the year locks, the field must show exactly the player's own green
  // guess (§4.3), never drift from it.
  $effect(() => {
    if (today.locks.year !== null) yearValue = today.locks.year;
  });

  const guessInput = $derived.by((): SubmitGuessInput | null => {
    if (yearValue === null || !Number.isInteger(yearValue) || yearValue < 1885 || yearValue > MAX_YEAR) return null;
    if (!effectiveMakeId || !effectiveModelId) return null;
    const model = catalog.models.get(effectiveModelId);
    if (!model || model.makeId !== effectiveMakeId) return null; // stale pair, e.g. mid-make-change
    return {
      makeId: effectiveMakeId,
      modelId: effectiveModelId,
      make: getMake(catalog, effectiveMakeId).name,
      model: model.name,
      year: yearValue,
    };
  });

  const makeInvalid = $derived(attemptedInvalid && !effectiveMakeId);
  const modelInvalid = $derived(attemptedInvalid && !!effectiveMakeId && !effectiveModelId);
  const yearInvalid = $derived(
    attemptedInvalid && today.locks.year === null && (yearValue === null || yearValue < 1885 || yearValue > MAX_YEAR),
  );
  const submitDisabled = $derived(formDisabled || guessInput === null);

  /** Own onchange handler, not an `$effect` keyed on the make — an effect would also fire on the
   *  lock-prefill pass above and fight it (§5.3.2). */
  function handleMakeChange(e: Event) {
    selectedMakeId = (e.currentTarget as HTMLSelectElement).value;
    selectedModelId = '';
  }

  function handleModelChange(e: Event) {
    selectedModelId = (e.currentTarget as HTMLSelectElement).value;
  }

  /** §5.3.5 narrow exception to "no custom key handling": HTML implicit submission does not fire
   *  from a `<select>` in Chromium (verified — Enter-in-select submits 0 times vs. Enter-in-text-input
   *  submits normally), so Enter is wired explicitly to reach the same validation path as the button. */
  function handleSelectKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (formDisabled) return;
    if (!guessInput) {
      attemptedInvalid = true;
      return;
    }
    attemptedInvalid = false;
    onsubmit(guessInput);
  }

  function confirmGiveUp() {
    confirmingGiveUp = false;
    ongiveup();
  }
</script>

<!-- novalidate: without it, the browser's own HTML5 constraint validation silently swallows the
     submit for an unfilled <select required> before this component's onsubmit ever runs — the
     same class of silent block B2 named, just triggered by native validation instead of the
     disabled attribute. Our own aria-invalid/aria-describedby message (§5.3.4) is the only
     validation UI; a native tooltip would also be unreachable in a headless e2e run. -->
<form class="guess-form" onsubmit={handleSubmit} novalidate>
  <div class="guess-form__grid">
    <div class="guess-form__label-row" data-area="make-label">
      <label for="mtd-make">Make</label>
      {#if makeInvalid}<p id="mtd-make-error" class="field-error">Choose a make</p>{/if}
      {#if makeLocked}<span class="lock-chip">Locked</span>{/if}
    </div>
    <div class="guess-form__label-row" data-area="model-label">
      <label for="mtd-model">Model</label>
      {#if modelInvalid}<p id="mtd-model-error" class="field-error">Choose a model</p>{/if}
      {#if modelLocked}<span class="lock-chip">Locked</span>{/if}
    </div>

    <div class="guess-form__cell" data-area="make" data-locked={makeLocked}>
      <select
        id="mtd-make"
        name="make"
        class="select"
        value={effectiveMakeId}
        disabled={formDisabled || makeLocked}
        aria-invalid={makeInvalid ? 'true' : undefined}
        aria-describedby={makeInvalid ? 'mtd-make-error' : undefined}
        aria-label={makeLocked && lockedMakeName ? `Make — locked to ${lockedMakeName}` : undefined}
        onchange={handleMakeChange}
        onkeydown={handleSelectKeydown}
      >
        <option value="">Choose a make…</option>
        {#each makeOptions as make (make.id)}
          <option value={make.id}>{make.name}</option>
        {/each}
      </select>
    </div>
    <div class="guess-form__cell" data-area="model" data-locked={modelLocked}>
      <select
        id="mtd-model"
        name="model"
        class="select"
        value={effectiveModelId}
        disabled={formDisabled || modelLocked || !effectiveMakeId}
        aria-invalid={modelInvalid ? 'true' : undefined}
        aria-describedby={modelInvalid ? 'mtd-model-error' : undefined}
        aria-label={modelLocked && lockedModelName ? `Model — locked to ${lockedModelName}` : undefined}
        onchange={handleModelChange}
        onkeydown={handleSelectKeydown}
      >
        <option value="">{effectiveMakeId ? 'Choose a model…' : 'Choose a make first'}</option>
        {#each modelOptions as model (model.id)}
          <option value={model.id}>{model.name}</option>
        {/each}
      </select>
    </div>

    <div class="guess-form__label-row" data-area="year-label">
      <label for="mtd-year">Year</label>
      {#if yearInvalid}
        <p id="mtd-year-error" class="field-error">Enter a year between 1885 and {MAX_YEAR}</p>
      {/if}
    </div>
    <div class="guess-form__cell" data-area="year" data-locked={today.locks.year !== null}>
      <YearInput
        id="mtd-year"
        value={yearValue}
        locked={today.locks.year !== null}
        disabled={formDisabled}
        invalid={yearInvalid}
        onchange={(v) => {
          yearValue = v;
        }}
      />
    </div>
    <div class="guess-form__cell" data-area="submit">
      <button
        type="submit"
        class="button button--primary"
        class:is-disabled={submitDisabled}
        disabled={formDisabled}
        aria-disabled={submitDisabled}
      >
        Guess {today.guesses.length + 1} of 5
      </button>
    </div>
  </div>

  {#if !gameOver}
    <div class="guess-form__secondary">
      {#if confirmingGiveUp}
        <p class="guess-form__confirm-text">Give up? This counts as a loss.</p>
        <button type="button" class="button" onclick={() => (confirmingGiveUp = false)}>Cancel</button>
        <button type="button" class="button button--danger is-confirm" onclick={confirmGiveUp}>Confirm</button>
      {:else}
        <button type="button" class="button button--danger" disabled={disabled} onclick={() => (confirmingGiveUp = true)}>
          Give up
        </button>
      {/if}
    </div>
  {/if}
</form>

<style>
  /* One layout at every width (§5.11.2). The height-keyed LAYOUT branch is gone; the only
     height-keyed rule left is the gap tightening at the bottom of this block. */
  .guess-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guess-form__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-areas:
      'make-label  model-label'
      'make        model'
      'year-label  year-label'
      'year        submit';
    column-gap: var(--space-2);
    row-gap: var(--space-1); /* label -> its own control: 4px, they are one unit */
    align-items: center;
  }

  [data-area='make-label'] {
    grid-area: make-label;
  }
  [data-area='model-label'] {
    grid-area: model-label;
  }
  [data-area='make'] {
    grid-area: make;
  }
  [data-area='model'] {
    grid-area: model;
  }
  [data-area='year'] {
    grid-area: year;
  }
  [data-area='submit'] {
    grid-area: submit;
  }
  /* The one place the rhythm opens up: 4px row-gap + 8px = 12px between the two control blocks,
     so "label sticks to its control, blocks breathe" is a single rule, not four ad-hoc gaps (U11).
     justify-content: flex-start (not the .guess-form__label-row default of space-between) because
     this row spans both columns — space-between would push the error to the far right, over the
     submit column instead of the year field it describes. Sit it right next to the label instead. */
  [data-area='year-label'] {
    grid-area: year-label;
    margin-top: var(--space-2);
    justify-content: flex-start;
  }

  /* The label line exists in EVERY state — that is what makes an error cost zero layout (U6).
     Label at the start; the field's error OR its Locked chip at the end of the same line. */
  .guess-form__label-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
    min-height: 1.05rem;
    line-height: 1.05rem;
  }

  .guess-form__label-row label {
    font-size: 0.75rem;
    color: var(--color-muted);
    white-space: nowrap;
  }

  .field-error {
    margin: 0;
    min-width: 0;
    padding-right: var(--space-1); /* keeps a long message off the neighbouring label at narrow widths */
    font-size: 0.75rem;
    line-height: 1.05rem;
    color: var(--color-danger);
    text-align: right;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis; /* a longer future message truncates; it never wraps and never shifts */
  }

  [data-area='year-label'] .field-error {
    text-align: left;
    padding-right: 0;
  }

  .lock-chip {
    display: inline-flex;
    align-items: center;
    height: 1.05rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-surface);
    color: var(--color-muted);
    font-size: 0.65rem;
    letter-spacing: 0.04em;
    text-transform: uppercase; /* presentational only — textContent stays "Locked" (§5.11.3) */
    white-space: nowrap;
  }

  .guess-form__cell {
    min-width: 0;
  }

  /* Every control in the form: same height, same radius, same border, same 16px floor. YearInput's
     own controls match via the same tokens in its own <style> — Svelte scopes styles per
     component, so the shared look is "same tokens", not one shared selector. */
  .select,
  .guess-form__cell .button {
    height: var(--touch-target);
    min-height: var(--touch-target);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    font-size: 1rem; /* 16px floor — iOS focus auto-zoom (§5.3.5) */
  }

  .select {
    width: 100%;
    min-width: 0;
    padding: 0 var(--space-3);
    background: var(--color-bg-elevated);
    color: inherit;
    text-overflow: ellipsis;
    touch-action: manipulation;
  }

  .guess-form__cell .button {
    width: 100%;
  } /* fixes U4 — the button fills its column */

  /* Two different "not editable" states, deliberately drawn differently (§5.3.3):
     LOCKED   = the player got it right; the value is theirs and settled -> full-strength text.
     DISABLED = the control is dead (game over, catalog failed, "choose a make first") -> muted.
     Neither uses opacity: opacity fades text and border together and drops the label under 4.5:1. */
  .select:disabled {
    opacity: 1;
    background: var(--color-surface);
    color: var(--color-muted);
    cursor: not-allowed;
  }

  [data-locked='true'] .select:disabled {
    color: var(--color-fg);
    font-weight: 600;
  }

  /* Soft-disabled submit (§5.3.4: aria-disabled, still clickable so it can explain itself). NOT a
     half-transparent accent fill (U5) — it takes the neutral control skin and snaps to the accent
     fill the moment the guess is complete, which is itself the affordance. An accent border/text
     keeps it reading as the CTA (rather than a disabled select) while the guess is incomplete;
     once the button is actually inert (game over) it drops to the same neutral skin as everything
     else — the rule below wins the tie on source order for the state where both apply. */
  .button--primary.is-disabled {
    opacity: 1;
    background: var(--color-surface);
    color: var(--color-accent);
    border-color: var(--color-accent);
  }
  .button--primary:disabled {
    opacity: 1;
    background: var(--color-surface);
    color: var(--color-muted);
    border-color: var(--color-border);
    cursor: not-allowed;
  }

  /* Give up is secondary and destructive: below a hairline, centered, quiet, never on the primary
     button's line and never at a competing weight (U4). */
  .guess-form__secondary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    border-top: 1px solid var(--color-border);
    padding-top: var(--space-1);
  }

  .guess-form__secondary .button--danger {
    background: transparent;
    border-color: transparent;
    color: var(--color-muted);
    padding: 0 var(--space-3);
    font-size: 0.9rem;
  }
  .guess-form__secondary .button--danger:hover {
    color: var(--color-danger);
  }
  .guess-form__secondary .button--danger:disabled {
    opacity: 0.55;
  }

  /* Cancel and Confirm read as a matched pair, not a near-miss — same minimum width regardless
     of label length. */
  .guess-form__secondary .button {
    flex: 0 0 auto;
    min-width: 96px;
  }

  /* The confirmation replaces the row's contents in place (U9): prompt on its own full-width line,
     Cancel then Confirm under it. Only this row grows; the grid above the hairline does not move. */
  .guess-form__confirm-text {
    flex: 1 1 100%;
    margin: 0;
    text-align: center;
    font-size: 0.8rem;
    color: var(--color-muted);
  }
  .guess-form__secondary .button--danger.is-confirm {
    color: var(--color-danger);
    border-color: var(--color-border);
  }

  /* The height-keyed rules that survive: gap tightening, plus — on the confirm row only — one
     line instead of two, which is what keeps Cancel/Confirm on-screen at 360x640 (review
     improvement #1). 700px, not 1000px: 360x640 and 320x568 need the 8px, and nothing taller
     does (§5.11.5). */
  @media (max-height: 700px) {
    .guess-form {
      gap: var(--space-2);
    }
    [data-area='year-label'] {
      margin-top: var(--space-1);
    }
    .guess-form__secondary {
      flex-wrap: nowrap;
    }
    .guess-form__confirm-text {
      flex: 1 1 auto;
      min-width: 0;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
</style>
