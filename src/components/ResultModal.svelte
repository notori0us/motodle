<!--
  §5.6, §7.3: win/lose headline, answer, the full reveal (letterboxed — its aspect is the
  source-cropped aspect, not 4:3), attribution (credit.modified always shown beside the licence
  link, creditNote verbatim, attribution shown regardless of attributionRequired), score
  breakdown, Share.
-->
<script lang="ts">
  import type { Puzzle, TodayState } from '../../schema/types';
  import { resolveAssetUrl } from '../lib/puzzle';
  import { multiplier, pointsFromLocks } from '../lib/score';
  import Modal from './Modal.svelte';

  interface Props {
    open: boolean;
    puzzle: Puzzle;
    today: TodayState;
    isPractice?: boolean;
    onclose: () => void;
    onshare: () => void;
    /** §5.10.3: opens the credits view (§5.10.4). Both modals are `Modal.svelte`-based and trap
     *  focus, so they must never be open at once — see `openCredits` below. */
    oncredits: () => void;
  }
  let { open, puzzle, today, isPractice = false, onclose, onshare, oncredits }: Props = $props();

  const won = $derived(today.status === 'won');
  const points = $derived(pointsFromLocks(today.locks));
  const mult = $derived(multiplier(won, today.endedAtGuess ?? 5));
  const fullSrc = $derived(resolveAssetUrl(puzzle.image.full.src));

  function openCredits(): void {
    onclose();
    oncredits();
  }
</script>

<Modal {open} titleId="result-title" {onclose}>
  <h2 id="result-title" class="result-verdict" class:is-win={won}>{won ? 'You got it!' : 'Better luck tomorrow'}</h2>
  <p class="result-answer">
    <span class="result-answer__year">{puzzle.answer.year}</span>
    {puzzle.answer.make}
    {puzzle.answer.model}
    {#if isPractice}<span class="practice-tag">(practice)</span>{/if}
  </p>

  <div class="result-image">
    <img
      src={fullSrc}
      width={puzzle.image.full.w}
      height={puzzle.image.full.h}
      alt={`${puzzle.answer.year} ${puzzle.answer.make} ${puzzle.answer.model}, full photo`}
      loading="lazy"
      style="width: 100%; height: 100%; object-fit: contain;"
    />
  </div>

  <p class="result-score">
    <span class="result-score__plate">{points} × {mult}</span> = <strong class="result-score__plate result-score__total">{today.score ?? 0}</strong> / 15
  </p>

  <p class="result-credit">
    Photo by {puzzle.credit.author} ·
    <a href={puzzle.credit.license.url} target="_blank" rel="noopener noreferrer">{puzzle.credit.license.name}</a>
    · {puzzle.credit.modified} ·
    <a href={puzzle.credit.descriptionUrl} target="_blank" rel="noopener noreferrer">Source on Commons</a>
  </p>
  {#if puzzle.credit.creditNote}
    <p class="result-credit-note">{puzzle.credit.creditNote}</p>
  {/if}

  <div class="result-actions">
    <button type="button" class="button button--primary" onclick={onshare}>Share</button>
    <button type="button" id="mtd-credits-link-result" class="link-button" onclick={openCredits}
      >Photo credits</button
    >
  </div>
</Modal>

<style>
  /* The Experience moment (§5.14.6): one orchestrated entrance, each element following the last.
     Reduced motion collapses every duration via app.css's global rule. */
  .result-verdict {
    font-size: 1.5rem;
    font-weight: 800;
    letter-spacing: -0.015em;
    line-height: 1.15;
    margin: 0 0 var(--space-2);
    color: var(--color-muted);
    animation: motodle-reveal-rise 180ms ease-out both;
  }

  /* K6: win/loss state ink, never --color-danger — red means "wrong tile" and the One Signal Rule
     holds here too. A win takes the "right" green; a loss stays quiet muted ink. */
  .result-verdict.is-win {
    color: var(--tile-green-bg);
  }

  .result-answer {
    font-size: 1.125rem;
    font-weight: 600;
    margin: 0 0 var(--space-4);
    animation: motodle-reveal-rise 180ms 40ms ease-out both;
  }

  .result-answer__year {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
  }

  .practice-tag {
    color: var(--color-muted);
    font-weight: 400;
  }

  /* Edge to edge (K10): the mount bleeds to the dialog's own edges (negative margin = the
     dialog's own padding) instead of floating as a bordered card inside it. The ground is a
     deliberate mat, not leftover chrome — a non-4:3 photo's letterbox bars now read as a mount,
     not a rendering bug. .result-image / object-fit:contain stay: ResultModal.test.ts asserts
     both. */
  .result-image {
    width: calc(100% + var(--space-5) * 2);
    margin: 0 calc(var(--space-5) * -1) var(--space-4);
    aspect-ratio: 4 / 3;
    background: color-mix(in oklab, var(--color-fg) 6%, var(--color-bg-elevated));
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: motodle-reveal-photo 260ms 60ms ease-out both;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .result-image {
      background: var(--color-bg);
    }
  }
  :global(:root[data-theme='dark']) .result-image {
    background: var(--color-bg);
  }

  @media (min-width: 900px) {
    .result-image {
      border-radius: 0 0 var(--radius-sm) var(--radius-sm);
    }
  }

  .result-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  /* The score row (§5.14.10 A4 — overrides §5.14.7 item 11's "three sibling plates"):
     ResultModal.test.ts:124 asserts /3 × 3/ against ONE element's own text, so the operand pair
     stays grouped in a single plate rather than splitting across siblings; the total gets its
     own plate. textContent stays the same literal "3 × 3 = 9 / 15" the test reads. */
  .result-score {
    font-size: 1rem;
    margin: 0 0 var(--space-4);
    animation: motodle-reveal-rise 180ms 120ms ease-out both;
  }

  .result-score__plate {
    display: inline-block;
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    background: var(--color-surface);
    border-radius: var(--radius-sm);
    padding: 0.1em var(--space-2);
  }

  .result-score__total {
    color: var(--color-fg);
  }

  /* A caption now (K12), not a wall: moved below the score, meta role, above a hairline. Every
     field and every link stay exactly as §5.10.3 specifies — presentation only. */
  .result-credit {
    font-size: 0.75rem;
    line-height: 1.5;
    color: var(--color-muted);
    padding-top: var(--space-3);
    border-top: 1px solid var(--color-border);
  }

  .result-credit-note {
    font-size: 0.75rem;
    font-style: italic;
    color: var(--color-muted);
    margin-top: var(--space-1);
  }

  .result-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
  }

  @media (max-width: 599px) {
    .result-actions .button--primary {
      flex: 1 1 auto;
    }
  }

  @keyframes motodle-reveal-rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes motodle-reveal-photo {
    from {
      opacity: 0;
      transform: scale(1.02);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  /* The scrim + dialog entrance (§5.14.6) is scoped to THIS dialog only — :has() targets the
     overlay that contains #result-title, so every other Modal.svelte consumer keeps its existing
     instant open. :global() because the overlay/dialog elements are Modal.svelte's own markup,
     outside this component's Svelte scope. */
  :global(.modal-overlay:has(#result-title)) {
    animation: motodle-reveal-scrim 160ms ease-out both;
  }
  :global(.modal-overlay:has(#result-title) .modal-dialog) {
    animation: motodle-reveal-dialog 220ms ease-out both;
  }

  @keyframes motodle-reveal-scrim {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes motodle-reveal-dialog {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
