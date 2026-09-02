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
    bottom: max(1rem, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    background: var(--color-fg);
    color: var(--color-bg);
    padding: var(--space-2) var(--space-4);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-modal);
    z-index: 60;
    font-size: 0.9rem;
    max-width: calc(100vw - 2rem);
    text-align: center;
  }
</style>
