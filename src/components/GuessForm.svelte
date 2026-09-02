<!-- Make/model dropdowns + year + submit/give-up (§5.3, §5.4, §4.3 locking). Two cascading native
     <select>s: DOM contract is frozen (§5.3.1) so the e2e workstream can address #mtd-make /
     #mtd-model by id and catalog id, independent of anything else here. -->
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
  <div class="guess-form__names">
    <div class="guess-form__field">
      <label for="mtd-make">Make</label>
      <div class="select-row">
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
        {#if makeLocked}
          <span class="lock-chip">Locked</span>
        {/if}
      </div>
      {#if makeInvalid}
        <p id="mtd-make-error" class="field-error">Choose a make</p>
      {/if}
    </div>

    <div class="guess-form__field">
      <label for="mtd-model">Model</label>
      <div class="select-row">
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
        {#if modelLocked}
          <span class="lock-chip">Locked</span>
        {/if}
      </div>
      {#if modelInvalid}
        <p id="mtd-model-error" class="field-error">Choose a model</p>
      {/if}
    </div>
  </div>

  <div class="guess-form__bottom">
    <div class="guess-form__field guess-form__field--year">
      <label for="mtd-year">Year</label>
      <YearInput
        id="mtd-year"
        value={yearValue}
        locked={today.locks.year !== null}
        disabled={formDisabled}
        invalid={yearInvalid}
        invalidMessage={`Enter a year between 1885 and ${MAX_YEAR}`}
        onchange={(v) => {
          yearValue = v;
        }}
      />
    </div>
    <div class="guess-form__actions">
      <button
        type="submit"
        class="button button--primary"
        class:is-disabled={submitDisabled}
        disabled={formDisabled}
        aria-disabled={submitDisabled}
      >
        Guess {today.guesses.length + 1} of 5
      </button>
      {#if !gameOver}
        {#if confirmingGiveUp}
          <span class="give-up-confirm">
            Give up? This counts as a loss.
            <button type="button" class="button button--danger" onclick={confirmGiveUp}>Confirm</button>
            <button type="button" class="button" onclick={() => (confirmingGiveUp = false)}>Cancel</button>
          </span>
        {:else}
          <button type="button" class="button button--danger" disabled={disabled} onclick={() => (confirmingGiveUp = true)}>
            Give up
          </button>
        {/if}
      {/if}
    </div>
  </div>
</form>

<style>
  .guess-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guess-form__field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .guess-form__field label {
    font-size: 0.85rem;
    color: var(--color-muted);
  }

  .guess-form__names {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .select-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .select {
    flex: 1;
    min-width: 0;
    min-height: var(--touch-target);
    font-size: 1rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    color: inherit;
    padding: 0 var(--space-3);
    touch-action: manipulation;
    text-overflow: ellipsis;
  }

  .select:disabled {
    opacity: 0.75;
  }

  .lock-chip {
    display: inline-flex;
    align-items: center;
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border-radius: var(--radius-md);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    font-size: 0.9rem;
    white-space: nowrap;
  }

  .guess-form__bottom {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .guess-form__actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  /* Short viewports (e.g. 360x640, §5.8): make + model sit side by side (each keeps its own
     visible label), and the year field and the submit/give-up row go on one line too —
     recovering enough height to keep the whole form (now two selects plus year/actions)
     reachable without scrolling (review B3). */
  @media (max-height: 900px) {
    .guess-form {
      gap: var(--space-2);
    }

    .guess-form__names {
      flex-direction: row;
      gap: var(--space-2);
    }

    .guess-form__names > .guess-form__field {
      flex: 1 1 0;
      min-width: 0;
    }

    /* A locked field's chip shares an already-narrow column with its select (§5.3.3) — tighten
       both so the select keeps as much width as possible for its (still fully visible via
       scroll/ellipsis) selected option text. */
    .select-row {
      gap: var(--space-1);
    }

    .lock-chip {
      flex: 0 0 auto;
      padding: 0 var(--space-2);
      font-size: 0.8rem;
    }

    .guess-form__bottom {
      flex-direction: row;
      align-items: flex-end;
      flex-wrap: wrap;
    }

    .guess-form__field--year {
      flex: 0 1 auto;
      min-width: 6rem;
    }

    .guess-form__actions {
      flex: 1 1 auto;
    }

    /* The visible "Year" label is redundant once the field sits next to the buttons on one line
       (the year input's own value and steppers make its purpose clear) — hidden the same way
       app.css's .visually-hidden utility does, so it stays in the accessibility tree. */
    .guess-form__field--year label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  }

  .give-up-confirm {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: 0.9rem;
  }

  .field-error {
    color: var(--color-danger);
    font-size: 0.85rem;
    margin: 0;
  }
</style>
