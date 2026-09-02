<!-- §5.4: numeric year input + steppers, 1885..currentYear+1. Never validated by string length
     (Cardle's "abcd" bug) — validity is "parses as an integer in range", nothing else. -->
<script lang="ts">
  const MIN_YEAR = 1885;
  const MAX_YEAR = new Date().getFullYear() + 1;

  interface Props {
    id: string;
    /** The current value, or null when empty/unparseable. Owned by the parent (GuessForm), which
     *  decides submit-eligibility from it — this component only reports and clamps. */
    value: number | null;
    onchange: (value: number | null) => void;
    /** Year locked green (§4.3): disabled, pre-filled with the player's OWN guess, never the
     *  answer. */
    locked?: boolean;
    disabled?: boolean;
    invalid?: boolean;
    invalidMessage?: string | null;
  }
  let { id, value, onchange, locked = false, disabled = false, invalid = false, invalidMessage = null }: Props =
    $props();

  // Initialized empty, not from `value` (§10.7 gotcha #8: `$state(someProp)` only captures the
  // INITIAL value) — the $effect below runs on mount too, so it does the one real assignment.
  let text = $state('');
  let repeatTimer: ReturnType<typeof setInterval> | null = null;
  let repeatDelay: ReturnType<typeof setTimeout> | null = null;

  // Sync the visible text only when the VALUE PROP itself changes (a new puzzle, a lock taking
  // effect, an external reset) — never fights the user's own keystrokes, because this effect's
  // only dependency is `value`, not `text`.
  $effect(() => {
    text = value !== null ? String(value) : '';
  });

  function clamp(n: number): number {
    return Math.min(MAX_YEAR, Math.max(MIN_YEAR, n));
  }

  function handleInput(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value;
    text = raw;
    if (raw.trim() === '') {
      onchange(null);
      return;
    }
    const n = Number(raw);
    onchange(Number.isInteger(n) ? n : null);
  }

  function handleFocus(e: FocusEvent) {
    (e.currentTarget as HTMLInputElement).select();
  }

  function commitStep(delta: number) {
    if (disabled || locked) return;
    const base = value !== null && Number.isInteger(value) ? value : delta > 0 ? MIN_YEAR - 1 : MAX_YEAR + 1;
    const next = clamp(base + delta);
    text = String(next);
    onchange(next);
  }

  function startRepeat(delta: number) {
    commitStep(delta);
    stopRepeat();
    repeatDelay = setTimeout(() => {
      repeatTimer = setInterval(() => commitStep(delta), 90);
    }, 400);
  }

  function stopRepeat() {
    if (repeatDelay) clearTimeout(repeatDelay);
    if (repeatTimer) clearInterval(repeatTimer);
    repeatDelay = null;
    repeatTimer = null;
  }
</script>

<div class="year-input">
  <button
    type="button"
    class="year-input__step"
    aria-label="Earlier year"
    disabled={disabled || locked}
    onpointerdown={() => startRepeat(-1)}
    onpointerup={stopRepeat}
    onpointerleave={stopRepeat}
    onpointercancel={stopRepeat}
  >
    −
  </button>
  <input
    {id}
    class="year-input__field"
    type="number"
    inputmode="numeric"
    min={MIN_YEAR}
    max={MAX_YEAR}
    step="1"
    value={text}
    disabled={disabled || locked}
    aria-invalid={invalid ? 'true' : undefined}
    aria-describedby={invalid && invalidMessage ? `${id}-error` : undefined}
    oninput={handleInput}
    onfocus={handleFocus}
  />
  <button
    type="button"
    class="year-input__step"
    aria-label="Later year"
    disabled={disabled || locked}
    onpointerdown={() => startRepeat(1)}
    onpointerup={stopRepeat}
    onpointerleave={stopRepeat}
    onpointercancel={stopRepeat}
  >
    +
  </button>
</div>
{#if invalid && invalidMessage}
  <p id={`${id}-error`} class="field-error">{invalidMessage}</p>
{/if}

<style>
  .year-input {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
  }

  .year-input__step {
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    font-size: 1.25rem;
    line-height: 1;
    touch-action: manipulation;
  }

  .year-input__field {
    flex: 1;
    min-width: 0;
    min-height: var(--touch-target);
    font-size: 1rem;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    padding: 0 var(--space-3);
    text-align: center;
  }

  .field-error {
    color: var(--color-danger);
    font-size: 0.85rem;
    margin: var(--space-1) 0 0;
  }
</style>
