<!--
  §5.2, §7.3: 5x3 tile grid. Every tile colour here is read straight off `guesses[].result`,
  which `src/lib/game.ts`'s `submitGuess()` (the ONLY place that calls `evaluateGuess()`) already
  computed — this component never derives a colour itself.
-->
<script lang="ts">
  import type { GuessRecord, TileResult } from '../../schema/types';

  interface Props {
    guesses: GuessRecord[];
    colorblind?: boolean;
  }
  let { guesses, colorblind = false }: Props = $props();

  const GLYPHS: Record<TileResult, string> = { green: '✓', yellow: '~', red: '✗' };
  const LABELS: Record<TileResult, string> = {
    green: 'correct',
    yellow: 'close',
    red: 'incorrect',
  };

  const rows = $derived(Array.from({ length: 5 }, (_, i) => guesses[i] ?? null));
</script>

<div class="scoreboard" role="table" aria-label="Guesses">
  <div class="scoreboard__head" role="row">
    <span role="columnheader">Make</span>
    <span role="columnheader">Model</span>
    <span role="columnheader">Year</span>
  </div>
  {#each rows as g, i (i)}
    <div class="scoreboard__row" role="row">
      {#if g}
        <span class="tile" role="cell" data-color={g.result.make}>
          {#if colorblind}<span class="tile__glyph" aria-hidden="true">{GLYPHS[g.result.make]}</span>{/if}
          <span class="tile__label">{g.make}</span>
          <span class="visually-hidden">Make: {g.make}, {LABELS[g.result.make]}</span>
        </span>
        <span class="tile" role="cell" data-color={g.result.model}>
          {#if colorblind}<span class="tile__glyph" aria-hidden="true">{GLYPHS[g.result.model]}</span>{/if}
          <span class="tile__label">{g.model}</span>
          <span class="visually-hidden">Model: {g.model}, {LABELS[g.result.model]}</span>
        </span>
        <span class="tile" role="cell" data-color={g.result.year}>
          {#if colorblind}<span class="tile__glyph" aria-hidden="true">{GLYPHS[g.result.year]}</span>{/if}
          <span class="tile__label">{g.year}</span>
          <span class="visually-hidden">Year: {g.year}, {LABELS[g.result.year]}</span>
        </span>
      {:else}
        <span class="tile" role="cell" data-color="empty" aria-hidden="true"></span>
        <span class="tile" role="cell" data-color="empty" aria-hidden="true"></span>
        <span class="tile" role="cell" data-color="empty" aria-hidden="true"></span>
      {/if}
    </div>
  {/each}
</div>

<style>
  .scoreboard {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .scoreboard__head {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    font-size: 0.8rem;
    color: var(--color-muted);
    text-align: center;
  }

  .scoreboard__row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
  }

  .tile {
    /* Tiles are non-interactive `<span role="cell">` (never focusable/tappable), so the 44px
       touch-target floor does not apply here (review B3) — a tighter min-height recovers ~68px
       over 5 rows, which 360x640 needs to keep the form on-screen without scrolling (§5.8). */
    min-height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    border-radius: var(--radius-sm);
    font-size: 0.85rem;
    text-align: center;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--tile-empty-border);
    background: var(--tile-empty-bg);
    color: var(--tile-empty-fg);
  }

  .tile[data-color='green'] {
    background: var(--tile-green-bg);
    color: var(--tile-green-fg);
    border-color: var(--tile-green-bg);
  }

  .tile[data-color='yellow'] {
    background: var(--tile-yellow-bg);
    color: var(--tile-yellow-fg);
    border-color: var(--tile-yellow-bg);
  }

  .tile[data-color='red'] {
    background: var(--tile-red-bg);
    color: var(--tile-red-fg);
    border-color: var(--tile-red-bg);
  }

  .tile__glyph {
    font-weight: 700;
  }

  .tile__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Short viewports (e.g. 360x640, §5.8): the 5-row grid is the single biggest fixed cost on the
     page, so tighten its row gap and tile padding further where vertical space is actually scarce
     (review B3's numeric target — 2rem alone was not enough to clear the fold). */
  @media (max-height: 900px) {
    .scoreboard {
      gap: var(--space-1);
    }

    .tile {
      min-height: 1.6rem;
      padding: 0 var(--space-1);
    }
  }
</style>
