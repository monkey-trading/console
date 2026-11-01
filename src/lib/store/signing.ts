/** The shared plumbing of a wallet-signed request: gating, nonce terms, the wallet prompt, and the signed-and-sent path with its nonce handling. */

import { signBlock } from "../engine/attestation";
import { EngineError, type ActionResult } from "../engine/client";
import { requestDomain, type Terms, type TypedRequest } from "../engine/eip712";
import type { RequestAuth } from "../engine/types";
import { UntrustedError } from "../engine/trust";
import type { Wallet } from "../engine/wallet";
import { describeReject } from "../messages";
import type { BlockReason } from "./state";
import type { ConsoleStore } from "./store";

/** A signed request stays valid this long past the node's signed time, within the engine's five-minute cap (`MAX_EXPIRY_AHEAD_MS`). */
export const REQUEST_TTL_MS = 120_000;

/** A refusal shown to the user, never thrown past an action. */
export type Outcome = { ok: true; result: ActionResult } | { ok: false };

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

/** How a request answered 409 (its nonce already used) is handled: a cancel re-signs with the nonce the node names, since running it twice does nothing more; an order does not, since a copy of it may have run first. */
export type OnNonceTaken = "sign-again" | "report";

/** The domain the client's deployment signs under. */
export const domainOf = (store: ConsoleStore) => requestDomain(store.deps.client.deployment.chainId, store.deps.client.deployment.vault);

/**
 * Signs and sends one request for a node whose attestation the console accepts: the nonce from
 * its signed answer, the expiry from that answer's signed time. A refusal shows only after the
 * account is read again, so the screen holds what the node holds when the user reads why.
 */
export async function signed(
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

/** What the console says an unexpected error was, naming the node's refusal when it carried one. */
export function errorText(error: unknown): string {
  if (error instanceof EngineError) return error.reject ? describeReject(error.reject) : error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Marks the caller as refused when `error` is an access refusal; true if it was. */
export function noteAccess(store: ConsoleStore, error: unknown): boolean {
  if (error instanceof EngineError && error.reject?.kind === "access") {
    const reason = error.reject.reason;
    if (reason === "united_states" || reason === "sanctioned_jurisdiction") {
      store.patch({ blocked: reason satisfies BlockReason, fundingOpen: false });
      return true;
    }
  }
  return false;
}
