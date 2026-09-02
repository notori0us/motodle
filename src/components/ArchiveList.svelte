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
          <a href={`?d=${p.date}`}>Motodle #{p.number} <span class="archive-list__date">{p.date}</span></a>
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
    min-height: var(--touch-target);
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-sm);
    text-decoration: none;
  }

  .archive-list a:hover {
    background: var(--color-surface);
  }

  .archive-list__date {
    color: var(--color-muted);
    font-size: 0.85rem;
  }
</style>
