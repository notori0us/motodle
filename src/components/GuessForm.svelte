<!-- Combobox + year + submit + give-up (§5.1, §5.3, §5.4, §4.3 locking). -->
<script lang="ts">
  import type { CatalogIndex, MatchResult, TodayState } from '../../schema/types';
  import { getMake } from '../lib/catalog';
  import type { SubmitGuessInput } from '../lib/game';
  import type { MatchEntry } from '../lib/match';
  import GuessCombobox from './GuessCombobox.svelte';
  import YearInput from './YearInput.svelte';

  const MAX_YEAR = new Date().getFullYear() + 1;

  interface Props {
    today: TodayState;
    catalog: CatalogIndex;
    entries: MatchEntry[];
    /** Catalog failed to load (§5.1): the form is disabled entirely. */
    disabled?: boolean;
    onsubmit: (input: SubmitGuessInput) => void;
    ongiveup: () => void;
  }
  let { today, catalog, entries, disabled = false, onsubmit, ongiveup }: Props = $props();

  let committed = $state<MatchResult | null>(null);
  // Initialized null, not from `today.locks.year` (§10.7 gotcha #8) — the $effect below runs on
  // mount too and sets it correctly for a resumed (e.g. practice) game that is already locked.
  let yearValue = $state<number | null>(null);
  let attemptedInvalid = $state(false);
  let confirmingGiveUp = $state(false);

  const gameOver = $derived(today.status !== 'in_progress');
  const formDisabled = $derived(disabled || gameOver);

  // Defensive re-sync: once the year locks, the field must show exactly the player's own green
  // guess (§4.3), never drift from it.
  $effect(() => {
    if (today.locks.year !== null) yearValue = today.locks.year;
  });

  const lockedMakeName = $derived(today.locks.makeId ? getMake(catalog, today.locks.makeId).name : null);

  /** The player's OWN matched entry for the guess that locked MODEL — never `answer.model`,
   *  which would leak an `acceptModelIds` match (§4.3). */
  const lockedModelLabel = $derived.by(() => {
    if (!today.locks.modelId) return null;
    const g = today.guesses.find((gr) => gr.modelId === today.locks.modelId);
    return g ? `${g.make} ${g.model}` : null;
  });

  const guessInput = $derived.by((): SubmitGuessInput | null => {
    if (yearValue === null || yearValue < 1885 || yearValue > MAX_YEAR) return null;
    if (today.locks.modelId && today.locks.makeId) {
      const g = today.guesses.find((gr) => gr.modelId === today.locks.modelId);
      if (!g) return null;
      return { makeId: today.locks.makeId, modelId: today.locks.modelId, make: g.make, model: g.model, year: yearValue };
    }
    if (!committed) return null;
    const make = getMake(catalog, committed.makeId).name;
    return { makeId: committed.makeId, modelId: committed.modelId, make, model: committed.label.slice(make.length + 1), year: yearValue };
  });

  const comboInvalid = $derived(attemptedInvalid && today.locks.modelId === null && committed === null);
  const yearInvalid = $derived(
    attemptedInvalid && today.locks.year === null && (yearValue === null || yearValue < 1885 || yearValue > MAX_YEAR),
  );
  const submitDisabled = $derived(formDisabled || guessInput === null);

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

<!-- novalidate: without it, the browser's own HTML5 constraint validation (YearInput's min/max)
     silently swallows the submit for an out-of-range TYPED year before this component's onsubmit
     ever runs — the same class of silent block B2 named, just triggered by native validation
     instead of the disabled attribute. Our own aria-invalid/aria-describedby message (§5.3) is the
     only validation UI; a native tooltip would also be unreachable in a headless e2e run. -->
<form class="guess-form" onsubmit={handleSubmit} novalidate>
  <div class="guess-form__field">
    <label for="mtd-guess">Make and model</label>
    <GuessCombobox
      id="mtd-guess"
      {entries}
      lockedMakeId={today.locks.makeId}
      {lockedMakeName}
      lockedLabel={lockedModelLabel}
      disabled={formDisabled}
      invalid={comboInvalid}
      invalidMessage="Pick a bike from the list"
      onchoose={(m) => {
        committed = m;
      }}
    />
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

  /* Short viewports (e.g. 360x640, §5.8): put the year field and the submit/give-up row on one
     line instead of stacked, recovering enough height to keep the form reachable without
     scrolling (review B3). */
  @media (max-height: 900px) {
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
</style>
