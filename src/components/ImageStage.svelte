<!--
  §5.5: crop levels, scrub control, tap-to-enlarge. NEVER touches `image.full` — that is
  ResultModal's job, lazily, only at game end.
-->
<script lang="ts">
  import type { CreditBlock, PuzzleImage } from '../../schema/types';
  import { resolveAssetUrl } from '../lib/puzzle';
  import Modal from './Modal.svelte';

  interface Props {
    image: PuzzleImage;
    unlockedLevel: number;
    viewLevel: number;
    onchangeLevel: (level: number) => void;
    /** §5.10.1: ONLY `credit.license.{name,url}` may reach this subtree. No `author`,
     *  `fileTitle`, `descriptionUrl` or `creditNote` anywhere below — not as text, not in an
     *  attribute — those are Commons-file-title-adjacent and would spoil the answer mid-game. */
    credit: CreditBlock;
  }
  let { image, unlockedLevel, viewLevel, onchangeLevel, credit }: Props = $props();

  let enlargeOpen = $state(false);

  const current = $derived(image.levels[Math.min(viewLevel, image.levels.length) - 1]);
  const currentSrc = $derived(resolveAssetUrl(current.src));

  // Level N+1 is prefetched as soon as level N unlocks, so the reveal is instant (§5.5).
  $effect(() => {
    const next = unlockedLevel + 1;
    if (next > image.levels.length) return;
    const src = resolveAssetUrl(image.levels[next - 1].src);
    if (typeof Image === 'undefined') return;
    const img = new Image();
    img.src = src;
  });

  function selectLevel(level: number) {
    if (level < 1 || level > unlockedLevel) return;
    onchangeLevel(level);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      selectLevel(Math.max(1, viewLevel - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      selectLevel(Math.min(unlockedLevel, viewLevel + 1));
    }
  }
</script>

<div class="image-stage">
  <button type="button" class="image-stage__frame" onclick={() => (enlargeOpen = true)} aria-label="Enlarge image">
    {#key currentSrc}
      <img
        class="image-stage__img"
        src={currentSrc}
        width={current.w}
        height={current.h}
        alt="The motorbike in this puzzle, progressively revealed"
        loading="eager"
      />
    {/key}
    <!-- Tap-to-enlarge affordance (§5.14.7 item 5): nothing previously suggested the photo was
         interactive. A drawn corner mark, not a caption — the photo stays the whole surface. -->
    <svg
      class="image-stage__hint"
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M7.5 3H3v4.5" />
      <path d="M12.5 17H17v-4.5" />
    </svg>
  </button>

  <div class="image-stage__meta">
    <a
      id="mtd-photo-licence"
      class="image-stage__licence"
      href={credit.license.url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Photo license: ${credit.license.name} (opens the license deed)`}
    >Photo: {credit.license.name}</a>

    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- roving-arrow-key navigation
         delegated to the group; each segment button is independently focusable/operable. -->
    <div class="scrub" role="group" aria-label="Crop level" onkeydown={handleKeydown}>
      {#each image.levels as l (l.level)}
        <button
          type="button"
          class="scrub__seg"
          class:active={l.level === viewLevel}
          class:locked={l.level > unlockedLevel}
          disabled={l.level > unlockedLevel}
          aria-disabled={l.level > unlockedLevel}
          aria-current={l.level === viewLevel ? 'true' : undefined}
          aria-label={`Crop level ${l.level} of ${image.levels.length}`}
          onclick={() => selectLevel(l.level)}
        >
          {l.level}
        </button>
      {/each}
    </div>
  </div>
</div>

<Modal open={enlargeOpen} titleId="image-enlarge-title" onclose={() => (enlargeOpen = false)}>
  <h2 id="image-enlarge-title" class="visually-hidden">Enlarged image</h2>
  <img class="image-stage__enlarged" src={currentSrc} width={current.w} height={current.h} alt="" />
</Modal>

<style>
  .image-stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .image-stage__frame {
    position: relative;
    display: block;
    /* Fixed 4:3 box per §5.5 ("zero layout shift as levels swap"). The height cap keeps the guess
       form above the fold at short viewports (§5.8's 360x640 no-scroll rule, review B3): the
       non-image chrome (header, scrub, 5-row board, form) measures ~475px, so the stage gets what
       is left of the viewport, never less than 120px and never more than 36svh / the column width.
       The WIDTH follows the cap (4:3 of it) rather than staying 100% — a 100%-wide, height-capped
       frame letterboxed the crop between two grey bars and wasted ~45% of the frame at 360x640. */
    /* Bigger at every viewport (§5.14.7 item 4, Photograph First Rule): 140->170px predicted at
       360x640, releasing further under the wide-viewport composition in app.css. */
    --stage-max-h: clamp(140px, 100svh - 470px, 40svh);
    width: min(100%, calc(var(--stage-max-h) * 4 / 3));
    margin: 0 auto;
    aspect-ratio: 4 / 3;
    border: none;
    padding: 0;
    background: var(--color-surface);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-plate);
    overflow: hidden;
    touch-action: manipulation;
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .image-stage__frame {
      box-shadow: none;
      border: 1px solid var(--color-border);
    }
  }
  :global(:root[data-theme='dark']) .image-stage__frame {
    box-shadow: none;
    border: 1px solid var(--color-border);
  }

  @media (min-width: 900px) and (min-height: 620px) {
    .image-stage__frame {
      --stage-max-h: min(60svh, 34rem);
    }
  }

  /* 320x568 fold regression (review B3): the 140px floor above left no room for the rest of the
     screen at the shortest supported viewport — 590.5px vs a 568px budget. 700px matches the same
     short-viewport breakpoint GuessForm already uses (§5.11.5); 360x640 clears it without this
     rule (140px frame stays put there), so the floor only drops at heights that actually need it.
     120px is the frame's own pre-Impeccable-pass floor, so "the photo never gets smaller than
     today" still holds even at 320x568. Scoped to (max-width: 899px) as well so it never fights
     the wide two-column composition's own (min-width: 900px) rule above at heights that satisfy
     both (e.g. a short 900px-wide window) — this rule and that one would otherwise tie on
     specificity and let source order silently shrink the wide-layout hero frame. */
  @media (max-height: 700px) and (max-width: 899px) {
    .image-stage__frame {
      --stage-max-h: clamp(120px, 100svh - 470px, 40svh);
    }
  }

  .image-stage__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    /* 200ms cross-fade (§5.5), now settling in rather than just blinking (§5.14.6) — a pure CSS
       @keyframes animation, deliberately NOT Svelte's transition: directive, which calls the Web
       Animations API (element.animate()) that jsdom does not implement, crashing every component
       test that advances a level. app.css's global prefers-reduced-motion rule collapses this to
       ~0. */
    animation: motodle-image-fade-in 200ms ease;
  }

  @keyframes motodle-image-fade-in {
    from {
      opacity: 0;
      transform: scale(1.015);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .image-stage__hint {
    position: absolute;
    top: 8px;
    left: 8px;
    color: var(--color-fg);
    opacity: 0.55;
    pointer-events: none;
  }

  .image-stage__enlarged {
    display: block;
    width: 100%;
    height: auto;
  }

  /* §5.10.1: the in-play licence line shares this row with the scrub control instead of costing
     its own vertical space (§5.10.2's measured fold budget). */
  .image-stage__meta {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .image-stage__licence {
    flex: 1 1 auto;
    min-width: 0; /* load-bearing: lets the text wrap instead of forcing horizontal overflow */
    display: flex;
    align-items: center;
    min-height: var(--touch-target); /* §5.8's 44px rule */
    font-size: 0.75rem;
    line-height: 1.25;
    overflow-wrap: anywhere;
    color: var(--color-muted);
  }

  .scrub {
    flex: 0 1 auto;
    display: grid;
    grid-template-columns: repeat(5, minmax(var(--touch-target), 1fr));
    gap: var(--space-1);
  }

  /* K9: the visual distance between LOCKED and UNLOCKED must exceed the distance between VIEWING
     and UNLOCKED — a progress indicator, not a pager. Viewing = ink fill (frees the accent for
     the submit button, Rare Accent Rule); unlocked = elevated + hairline; locked = no fill, no
     border, reduced-weight muted digit. */
  .scrub__seg {
    min-height: var(--touch-target);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    color: var(--color-fg);
    font-family: var(--font-numeric);
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    touch-action: manipulation;
    transition:
      background-color 120ms ease-out,
      border-color 120ms ease-out,
      color 120ms ease-out;
  }

  .scrub__seg.locked {
    border-color: transparent;
    background: transparent;
    color: var(--color-muted);
    font-weight: 400;
  }

  .scrub__seg.active {
    background: var(--color-fg);
    color: var(--color-bg);
    border-color: var(--color-fg);
  }
</style>
