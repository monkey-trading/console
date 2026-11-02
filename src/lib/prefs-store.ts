/** The preferences' external store: loaded from the browser's storage on first read, written on change, and read apart from the console's store so a stream message re-renders nothing here. */

import { DEFAULT_PREFS, parsePrefs, parseSizes, PREFS_KEY, SIZES_KEY, type Prefs } from "./prefs";

/** The storage the preferences go through: `window.localStorage` in the page, a map in tests. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PrefsState {
  prefs: Prefs;
  /** The last size placed in each market, by market id. */
  sizes: Readonly<Record<number, string>>;
  /** False once a write failed (storage full or denied): the choices hold for this page only. */
  saved: boolean;
}

/** What the server renders and the browser's first render matches, before storage is read. */
export const DEFAULT_STATE: PrefsState = { prefs: DEFAULT_PREFS, sizes: {}, saved: true };

export class PrefsStore {
  private state: PrefsState | null = null;
  private readonly listeners = new Set<() => void>();
  private unwatch: (() => void) | null = null;

  /**
   * `storage` is reached lazily and may be null (no storage) or throw; `watch` calls `onChange` when
   * another tab of the browser writes, and returns its own stop.
   */
  constructor(private readonly storage: () => PrefsStorage | null, private readonly watch?: (onChange: () => void) => () => void) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      // Nothing heard another tab's writes while no one was listening: read again, unless a write failed (the page's own choices are then the only true copy).
      if (this.state?.saved === true) {
        const fresh = this.load();
        if (fresh.saved) this.state = fresh;
      }
      if (this.watch !== undefined) this.unwatch = this.watch(() => this.reload());
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.unwatch?.();
        this.unwatch = null;
      }
    };
  };

  getSnapshot = (): PrefsState => (this.state ??= this.load());

  /** Sets one preference and saves all of them. */
  set<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    const now = this.getSnapshot();
    this.write({ ...now, prefs: { ...now.prefs, [key]: value } }, PREFS_KEY, JSON.stringify({ ...now.prefs, [key]: value }));
  }

  /** Remembers `size` as the last one placed in `market`. */
  rememberSize(market: number, size: string): void {
    const now = this.getSnapshot();
    if (now.sizes[market] === size) return;
    const sizes = { ...now.sizes, [market]: size };
    this.write({ ...now, sizes }, SIZES_KEY, JSON.stringify(sizes));
  }

  private load(): PrefsState {
    try {
      const storage = this.storage();
      if (storage === null) return { ...DEFAULT_STATE, saved: false };
      return { prefs: parsePrefs(storage.getItem(PREFS_KEY)), sizes: parseSizes(storage.getItem(SIZES_KEY)), saved: true };
    } catch {
      return { ...DEFAULT_STATE, saved: false }; // storage denied: the defaults hold, and a change will say it is not kept
    }
  }

  private write(next: PrefsState, key: string, value: string): void {
    let saved = true;
    try {
      const storage = this.storage();
      if (storage === null) saved = false;
      else storage.setItem(key, value);
    } catch {
      saved = false; // quota or permission: the change still applies to this page
    }
    this.state = { ...next, saved };
    this.notify();
  }

  /** Another tab wrote: read it again. */
  private reload(): void {
    this.state = this.load();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
