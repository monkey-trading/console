/** What the user can do: connect a wallet, attest, deposit, trade, and withdraw. */

import { signBlock } from "../engine/attestation";
import { EngineError, type ActionResult } from "../engine/client";
import type { EligibilityClass, OrderKind, RequestAuth, Side } from "../engine/types";
import type { SignRequest, Wallet } from "../engine/wallet";
import { fixedToWire, formatFixedPlaces, parseFixed, type Fixed } from "../fixed";
import { describeReject } from "../messages";
import { previewTicket } from "../ticket";
import type { ConsoleStore } from "./store";

/** A signed request stays valid for this long, in milliseconds. */
const REQUEST_TTL_MS = 60_000;

/** The statement each eligibility class signs, as the engine defines it. */
export const STATEMENTS: Record<EligibilityClass, string> = {
  professional: "I attest that I am a professional client.",
  eligible_client: "I attest that I am an eligible client.",
};

/** A refusal shown to the user, never thrown past an action. */
type Outcome = { ok: true; result: ActionResult } | { ok: false };

function walletOf(store: ConsoleStore): Wallet | null {
  return store.liveWallet;
}

export async function connectWallet(store: ConsoleStore, optionId: string, quiet = false): Promise<void> {
  try {
    const wallet = await store.deps.wallets.connect(optionId);
    store.liveWallet = wallet;
    store.setWallet({ address: wallet.address, label: wallet.label });
    await store.loadAccount(true);
    if (!quiet) store.toast("ok", `Connected ${wallet.label}.`);
  } catch (error) {
    if (!store.noteAccess(error)) store.toast("error", error instanceof Error ? error.message : "The wallet did not connect.");
    if (!store.getSnapshot().wallet) store.liveWallet = null;
  }
}

export function disconnectWallet(store: ConsoleStore): void {
  store.liveWallet = null;
  store.setWallet(null);
  store.patch({ account: null, eligibility: null, queue: [], history: [] });
}

/**
 * Signs and sends one request. The console signs only for a node whose attestation it accepts.
 * Every refusal becomes a message for the user.
 */
async function signed(
  store: ConsoleStore,
  build: (terms: { nonce: number; expires_at: number }) => SignRequest,
  send: (auth: RequestAuth, wallet: Wallet) => Promise<ActionResult>,
): Promise<Outcome> {
  const wallet = walletOf(store);
  const state = store.getSnapshot();
  if (!wallet) {
    store.toast("error", "Connect a wallet first.");
    return { ok: false };
  }
  const blocked = signBlock(state.attestation, state.stream);
  if (blocked !== null) {
    store.toast("error", `The console will not sign: ${blocked}`);
    return { ok: false };
  }
  store.patch({ busy: true });
  try {
    const { next_nonce } = await store.deps.client.nonce(wallet.address);
    const terms = { nonce: next_nonce, expires_at: state.now + REQUEST_TTL_MS };
    // What the wallet signs carries every field the request depends on, nonce and expiry included.
    const signature = await wallet.sign(build(terms));
    const result = await send({ ...terms, signature }, wallet);
    return { ok: true, result };
  } catch (error) {
    if (!store.noteAccess(error)) store.toast("error", errorText(error));
    return { ok: false };
  } finally {
    store.patch({ busy: false });
  }
}

function errorText(error: unknown): string {
  if (error instanceof EngineError) return error.reject ? describeReject(error.reject) : error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

export async function attestEligibility(store: ConsoleStore, cls: EligibilityClass): Promise<void> {
  const out = await signed(store, (t) => ({ primaryType: "Eligibility", summary: STATEMENTS[cls], message: { account: store.getSnapshot().wallet?.address ?? "", class: cls, statement: STATEMENTS[cls], ...t } }), (auth, wallet) =>
    store.deps.client.attestEligibility({ account: wallet.address, class: cls, auth }),
  );
  if (!out.ok) return;
  const refused = out.result.events.find((e) => e.type === "eligibility_rejected");
  if (refused && refused.type === "eligibility_rejected") store.toast("error", describeReject(refused.reason));
  else store.toast("ok", "Eligibility recorded.");
  await store.refresh(true);
}

/** Sends a deposit from the wallet to the vault; the node credits it once it is final. */
export async function deposit(store: ConsoleStore, amount: Fixed): Promise<void> {
  const wallet = walletOf(store);
  if (!wallet) return;
  const blocked = signBlock(store.getSnapshot().attestation, store.getSnapshot().stream);
  if (blocked !== null) {
    store.toast("error", `The console will not send a deposit: ${blocked}`);
    return;
  }
  store.patch({ busy: true });
  try {
    await wallet.deposit(amount);
    store.toast("info", `Deposit of $${formatFixedPlaces(amount, 2)} sent. It counts as collateral now and can be withdrawn once the vault's transaction is final.`);
    await store.refresh(true);
  } catch (error) {
    if (!store.noteAccess(error)) store.toast("error", errorText(error));
  } finally {
    store.patch({ busy: false });
  }
}

export interface OrderParams {
  market: number;
  side: Side;
  notional: Fixed;
  slippageBps: number;
  kind: { kind: "market" } | { kind: "limit" | "stop"; price: Fixed };
  reduceOnly: boolean;
  /** An exact quantity, such as a position being closed; the size above then only prices the quote. */
  qty?: Fixed;
}

/** Places an order. A market order carries the quote shown to the user and their slippage bound. */
export async function placeOrder(store: ConsoleStore, params: OrderParams): Promise<void> {
  const state = store.getSnapshot();
  const market = state.markets.find((m) => m.id === params.market);
  if (!market) return;
  const preview = previewTicket({ market, side: params.side, notional: params.notional, slippageBps: params.slippageBps, account: state.account, houseNav: state.house.nav });
  const units = params.qty ?? preview.qty;
  if (!preview.quote || units <= 0n) return;
  const qty = fixedToWire(units);
  const kind: OrderKind =
    params.kind.kind === "market"
      ? { kind: "market", quoted: fixedToWire(preview.quote.price), max_slippage_bps: params.slippageBps }
      : { kind: params.kind.kind, price: fixedToWire(params.kind.price) };
  const shown = formatFixedPlaces(preview.quote.price, market.places);
  const summary = `${params.side} ${qty} ${market.symbol}${params.kind.kind === "market" ? ` at ${shown}, up to ${params.slippageBps} bps worse` : ""}`;
  const clientId = store.id();
  const out = await signed(store, (t) => ({ primaryType: "Order", summary, message: { account: store.getSnapshot().wallet?.address ?? "", client_id: clientId, market: market.id, side: params.side, qty, kind: kind.kind, price: kind.kind === "market" ? kind.quoted : kind.price, max_slippage_bps: kind.kind === "market" ? kind.max_slippage_bps ?? 0 : 0, reduce_only: params.reduceOnly ? 1 : 0, ...t } }), (auth, wallet) =>
    store.deps.client.placeOrder({ account: wallet.address, client_id: clientId, market: market.id, side: params.side, qty, kind, reduce_only: params.reduceOnly, auth }),
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
  const out = await signed(store, (t) => ({ primaryType: "Cancel", summary: `cancel order ${orderId}`, message: { account: store.getSnapshot().wallet?.address ?? "", order_id: orderId, ...t } }), (auth, wallet) =>
    store.deps.client.cancelOrder({ account: wallet.address, order_id: orderId, auth }),
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
  const out = await signed(store, (t) => ({ primaryType: "Withdrawal", summary: `withdraw ${wire} USDC`, message: { account: store.getSnapshot().wallet?.address ?? "", amount: wire, ...t } }), (auth, wallet) =>
    store.deps.client.withdraw({ account: wallet.address, amount: wire, auth }),
  );
  if (!out.ok) return false;
  const refused = out.result.events.find((e) => e.type === "withdrawal_rejected");
  if (refused && refused.type === "withdrawal_rejected") {
    store.toast("error", describeReject(refused.reason));
    await store.refresh(true);
    return false;
  }
  if (out.result.events.some((e) => e.type === "withdrawal_queued")) store.toast("info", "Withdrawal queued. The vault pays the queue in order as it has liquidity.");
  else store.toast("ok", "Withdrawal approved.");
  await store.refresh(true);
  return true;
}

/** Parses an amount typed by the user, or null: digits and one decimal point only, so `100,50` is refused, not read as 10050. */
export function parseAmount(text: string): Fixed | null {
  const value = parseFixed(text);
  return value !== null && value > 0n ? value : null;
}
