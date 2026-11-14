/**
 * The trading dev scenario's rig: the console's store over a live client through the tampering
 * proxy, the operator's admin commands, a restart of the node with moved mock mids, and the deal
 * ticket's and positions table's own figures, computed as those screens compute them.
 */

import { execFileSync, spawn } from "node:child_process";
import { openSync, readFileSync, writeFileSync } from "node:fs";

import { ticketClose, type ClosePreview } from "../../src/lib/close-preview";
import { LiveEngineClient } from "../../src/lib/engine/live";
import { ProviderWallet } from "../../src/lib/engine/provider-wallet";
import { realVerifier } from "../../src/lib/engine/test-vectors";
import type { EngineEvent, MarketId, OrderRequest, Side } from "../../src/lib/engine/types";
import { ACCOUNT, StubProvider } from "../../src/lib/engine/wallet-kit";
import { positionFee } from "../../src/lib/fee-words";
import { divFixed, fixedFromInt, fixedToWire, type Fixed } from "../../src/lib/fixed";
import type { MarketModel } from "../../src/lib/models";
import { stressTermsAt } from "../../src/lib/pricing";
import { ticketPrices, type TicketPrices } from "../../src/lib/quotes";
import { loadAccount } from "../../src/lib/store/account";
import { followAccountFeeds, syncQuotes } from "../../src/lib/store/funds";
import { ConsoleStore } from "../../src/lib/store/store";
import { parseSize, previewTicket, slippageBound, usdConverter } from "../../src/lib/ticket";
import { startProxy, type Proxy } from "./tamper-proxy";

export const NODE = process.env.ENGINE_NODE_URL ?? "";
export const ENGINE_BIN = process.env.ENGINE_BIN ?? "";
export const NODE_CONFIG = process.env.NODE_CONFIG ?? "";
export const WORK = process.env.SCENARIO_WORK ?? "";
export const VAULT = "0x0000000000000000000000000000000000000000";
/** The user's slippage bound for market orders, within the markets' own caps. */
export const SLIPPAGE_BPS = 25;

/** The scenario's store and what it records: every order the client posted, and the events the node answered each with. */
export interface Rig {
  store: ConsoleStore;
  proxy: Proxy;
  posted: { body: OrderRequest }[];
  answers: EngineEvent[][];
  stop: () => void;
}

/** Starts the console's store against the node through the proxy, with the fixed-key wallet connected and its account read. */
export async function startRig(): Promise<Rig> {
  if (NODE === "" || ENGINE_BIN === "" || NODE_CONFIG === "" || WORK === "") throw new Error("scripts/dev-trading.sh sets ENGINE_NODE_URL, ENGINE_BIN, NODE_CONFIG and SCENARIO_WORK");
  const [verifier, proxy] = await Promise.all([realVerifier(true), startProxy(NODE)]);
  const posted: { body: OrderRequest }[] = [];
  const answers: EngineEvent[][] = [];
  const recordingFetch: typeof fetch = async (input, init) => {
    const order = init?.method === "POST" && new URL(String(input)).pathname === "/v1/orders" && typeof init.body === "string";
    if (order && typeof init.body === "string") posted.push({ body: JSON.parse(init.body) as OrderRequest });
    const response = await fetch(input, init);
    // The node answers an order with the events its command produced; the client verifies the signed answer itself.
    if (order && response.ok) answers.push((await response.clone().json()) as EngineEvent[]);
    return response;
  };
  const client = new LiveEngineClient({
    origin: proxy.url, streamOrigin: proxy.url.replace(/^http/, "ws"), chainId: 31337, vault: VAULT, heartbeatMs: 5_000,
    loadVerifier: async () => verifier, releases: [], acceptsMock: true,
    fetch: recordingFetch, openSocket: (url) => new WebSocket(url),
    scheduler: { setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) },
    nowMs: () => Date.now(),
  });
  const wallet = new ProviderWallet(ACCOUNT, "Scenario wallet", new StubProvider(), { chainId: 31337, vault: VAULT, usdc: "0x00000000000000000000000000000000000000cc", add: null }, { wait: async () => {} });
  const store = new ConsoleStore({ client, wallets: { options: [], connect: async () => wallet }, history: () => [], initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 } });
  const stopLive = store.start(0);
  const stopFeeds = followAccountFeeds(store);
  // The quote request follows the account, the selected market and the markets held, as the console wires it.
  let key = "";
  const sync = () => {
    const state = store.getSnapshot();
    const next = JSON.stringify([state.wallet?.address ?? null, state.selected, state.account?.positions.map((p) => p.market) ?? [], state.account !== null]);
    if (next === key) return;
    key = next;
    syncQuotes(store);
  };
  sync();
  const stopQuoteSync = store.subscribe(sync);
  store.liveWallet = wallet;
  store.setWallet({ address: wallet.address, label: wallet.label });
  await loadAccount(store, true);
  // Signing waits for a live stream, so readiness waits for one too.
  await until(store, () => { const s = store.getSnapshot(); return s.attestation.kind === "mock" && s.markets.length > 0 && s.stream === "live"; }, 60_000, "the node's attestation, markets and stream");
  return { store, proxy, posted, answers, stop: () => { stopQuoteSync(); stopFeeds(); stopLive(); } };
}

/** Waits until `done` holds, or fails after `ms` with the state that stuck. */
export async function until(store: ConsoleStore, done: () => boolean, ms = 30_000, what = "the node"): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) {
      const s = store.getSnapshot();
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify({ attestation: s.attestation, stream: s.stream, markets: s.markets.length, account: s.account !== null, quotes: Object.keys(s.quotes), quoteError: s.quoteError, notices: Object.fromEntries(Object.entries(s.notices).map(([surface, n]) => [surface, n?.text])) })}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** A plain read or post against the node itself, past the proxy. */
export function curl(path: string, body?: unknown): unknown {
  const args = ["-sk", `${NODE}${path}`];
  if (body !== undefined) args.push("-H", "content-type: application/json", "-d", JSON.stringify(body));
  return JSON.parse(execFileSync("curl", args, { encoding: "utf8" }));
}

/** Signs and submits an admin command as the dev config's operator, through `engine admin`. */
export function admin(args: string[]): void {
  const keyFile = `${WORK}/operator.key`;
  writeFileSync(keyFile, "4242424242424242424242424242424242424242424242424242424242424242\n");
  const pin = (curl("/v1/attestation") as { bundle: string }).bundle.replace(/^0x/, "").slice(-64);
  execFileSync(ENGINE_BIN, ["admin", "--config", NODE_CONFIG, "--node", NODE, "--pin", pin, "--key-file", keyFile, ...args], { stdio: "pipe" });
}

/**
 * Stops the node by the PID the scenario recorded, sets the mock feed's starting mids, and starts it
 * again on the same log, recording its PID where the scenario's cleanup reads it. A mock walk starts
 * from its configured mid, so the index jumps there.
 */
export async function restartNode(mids: Readonly<Record<MarketId, Fixed>>): Promise<void> {
  const pid = Number(readFileSync(`${WORK}/node.pid`, "utf8").trim());
  process.kill(pid, "SIGTERM");
  for (let i = 0; i < 100 && alive(pid); i += 1) await new Promise((resolve) => setTimeout(resolve, 200));
  if (alive(pid)) throw new Error(`the node ${pid} did not stop`);
  const config = readFileSync(NODE_CONFIG, "utf8").replace(/^mock_mids = .*$/m, (line) =>
    line.replace(/\{ market = (\d+), mid = "[^"]*" \}/g, (entry, id: string) => (mids[Number(id)] === undefined ? entry : `{ market = ${id}, mid = "${fixedToWire(mids[Number(id)] ?? 0n)}" }`)));
  writeFileSync(NODE_CONFIG, config);
  const log = openSync(`${WORK}/node.log`, "a");
  const child = spawn(ENGINE_BIN, ["run", "--config", NODE_CONFIG], { cwd: WORK, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  if (child.pid === undefined) throw new Error("the node did not start again");
  writeFileSync(`${WORK}/node.pid`, `${child.pid}\n`);
}

/** Whether a process is still running. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The market `id` as the store holds it. */
export function marketOf(store: ConsoleStore, id: MarketId): MarketModel {
  const market = store.getSnapshot().markets.find((m) => m.id === id);
  if (market === undefined) throw new Error(`market ${id} has not loaded`);
  return market;
}

/** The size, on the size field's step, whose notional at the mark is about `dollars`. */
export function sizeFor(market: MarketModel, dollars: number): Fixed {
  if (market.mark === null) throw new Error(`no mark for ${market.symbol}`);
  const size = parseSize(fixedToWire(divFixed(fixedFromInt(dollars), market.mark)).replace(/(\.\d{6})\d*$/, "$1"));
  if (size.kind !== "qty") throw new Error("no size");
  return size.qty;
}

/** What the deal ticket shows for a market order of `qty` on `side`: its prices from the node's quote, and its close preview, computed as `DealTicket` computes them. */
export function ticketFor(store: ConsoleStore, id: MarketId, side: Side, qty: Fixed): { prices: TicketPrices; close: ClosePreview | null; slippage: number } {
  const state = store.getSnapshot();
  const market = marketOf(store, id);
  const params = state.houseParams;
  const position = state.account?.positions.find((p) => p.market === id) ?? null;
  const fee = position === null ? null : positionFee(position.closeFee, params, state.now);
  const slippage = slippageBound(SLIPPAGE_BPS, market);
  const preview = previewTicket({ market, side, qty, slippageBps: slippage, account: state.account, houseNav: state.house.nav, estimates: false, stress: stressTermsAt(params?.stressLevels, market.stress), closeFeeBps: fee?.feeBps ?? params?.profitFeeBps });
  const prices = ticketPrices({ live: true, quote: state.quotes[id] ?? null, quoteError: state.quoteError, preview, side, mark: market.mark });
  const close = ticketClose({
    position, side, qty: preview.qty, price: prices.price, exactPrice: prices.exactClose, feeBps: fee?.feeBps ?? params?.profitFeeBps ?? null,
    fallsAt: fee?.fallsAt ?? null, now: state.now, toUsdDown: market.mark === null ? null : usdConverter(market.view, market.mark, "down"),
  });
  return { prices, close, slippage };
}
