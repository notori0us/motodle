/**
 * Runes store wiring `src/lib/**` (W3) to the UI (§5.1 screens/states, §4.5 rollover, §4.6
 * practice isolation). A `.svelte.ts` module, so runes work at module scope (Svelte 5.57).
 *
 * Per §10.7 gotcha #9, this file never does `export let x = $state(...)` — state lives on a
 * class instance and callers read/write through its fields/methods, which is the supported
 * pattern for a mutable rune outside a component.
 */
import type {
  Catalog,
  CatalogIndex,
  Manifest,
  PracticeState,
  PrefsState,
  Puzzle,
  StatsState,
  StorageBackend,
  TodayState,
} from '../../schema/types';
import { todayOverride } from '../config';
import { buildCatalogIndex, loadCatalog, type CatalogLoadResult } from '../lib/catalog';
import { dayIndex, puzzleNumber, todayKey } from '../lib/date';
import { giveUp as libGiveUp, submitGuess as libSubmitGuess, type SubmitGuessInput } from '../lib/game';
import { loadManifest, loadPuzzle, resolveAssetUrl, type PuzzleLoadResult } from '../lib/puzzle';
import {
  KEY_PREFS,
  KEY_STATS,
  KEY_TODAY,
  LocalStorageBackend,
  loadTodayState,
  loadVersioned,
  practiceKey,
  saveVersioned,
  touchPractice,
} from '../lib/storage';
import { createInitialStats, recordCompletion } from '../lib/stats';

export type Screen = 'loading' | 'game' | 'no-puzzle' | 'load-failed';
export type CatalogStatus = 'loading' | 'ok' | 'failed';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolves "now" honouring the DEV-only clock override (§7.4a): `?today=YYYY-MM-DD` first, then
 *  `src/config.ts`'s `todayOverride`, both guarded by `import.meta.env.DEV` so a production build
 *  can never read either. Both are LOCAL dates with no timezone suffix, matching `todayKey()`. */
function resolveNow(search: string): Date {
  if (import.meta.env.DEV) {
    const qp = new URLSearchParams(search).get('today');
    if (qp && DATE_RE.test(qp)) return new Date(`${qp}T00:00:00`);
    if (todayOverride && DATE_RE.test(todayOverride)) return new Date(`${todayOverride}T00:00:00`);
  }
  return new Date();
}

function freshToday(puzzle: Puzzle): TodayState {
  return {
    schemaVersion: 1,
    date: puzzle.date,
    number: puzzle.number,
    puzzleId: puzzle.id,
    status: 'in_progress',
    guesses: [],
    locks: { makeId: null, modelId: null, year: null },
    viewLevel: 1,
    endedAtGuess: null,
    score: null,
  };
}

const defaultPrefs: PrefsState = { schemaVersion: 1, theme: 'system', colorblind: false, seenHelp: false };

export class GameStore {
  screen = $state<Screen>('loading');

  catalogStatus = $state<CatalogStatus>('loading');
  catalogReason = $state<string | null>(null);
  puzzleReason = $state<string | null>(null);

  catalog = $state<CatalogIndex | null>(null);

  puzzle = $state<Puzzle | null>(null);
  manifest = $state<Manifest | null>(null);

  isPractice = $state(false);
  practiceDate = $state<string | null>(null);

  today = $state<TodayState>(
    /* placeholder until a puzzle loads; screen stays 'loading'/'no-puzzle'/'load-failed' until
       then, so nothing renders a board against this. */
    freshToday({ date: '', number: 0, id: '' } as Puzzle),
  );
  stats = $state<StatsState>(createInitialStats());
  prefs = $state<PrefsState>({ ...defaultPrefs });

  staleDay = $state(false);

  helpOpen = $state(false);
  statsOpen = $state(false);
  resultOpen = $state(false);
  archiveOpen = $state(false);

  toast = $state<string | null>(null);

  private backend: StorageBackend;
  private rolloverTimer: ReturnType<typeof setInterval> | null = null;
  private resultTimer: ReturnType<typeof setTimeout> | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private todayDateKey = '';
  private visListener: (() => void) | null = null;
  private focusListener: (() => void) | null = null;

  constructor(backend: StorageBackend = new LocalStorageBackend()) {
    this.backend = backend;
  }

  /** The resolved local date key "today" was computed against at boot (§4.1, §7.4a's clock
   *  override honoured). Used by ArchiveList to filter to `date < today` (§4.6). */
  get resolvedTodayKey(): string {
    return this.todayDateKey;
  }

  get unlockedLevel(): number {
    if (this.today.status !== 'in_progress') return 5;
    return Math.min(5, this.today.guesses.length + 1);
  }

  assetUrl(relSrc: string): string {
    return resolveAssetUrl(relSrc);
  }

  async init(): Promise<void> {
    const search = typeof location !== 'undefined' ? location.search : '';
    const now = resolveNow(search);
    this.todayDateKey = todayKey(now);

    this.prefs = loadVersioned(this.backend, KEY_PREFS, { ...defaultPrefs });
    this.stats = loadVersioned(this.backend, KEY_STATS, createInitialStats());
    this.applyTheme();
    this.applyColorblind();

    const dParam = new URLSearchParams(search).get('d');
    if (dParam && DATE_RE.test(dParam) && dayIndex(dParam) < dayIndex(this.todayDateKey)) {
      this.isPractice = true;
      this.practiceDate = dParam;
    } else {
      this.isPractice = false;
      this.practiceDate = null;
      // §4.6: a future/current date in the query string redirects to today — strip it rather
      // than loop back through a fetch of a date that isn't practice-eligible.
      if (dParam && typeof history !== 'undefined') {
        history.replaceState(null, '', location.pathname + location.hash);
      }
    }

    const targetDate = this.isPractice && this.practiceDate ? this.practiceDate : this.todayDateKey;

    const catalogPromise = loadCatalog();
    const puzzlePromise: Promise<PuzzleLoadResult> =
      puzzleNumber(targetDate) < 1 ? Promise.resolve({ status: 'no-puzzle' as const }) : loadPuzzle(targetDate);

    const [catalogResult, puzzleResult] = await Promise.all([catalogPromise, puzzlePromise]);
    this.applyCatalogResult(catalogResult);
    this.applyPuzzleResult(puzzleResult);

    this.startRolloverWatcher();
  }

  private applyCatalogResult(result: CatalogLoadResult): void {
    if (result.status === 'ok') {
      this.catalog = buildCatalogIndex(result.catalog);
      this.catalogStatus = 'ok';
      this.catalogReason = null;
    } else {
      this.catalogStatus = 'failed';
      this.catalogReason = result.reason;
    }
  }

  private applyPuzzleResult(result: PuzzleLoadResult): void {
    if (result.status === 'ok') {
      this.puzzle = result.puzzle;
      this.screen = 'game';
      this.loadTodayStateFor(result.puzzle);
      if (!this.prefs.seenHelp) this.helpOpen = true;
      this.resultOpen = this.today.status !== 'in_progress';
    } else if (result.status === 'no-puzzle') {
      this.screen = 'no-puzzle';
    } else {
      this.screen = 'load-failed';
      this.puzzleReason = result.reason;
    }
  }

  async retryPuzzle(): Promise<void> {
    const targetDate = this.isPractice && this.practiceDate ? this.practiceDate : this.todayDateKey;
    const num = puzzleNumber(targetDate);
    const result: PuzzleLoadResult = num < 1 ? { status: 'no-puzzle' } : await loadPuzzle(targetDate);
    this.applyPuzzleResult(result);
  }

  async retryCatalog(): Promise<void> {
    this.catalogStatus = 'loading';
    this.applyCatalogResult(await loadCatalog());
  }

  private loadTodayStateFor(puzzle: Puzzle): void {
    const fresh = freshToday(puzzle);
    if (this.isPractice) {
      const stored = loadVersioned<PracticeState>(this.backend, practiceKey(puzzle.date), {
        ...fresh,
        practice: true,
      });
      this.today = stored.date === puzzle.date && stored.puzzleId === puzzle.id ? stored : fresh;
    } else {
      const stored = loadTodayState(this.backend, puzzle.date, fresh);
      this.today = stored.puzzleId === puzzle.id ? stored : fresh;
    }
  }

  private persistToday(): void {
    if (this.isPractice) {
      if (!this.practiceDate) return;
      touchPractice(this.backend, this.practiceDate);
      saveVersioned<PracticeState>(this.backend, practiceKey(this.practiceDate), {
        ...this.today,
        practice: true,
      });
    } else {
      saveVersioned<TodayState>(this.backend, KEY_TODAY, this.today);
    }
  }

  submitGuess(input: SubmitGuessInput): void {
    if (!this.puzzle || !this.catalog) return;
    this.today = libSubmitGuess(this.today, input, this.puzzle.answer, this.catalog);
    this.today = { ...this.today, viewLevel: Math.min(5, this.today.guesses.length + 1) };
    this.persistToday();
    if (this.today.status !== 'in_progress') this.onGameEnded();
  }

  giveUp(): void {
    if (!this.puzzle) return;
    this.today = libGiveUp(this.today);
    this.persistToday();
    this.onGameEnded();
  }

  private onGameEnded(): void {
    if (!this.isPractice && this.puzzle) {
      const won = this.today.status === 'won';
      this.stats = recordCompletion(this.stats, this.puzzle, { won, score: this.today.score ?? 0 });
      saveVersioned<StatsState>(this.backend, KEY_STATS, this.stats);
    }
    if (this.resultTimer) clearTimeout(this.resultTimer);
    // ~400ms after the final tile animation (§5.1, §5.6) — but §5.5/§5.8 require the
    // reduced-motion path to skip the delay itself, not just the CSS animation (review
    // improvement #2), so this logical delay needs its own matchMedia guard.
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.resultTimer = setTimeout(
      () => {
        this.resultOpen = true;
      },
      reducedMotion ? 0 : 400,
    );
  }

  setViewLevel(level: number): void {
    if (level < 1 || level > this.unlockedLevel) return;
    this.today = { ...this.today, viewLevel: level };
    this.persistToday();
  }

  setTheme(theme: PrefsState['theme']): void {
    this.prefs = { ...this.prefs, theme };
    saveVersioned(this.backend, KEY_PREFS, this.prefs);
    this.applyTheme();
  }

  toggleColorblind(): void {
    this.prefs = { ...this.prefs, colorblind: !this.prefs.colorblind };
    saveVersioned(this.backend, KEY_PREFS, this.prefs);
    this.applyColorblind();
  }

  closeHelp(): void {
    this.helpOpen = false;
    if (!this.prefs.seenHelp) {
      this.prefs = { ...this.prefs, seenHelp: true };
      saveVersioned(this.backend, KEY_PREFS, this.prefs);
    }
  }

  openHelp(): void {
    this.helpOpen = true;
  }

  openStats(): void {
    this.statsOpen = true;
  }

  closeStats(): void {
    this.statsOpen = false;
  }

  openResult(): void {
    this.resultOpen = true;
  }

  closeResult(): void {
    this.resultOpen = false;
  }

  async openArchive(): Promise<void> {
    this.archiveOpen = true;
    if (!this.manifest) {
      const result = await loadManifest();
      if (result.status === 'ok') this.manifest = result.manifest;
    }
  }

  closeArchive(): void {
    this.archiveOpen = false;
  }

  showToast(message: string): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = message;
    this.toastTimer = setTimeout(() => {
      this.toast = null;
    }, 2500);
  }

  dismissToast(): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toast = null;
  }

  private applyTheme(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (this.prefs.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.prefs.theme);
  }

  private applyColorblind(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-colorblind', String(this.prefs.colorblind));
  }

  private startRolloverWatcher(): void {
    if (typeof window === 'undefined') return;
    const check = () => {
      const key = todayKey(resolveNow(location.search));
      if (key !== this.todayDateKey) this.staleDay = true;
    };
    this.visListener = check;
    this.focusListener = check;
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    this.rolloverTimer = setInterval(check, 60_000);
  }

  /** Stops timers/listeners. Call on teardown (tests, or a future SPA unmount). */
  dispose(): void {
    if (this.rolloverTimer) clearInterval(this.rolloverTimer);
    if (this.resultTimer) clearTimeout(this.resultTimer);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    if (typeof document !== 'undefined' && this.visListener) {
      document.removeEventListener('visibilitychange', this.visListener);
    }
    if (typeof window !== 'undefined' && this.focusListener) {
      window.removeEventListener('focus', this.focusListener);
    }
  }
}

/** The one app-wide instance. `App.svelte` calls `game.init()` on mount. */
export const game = new GameStore();
