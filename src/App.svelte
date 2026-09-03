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
  import CreditsModal from './components/CreditsModal.svelte';
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

  // The theme button cycles system -> dark -> light; the glyph never changes, so the tooltip is
  // the only place a sighted player learns which of the three they are on.
  const themeTitle = $derived(`Theme: ${game.prefs.theme} (click to change)`);
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
        <button type="button" class="icon-button" aria-label="How to play" title="How to play" onclick={() => game.openHelp()}>
          ?
        </button>
        <button type="button" class="icon-button" aria-label="Statistics" title="Statistics" onclick={() => game.openStats()}>
          &#128202;
        </button>
        <button type="button" class="icon-button" aria-label="Archive" title="Archive" onclick={() => game.openArchive()}>
          &#128197;
        </button>
        <button type="button" class="icon-button" aria-label="Change theme" title={themeTitle} onclick={cycleTheme}>
          &#9680;
        </button>
        <button
          type="button"
          class="icon-button"
          aria-pressed={game.prefs.colorblind}
          aria-label="Toggle colourblind mode"
          title="Toggle colourblind mode"
          onclick={() => game.toggleColorblind()}
        >
          &#9681;
        </button>
      </div>
    </header>

    {#if game.isPractice}
      <div class="practice-bar">
        <span>{game.puzzle ? `Practice · Motodle #${game.puzzle.number}` : 'Practice'}</span>
        <a class="button" href="?">Back to today</a>
      </div>
    {/if}

    <main class="app-main">
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
            credit={game.puzzle.credit}
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
              onsubmit={(input) => game.submitGuess(input)}
              ongiveup={() => game.giveUp()}
            />
          {/if}
        {/key}
      {/if}
    </main>

    <footer class="app-footer">
      Photos: <a href="https://commons.wikimedia.org/" target="_blank" rel="noopener noreferrer"
        >Wikimedia Commons</a
      >, Creative Commons licences ·
      <button type="button" id="mtd-credits-link" class="link-button" onclick={() => game.openCredits()}
        >Photo credits</button
      >
    </footer>
  </div>
</div>

<HelpModal open={game.helpOpen} onclose={() => game.closeHelp()} />
<StatsModal
  open={game.statsOpen}
  stats={game.stats}
  highlightScore={!game.isPractice && game.today.status !== 'in_progress' ? game.today.score : null}
  canShare={game.screen === 'game' && game.today.status !== 'in_progress'}
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
    oncredits={() => game.openCredits()}
  />
{/if}
<ArchiveList
  open={game.archiveOpen}
  manifest={game.manifest}
  todayDateKey={game.resolvedTodayKey}
  onclose={() => game.closeArchive()}
/>
<CreditsModal
  open={game.creditsOpen}
  rows={game.credits}
  status={game.creditsStatus}
  hasMore={game.creditsHasMore}
  remaining={game.creditsRemaining}
  loadingMore={game.creditsLoadingMore}
  onmore={() => game.loadMoreCredits()}
  onretry={() => game.openCredits()}
  onclose={() => game.closeCredits()}
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
    flex: 0 0 auto;
    gap: var(--space-2);
  }

  @media (max-width: 380px) {
    .app-header__actions {
      gap: 2px; /* 5 x 44px buttons must fit beside the title at 360px under DejaVu Sans (CI runner) */
    }
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
