/**
 * The `ShareSink` delivery ladder (§4.4, §3.7 interface): navigator.share -> clipboard.writeText
 * -> document.execCommand('copy') on a temporary readonly <textarea> -> manual select. This is
 * the only DOM-touching part of sharing; `src/lib/share.ts` (W3) stays pure and only builds the
 * string. Injected into the UI so it is stubbable in tests (and by the e2e clipboard spec, §7.4
 * step 7).
 *
 * IMPORTANT (Safari user-activation): callers must build the share string synchronously inside
 * the click handler and call `sink.share(text)` without an intervening `await` — this function's
 * own first DOM-touching call (clipboard.writeText, when navigator.share is unavailable) happens
 * with no prior await, so the activation survives as long as the caller doesn't add one first.
 */
import type { ShareSink } from '../../schema/types';

type ShareOutcome = 'shared' | 'copied' | 'manual';

/**
 * Real, DOM-backed `ShareSink`. `navigator.share`'s `AbortError` (the user dismissed the OS
 * share sheet) resolves as `'shared'`, exactly like a completed share — deliberately
 * indistinguishable, because §4.4 requires it to be silently ignored, not reported. The caller
 * (Toast wiring) only surfaces feedback for `'copied'`/`'manual'`; the OS share sheet already
 * gives its own feedback (or none, on a deliberate cancel), so `'shared'` never toasts.
 */
export function createShareSink(): ShareSink {
  return {
    async share(text: string): Promise<ShareOutcome> {
      const nav = typeof navigator !== 'undefined' ? navigator : undefined;

      if (nav && typeof nav.share === 'function') {
        try {
          await nav.share({ text });
          return 'shared';
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return 'shared';
          }
          // Any other failure (permission, not-a-secure-context, etc.) falls through to
          // clipboard rather than surfacing an error.
        }
      }

      if (nav?.clipboard?.writeText) {
        try {
          await nav.clipboard.writeText(text);
          return 'copied';
        } catch {
          // fall through to execCommand
        }
      }

      if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        textarea.style.left = '-1000px';
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        let copied = false;
        try {
          copied = document.execCommand('copy');
        } catch {
          copied = false;
        }
        document.body.removeChild(textarea);
        if (copied) return 'copied';
      }

      return 'manual';
    },
  };
}
