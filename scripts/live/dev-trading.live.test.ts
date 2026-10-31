/**
 * The trading dev scenario: the console's store and actions against a real dev node with mock
 * custody and feeds. A fixed-key wallet funds itself through the mock-custody dev endpoint,
 * declares eligibility, and trades at the executable quotes the node streams: a market order at
 * the shown quote with a slippage bound, a resting order and its cancel, a reduce-only close at the
 * streamed closing price, and a close-out the operator forces by raising the market's margin tier.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LiveEngineClient } from "../../src/lib/engine/live";
import { ProviderWallet } from "../../src/lib/engine/provider-wallet";
import { realVerifier } from "../../src/lib/engine/test-vectors";
import type { OrderRequest } from "../../src/lib/engine/types";
import { ACCOUNT, StubProvider } from "../../src/lib/engine/wallet-kit";
import { fixedFromWire, fixedToWire, parseFixed } from "../../src/lib/fixed";
import { closingPrice, ticketPrices } from "../../src/lib/quotes";
import { previewTicket, slippageBound } from "../../src/lib/ticket";
import { attestEligibility, cancelOrder, placeOrder } from "../../src/lib/store/actions";
import { followAccountFeeds, syncQuotes } from "../../src/lib/store/funds";
import { ConsoleStore } from "../../src/lib/store/store";
import { startProxy, type Proxy } from "./tamper-proxy";

const NODE = process.env.ENGINE_NODE_URL ?? "";
const ENGINE_BIN = process.env.ENGINE_BIN ?? "";
const NODE_CONFIG = process.env.NODE_CONFIG ?? "";
const WORK = process.env.SCENARIO_WORK ?? "";
const VAULT = "0x0000000000000000000000000000000000000000";
const BTC = 1;
/** Whole USDC the mock-custody dev endpoint credits. */
const FUND = "20000";
/** The position each opening leg aims for, in dollars of notional. */
const OPEN_NOTIONAL = "60000";
/** The user's slippage bound for market orders, within the market's own 25 bps cap. */
const SLIPPAGE_BPS = 25;

let proxy: Proxy;
let store: ConsoleStore;
let stopAll: () => void;
const posted: { body: OrderRequest }[] = [];

/** Waits until `done` holds, or fails after `ms` with the state that stuck. */
async function until(done: () => boolean, ms = 30_000, what = "the node"): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) {
      const state = snapshot();
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify({ attestation: state.attestation, stream: state.stream, markets: state.markets.length, wallet: state.wallet?.address ?? null, account: state.account !== null, quotes: Object.keys(state.quotes), quoteError: state.quoteError, toasts: state.toasts.map((t) => t.text) })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

const curl = (path: string, body?: unknown): unknown => {
  const args = ["-sk", `${NODE}${path}`];
  if (body !== undefined) args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  return JSON.parse(execFileSync("curl", args, { encoding: "utf8" }));
};

const snapshot = () => store.getSnapshot();

function btcMarket() {
  const market = snapshot().markets.find((m) => m.id === BTC);
  if (market === undefined) throw new Error("the BTC-USD market has not loaded");
  return market;
}

function btcPosition() {
  return snapshot().account?.positions.find((p) => p.market === BTC) ?? null;
}

/** The market order's shown price, computed as the deal ticket computes it from the streamed quote. */
function ticketPrice(): { price: bigint; qty: bigint; slippage: number } {
  const state = snapshot();
  const market = btcMarket();
  const quote = state.quotes[BTC];
  const notional = parseFixed(OPEN_NOTIONAL);
  if (quote === undefined || notional === null) throw new Error("no quote or size");
  const slippage = slippageBound(SLIPPAGE_BPS, market);
  const preview = previewTicket({ market, side: "buy", notional, slippageBps: slippage, account: state.account, houseNav: state.house.nav, estimates: false });
  const prices = ticketPrices({ live: true, quote, quoteError: state.quoteError, preview, side: "buy", mark: market.mark });
  if (prices.price === null) throw new Error(`the node quotes no price: ${prices.problem ?? "unknown"}`);
  return { price: prices.price, qty: preview.qty, slippage };
}

/** The operator's admin command raising BTC-USD's margin tier to 100%, under-margining every open position. */
function raiseMarginTier(): void {
  const spec = `${WORK}/btc-usd.toml`;
  writeFileSync(spec, `id = 1
symbol = "BTC-USD"
asset_class = "crypto"
max_slippage_bps = 25
house_cap_bps = 3000
house_cap_floor = "300000"
margin_tiers = [{ bps = 10000 }]
spread_tiers = [{ up_to = "2000000", bps = 0 }, { up_to = "10000000", bps = 3 }, { bps = 8 }]
schedule = { kind = "always_open" }
price_rules = { max_age_ms = 1000, max_divergence_bps = 25, min_sources = 2 }
financing = { benchmark = "SOFR", markup_bps = 500, day_basis = 365 }
`);
  const keyFile = `${WORK}/operator.key`;
  writeFileSync(keyFile, "4242424242424242424242424242424242424242424242424242424242424242\n");
  const attestation = curl("/v1/attestation") as { bundle: string };
  const pin = attestation.bundle.replace(/^0x/, "").slice(-64);
  execFileSync(ENGINE_BIN, ["admin", "--config", NODE_CONFIG, "--node", NODE, "--pin", pin, "--key-file", keyFile, "upsert-market", spec], { stdio: "pipe" });
}

beforeAll(async () => {
  if (NODE === "" || ENGINE_BIN === "" || NODE_CONFIG === "" || WORK === "") {
    throw new Error("scripts/dev-trading.sh sets ENGINE_NODE_URL, ENGINE_BIN, NODE_CONFIG and SCENARIO_WORK");
  }
  const [verifier, started] = await Promise.all([realVerifier(true), startProxy(NODE)]);
  proxy = started;
  const recordingFetch: typeof fetch = (input, init) => {
    if (init?.method === "POST" && new URL(String(input)).pathname === "/v1/orders" && typeof init.body === "string") {
      posted.push({ body: JSON.parse(init.body) as OrderRequest });
    }
    return fetch(input, init);
  };
  const client = new LiveEngineClient({
    origin: proxy.url, streamOrigin: proxy.url.replace(/^http/, "ws"), chainId: 31337, vault: VAULT, heartbeatMs: 5_000,
    loadVerifier: async () => verifier, manifests: [], acceptsMock: true,
    fetch: recordingFetch, openSocket: (url) => new WebSocket(url),
    scheduler: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    nowMs: () => Date.now(),
  });
  const wallet = new ProviderWallet(ACCOUNT, "Scenario wallet", new StubProvider(), { chainId: 31337, vault: VAULT, usdc: "0x00000000000000000000000000000000000000cc", add: null }, { wait: async () => {} });
  store = new ConsoleStore({
    client, wallets: { options: [], connect: async () => wallet }, history: () => [],
    initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 },
  });
  const stopLive = store.start(0);
  const stopFeeds = followAccountFeeds(store);
  // The quote request follows the account, the selected market and the markets held, as the console wires it.
  let key = "";
  const sync = () => {
    const state = snapshot();
    const next = JSON.stringify([state.wallet?.address ?? null, state.selected, state.account?.positions.map((p) => p.market) ?? [], state.account !== null]);
    if (next === key) return;
    key = next;
    syncQuotes(store);
  };
  sync();
  const stopQuoteSync = store.subscribe(sync);
  stopAll = () => {
    stopQuoteSync();
    stopFeeds();
    stopLive();
  };
  store.liveWallet = wallet;
  store.setWallet({ address: wallet.address, label: wallet.label });
  await store.loadAccount(true);
  await until(() => snapshot().attestation.kind === "mock" && snapshot().markets.length > 0, 60_000, "the node's attestation and markets");
}, 60_000);

afterAll(async () => {
  stopAll();
  await proxy.close();
});

describe("trading against a dev node", () => {
  it("funds the account and records its eligibility declaration", async () => {
    // The engine holds a never-credited account's deposit pending until its declaration arrives,
    // so the deposit is sent first and the declaration credits it.
    curl("/v1/dev/deposit", { account: ACCOUNT, amount: FUND });
    await attestEligibility(store, "eligible_client");
    await until(() => snapshot().eligibility === "eligible_client");
    await until(() => {
      const account = snapshot().account;
      return account !== null && account.balance === parseFixed(FUND);
    });
  });

  it("fills a market order at the streamed quote, sent as the quoted price with the slippage bound", async () => {
    await until(() => snapshot().quotes[BTC] !== undefined);
    const { price, qty, slippage } = ticketPrice();
    await placeOrder(store, { market: BTC, side: "buy", qty, kind: { kind: "market", quoted: price, slippageBps: slippage }, reduceOnly: false });
    const wire = posted.at(-1)?.body;
    if (wire === undefined) throw new Error("no order was posted");
    expect(wire.kind).toEqual({ kind: "market", quoted: fixedToWire(price), max_slippage_bps: slippage });
    await until(() => (btcPosition()?.qty ?? 0n) > 0n);
  });

  it("rests a limit order and cancels it", async () => {
    const trigger = (btcMarket().mark ?? 0n) * 85n / 100n;
    const qty = parseFixed("0.1");
    if (qty === null) throw new Error("bad size");
    await placeOrder(store, { market: BTC, side: "buy", qty, kind: { kind: "limit", price: trigger }, reduceOnly: false });
    await until(() => (snapshot().account?.orders.length ?? 0) > 0);
    const order = snapshot().account?.orders[0];
    if (order === undefined) throw new Error("no resting order");
    await cancelOrder(store, order.order_id);
    await until(() => (snapshot().account?.orders.length ?? 0) === 0);
  });

  it("closes the position at the streamed closing price, reduce only", async () => {
    await until(() => {
      const quote = snapshot().quotes[BTC];
      const position = btcPosition();
      return quote !== undefined && position !== null && closingPrice(quote, "sell", position.qty > 0n ? position.qty : -position.qty) !== null;
    });
    const quote = snapshot().quotes[BTC];
    const position = btcPosition();
    if (quote === undefined || position === null) throw new Error("no quote or position");
    const qty = position.qty > 0n ? position.qty : -position.qty;
    const price = closingPrice(quote, "sell", qty);
    if (price === null) throw new Error("no closing price");
    await placeOrder(store, { market: BTC, side: "sell", qty, kind: { kind: "market", quoted: price, slippageBps: slippageBound(SLIPPAGE_BPS, btcMarket()) }, reduceOnly: true });
    await until(() => (btcPosition()?.qty ?? 0n) === 0n);
  });

  it("is closed out when the margin tier rises past its equity, and the console sees it", async () => {
    const { price, qty, slippage } = ticketPrice();
    await placeOrder(store, { market: BTC, side: "buy", qty, kind: { kind: "market", quoted: price, slippageBps: slippage }, reduceOnly: false });
    await until(() => (btcPosition()?.qty ?? 0n) > 0n);
    raiseMarginTier();
    await until(() => (snapshot().account?.positions.length ?? 0) === 0 && snapshot().history.some((e) => e.type === "close_out"), 60_000);
    const closeOut = snapshot().history.find((e) => e.type === "close_out");
    if (closeOut === undefined || closeOut.type !== "close_out") throw new Error("no close_out event");
    // The raised tier makes the position's margin its whole notional, over twice the funded equity.
    expect(fixedFromWire(closeOut.margin)).toBeGreaterThan(2n * fixedFromWire(closeOut.equity));
    expect(snapshot().toasts.some((t) => t.text.includes("closed out"))).toBe(true);
  });
});
