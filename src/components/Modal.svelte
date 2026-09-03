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
      <button type="button" class="modal-close" aria-label="Close" onclick={onclose}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true" focusable="false">
          <path d="M5 5 L15 15 M15 5 L5 15" />
        </svg>
      </button>
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
    background-color: var(--color-bg-elevated);
    /* Bottom scroll-shadow (§5.14.10 K3): the two `local`-attached gradients mask the shadow
       against the dialog's own background near an edge that has nothing left to scroll; the two
       `scroll`-attached gradients paint the actual shadow relative to the dialog's own viewport,
       so it appears only while there is more content in that direction. A dialog that clips its
       own content (the first-run help modal at 360x640 clipped mid-sentence with zero indicator,
       K3's original finding) now visibly LOOKS clipped. */
    background-image:
      linear-gradient(var(--color-bg-elevated) 30%, transparent),
      linear-gradient(transparent, var(--color-bg-elevated) 70%),
      linear-gradient(to bottom, color-mix(in oklab, var(--color-fg) 16%, transparent), transparent),
      linear-gradient(to top, color-mix(in oklab, var(--color-fg) 16%, transparent), transparent);
    background-repeat: no-repeat;
    background-size: 100% 2rem, 100% 2rem, 100% 0.9rem, 100% 0.9rem;
    background-position: top, bottom, top, bottom;
    background-attachment: local, local, scroll, scroll;
    color: var(--color-fg);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-modal);
    width: 100%;
    max-width: 30rem;
    max-height: 90vh;
    overflow-y: auto;
    padding: var(--space-5);
    /* The close button no longer overlaps the title's optical space (§5.14.7 item 8): it stays
       top-right, but the dialog's own top padding clears its 44px hit area (top: var(--space-2)
       + 44px tall) before any content starts — a block-level h2 is hit-testable across its FULL
       WIDTH regardless of how short its text is, so §5.14.3's own margin:0 on the verdict role
       put the title's box back in the button's rectangle at var(--space-6) alone (32px) with 44px
       of button to clear. Verified empirically via e2e, not by inspection — this is the value
       that actually clears it. */
    padding-top: calc(var(--touch-target) + var(--space-3));
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
    border: 1px solid transparent;
    background: transparent;
    color: var(--color-muted);
    touch-action: manipulation;
    transition: background-color 120ms ease-out, color 120ms ease-out;
  }

  .modal-close:hover,
  .modal-close:focus-visible {
    background: var(--color-surface);
    color: var(--color-fg);
  }

  /* Sticky footer (§5.14.10 K3): whichever primary action ends the dialog's content stays on
     screen regardless of scroll length — Got it, Share (when the dialog's last child IS the
     button, or wraps it alongside a secondary link). Global selectors: content rendered via
     {@render children()} carries the CONSUMER's Svelte scope hash, not Modal's, so a plain
     scoped selector here can never reach it — same reason app.css's `.app-main >` rule had to go
     in the global sheet. The button keeps its own accent fill (Rare Accent Rule); a wrapping
     action row instead gets the elevated backdrop so the docked bar doesn't look transparent. */
  :global(.modal-dialog > .button--primary:last-child) {
    position: sticky;
    bottom: calc(var(--space-5) * -1);
    z-index: 1;
    /* display: flex (review B2): the button was still display:inline-flex, so the negative side
       margins below just SHIFTED an unchanged-width pill instead of stretching it — full-bleed
       only above 599px by accident, a stray square-cornered pill below it.
       width: calc(100% + var(--space-5) * 2), not width: auto — a <button>'s UA widget keeps its
       own fit-content sizing algorithm for width:auto even once display is block-level (verified
       empirically: an equivalent <div> DOES auto-fill under the same display + negative-margin
       setup, a <button> does not). 100% resolves against the dialog's CONTENT box (its border-box
       minus its own left/right padding); adding back twice that padding, then the -24px margins
       on each side, lands the button's outer edges exactly on the dialog's own outer edges —
       full-bleed at every width, not just >=600px. */
    display: flex;
    width: calc(100% + var(--space-5) * 2);
    margin: var(--space-3) calc(var(--space-5) * -1) calc(var(--space-5) * -1);
    padding-block: var(--space-3);
    border-radius: 0;
    border-bottom-left-radius: var(--radius-lg);
    border-bottom-right-radius: var(--radius-lg);
    background: var(--color-accent);
    box-shadow: 0 -1px 0 0 var(--color-border);
  }

  :global(.modal-dialog > *:last-child:has(> .button--primary)) {
    position: sticky;
    bottom: calc(var(--space-5) * -1);
    z-index: 1;
    margin: var(--space-3) calc(var(--space-5) * -1) calc(var(--space-5) * -1);
    padding: var(--space-3) var(--space-5);
    background: var(--color-bg-elevated);
    border-top: 1px solid var(--color-border);
  }
</style>
