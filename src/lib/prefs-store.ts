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
  /** The storage keys whose last write failed: the page's copy of each is the only true one, so a read never replaces it. */
  private readonly unsaved = new Set<string>();

  /**
   * `storage` is reached lazily and may be null (no storage) or throw; `watch` calls `onChange` when
   * another tab of the browser writes, and returns its own stop.
   */
  constructor(private readonly storage: () => PrefsStorage | null, private readonly watch?: (onChange: () => void) => () => void) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      // Nothing heard another tab's writes while no one was listening: read again.
      if (this.state !== null) this.refresh();
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
    if (saved) this.unsaved.delete(key);
    else this.unsaved.add(key);
    this.state = { ...next, saved: this.unsaved.size === 0 };
    this.notify();
  }

  /** Reads storage again into the state: what it holds replaces the page's copy of each key whose last write saved, and a read that fails changes nothing but the warning. */
  private refresh(): void {
    const fresh = this.load();
    const current = this.state;
    if (current === null) this.state = fresh;
    else if (!fresh.saved) this.state = { ...current, saved: false };
    else this.state = { prefs: this.unsaved.has(PREFS_KEY) ? current.prefs : fresh.prefs, sizes: this.unsaved.has(SIZES_KEY) ? current.sizes : fresh.sizes, saved: this.unsaved.size === 0 };
  }

  /** Another tab wrote: read it again. */
  private reload(): void {
    this.refresh();
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
