/** What the console knows about a listed market beyond the node's spec: names, places and the mock's close-spread ceiling. */

export interface MarketMeta {
  name: string;
  /** Places shown after the decimal point. */
  places: number;
  /**
   * The close-spread ceiling the mock node charges, in bps: the most a close pays (`close_spread.rs`),
   * as the engine's dev genesis sets it. The node serves no ceiling, so a live build takes every price
   * from its signed quotes, which already count it; null for a market the mock does not list.
   */
  closeCeilingBps: number | null;
}

const META: Readonly<Record<string, MarketMeta>> = {
  "BTC-USD": { name: "Bitcoin", places: 2, closeCeilingBps: 30 },
  "ETH-USD": { name: "Ethereum", places: 2, closeCeilingBps: 30 },
  "EUR-USD": { name: "Euro / US dollar", places: 5, closeCeilingBps: 17 },
  US500: { name: "US 500 index", places: 2, closeCeilingBps: 18 },
  "XAU-USD": { name: "Gold", places: 2, closeCeilingBps: 25 },
};

const FALLBACK: MarketMeta = { name: "", places: 4, closeCeilingBps: null };

/** The display metadata for `symbol`, with a plain fallback for a market the console has not seen. */
export function metaFor(symbol: string): MarketMeta {
  return { ...FALLBACK, ...META[symbol], name: META[symbol]?.name ?? symbol };
}
