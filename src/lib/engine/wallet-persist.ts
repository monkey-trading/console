/**
 * The wallet connection the console persists across page loads (monkey-trading/console#82,
 * approved by the owner there): the connector choice alone — "injected", or the WalletConnect
 * session topic — never keys, addresses, or session material. Cleared on explicit disconnect and
 * disclosed on /notices.
 */

/** The persisted choice: which connector reconnects on load. */
export type WalletChoice = { readonly kind: "injected" } | { readonly kind: "walletconnect"; readonly topic: string };

/** The key-value storage the choice is written through: `window.localStorage` in the page, a map in tests. */
export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The localStorage key the choice is stored under. */
export const WALLET_CHOICE_KEY = "monkeytrading.wallet-choice";

/** The longest topic the console persists; a longer value is not one it wrote. */
const TOPIC_MAX = 200;

/**
 * Reads the persisted choice, or null when none is stored or the value is not one the console
 * wrote: what a visitor's browser already holds is untrusted input, parsed strictly and ignored,
 * never acted on, when it does not parse.
 */
export function loadChoice(storage: ChoiceStorage): WalletChoice | null {
  const raw = storage.getItem(WALLET_CHOICE_KEY);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // not JSON: not a value this console wrote
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>; // narrowed just above to a plain object
  if (record.kind === "injected") return { kind: "injected" };
  if (record.kind === "walletconnect" && typeof record.topic === "string" && record.topic.length > 0 && record.topic.length <= TOPIC_MAX) {
    return { kind: "walletconnect", topic: record.topic };
  }
  return null;
}

/** Writes the choice; the only browser storage the console keeps, and the whole of what it keeps. */
export function saveChoice(storage: ChoiceStorage, choice: WalletChoice): void {
  storage.setItem(WALLET_CHOICE_KEY, JSON.stringify(choice));
}

/** Drops the choice, on an explicit disconnect. */
export function clearChoice(storage: ChoiceStorage): void {
  storage.removeItem(WALLET_CHOICE_KEY);
}
