<!-- Copy confirmation / error toast. A polite live region so screen readers announce it without
     moving focus. -->
<script lang="ts">
  interface Props {
    message: string | null;
  }
  let { message }: Props = $props();
</script>

{#if message}
  <div class="toast" role="status" aria-live="polite">
    {message}
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    left: 50%;
    /* Lifted clear of the give-up row's hairline at short viewports (§5.14.10 minor obs) — the
       toast used to land directly on top of it. */
    bottom: max(4.5rem, calc(env(safe-area-inset-bottom) + 3.5rem));
    transform: translateX(-50%);
    background: var(--color-fg);
    color: var(--color-bg);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    z-index: 60;
    font-size: 0.875rem;
    font-weight: 500;
    max-width: calc(100vw - 2rem);
    text-align: center;
    animation: motodle-toast-in 160ms ease-out both;
  }

  @keyframes motodle-toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  @media (min-width: 900px) and (min-height: 620px) {
    .toast {
      bottom: max(1.5rem, env(safe-area-inset-bottom));
    }
  }
</style>
