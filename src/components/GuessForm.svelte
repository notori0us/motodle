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
      {#if makeInvalid}
        <p id="mtd-make-error" class="field-error">
          <svg class="field-error__icon" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 3 L18 17 L2 17 Z" />
            <path d="M10 8.5v3.5" />
            <circle cx="10" cy="14.5" r="0.1" fill="currentColor" stroke="none" />
          </svg>
          Choose a make
        </p>
      {/if}
      {#if makeLocked}<span class="lock-chip"><svg class="lock-chip__icon" width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="9" width="10" height="8" rx="1.5" /><path d="M7.5 9V6.5a2.5 2.5 0 0 1 5 0V9" /></svg>Locked</span>{/if}
    </div>
    <div class="guess-form__label-row" data-area="model-label">
      <label for="mtd-model">Model</label>
      {#if modelInvalid}
        <p id="mtd-model-error" class="field-error">
          <svg class="field-error__icon" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 3 L18 17 L2 17 Z" />
            <path d="M10 8.5v3.5" />
            <circle cx="10" cy="14.5" r="0.1" fill="currentColor" stroke="none" />
          </svg>
          Choose a model
        </p>
      {/if}
      {#if modelLocked}<span class="lock-chip"><svg class="lock-chip__icon" width="10" height="10" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="9" width="10" height="8" rx="1.5" /><path d="M7.5 9V6.5a2.5 2.5 0 0 1 5 0V9" /></svg>Locked</span>{/if}
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
        <p id="mtd-year-error" class="field-error">
          <svg class="field-error__icon" width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
            <path d="M10 3 L18 17 L2 17 Z" />
            <path d="M10 8.5v3.5" />
            <circle cx="10" cy="14.5" r="0.1" fill="currentColor" stroke="none" />
          </svg>
          Enter a year between 1885 and {MAX_YEAR}
        </p>
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
     This row spans both columns; the shared .guess-form__label-row rule below now starts every
     label row at flex-start, so no override is needed here any more (§5.14.10 K2). */
  [data-area='year-label'] {
    grid-area: year-label;
    margin-top: var(--space-2);
  }

  /* The label line exists in EVERY state — that is what makes an error cost zero layout (U6).
     §5.14.10 K2: flex-start, not space-between — an error message now sits immediately after ITS
     OWN label instead of flush against the neighbouring field's label, which is what made "Choose
     a make" read as though it belonged to Model. The Locked chip (review improvement #4) now sits
     right after its own label the same way, instead of taking margin-left: auto to park flush
     against the row's end — at 360px that put it hard against the NEXT field's label ("Make
     [Locked]Model"), reproducing the exact ambiguity this rule was written to fix. */
  .guess-form__label-row {
    display: flex;
    align-items: baseline;
    justify-content: flex-start;
    gap: var(--space-2);
    min-width: 0;
    min-height: 1.05rem;
    line-height: 1.05rem;
  }

  .guess-form__label-row label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-muted);
    white-space: nowrap;
  }

  /* align-self: center (not the row's own align-items: baseline): .field-error is itself a flex
     container now that it carries an icon, and a nested flex container's contribution to an
     outer baseline-aligned row falls back to its margin edge rather than its text baseline —
     that mismatch against the plain-text <label> silently grew the row a few px past its
     min-height (caught by e2e/mobile-layout.spec.ts's bottomAfter===bottomBefore assertion, not
     by inspection). Opting out of baseline alignment for this one item removes the mismatch. */
  .field-error {
    display: flex;
    align-items: center;
    align-self: center;
    gap: 0.2em;
    margin: 0;
    min-width: 0;
    height: 1.05rem;
    padding-right: var(--space-1); /* keeps a long message off the neighbouring label at narrow widths */
    font-size: 0.75rem;
    line-height: 1.05rem;
    color: var(--color-danger);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis; /* a longer future message truncates; it never wraps and never shifts */
  }

  .field-error__icon {
    flex: 0 0 auto;
  }

  .lock-chip {
    display: inline-flex;
    align-items: center;
    align-self: center;
    gap: 0.2em;
    height: 1.05rem;
    padding: 0 var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-pill);
    background: var(--color-surface);
    color: var(--color-fg);
    font-size: 0.75rem;
    font-weight: 600;
    white-space: nowrap;
  }

  .lock-chip__icon {
    flex: 0 0 auto;
    color: var(--color-muted);
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
    font-weight: 500;
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
    padding-top: var(--space-3);
  }

  .guess-form__secondary .button--danger {
    background: transparent;
    border-color: transparent;
    color: var(--color-muted);
    padding: 0 var(--space-3);
    font-size: 0.875rem;
  }
  .guess-form__secondary .button--danger:hover {
    color: var(--color-danger);
  }
  /* review improvement #7: opacity on a disabled control contradicts the system's own
     "don't use opacity for disabled" rule and dropped this label under 3:1. The rule above
     already colors it var(--color-muted) on transparent regardless of :disabled (~6:1 against the
     page ground either way), so dropping the multiply-through-opacity override loses nothing. */

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
    font-size: 0.75rem;
    color: var(--color-muted);
  }
  .guess-form__secondary .button--danger.is-confirm {
    color: var(--color-danger);
    border-color: var(--color-danger);
  }

  /* The height-keyed rules that survive: gap tightening, plus — on the confirm row only — one
     line instead of two, which is what keeps Cancel/Confirm on-screen at 360x640 (review
     improvement #1). 700px, not 1000px: 360x640 and 320x568 need the 8px, and nothing taller
     does (§5.11.5). §5.14.10 C8/item 7 fix: the confirm sentence used to truncate here
     ("Give up? This count…") — the nowrap/ellipsis is gone, so it wraps onto two lines instead;
     only the submit button above the hairline is contractual, and this row is free to grow. */
  @media (max-height: 700px) {
    .guess-form {
      gap: var(--space-2);
    }
    [data-area='year-label'] {
      margin-top: var(--space-1);
    }
    .guess-form__confirm-text {
      flex: 1 1 100%;
    }
  }
</style>
