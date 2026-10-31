/** What the user can do: connect a wallet, deposit, declare eligibility, trade, and withdraw. */

import { signBlock } from "../engine/attestation";
import { EngineError, type ActionResult } from "../engine/client";
import type { Deploy } from "../engine/deploy";
import { FAUCET_USDC, faucetAvailable, topUpGas } from "../engine/faucet";
import { UntrustedError } from "../engine/trust";
import { cancelTypedData, eligibilityTypedData, orderTypedData, requestDomain, STATEMENTS, withdrawalTypedData, type Terms, type TypedRequest } from "../engine/eip712";
import type { EligibilityClass, OrderKind, RequestAuth, Side } from "../engine/types";
import type { Wallet } from "../engine/wallet";
import { fixedToWire, formatFixedPlaces, parseFixed, type Fixed } from "../fixed";
import { formatUsdc } from "../vault";
import { describeReject } from "../messages";
import type { ConsoleStore } from "./store";

export { STATEMENTS };

/** A signed request stays valid this long past the node's signed time, within the engine's five-minute cap (`MAX_EXPIRY_AHEAD_MS`). */
export const REQUEST_TTL_MS = 120_000;

/** A refusal shown to the user, never thrown past an action. */
type Outcome = { ok: true; result: ActionResult } | { ok: false };

/** The state a wallet change clears: everything read or streamed for the account before. */
const NO_ACCOUNT = { account: null, eligibility: null, queue: [], history: [], quotes: {}, quoteError: null, quoted: [], authorizations: [], approvals: [], approvalsNext: null, payoutHints: {}, searching: null, paid: [], unpaid: [] };

/** Ends a wallet's connection in the background, telling the user if that fails. */
function release(store: ConsoleStore, wallet: Wallet | null): void {
  wallet?.disconnect?.().catch((error: unknown) => store.toast("error", `The wallet's session did not close: ${errorText(error)}`));
}

/** Offers to add the deployment's USDC to the wallet that just connected; one small toast when the wallet adds it, silence on a decline or a wallet that cannot. */
function offerUsdcImport(store: ConsoleStore, wallet: Wallet): void {
  if (wallet.readOnly || wallet.suggestUsdc === undefined) return;
  void wallet.suggestUsdc().then(
    (added) => { if (added) store.toast("info", "USDC was added to your wallet, so its balance shows there."); },
    () => undefined,
  );
}

export async function connectWallet(store: ConsoleStore, optionId: string, quiet = false): Promise<void> {
  try {
    const wallet = await store.deps.wallets.connect(optionId);
    // The wallet this one replaces keeps no session open.
    if (store.liveWallet !== wallet) release(store, store.liveWallet);
    store.liveWallet = wallet;
    store.patch(NO_ACCOUNT);
    store.setWallet({ address: wallet.address, label: wallet.label, ...(wallet.readOnly ? { readOnly: true } : {}) });
    offerUsdcImport(store, wallet);
    await store.loadAccount(true);
    if (!quiet) store.toast("ok", `Connected ${wallet.label}.`);
  } catch (error) {
    // A node that cannot be trusted is reported by the attestation banner and the stream, once; the account read waiting on the same check does not repeat it.
    if (!store.noteAccess(error) && !(error instanceof UntrustedError)) store.toast("error", error instanceof Error ? error.message : "The wallet did not connect.");
    if (!store.getSnapshot().wallet) store.liveWallet = null;
  }
}

export function disconnectWallet(store: ConsoleStore): void {
  release(store, store.liveWallet);
  store.liveWallet = null;
  store.setWallet(null);
  store.patch(NO_ACCOUNT);
}

/** The connected wallet when the console may use it now; otherwise tells the user why not and returns null. */
export function usableWallet(store: ConsoleStore, action: string): Wallet | null {
  const wallet = store.liveWallet;
  const state = store.getSnapshot();
  if (!wallet) {
    store.toast("error", "Connect a wallet first.");
    return null;
  }
  const blocked = signBlock(state.attestation, state.stream, state.wallet?.readOnly === true);
  if (blocked !== null) {
    store.toast("error", `The console will not ${action}: ${blocked}.`);
    return null;
  }
  return wallet;
}

/** Runs one wallet step, showing `prompt` while the wallet waits for the user. */
export async function prompting<T>(store: ConsoleStore, prompt: string, step: () => Promise<T>): Promise<T> {
  store.patch({ prompt });
  try {
    return await step();
  } finally {
    store.patch({ prompt: null });
  }
}

/**
 * How a request answered 409 (its nonce already used) is handled. A cancel or a declaration is signed
 * once more with the nonce the node names, since running it twice does nothing more; an order or a
 * withdrawal is not, since a copy of it may have run first (the node's own README warns a man in the
 * middle can send a copy first and deliver the refusal of the second).
 */
type OnNonceTaken = "sign-again" | "report";

/**
 * Signs and sends one request for a node whose attestation the console accepts. The nonce comes
 * from the node's signed answer, and the expiry from that answer's signed time. A refusal is shown
 * only after the account is read again under fresh challenges, so the screen holds what the node
 * holds when the user reads why, as the engine asks of a client.
 */
async function signed(
  store: ConsoleStore,
  summary: string,
  build: (terms: Terms, account: string) => TypedRequest,
  send: (auth: RequestAuth, wallet: Wallet) => Promise<ActionResult>,
  onNonceTaken: OnNonceTaken,
): Promise<Outcome> {
  const wallet = usableWallet(store, "sign");
  if (!wallet) return { ok: false };
  store.patch({ busy: true });
  /** Whether the request left the page: from then on it may have run, whatever comes back. */
  let sent = false;
  try {
    const { next_nonce, time_ms } = await store.deps.client.nonce(wallet.address);
    const expiresAt = (time_ms ?? store.getSnapshot().now) + REQUEST_TTL_MS;
    const attempt = async (nonce: number) => {
      const typed = build({ nonce, expiresAt }, wallet.address);
      const signature = await prompting(store, `Confirm in your wallet: ${summary}.`, () => wallet.sign({ summary, typed }));
      sent = true;
      return send({ nonce, expires_at: expiresAt, signature }, wallet);
    };
    try {
      return { ok: true, result: await attempt(next_nonce) };
    } catch (error) {
      if (!(error instanceof EngineError) || error.reject?.kind !== "invalid_nonce") throw error;
      if (onNonceTaken === "report") throw new EngineError(error.status, `The node had already used nonce ${next_nonce} for this account, so it did not take this request as sent. If it was sent twice it may have run: check your positions, orders, withdrawals and history before trying again.`);
      return { ok: true, result: await attempt(error.reject.expected) };
    }
  } catch (error) {
    if (store.noteAccess(error)) return { ok: false };
    // A sent request the node refused, left unanswered, or answered unverifiably may still have run: read the account first.
    if (sent) await store.refresh(true);
    // Only a refusal the node signed says the request did not run; no answer, or one that does not verify, says nothing.
    const unanswered = error instanceof UntrustedError || (error instanceof EngineError && error.status === 0);
    const unknown = sent && unanswered ? " It may have run: check your positions, orders, withdrawals and history before trying again." : "";
    store.toast("error", `${errorText(error)}${unknown}`);
    return { ok: false };
  } finally {
    store.patch({ busy: false });
  }
}

export function errorText(error: unknown): string {
  if (error instanceof EngineError) return error.reject ? describeReject(error.reject) : error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** The domain the client's deployment signs under. */
export const domainOf = (store: ConsoleStore) => requestDomain(store.deps.client.deployment.chainId, store.deps.client.deployment.vault);

export async function attestEligibility(store: ConsoleStore, cls: EligibilityClass): Promise<void> {
  const out = await signed(store, `declare "${STATEMENTS[cls]}"`, (t, account) => eligibilityTypedData(domainOf(store), account, cls, t), (auth, wallet) =>
    store.deps.client.attestEligibility({ account: wallet.address, class: cls, auth }), "sign-again",
  );
  if (!out.ok) return;
  const refused = out.result.events.find((e) => e.type === "eligibility_rejected");
  if (refused && refused.type === "eligibility_rejected") store.toast("error", describeReject(refused.reason));
  else store.toast("ok", "Eligibility recorded.");
  await store.refresh(true);
}

/** Sends a deposit from the wallet to the vault, approving the vault first if needed; the node credits it once it is final. */
export async function deposit(store: ConsoleStore, amount: Fixed): Promise<void> {
  const wallet = usableWallet(store, "send a deposit");
  if (!wallet) return;
  const shown = formatUsdc(amount);
  store.patch({ busy: true });
  try {
    await prompting(store, `Confirm in your wallet: deposit ${shown} to the vault (an approval first, if the vault needs one).`, () => wallet.deposit(amount, (waitingFor) => store.patch({ prompt: waitingFor })));
    store.toast("info", store.deps.client.signatures === "none"
      ? `Deposit of ${shown} sent. It counts as collateral now and can be withdrawn once the vault's transaction is final.`
      : `Deposit of ${shown} sent. The node sees it a few blocks after it is mined and credits it once your eligibility is recorded; it can be withdrawn once the vault's transaction is final.`);
    await store.refresh(true);
  } catch (error) {
    if (!store.noteAccess(error)) store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
}

/**
 * The dev-only faucet (monkey-trading/console#44): tops the wallet's gas up to 1 ETH through
 * `anvil_setBalance` on the build's pinned RPC, then mints 10,000 mock USDC to it through the
 * wallet. A pinned RPC that is not Anvil is named, not guessed at, and nothing is minted then.
 */
export async function fundWithAnvil(store: ConsoleStore, deploy: Deploy): Promise<void> {
  if (!faucetAvailable(deploy)) return;
  const wallet = usableWallet(store, "fund the wallet");
  const rpcUrl = deploy.rpcUrl;
  if (!wallet || wallet.fund === undefined || rpcUrl === null) {
    store.toast("error", "This build's faucet is not available for the connected wallet.");
    return;
  }
  // Bound to the wallet: calling the method without a receiver unbinds `this` in the provider wallet.
  const fund = wallet.fund.bind(wallet);
  store.patch({ busy: true });
  try {
    const gas = await topUpGas(rpcUrl, wallet.address, postJsonRpc);
    if (!gas.ok) {
      store.toast("error", gas.notAnvil
        ? `The build's RPC is not an Anvil node (${gas.detail}), so the faucet cannot fund this wallet.`
        : `The faucet could not top up gas: ${gas.detail}.`);
      return;
    }
    await prompting(store, `Confirm in your wallet: mint ${formatUsdc(FAUCET_USDC)} from the Anvil faucet.`, () => fund(FAUCET_USDC, (waitingFor) => store.patch({ prompt: waitingFor })));
    store.toast("ok", `${formatUsdc(FAUCET_USDC)} minted${gas.toppedUp ? " and the wallet holds 1 ETH for gas" : ""}. Deposit into the vault to trade it.`);
  } catch (error) {
    if (!store.noteAccess(error)) store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
}

/** POSTs one JSON-RPC request to the chain's RPC and resolves with the decoded body. Error cases: the RPC answers not-OK. */
const postJsonRpc = async (url: string, body: unknown): Promise<unknown> => {
  const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`the chain's RPC answered HTTP ${response.status}`);
  return response.json() as Promise<unknown>;
};

export interface OrderParams {
  market: number;
  side: Side;
  qty: Fixed;
  /** A market order carries the price the user was shown and their slippage bound; a limit or stop order its trigger. */
  kind: { kind: "market"; quoted: Fixed; slippageBps: number } | { kind: "limit" | "stop"; price: Fixed };
  reduceOnly: boolean;
}

/** Places an order. A market order carries the quote shown to the user and their slippage bound. */
export async function placeOrder(store: ConsoleStore, params: OrderParams): Promise<void> {
  const market = store.getSnapshot().markets.find((m) => m.id === params.market);
  if (!market || params.qty <= 0n) return;
  const qty = fixedToWire(params.qty);
  const kind: OrderKind =
    params.kind.kind === "market"
      ? { kind: "market", quoted: fixedToWire(params.kind.quoted), max_slippage_bps: params.kind.slippageBps }
      : { kind: params.kind.kind, price: fixedToWire(params.kind.price) };
  const order = { client_id: store.id(), market: market.id, side: params.side, qty, kind, reduce_only: params.reduceOnly };
  const at = params.kind.kind === "market" ? `at ${formatFixedPlaces(params.kind.quoted, market.places)}, up to ${params.kind.slippageBps} bps worse` : `${params.kind.kind} at ${formatFixedPlaces(params.kind.price, market.places)}`;
  const summary = `${params.side} ${qty} ${market.symbol} ${at}${params.reduceOnly ? ", reduce only" : ""}`;
  const out = await signed(store, summary, (t, account) => orderTypedData(domainOf(store), { ...order, account }, t), (auth, wallet) =>
    store.deps.client.placeOrder({ ...order, account: wallet.address, auth }), "report",
  );
  if (!out.ok) return;
  const rejected = out.result.events.find((e) => e.type === "order_rejected");
  if (rejected && rejected.type === "order_rejected") store.toast("error", describeReject(rejected.reason));
  else if (out.result.events.some((e) => e.type === "fill")) store.toast("ok", `Filled: ${summary}.`);
  else if (out.result.events.some((e) => e.type === "order_cancelled")) store.toast("error", "The order was accepted but could not be filled, so it was cancelled.");
  else store.toast("ok", "Order placed and resting.");
  await store.refresh(true);
}

export async function cancelOrder(store: ConsoleStore, orderId: number): Promise<void> {
  const out = await signed(store, `cancel order ${orderId}`, (t, account) => cancelTypedData(domainOf(store), { account, order_id: orderId }, t), (auth, wallet) =>
    store.deps.client.cancelOrder({ account: wallet.address, order_id: orderId, auth }), "sign-again",
  );
  if (!out.ok) return;
  const refused = out.result.events.find((e) => e.type === "order_rejected");
  if (refused && refused.type === "order_rejected") store.toast("error", describeReject(refused.reason));
  else store.toast("ok", `Order ${orderId} cancelled.`);
  await store.refresh(true);
}

/** Asks to withdraw `amount`; true when the node took the request, false when it refused it. */
export async function withdraw(store: ConsoleStore, amount: Fixed): Promise<boolean> {
  const wire = fixedToWire(amount);
  const out = await signed(store, `withdraw ${wire} USDC`, (t, account) => withdrawalTypedData(domainOf(store), account, wire, t), (auth, wallet) =>
    store.deps.client.withdraw({ account: wallet.address, amount: wire, auth }), "report",
  );
  if (!out.ok) return false;
  const refused = out.result.events.find((e) => e.type === "withdrawal_rejected");
  if (refused && refused.type === "withdrawal_rejected") {
    store.toast("error", describeReject(refused.reason));
    await store.refresh(true);
    return false;
  }
  if (out.result.events.some((e) => e.type === "withdrawal_queued")) store.toast("info", "Withdrawal queued. The vault pays the queue in order as it has liquidity.");
  // The mock pays an approved withdrawal itself; a live node's needs a claim on the vault.
  else store.toast("ok", store.deps.client.signatures === "none" ? "Withdrawal approved." : "Withdrawal approved. Its authorization arrives once a checkpoint covers it; then claim it on the vault.");
  await store.refresh(true);
  return true;
}

/** Parses an amount typed by the user, or null: digits and one decimal point only, so `100,50` is refused, not read as 10050. */
export function parseAmount(text: string): Fixed | null {
  const value = parseFixed(text);
  return value !== null && value > 0n ? value : null;
}
