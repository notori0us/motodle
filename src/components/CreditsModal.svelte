<!--
  §5.10.4: the photo-credits back-catalogue. Presentational, like ArchiveList — the store
  (`src/state/game.svelte.ts`) owns fetching, batching and the spoiler filter (`src/lib/credits.ts`
  is the only place that filter lives). Reachable from the footer (`#mtd-credits-link`) and from
  ResultModal (`#mtd-credits-link-result`).
-->
<script lang="ts">
  import type { CreditRow } from '../lib/credits';
  import Modal from './Modal.svelte';

  interface Props {
    open: boolean;
    rows: CreditRow[];
    status: 'loading' | 'ready' | 'failed';
    hasMore: boolean;
    /** Count for the "Show more (N remaining)" label — not derivable from `rows.length` alone,
     *  since a skipped (404 / load-failed) day is counted toward progress but produces no row. */
    remaining: number;
    loadingMore: boolean;
    onmore: () => void;
    onretry: () => void;
    onclose: () => void;
  }
  let { open, rows, status, hasMore, remaining, loadingMore, onmore, onretry, onclose }: Props = $props();
</script>

<Modal {open} titleId="credits-title" {onclose}>
  <h2 id="credits-title">Photo credits</h2>
  <p class="credits-intro">
    Photos come from Wikimedia Commons under Creative Commons or public-domain licenses and are
    cropped, resized and re-encoded.
  </p>

  {#if status === 'loading'}
    <p>Loading…</p>
  {:else if status === 'failed'}
    <p>Couldn't load the photo credits.</p>
    <button type="button" class="button button--primary" onclick={onretry}>Retry</button>
  {:else if rows.length === 0}
    <p id="mtd-credits-empty">No photo credits yet — they appear here once a puzzle is finished.</p>
  {:else}
    <ul id="mtd-credits" class="credits-list">
      {#each rows as row (row.id)}
        <li data-mtd-credit-row data-date={row.date} class="credits-row">
          <p class="credits-row__line">
            Motodle #{row.number} · {row.date} · {row.year} {row.make} {row.model} — photo by {row.credit.author}
            ·
            <a href={row.credit.license.url} target="_blank" rel="noopener noreferrer">{row.credit.license.name}</a>
            ·
            <a href={row.credit.descriptionUrl} target="_blank" rel="noopener noreferrer">Source on Commons</a>
            · {row.credit.modified}
          </p>
          {#if row.credit.creditNote}
            <p class="credits-row__note">{row.credit.creditNote}</p>
          {/if}
        </li>
      {/each}
    </ul>
    {#if hasMore}
      <button
        type="button"
        id="mtd-credits-more"
        class="button"
        disabled={loadingMore}
        onclick={onmore}
      >{loadingMore ? 'Loading…' : `Show more (${remaining} remaining)`}</button>
    {/if}
  {/if}
</Modal>

<style>
  .credits-intro {
    color: var(--color-muted);
    margin-bottom: var(--space-4);
  }

  .credits-list {
    list-style: none;
    margin: 0 0 var(--space-4);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    max-height: 60vh;
    overflow-y: auto;
  }

  .credits-row {
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--color-border);
  }

  .credits-row:last-child {
    border-bottom: none;
  }

  .credits-row__line {
    margin: 0;
    font-size: 0.85rem;
  }

  .credits-row__note {
    margin: var(--space-1) 0 0;
    font-size: 0.85rem;
    font-style: italic;
    color: var(--color-muted);
  }
</style>
