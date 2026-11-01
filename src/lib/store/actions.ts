/** What the user can do: connect a wallet, deposit, declare eligibility, trade, and withdraw. */

import type { Deploy } from "../engine/deploy";
import { FAUCET_USDC, faucetAvailable, topUpGas } from "../engine/faucet";
import { cancelTypedData, eligibilityTypedData, orderTypedData, STATEMENTS, withdrawalTypedData } from "../engine/eip712";
import type { EligibilityClass, OrderKind, Side } from "../engine/types";
import type { Wallet } from "../engine/wallet";
import { saveChoice } from "../engine/wallet-persist";
import { UntrustedError } from "../engine/trust";
import { fixedToWire, formatFixedPlaces, parseFixed, type Fixed } from "../fixed";
import { formatUsdc } from "../vault";
import { describeReject } from "../messages";
import { loadAccount } from "./account";
import { ensureLogin, revokeSession, sessionSigned } from "./session";
import { domainOf, errorText, prompting, REQUEST_TTL_MS, signed, usableWallet } from "./signing";
import type { ConsoleStore } from "./store";

export { REQUEST_TTL_MS, STATEMENTS };

/** The state a wallet change clears: everything read or streamed for the account before. */
const NO_ACCOUNT = { account: null, eligibility: null, queue: [], history: [], quotes: {}, quoteError: null, quoted: [], authorizations: [], approvals: [], approvalsNext: null, payoutHints: {}, searching: null, paid: [], unpaid: [], entitlement: null, emissionsVault: null };

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

export async function connectWallet(store: ConsoleStore, optionId: string, quiet = false, connected?: Wallet): Promise<boolean> {
  try {
    const wallet = connected ?? (await store.deps.wallets.connect(optionId));
    if (quiet && store.liveWallet !== null && store.liveWallet !== wallet) {
      release(store, wallet); // a quiet connect never replaces a wallet that connected while it waited; the stale one ends
      return false;
    }
    if (store.liveWallet !== wallet) release(store, store.liveWallet); // the wallet this one replaces keeps no session open
    store.liveWallet = wallet;
    store.patch(NO_ACCOUNT);
    store.setWallet({ address: wallet.address, label: wallet.label, ...(wallet.readOnly ? { readOnly: true } : {}) });
    if (!quiet) offerUsdcImport(store, wallet);
    // The choice persists only now that the wallet is adopted: a refused connect, quiet or not, leaves storage alone.
    const choice = wallet.topic !== undefined ? { kind: "walletconnect" as const, topic: wallet.topic } : optionId === "injected" ? { kind: "injected" as const } : null;
    if (store.deps.persistence !== undefined && choice !== null) saveChoice(store.deps.persistence, choice);
    await loadAccount(store, true);
    // The one-signature login (console#68): trading signs with the ephemeral key it authorizes. A
    // fresh account is not credited yet — the registration refuses silently, and its first deposit's
    // event runs the login when trading becomes possible.
    if (!wallet.readOnly) await ensureLogin(store);
    if (!quiet) store.toast("ok", `Connected ${wallet.label}.`);
    return true;
  } catch (error) {
    // A node that cannot be trusted is reported by the attestation banner and the stream, once; the account read waiting on the same check does not repeat it.
    if (!store.noteAccess(error) && !(error instanceof UntrustedError)) store.toast("error", error instanceof Error ? error.message : "The wallet did not connect.");
    if (!store.getSnapshot().wallet) store.liveWallet = null;
    return false;
  }
}

/**
 * Disconnects the wallet. A session key the login authorized is revoked first, best effort, while
 * the wallet's session can still sign; a disconnect from an already-ended WalletConnect session
 * (`revoke: false`) skips that, and the registration expires on its own.
 */
export function disconnectWallet(store: ConsoleStore, revoke = true): void {
  const wallet = store.liveWallet;
  const key = store.sessionKey;
  store.liveWallet = null;
  store.sessionKey = null;
  store.sessionKeyExpiresAt = 0;
  store.setWallet(null);
  store.patch(NO_ACCOUNT);
  if (revoke && wallet && !wallet.readOnly && key !== null) void revokeThenRelease(store, wallet, key);
  else release(store, wallet);
}

/** Revokes the session key, then ends the wallet's session; the wallet is gone either way. */
async function revokeThenRelease(store: ConsoleStore, wallet: Wallet, key: NonNullable<ConsoleStore["sessionKey"]>): Promise<void> {
  await revokeSession(store, wallet, key);
  release(store, wallet);
}

/** The connected wallet when the console may use it now; otherwise tells the user why not and returns null. */
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
  // usableWallet toasts its own reason when it refuses; only an able wallet that cannot mint reaches the toast below.
  const wallet = usableWallet(store, "fund the wallet");
  if (!wallet) return;
  const rpcUrl = deploy.rpcUrl;
  if (wallet.fund === undefined || rpcUrl === null) {
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
  const out = await sessionSigned(store, summary, (t, account) => orderTypedData(domainOf(store), { ...order, account }, t), (auth, wallet) =>
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
  const out = await sessionSigned(store, `cancel order ${orderId}`, (t, account) => cancelTypedData(domainOf(store), { account, order_id: orderId }, t), (auth, wallet) =>
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
