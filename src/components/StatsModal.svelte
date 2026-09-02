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
      <div class="distribution__row">
        <span class="distribution__label">{score}</span>
        <div class="distribution__track">
          <div
            class="distribution__bar"
            class:distribution__bar--highlight={highlightScore === score}
            style={`width: ${pct}%`}
          >
            {count}
          </div>
        </div>
      </div>
    {/each}
  </div>

  <div class="countdown">
    <span>Next Motodle</span>
    <strong>{formatHMS(remainingMs)}</strong>
  </div>

  {#if canShare}
    <button type="button" class="button button--primary" onclick={onshare}>Share</button>
  {/if}
</Modal>

<style>
  .stats-summary {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: var(--space-2);
    text-align: center;
    margin-bottom: var(--space-4);
  }

  .stats-summary strong {
    display: block;
    font-size: 1.4rem;
  }

  .stats-summary span {
    font-size: 0.75rem;
    color: var(--color-muted);
  }

  .distribution {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }

  .distribution__row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .distribution__label {
    width: 2rem;
    text-align: right;
    font-size: 0.85rem;
    color: var(--color-muted);
  }

  .distribution__track {
    flex: 1;
    background: var(--color-surface);
    border-radius: var(--radius-sm);
  }

  .distribution__bar {
    min-width: 1.5rem;
    background: var(--color-accent);
    color: var(--color-accent-fg);
    border-radius: var(--radius-sm);
    padding: 0 var(--space-2);
    font-size: 0.8rem;
    text-align: right;
  }

  .distribution__bar--highlight {
    background: var(--tile-green-bg);
    color: var(--tile-green-fg);
  }

  .countdown {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }

  .countdown strong {
    font-variant-numeric: tabular-nums;
  }
</style>
