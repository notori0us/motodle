<!--
  Focus-trapped dialog primitive (§5.6). Fixed to the viewport (not absolutely positioned inside
  a narrow column). Esc closes, focus returns to the opener, background scroll locked via
  overscroll-behavior: contain.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    titleId: string;
    onclose: () => void;
    children: Snippet;
  }
  let { open, titleId, onclose, children }: Props = $props();

  let dialogEl: HTMLDivElement | undefined = $state();

  function trap(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
      return;
    }
    if (e.key !== 'Tab' || !dialogEl) return;
    const focusables = dialogEl.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  $effect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overscrollBehavior = 'contain';
    const raf = requestAnimationFrame(() => dialogEl?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overscrollBehavior = previousOverscroll;
      opener?.focus();
    };
  });
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -- decorative backdrop; the dialog
       itself and its own controls (incl. Esc) are the real interactive surface. -->
  <div
    class="modal-overlay"
    onpointerdown={(e) => {
      if (e.target === e.currentTarget) onclose();
    }}
  >
    <div
      class="modal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabindex="-1"
      bind:this={dialogEl}
      onkeydown={trap}
    >
      <!-- Esc and the backdrop close every dialog, but neither is discoverable on a phone with no
           keyboard and a thin backdrop strip (review improvement #5) — every dialog needs a
           visible control too. -->
      <button type="button" class="modal-close" aria-label="Close" onclick={onclose}>&times;</button>
      {@render children()}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-overlay);
    padding: var(--space-4);
    z-index: 50;
  }

  .modal-dialog {
    position: relative;
    background: var(--color-bg-elevated);
    color: var(--color-fg);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
    width: 100%;
    max-width: 30rem;
    max-height: 90vh;
    overflow-y: auto;
    padding: var(--space-5);
    outline: none;
  }

  .modal-close {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    min-width: var(--touch-target);
    min-height: var(--touch-target);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-md);
    border: 1px solid var(--color-border);
    background: var(--color-bg-elevated);
    font-size: 1.5rem;
    line-height: 1;
    touch-action: manipulation;
  }
</style>
