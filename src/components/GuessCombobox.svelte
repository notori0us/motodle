<!--
  The ARIA combobox (§5.3, APG combobox / list autocomplete). The listbox is ALWAYS mounted,
  hidden with the `hidden` attribute — never `{#if open}` — so `aria-controls` resolves to a
  real element in both states. DOM focus never leaves the input; the active option is only ever
  virtual (`aria-activedescendant`).
-->
<script lang="ts">
  import type { MatchResult } from '../../schema/types';
  import { matchCatalog, type MatchEntry } from '../lib/match';

  interface Props {
    id: string;
    entries: MatchEntry[];
    /** Locked-make filtering (§4.3, §5.3): narrows the search pool, but each entry keeps its
     *  full "{make} {model}" norm, so make tokens stay searchable. */
    lockedMakeId?: string | null;
    lockedMakeName?: string | null;
    /** Model locked green (§4.3): the field shows the player's OWN matched entry and is
     *  disabled — never the answer's canonical label (that would leak an acceptModelIds match). */
    lockedLabel?: string | null;
    disabled?: boolean;
    invalid?: boolean;
    invalidMessage?: string | null;
    /** Fires with the chosen entry on commit, or `null` the moment the player edits away from a
     *  previously-committed choice (§5.3: submit is enabled only when an entry is ACTUALLY
     *  chosen, not just typed). */
    onchoose: (match: MatchResult | null) => void;
  }
  let {
    id,
    entries,
    lockedMakeId = null,
    lockedMakeName = null,
    lockedLabel = null,
    disabled = false,
    invalid = false,
    invalidMessage = null,
    onchoose,
  }: Props = $props();

  const listId = $derived(`${id}-listbox`);
  const errorId = $derived(`${id}-error`);

  // Initialized empty, not from `lockedLabel` (§10.7 gotcha #8) — the $effect below runs on
  // mount too and sets it correctly for the initial locked case.
  let query = $state('');
  let open = $state(false);
  let active = $state(-1);
  let containerEl: HTMLDivElement | undefined = $state();

  // Locked-model mode overrides everything else: show the player's own entry, non-interactive.
  $effect(() => {
    if (lockedLabel !== null) {
      query = lockedLabel;
      open = false;
      active = -1;
    }
  });

  // The make just locked (between guesses): reformat a leftover full "Make Model" label from an
  // earlier, unfiltered guess down to model-only, so the chip and the input don't both repeat
  // the make name.
  $effect(() => {
    if (lockedMakeId && lockedMakeName && lockedLabel === null && query.startsWith(`${lockedMakeName} `)) {
      query = query.slice(lockedMakeName.length + 1);
    }
  });

  const isLocked = $derived(lockedLabel !== null);
  const options = $derived(disabled || isLocked ? [] : matchCatalog(query, entries, { lockedMakeId }));

  /** In locked-make mode the row (and the committed display) shows the model name only — the
   *  make is already shown as the chip beside the input (§5.3). */
  function displayLabel(m: MatchResult): string {
    if (lockedMakeId && lockedMakeName && m.label.startsWith(`${lockedMakeName} `)) {
      return m.label.slice(lockedMakeName.length + 1);
    }
    return m.label;
  }

  function openList() {
    if (disabled || isLocked) return;
    open = true;
  }

  function closeList() {
    open = false;
    active = -1;
  }

  function commit(m: MatchResult) {
    query = displayLabel(m);
    closeList();
    onchoose(m);
  }

  function handleInput(e: Event) {
    query = (e.currentTarget as HTMLInputElement).value;
    onchoose(null); // editing away from a committed choice uncommits it
    open = query !== '';
    active = options.length > 0 ? 0 : -1;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (disabled || isLocked) return;
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (e.altKey) {
          openList();
          return;
        }
        if (!open) {
          openList();
          active = options.length > 0 ? 0 : -1;
          return;
        }
        active = options.length > 0 ? Math.min(active + 1, options.length - 1) : -1;
        return;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (e.altKey) {
          closeList(); // Alt+Up: close, keep text
          return;
        }
        if (!open) {
          openList();
          active = options.length > 0 ? options.length - 1 : -1;
          return;
        }
        active = options.length > 0 ? Math.max(active - 1, 0) : -1;
        return;
      }
      case 'Enter': {
        if (!open) return; // falls through to native form submit
        e.preventDefault(); // open: never submits the round
        if (active >= 0 && options[active]) commit(options[active]);
        return;
      }
      case 'Escape': {
        if (open) {
          closeList(); // 1st: close, keep text
          return;
        }
        query = ''; // 2nd: clear
        onchoose(null);
        return;
      }
      case 'Tab': {
        if (open && active >= 0 && options[active]) commit(options[active]);
        else closeList();
        return; // never preventDefault — focus moves on natively
      }
      // Home/End intentionally unhandled: the editable-combobox rule is that they move the TEXT
      // CARET, not the list (§5.3) — falling through to the browser default achieves that.
      default:
        return;
    }
  }

  function handleOptionPointerDown(e: PointerEvent, m: MatchResult) {
    // preventDefault here (not on click) is what stops the input's mousedown-blur from closing
    // the list before the selection registers — Cardle's exact bug class (§5.3).
    e.preventDefault();
    commit(m);
  }

  $effect(() => {
    if (!open) return;
    const onDocPointerDown = (e: PointerEvent) => {
      const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
      if (containerEl && !path.includes(containerEl)) closeList();
    };
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  });

  $effect(() => {
    if (active < 0) return;
    // jsdom (component tests) has no `scrollIntoView` — guard it rather than skip the effect.
    document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' });
  });

  // Flip the popup above the input when it sits in the lower 45% of the visual viewport, so the
  // on-screen keyboard never covers it (§5.3). Defensive against environments with no
  // visualViewport (jsdom in component tests) — flipUp just stays false there.
  let flipUp = $state(false);
  $effect(() => {
    if (!open || typeof window === 'undefined' || !window.visualViewport || !containerEl) {
      flipUp = false;
      return;
    }
    const rect = containerEl.getBoundingClientRect();
    flipUp = rect.top / window.visualViewport.height > 0.55;
  });
</script>

<div class="combobox" bind:this={containerEl}>
  {#if lockedMakeId && lockedMakeName && lockedLabel === null}
    <!-- Suppressed once the model itself locks too: the disabled field's own label already
         reads "Make Model" in full, so the chip would just repeat the make name. -->
    <span class="make-chip">{lockedMakeName}</span>
  {/if}
  <div class="combobox__field">
    <input
      {id}
      role="combobox"
      aria-expanded={open}
      aria-controls={listId}
      aria-autocomplete="list"
      aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
      aria-label={lockedMakeId && lockedMakeName && lockedLabel === null ? `${lockedMakeName} model` : undefined}
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={invalid && invalidMessage ? errorId : undefined}
      autocomplete="off"
      autocorrect="off"
      autocapitalize="none"
      spellcheck="false"
      inputmode="text"
      enterkeyhint="search"
      disabled={disabled || isLocked}
      class="combobox__input"
      value={query}
      oninput={handleInput}
      onkeydown={handleKeydown}
      onfocus={(e) => (e.currentTarget as HTMLInputElement).select()}
    />
    <div aria-live="polite" class="visually-hidden">
      {#if open}{options.length} results{/if}
    </div>
  </div>
  <ul
    id={listId}
    role="listbox"
    aria-label="Motorbikes"
    hidden={!open}
    class="combobox-list"
    class:combobox-list--flip-up={flipUp}
  >
    {#each options as m, i (m.makeId + ':' + m.modelId)}
      <li
        id={`${listId}-${i}`}
        role="option"
        aria-selected={i === active}
        class="combobox-option"
        class:active={i === active}
        onpointerdown={(e) => handleOptionPointerDown(e, m)}
      >
        {displayLabel(m)}
      </li>
    {/each}
  </ul>
</div>
{#if invalid && invalidMessage}
  <p id={errorId} class="field-error">{invalidMessage}</p>
{/if}

<style>
  .combobox {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
  }

  .make-chip {
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

  .combobox__field {
    position: relative;
    flex: 1;
    min-width: 8rem;
  }

  .combobox__input {
    width: 100%;
    min-height: var(--touch-target);
    font-size: 1rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    padding: 0 var(--space-3);
  }

  .combobox-list {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(100% + var(--space-1));
    z-index: 30;
    margin: 0;
    padding: var(--space-1);
    list-style: none;
    background: var(--color-bg-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    max-height: min(60dvh, 20rem);
    overflow-y: auto;
  }

  .combobox-list--flip-up {
    top: auto;
    bottom: calc(100% + var(--space-1));
  }

  .combobox-option {
    min-height: var(--touch-target);
    display: flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    touch-action: manipulation;
  }

  .combobox-option.active {
    background: var(--color-accent);
    color: var(--color-accent-fg);
  }

  .field-error {
    color: var(--color-danger);
    font-size: 0.85rem;
    margin: var(--space-1) 0 0;
  }
</style>
