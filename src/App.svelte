<!--
  Shell, routing (?d= archive), rollover watcher, all screens/states (§5.1). Owns the singleton
  game store (`src/state/game.svelte.ts`) and wires it to every child component; children stay
  presentational and read tile colours only off `TodayState.guesses[].result` (already produced
  by `evaluateGuess()` inside `submitGuess()`), never recomputing one.
-->
<script lang="ts">
  import './styles/tokens.css';
  import './styles/app.css';
  import { onMount } from 'svelte';
  import ArchiveList from './components/ArchiveList.svelte';
  import GuessForm from './components/GuessForm.svelte';
  import HelpModal from './components/HelpModal.svelte';
  import ImageStage from './components/ImageStage.svelte';
  import Modal from './components/Modal.svelte';
  import ResultModal from './components/ResultModal.svelte';
  import Scoreboard from './components/Scoreboard.svelte';
  import StatsModal from './components/StatsModal.svelte';
  import Toast from './components/Toast.svelte';
  import { buildShareText } from './lib/share';
  import { game } from './state/game.svelte';
  import { createShareSink } from './state/share';

  const shareSink = createShareSink();

  // The 'manual' rung of the share ladder (§4.4): a visible, selectable textarea, not a toast
  // that vanishes before the player can copy it (review improvement #4). Local to the shell
  // rather than the game store, since it's pure share-UI state, not persisted game state.
  let manualShareText = $state<string | null>(null);
  let manualShareTextarea = $state<HTMLTextAreaElement | undefined>();

  $effect(() => {
    if (manualShareText !== null) manualShareTextarea?.select();
  });

  onMount(() => {
    game.init();
    return () => game.dispose();
  });

  function handleShare(): void {
    if (!game.puzzle) return;
    const text = buildShareText({
      number: game.puzzle.number,
      score: game.today.score ?? 0,
      guesses: game.today.guesses,
      practice: game.isPractice,
      colorblind: game.prefs.colorblind,
    });
    void shareSink.share(text).then((outcome) => {
      if (outcome === 'copied') game.showToast('Copied to clipboard');
      else if (outcome === 'manual') manualShareText = text;
      // 'shared' (including a dismissed OS share sheet) is silently NOT toasted (§4.4) — the
      // share sheet already gave its own feedback.
    });
  }

  function cycleTheme(): void {
    const next = game.prefs.theme === 'system' ? 'dark' : game.prefs.theme === 'dark' ? 'light' : 'system';
    game.setTheme(next);
  }
</script>

<div class="app-shell">
  {#if game.staleDay}
    <div class="stale-banner" role="status">
      <span>A new Motodle is ready</span>
      <button type="button" class="button" onclick={() => location.reload()}>Reload</button>
    </div>
  {/if}

  <div class="app-column">
    <header class="app-header">
      <h1>Motodle</h1>
      <div class="app-header__actions">
        <button type="button" class="icon-button" aria-label="How to play" onclick={() => game.openHelp()}>?</button>
        <button type="button" class="icon-button" aria-label="Statistics" onclick={() => game.openStats()}>
          &#128202;
        </button>
        <button type="button" class="icon-button" aria-label="Archive" onclick={() => game.openArchive()}>
          &#128197;
        </button>
        <button type="button" class="icon-button" aria-label="Change theme" onclick={cycleTheme}>&#9680;</button>
        <button
          type="button"
          class="icon-button"
          aria-pressed={game.prefs.colorblind}
          aria-label="Toggle colourblind mode"
          onclick={() => game.toggleColorblind()}
        >
          &#9681;
        </button>
      </div>
    </header>

    {#if game.isPractice}
      <div class="practice-bar">
        <span>Practice · Motodle #{game.puzzle?.number ?? ''}</span>
        <a class="button" href="?">Back to today</a>
      </div>
    {/if}

    {#if game.screen === 'loading'}
      <div class="skeleton" style="aspect-ratio: 4 / 3" aria-hidden="true"></div>
    {:else if game.screen === 'no-puzzle'}
      <section class="state-message">
        <p>No Motodle today. Check back tomorrow, or play a past puzzle.</p>
        <button type="button" class="button button--primary" onclick={() => game.openArchive()}>
          Play the archive
        </button>
      </section>
    {:else if game.screen === 'load-failed'}
      <section class="state-message">
        <p>Couldn't load today's Motodle.</p>
        <button type="button" class="button button--primary" onclick={() => game.retryPuzzle()}>Retry</button>
      </section>
    {:else if game.screen === 'game' && game.puzzle}
      {#key game.today.puzzleId}
        <ImageStage
          image={game.puzzle.image}
          unlockedLevel={game.unlockedLevel}
          viewLevel={game.today.viewLevel}
          onchangeLevel={(l) => game.setViewLevel(l)}
        />

        <Scoreboard guesses={game.today.guesses} colorblind={game.prefs.colorblind} />

        {#if game.catalogStatus === 'failed'}
          <section class="state-message">
            <p>Couldn't load the bike list.</p>
            <button type="button" class="button button--primary" onclick={() => game.retryCatalog()}>Retry</button>
          </section>
        {:else if game.catalogStatus === 'ok' && game.catalog}
          <GuessForm
            today={game.today}
            catalog={game.catalog}
            entries={game.matchEntries}
            onsubmit={(input) => game.submitGuess(input)}
            ongiveup={() => game.giveUp()}
          />
        {/if}
      {/key}
    {/if}

    <footer class="app-footer">
      <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer"
        >Photos via Wikimedia Commons</a
      >
    </footer>
  </div>
</div>

<HelpModal open={game.helpOpen} onclose={() => game.closeHelp()} />
<StatsModal
  open={game.statsOpen}
  stats={game.stats}
  highlightScore={!game.isPractice && game.today.status !== 'in_progress' ? game.today.score : null}
  onclose={() => game.closeStats()}
  onshare={handleShare}
/>
{#if game.puzzle}
  <ResultModal
    open={game.resultOpen}
    puzzle={game.puzzle}
    today={game.today}
    isPractice={game.isPractice}
    onclose={() => game.closeResult()}
    onshare={handleShare}
  />
{/if}
<ArchiveList
  open={game.archiveOpen}
  manifest={game.manifest}
  todayDateKey={game.resolvedTodayKey}
  onclose={() => game.closeArchive()}
/>
<Modal open={manualShareText !== null} titleId="manual-share-title" onclose={() => (manualShareText = null)}>
  <h2 id="manual-share-title">Copy your result</h2>
  <p>Your browser can't share directly — select the text below and copy it.</p>
  <textarea
    class="manual-share-text"
    readonly
    bind:this={manualShareTextarea}
    onfocus={(e) => e.currentTarget.select()}>{manualShareText ?? ''}</textarea
  >
</Modal>
<Toast message={game.toast} />

<style>
  .app-header__actions {
    display: flex;
    gap: var(--space-2);
  }

  .skeleton {
    width: 100%;
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }

  .state-message {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  .manual-share-text {
    width: 100%;
    min-height: 8rem;
    font: inherit;
    font-size: 1rem;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-fg);
    resize: vertical;
  }

  .app-footer {
    margin-top: auto;
    padding-top: var(--space-4);
    font-size: 0.75rem;
    text-align: center;
    color: var(--color-muted);
  }
</style>
