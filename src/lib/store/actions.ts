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
import { ensureLogin } from "./session";
import { sessionSigned } from "./session-signed";
import { abandoned, domainOf, errorText, notBusy, noteRegionRefusal, prompting, REQUEST_TTL_MS, signed, usableWallet } from "./signing";
import type { ConsoleStore } from "./store";
import { adoptStoredKey, KEY_EXPIRED, NO_ACCOUNT, NO_SESSION, release, sessionEnded } from "./wallet-session";

export { REQUEST_TTL_MS, STATEMENTS };
export { disconnectWallet, storedKeyChanged, walletSessionEnded } from "./wallet-session";

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
    // A previous disconnect's revocation and release run to the end before a new wallet adopts the
    // store, so a WalletConnect relay is never closed under a fresh pairing. The promise stays
    // installed until it settles: a second connect waits on the same cleanup, not a cleared slot.
    if (store.walletCleanup !== null) {
      const cleanup = store.walletCleanup;
      // Bounded by the revocation's own request expiry: past it the signature could not be accepted,
      // so the connect proceeds and the late cleanup settles in the background.
      await Promise.race([cleanup, new Promise((resolve) => setTimeout(resolve, REQUEST_TTL_MS))]);
      if (store.walletCleanup === cleanup) store.walletCleanup = null;
    }
    const wallet = connected ?? (await store.deps.wallets.connect(optionId));
    if (quiet && store.liveWallet !== null && store.liveWallet !== wallet) {
      release(store, wallet); // a quiet connect never replaces a wallet that connected while it waited; the stale one ends
      return false;
    }
    if (store.liveWallet !== wallet) {
      release(store, store.liveWallet); // the wallet this one replaces keeps no session open
      // The old connection's key, expiry, in-flight login, refusal and setup do not carry to the new wallet.
      store.sessionKey = null;
      store.sessionLogin = null;
      store.patch(NO_SESSION);
    }
    store.liveWallet = wallet;
    store.patch(NO_ACCOUNT);
    store.setWallet({ address: wallet.address, label: wallet.label, ...(wallet.readOnly ? { readOnly: true } : {}) });
    // Before the key and the account, as nothing is signed for the node until the vault's release has
    // been read, and before the offer below: its prompt would hold the wallet from answering the read.
    await store.deps.client.readChainThrough(wallet.chainReads ?? null);
    // The connection may have ended while the wallet answered: nothing of it is stored or adopted.
    if (store.liveWallet !== wallet) return false;
    if (!quiet) offerUsdcImport(store, wallet);
    // The choice persists only now that the wallet is adopted: a refused connect, quiet or not, leaves storage alone.
    const choice = wallet.topic !== undefined ? { kind: "walletconnect" as const, topic: wallet.topic } : optionId === "injected" ? { kind: "injected" as const } : null;
    if (store.deps.persistence !== undefined && choice !== null) saveChoice(store.deps.persistence, choice);
    // A key stored for this account, chain and vault is reused with no signature. A reload that re-attached
    // its connection by itself and finds the key expired ends as any expiry does. A connect the user just
    // made, by pressing it or by the pairing a reload falls back to, is the reconnection that would ask for.
    const reattached = quiet && (connected !== undefined || optionId !== "walletconnect");
    if (adoptStoredKey(store, wallet) === "expired" && reattached) {
      sessionEnded(store, KEY_EXPIRED);
      return false;
    }
    // The mock's demo account, connected on load, holds a key as a returning trader does. Everything else asks through setup.
    if (quiet && store.deps.client.signatures === "none") await ensureLogin(store);
    await loadAccount(store, true);
    if (!quiet) store.toast("ok", `Connected ${wallet.label}.`);
    return true;
  } catch (error) {
    // A node that cannot be trusted is reported by the attestation banner and the stream, once; the account read waiting on the same check does not repeat it.
    if (!store.noteAccess(error) && !(error instanceof UntrustedError)) store.toast("error", error instanceof Error ? error.message : "The wallet did not connect.");
    if (!store.getSnapshot().wallet) store.liveWallet = null;
    return false;
  }
}


/** The setup popup's authorization: the one wallet signature, busy while the wallet asks. True once this browser holds a live key. */
export async function authorizeBrowser(store: ConsoleStore): Promise<boolean> {
  const wallet = store.liveWallet;
  if (wallet === null) return false;
  store.patch({ busy: true });
  try {
    return await ensureLogin(store);
  } finally {
    notBusy(store, wallet);
  }
}

/** Signs and sends the declaration, then reads the account again, so what comes next sees it. True when this connection's declaration was recorded. */
export async function attestEligibility(store: ConsoleStore, cls: EligibilityClass): Promise<boolean> {
  const wallet = store.liveWallet;
  const out = await signed(store, `declare "${STATEMENTS[cls]}"`, (t, account) => eligibilityTypedData(domainOf(store), account, cls, t), (auth, wallet) =>
    store.deps.client.attestEligibility({ account: wallet.address, class: cls, auth }), "sign-again",
  );
  if (!out.ok) return false;
  const refused = out.result.events.find((e) => e.type === "eligibility_rejected");
  // The node screens a declaration in the log: a region it does not serve answers here, not as a 403.
  if (refused && refused.type === "eligibility_rejected") {
    if (!noteRegionRefusal(store, refused.reason)) store.toast("error", describeReject(refused.reason));
  } else store.toast("ok", "Eligibility recorded.");
  await store.refresh(true);
  return refused === undefined && store.liveWallet === wallet;
}

/** Sends a deposit from the wallet to the vault, approving the vault first if needed; the node credits it once it is final. */
export async function deposit(store: ConsoleStore, amount: Fixed): Promise<void> {
  const wallet = usableWallet(store, "send a deposit");
  if (!wallet) return;
  const shown = formatUsdc(amount);
  store.patch({ busy: true });
  try {
    await prompting(store, wallet, `Confirm in your wallet: deposit ${shown} to the vault (an approval first, if the vault needs one).`, (progress) => wallet.deposit(amount, progress));
    store.toast("info", store.deps.client.signatures === "none"
      ? `Deposit of ${shown} sent. It counts as collateral now and can be withdrawn once the vault's transaction is final.`
      : `Deposit of ${shown} sent. The node sees it a few blocks after it is mined and credits it; it can be withdrawn once the vault's transaction is final.`);
    await store.refresh(true);
  } catch (error) {
    if (!abandoned(store, wallet, error) && !store.noteAccess(error)) store.toast("error", errorText(error));
  } finally {
    notBusy(store, wallet);
  }
}

/**
 * The dev-only faucet (monkey-trading/console#44): tops the wallet's gas up to 1 ETH through
 * `anvil_setBalance` on the build's pinned RPC, then mints 10,000 mock USDC to it through the
 * wallet. A pinned RPC that is not Anvil is named, not guessed at, and nothing is minted then. True
 * when the mint went through and this wallet is still the one connected.
 */
export async function fundWithAnvil(store: ConsoleStore, deploy: Deploy): Promise<boolean> {
  if (!faucetAvailable(deploy)) return false;
  // usableWallet toasts its own reason when it refuses; only an able wallet that cannot mint reaches the toast below.
  const wallet = usableWallet(store, "fund the wallet");
  if (!wallet) return false;
  const rpcUrl = deploy.rpcUrl;
  if (wallet.fund === undefined || rpcUrl === null) {
    store.toast("error", "This build's faucet is not available for the connected wallet.");
    return false;
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
      return false;
    }
    await prompting(store, wallet, `Confirm in your wallet: mint ${formatUsdc(FAUCET_USDC)} from the Anvil faucet.`, (progress) => fund(FAUCET_USDC, progress));
    store.toast("ok", `${formatUsdc(FAUCET_USDC)} minted${gas.toppedUp ? " and the wallet holds 1 ETH for gas" : ""}. Deposit into the vault to trade it.`);
    return store.liveWallet === wallet; // a mint the old wallet finished settles nothing for the connection that came next
  } catch (error) {
    if (!abandoned(store, wallet, error) && !store.noteAccess(error)) store.toast("error", errorText(error));
    return false;
  } finally {
    notBusy(store, wallet);
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

/**
 * Places an order. A market order carries the quote shown to the user and their slippage bound.
 * True when the order filled or rests; false when it was refused, cancelled unfilled, or never reached the node.
 */
export async function placeOrder(store: ConsoleStore, params: OrderParams): Promise<boolean> {
  const market = store.getSnapshot().markets.find((m) => m.id === params.market);
  if (!market || params.qty <= 0n) return false;
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
  if (!out.ok) return false;
  const rejected = out.result.events.find((e) => e.type === "order_rejected");
  const filled = out.result.events.some((e) => e.type === "fill");
  const cancelled = out.result.events.some((e) => e.type === "order_cancelled");
  if (rejected && rejected.type === "order_rejected") store.toast("error", describeReject(rejected.reason));
  else if (filled) store.toast("ok", `Filled: ${summary}.`);
  else if (cancelled) store.toast("error", "The order was accepted but could not be filled, so it was cancelled.");
  else store.toast("ok", "Order placed and resting.");
  await store.refresh(true);
  return rejected === undefined && (filled || !cancelled);
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
