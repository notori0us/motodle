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

  // Screen-reader announcement of the latest row. The tiles themselves are static cells, so
  // without this a keyboard/SR player submits a guess and hears nothing (§5.6 spirit: colour is
  // never the only signal — here, sight is not the only channel either).
  const latest = $derived(guesses.length > 0 ? guesses[guesses.length - 1] : null);
  const announcement = $derived(
    latest
      ? `Guess ${guesses.length}: make ${latest.make} ${LABELS[latest.result.make]}, ` +
        `model ${latest.model} ${LABELS[latest.result.model]}, year ${latest.year} ${LABELS[latest.result.year]}.`
      : '',
  );
</script>

<!-- A plain polite live region, deliberately NOT role="status": the toast and the rollover banner
     already own that role, and a third one would make `getByRole('status')` ambiguous. -->
<div class="visually-hidden" aria-live="polite" aria-atomic="true" data-testid="guess-announcement">{announcement}</div>
<div class="scoreboard" role="table" aria-label="Guesses">
  <div class="scoreboard__head" role="row">
    <span role="columnheader">Make</span>
    <span role="columnheader">Model</span>
    <span role="columnheader">Year</span>
  </div>
  {#each rows as g, i (i)}
    <div class="scoreboard__row" role="row" class:is-new={g !== null && i === guesses.length - 1}>
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
        <span class="tile tile--numeric" role="cell" data-color={g.result.year}>
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
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--color-border);
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
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
    font-size: 0.875rem;
    font-weight: 600;
    letter-spacing: -0.005em;
    text-align: center;
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--tile-empty-border);
    background: var(--tile-empty-bg);
    color: var(--tile-empty-fg);
  }

  .tile--numeric .tile__label {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
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

  /* The stamp (§5.14.6, signature motion): only the newest row animates in, staggered per
     column so make -> model -> year read as a sequence, not a flash. Pure CSS @keyframes, same
     reason as ImageStage's cross-fade — no Svelte transition:, no Web Animations API, jsdom-safe. */
  .scoreboard__row.is-new .tile {
    animation: motodle-stamp 150ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }
  .scoreboard__row.is-new .tile:nth-child(1) {
    animation-delay: 0ms;
  }
  .scoreboard__row.is-new .tile:nth-child(2) {
    animation-delay: 60ms;
  }
  .scoreboard__row.is-new .tile:nth-child(3) {
    animation-delay: 120ms;
  }

  @keyframes motodle-stamp {
    from {
      opacity: 0;
      transform: translateY(3px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* Short viewports (e.g. 360x640, §5.8): the 5-row grid is the single biggest fixed cost on the
     page, so tighten its row gap and tile padding further where vertical space is actually scarce
     (review B3's numeric target — 2rem alone was not enough to clear the fold). */
  @media (max-height: 1000px) {
    .scoreboard {
      gap: var(--space-1);
    }

    .tile {
      min-height: 1.6rem;
      padding: 0 var(--space-1);
    }
  }

  /* 320x568 fold regression (review B3, optional buffer): a few more px of slack on the same
     shortest-viewport budget as GuessForm's and ImageStage's 700px rules. */
  @media (max-height: 700px) {
    .scoreboard__head {
      padding-bottom: 0;
    }
  }
</style>
