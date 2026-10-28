/** What the console knows about a listed market beyond the node's spec: names, places and quote spread. */

export interface MarketMeta {
  name: string;
  /** Places shown after the decimal point. */
  places: number;
  /** The half-spread each side pays at normal size in calm markets, in basis points. */
  baseSpreadBps: number;
}

const META: Readonly<Record<string, MarketMeta>> = {
  "BTC-USD": { name: "Bitcoin", places: 2, baseSpreadBps: 3 },
  "ETH-USD": { name: "Ethereum", places: 2, baseSpreadBps: 4 },
  "EUR-USD": { name: "Euro / US dollar", places: 5, baseSpreadBps: 1 },
  US500: { name: "US 500 index", places: 2, baseSpreadBps: 2 },
  "XAU-USD": { name: "Gold", places: 2, baseSpreadBps: 2 },
};

const FALLBACK: MarketMeta = { name: "", places: 4, baseSpreadBps: 5 };

/** The display metadata for `symbol`, with a plain fallback for a market the console has not seen. */
export function metaFor(symbol: string): MarketMeta {
  return { ...FALLBACK, ...META[symbol], name: META[symbol]?.name ?? symbol };
}
