/** What the user can do: connect a wallet, attest, deposit, trade, and withdraw. */

import { maySign } from "../engine/attestation";
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
    store.patch({ wallet: { address: wallet.address, label: wallet.label } });
    await store.loadAccount(true);
    if (!quiet) store.toast("ok", `Connected ${wallet.label}.`);
  } catch (error) {
    if (!store.noteAccess(error)) store.toast("error", error instanceof Error ? error.message : "The wallet did not connect.");
    if (!store.getSnapshot().wallet) store.liveWallet = null;
  }
}

export function disconnectWallet(store: ConsoleStore): void {
  store.liveWallet = null;
  store.patch({ wallet: null, account: null, eligibility: null, queue: [], history: [] });
}

/**
 * Signs and sends one request. The console signs only for a node whose attestation it accepts.
 * Every refusal becomes a message for the user.
 */
async function signed(
  store: ConsoleStore,
  request: SignRequest,
  send: (auth: RequestAuth, wallet: Wallet) => Promise<ActionResult>,
): Promise<Outcome> {
  const wallet = walletOf(store);
  const state = store.getSnapshot();
  if (!wallet) {
    store.toast("error", "Connect a wallet first.");
    return { ok: false };
  }
  if (!maySign(state.attestation)) {
    store.toast("error", "The node's attestation is not verified, so the console will not sign for it.");
    return { ok: false };
  }
  store.patch({ busy: true });
  try {
    const { next_nonce } = await store.deps.client.nonce(wallet.address);
    const signature = await wallet.sign(request);
    const result = await send({ nonce: next_nonce, expires_at: state.now + REQUEST_TTL_MS, signature }, wallet);
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
  const out = await signed(store, { primaryType: "Eligibility", summary: STATEMENTS[cls], message: { class: cls } }, (auth, wallet) =>
    store.deps.client.attestEligibility({ account: wallet.address, class: cls, auth }),
  );
  if (out.ok) {
    store.toast("ok", "Eligibility recorded.");
    await store.refresh(true);
  }
}

/** Sends a deposit from the wallet to the vault; the node credits it once it is final. */
export async function deposit(store: ConsoleStore, amount: Fixed): Promise<void> {
  const wallet = walletOf(store);
  if (!wallet) return;
  try {
    await wallet.deposit(amount);
    store.toast("info", `Deposit of $${formatFixedPlaces(amount, 2)} sent. It is credited when the vault's transaction is final.`);
    await store.refresh(true);
  } catch (error) {
    if (!store.noteAccess(error)) store.toast("error", errorText(error));
  }
}

export interface OrderParams {
  market: number;
  side: Side;
  notional: Fixed;
  slippageBps: number;
  kind: { type: "market" } | { type: "limit" | "stop"; price: Fixed };
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
    params.kind.type === "market"
      ? { type: "market", quoted: fixedToWire(preview.quote.price), max_slippage_bps: params.slippageBps }
      : { type: params.kind.type, price: fixedToWire(params.kind.price) };
  const shown = formatFixedPlaces(preview.quote.price, market.places);
  const summary = `${params.side} ${qty} ${market.symbol}${params.kind.type === "market" ? ` at ${shown}, up to ${params.slippageBps} bps worse` : ""}`;
  const out = await signed(store, { primaryType: "Order", summary, message: { market: market.id, side: params.side, qty } }, (auth, wallet) =>
    store.deps.client.placeOrder({ account: wallet.address, client_id: store.id(), market: market.id, side: params.side, qty, kind, reduce_only: params.reduceOnly, auth }),
  );
  if (!out.ok) return;
  const rejected = out.result.events.find((e) => e.type === "order_rejected");
  if (rejected && rejected.type === "order_rejected") store.toast("error", describeReject(rejected.reason));
  else if (out.result.events.some((e) => e.type === "fill")) store.toast("ok", `Filled: ${summary}.`);
  else store.toast("ok", "Order placed and resting.");
  await store.refresh(true);
}

export async function cancelOrder(store: ConsoleStore, orderId: number): Promise<void> {
  const out = await signed(store, { primaryType: "Cancel", summary: `cancel order ${orderId}`, message: { order_id: orderId } }, (auth, wallet) =>
    store.deps.client.cancelOrder({ account: wallet.address, order_id: orderId, auth }),
  );
  if (out.ok) {
    store.toast("ok", `Order ${orderId} cancelled.`);
    await store.refresh(true);
  }
}

/** Asks to withdraw `amount`; the vault pays whole USDC first-in first-out. */
export async function withdraw(store: ConsoleStore, amount: Fixed): Promise<void> {
  const wire = fixedToWire(amount);
  const out = await signed(store, { primaryType: "Withdrawal", summary: `withdraw ${wire} USDC`, message: { amount: wire } }, (auth, wallet) =>
    store.deps.client.withdraw({ account: wallet.address, amount: wire, auth }),
  );
  if (!out.ok) return;
  const refused = out.result.events.find((e) => e.type === "withdrawal_rejected");
  if (refused && refused.type === "withdrawal_rejected") store.toast("error", describeReject(refused.reason));
  else if (out.result.events.some((e) => e.type === "withdrawal_queued")) store.toast("info", "Withdrawal queued. The vault pays the queue in order as it has liquidity.");
  else store.toast("ok", "Withdrawal approved.");
  await store.refresh(true);
}

/** Parses an amount typed by the user, or null. */
export function parseAmount(text: string): Fixed | null {
  const value = parseFixed(text.replace(/[,\s]/g, ""));
  return value !== null && value > 0n ? value : null;
}
