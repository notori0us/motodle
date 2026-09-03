<!-- §5.6: Played / Win% / streaks, the 8-bucket score distribution, countdown, Share. -->
<script lang="ts">
  import type { StatsState } from '../../schema/types';
  import { msUntilNextLocalMidnight } from '../lib/date';
  import Modal from './Modal.svelte';

  interface Props {
    open: boolean;
    stats: StatsState;
    /** This session's just-finished, non-practice score — highlights that bucket. Null when
     *  nothing has been completed yet (or the finished game was practice, which never touches
     *  stats). */
    highlightScore: number | null;
    /** Sharing mid-game would broadcast a partial grid as a 0/15 result — the button exists only
     *  once today's (or the practice) game has ended, exactly like Wordle. */
    canShare: boolean;
    onclose: () => void;
    onshare: () => void;
  }
  let { open, stats, highlightScore, canShare, onclose, onshare }: Props = $props();

  // Display order is descending (§5.6: "15 12 9 6 3 2 1 0").
  const ORDER = [15, 12, 9, 6, 3, 2, 1, 0] as const;

  const winPct = $derived(stats.played > 0 ? Math.round((stats.wins / stats.played) * 100) : 0);
  const maxCount = $derived(Math.max(1, ...ORDER.map((s) => stats.scoreDistribution[String(s) as '0'])));

  function formatHMS(ms: number): string {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
  }

  let remainingMs = $state(msUntilNextLocalMidnight());

  $effect(() => {
    if (!open) return;
    remainingMs = msUntilNextLocalMidnight();
    const timer = setInterval(() => {
      remainingMs = msUntilNextLocalMidnight();
    }, 1000);
    return () => clearInterval(timer);
  });
</script>

<Modal {open} titleId="stats-title" {onclose}>
  <h2 id="stats-title">Statistics</h2>
  <div class="stats-summary">
    <div><strong>{stats.played}</strong><span>Played</span></div>
    <div><strong>{winPct}</strong><span>Win %</span></div>
    <div><strong>{stats.currentStreak}</strong><span>Current streak</span></div>
    <div><strong>{stats.maxStreak}</strong><span>Max streak</span></div>
  </div>

  <h3>Score distribution</h3>
  <div class="distribution">
    {#each ORDER as score (score)}
      {@const count = stats.scoreDistribution[String(score) as '0']}
      {@const pct = Math.max(6, Math.round((count / maxCount) * 100))}
      {@const highlighted = highlightScore === score}
      <div class="distribution__row">
        <span class="distribution__label">{score}</span>
        <div class="distribution__track">
          <div
            class="distribution__bar"
            class:distribution__bar--highlight={highlighted}
            class:distribution__bar--zero={count === 0}
            style={count === 0 ? undefined : `width: ${pct}%`}
          >
            {count}
          </div>
        </div>
      </div>
    {/each}
  </div>

  <div class="countdown">
    <span class="countdown__label">Next Motodle</span>
    <strong class="countdown__value">{formatHMS(remainingMs)}</strong>
  </div>

  {#if canShare}
    <button type="button" class="button button--primary stats-cta" onclick={onshare}>Share</button>
  {/if}
</Modal>

<style>
  h3 {
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-muted);
    margin: 0 0 var(--space-2);
  }

  .stats-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
    text-align: center;
    margin-bottom: var(--space-5);
  }

  .stats-summary strong {
    display: block;
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 1.5rem;
  }

  .stats-summary span {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-muted);
  }

  /* K11: "Current streak" wraps to two lines and breaks the grid at 360px. Two columns under
     380px, not a shortened caption — the caption strings are frozen copy. */
  @media (max-width: 380px) {
    .stats-summary {
      grid-template-columns: repeat(2, 1fr);
      row-gap: var(--space-4);
    }
  }

  .distribution {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-5);
  }

  .distribution__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .distribution__label {
    width: 2rem;
    text-align: right;
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-size: 0.875rem;
    color: var(--color-muted);
  }

  /* review improvement #3: a day-one player (all eight buckets at 0) used to see eight identical
     full-width grey plates before a single game had ever painted one — the FILLED bar was fixed
     (K11), but the TRACK it sits in was always opaque regardless. A hairline baseline instead of a
     plate: a real bar still reads as "filling toward" something, an empty row reads as empty. */
  .distribution__track {
    flex: 1;
    border-bottom: 1px solid var(--color-border);
  }

  /* K11: a zero-count bucket used to render as a colour-filled stub identical in kind to a real
     result — eight of them on a first-time player's very first look at the modal. Non-zero bars
     fill in ink at low alpha with an ink label (not the accent — colour still belongs to the
     scoreboard); a zero bucket carries no fill at all, just its count at the track's left edge. */
  .distribution__bar {
    min-width: 1.5rem;
    background: color-mix(in oklab, var(--color-fg) 12%, transparent);
    color: var(--color-fg);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-size: 0.875rem;
    text-align: right;
  }

  .distribution__bar--zero {
    width: auto;
    background: transparent;
    color: var(--color-muted);
    padding-left: 0;
    text-align: left;
  }

  .distribution__bar--highlight {
    background: var(--tile-green-bg);
    color: var(--tile-green-fg);
  }

  .countdown {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }

  .countdown__label {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--color-muted);
  }

  .countdown__value {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 1.5rem;
  }

  .stats-cta {
    margin-top: var(--space-2);
  }
</style>
