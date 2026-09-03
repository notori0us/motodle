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
  <h2 id="result-title">{won ? 'You got it!' : 'Better luck tomorrow'}</h2>
  <p class="result-answer">
    {puzzle.answer.year}
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

  <p class="result-credit">
    Photo by {puzzle.credit.author} ·
    <a href={puzzle.credit.license.url} target="_blank" rel="noopener noreferrer">{puzzle.credit.license.name}</a>
    · {puzzle.credit.modified} ·
    <a href={puzzle.credit.descriptionUrl} target="_blank" rel="noopener noreferrer">Source on Commons</a>
  </p>
  {#if puzzle.credit.creditNote}
    <p class="result-credit-note">{puzzle.credit.creditNote}</p>
  {/if}

  <p class="result-score">
    {points} × {mult} = <strong>{today.score ?? 0}</strong> / 15
  </p>

  <div class="result-actions">
    <button type="button" class="button button--primary" onclick={onshare}>Share</button>
    <button type="button" id="mtd-credits-link-result" class="link-button" onclick={openCredits}
      >Photo credits</button
    >
  </div>
</Modal>

<style>
  .result-answer {
    font-size: 1.1rem;
    font-weight: 600;
  }

  .practice-tag {
    color: var(--color-muted);
    font-weight: 400;
  }

  .result-image {
    width: 100%;
    aspect-ratio: 4 / 3;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .result-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .result-credit {
    font-size: 0.85rem;
    color: var(--color-muted);
    margin-top: var(--space-3);
  }

  .result-credit-note {
    font-size: 0.85rem;
    font-style: italic;
    color: var(--color-muted);
  }

  .result-score {
    font-size: 1rem;
    margin: var(--space-3) 0;
  }

  .result-actions {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
</style>
