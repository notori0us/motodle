<!--
  §5.5: crop levels, scrub control, tap-to-enlarge. NEVER touches `image.full` — that is
  ResultModal's job, lazily, only at game end.
-->
<script lang="ts">
  import type { PuzzleImage } from '../../schema/types';
  import { resolveAssetUrl } from '../lib/puzzle';
  import Modal from './Modal.svelte';

  interface Props {
    image: PuzzleImage;
    unlockedLevel: number;
    viewLevel: number;
    onchangeLevel: (level: number) => void;
  }
  let { image, unlockedLevel, viewLevel, onchangeLevel }: Props = $props();

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
  </button>

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -- roving-arrow-key navigation
       delegated to the group; each segment button is independently focusable/operable. -->
  <div class="scrub" role="group" aria-label="Crop level" onkeydown={handleKeydown}>
    {#each image.levels as l (l.level)}
      <button
        type="button"
        class="scrub__seg"
        class:active={l.level === viewLevel}
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
    --stage-max-h: clamp(120px, 100svh - 500px, 36svh);
    width: min(100%, calc(var(--stage-max-h) * 4 / 3));
    margin: 0 auto;
    aspect-ratio: 4 / 3;
    border: none;
    padding: 0;
    background: var(--color-surface);
    border-radius: var(--radius-md);
    overflow: hidden;
    touch-action: manipulation;
  }

  .image-stage__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    /* 200ms cross-fade (§5.5) as a pure CSS @keyframes animation — deliberately NOT Svelte's
       transition: directive, which calls the Web Animations API (element.animate()) that jsdom
       does not implement, crashing every component test that advances a level. A declarative CSS
       animation needs no JS runtime support at all, and app.css's global
       prefers-reduced-motion rule already collapses its duration to ~0. */
    animation: motodle-image-fade-in 200ms ease;
  }

  @keyframes motodle-image-fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .image-stage__enlarged {
    display: block;
    width: 100%;
    height: auto;
  }

  .scrub {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-1);
  }

  .scrub__seg {
    min-height: var(--touch-target);
    border-radius: var(--radius-sm);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    touch-action: manipulation;
  }

  .scrub__seg.active {
    background: var(--color-accent);
    color: var(--color-accent-fg);
    border-color: var(--color-accent);
  }
</style>
