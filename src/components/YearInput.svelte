<!-- §5.4: numeric year input + steppers, 1885..currentYear+1. Never validated by string length
     (Cardle's "abcd" bug) — validity is "parses as an integer in range", nothing else.
     Revision 8 (§5.11.3/§5.11.7): drops invalidMessage/its own <p> — GuessForm owns the message,
     on the field's shared label line, so the component only reports aria-invalid/-describedby. -->
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
  }
  let { id, value, onchange, locked = false, disabled = false, invalid = false }: Props = $props();

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

  /** The steppers are pointer-driven (press-and-hold auto-repeat), and a keyboard activation
   *  fires no pointer events — so Enter/Space step once explicitly, else the buttons are
   *  focusable but inert for keyboard-only players. */
  function handleStepKeydown(e: KeyboardEvent, delta: number) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (e.repeat) return;
    commitStep(delta);
  }
</script>

<div class="year-input" data-locked={locked}>
  <button
    type="button"
    class="year-input__step"
    aria-label="Earlier year"
    disabled={disabled || locked}
    onpointerdown={() => startRepeat(-1)}
    onpointerup={stopRepeat}
    onpointerleave={stopRepeat}
    onpointercancel={stopRepeat}
    onkeydown={(e) => handleStepKeydown(e, -1)}
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
    aria-describedby={invalid ? `${id}-error` : undefined}
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
    onkeydown={(e) => handleStepKeydown(e, 1)}
  >
    +
  </button>
</div>

<style>
  /* − [ field ] + as a grid, not a flex row: the steppers are EXACTLY --touch-target and the field
     takes what is left, instead of the field collapsing and the steppers stretching. */
  .year-input {
    display: grid;
    grid-template-columns: var(--touch-target) minmax(0, 1fr) var(--touch-target);
    gap: var(--space-1);
  }

  /* Same height/radius/border/16px-floor as GuessForm's .select and .button — drawn from the same
     tokens rather than one shared selector, since Svelte scopes styles per component. */
  .year-input__step,
  .year-input__field {
    height: var(--touch-target);
    min-height: var(--touch-target);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    color: var(--color-fg);
    width: 100%;
    touch-action: manipulation;
    transition: background-color 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out;
  }

  .year-input__step {
    font-size: 1.25rem;
    line-height: 1;
  }

  .year-input__field {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    font-size: 1rem; /* 16px floor — iOS focus auto-zoom (§5.3.5), contractual regardless of face */
    padding: 0 var(--space-1);
    text-align: center;
    /* Kill the native spinner: it is a second, ~12px-wide stepper sitting beside our own two. */
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .year-input__field::-webkit-outer-spin-button,
  .year-input__field::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  /* Two different "not editable" states, deliberately drawn differently (§5.3.3):
     LOCKED   = the player got it right; the value is theirs and settled -> full-strength text.
     DISABLED = the control is dead (game over, catalog failed) -> muted.
     Neither uses opacity: opacity fades text and border together and drops the label under 4.5:1. */
  .year-input__step:disabled,
  .year-input__field:disabled {
    opacity: 1;
    background: var(--color-surface);
    color: var(--color-muted);
    cursor: not-allowed;
  }

  .year-input[data-locked='true'] .year-input__field:disabled {
    color: var(--color-fg);
    font-weight: 600;
  }
</style>
