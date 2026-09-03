<!-- §4.6, §5.1: practice-mode picker. Manifest entries carry no answers/image paths (§3.3) —
     nothing here can spoil. Only date < today is offered; a future/current date is not linked. -->
<script lang="ts">
  import type { Manifest } from '../../schema/types';
  import Modal from './Modal.svelte';

  interface Props {
    open: boolean;
    manifest: Manifest | null;
    todayDateKey: string;
    onclose: () => void;
  }
  let { open, manifest, todayDateKey, onclose }: Props = $props();

  const past = $derived((manifest?.puzzles ?? []).filter((p) => p.date < todayDateKey));
</script>

<Modal {open} titleId="archive-title" {onclose}>
  <h2 id="archive-title">Archive</h2>
  {#if !manifest}
    <p>Loading…</p>
  {:else if past.length === 0}
    <p>No past puzzles yet — check back after today's.</p>
  {:else}
    <ul class="archive-list">
      {#each past as p (p.id)}
        <li>
          <a href={`?d=${p.date}`}>
            <span class="archive-list__num">Motodle #{p.number}</span>
            <span class="archive-list__date">{p.date}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</Modal>

<style>
  .archive-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    max-height: 60vh;
    overflow-y: auto;
  }

  .archive-list a {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: var(--touch-target);
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-bg-elevated);
    color: var(--color-fg);
    font-weight: 500;
    text-decoration: none;
    transition: background-color 120ms ease-out, border-color 120ms ease-out;
  }

  .archive-list a:hover,
  .archive-list a:focus-visible {
    background: var(--color-surface);
  }

  .archive-list__num {
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
  }

  .archive-list__date {
    color: var(--color-muted);
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-size: 0.75rem;
  }
</style>
