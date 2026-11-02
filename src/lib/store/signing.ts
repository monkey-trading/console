/** The shared plumbing of a wallet-signed request: gating, nonce terms, the wallet prompt, and the signed-and-sent path with its nonce handling. */

import { signBlock } from "../engine/attestation";
import { EngineError, type ActionResult } from "../engine/client";
import { requestDomain, type Terms, type TypedRequest } from "../engine/eip712";
import { declinedByUser } from "../engine/provider-errors";
import type { Reject, RequestAuth } from "../engine/types";
import { UntrustedError } from "../engine/trust";
import type { Progress, Wallet } from "../engine/wallet";
import { describeReject } from "../messages";
import type { BlockReason } from "./state";
import type { ConsoleStore } from "./store";

/** A signed request stays valid this long past the node's signed time, within the engine's five-minute cap (`MAX_EXPIRY_AHEAD_MS`). */
export const REQUEST_TTL_MS = 120_000;

/** The sentinel an abandoned action throws when its connection ends between a wait and the send. */
export const DISCONNECTED = new Error("The connection ended before the request was sent.");

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

/**
 * Runs one wallet step for `owner`, the connection that asked, showing `prompt` while the wallet waits
 * for the user; the step reports what each part of it waits for through the `Progress` it is given. A
 * change of connection already cleared the prompt and the next wallet's may be showing, so a step of an
 * old connection neither writes nor clears it. Null is a revocation, which runs once its connection has
 * been dropped and until another adopts.
 */
export async function prompting<T>(store: ConsoleStore, owner: Wallet | null, prompt: string, step: (progress: Progress) => Promise<T>): Promise<T> {
  const current = () => store.liveWallet === owner;
  if (current()) store.patch({ prompt });
  try {
    return await step((waitingFor) => {
      if (current()) store.patch({ prompt: waitingFor });
    });
  } finally {
    if (current()) store.patch({ prompt: null });
  }
}

/** Whether `error` is the user declining in a wallet whose connection has since ended: nothing happened, and the connection that came next never asked. A transaction that failed is still told, whoever is connected. */
export const abandoned = (store: ConsoleStore, wallet: Wallet, error: unknown): boolean => store.liveWallet !== wallet && declinedByUser(error);

/** Ends `wallet`'s request's busy state. A change of connection already did, and the next wallet's own request may hold it now. */
export function notBusy(store: ConsoleStore, wallet: Wallet): void {
  if (store.liveWallet === wallet) store.patch({ busy: false });
}

/** How a request answered 409 (its nonce already used) is handled: a cancel or a declaration re-signs with the nonce the node names, since running it twice does nothing more; an order or a withdrawal does not, since a copy of it may have run first. */
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
      // The connection may have ended while the nonce read waited: its wallet is not asked.
      if (store.liveWallet !== wallet) throw DISCONNECTED;
      const typed = build({ nonce, expiresAt }, wallet.address);
      const signature = await prompting(store, wallet, `Confirm in your wallet: ${summary}.`, () => wallet.sign({ summary, typed }));
      // Or while the wallet asked: nothing goes out for a connection that ended.
      if (store.liveWallet !== wallet) throw DISCONNECTED;
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
    // A wallet that declines or fails after its connection ended has nothing to tell the connection that came next.
    if (error === DISCONNECTED || (!sent && store.liveWallet !== wallet)) return { ok: false };
    if (store.noteAccess(error)) return { ok: false };
    // A sent request the node refused, left unanswered, or answered unverifiably may still have run: read the account first.
    if (sent) await store.refresh(true);
    store.toast("error", `${errorText(error)}${sent && mayHaveRun(error) ? MAY_HAVE_RUN : ""}`);
    return { ok: false };
  } finally {
    notBusy(store, wallet);
  }
}

/** What the console adds for a request that went out with no answer it can judge. */
export const MAY_HAVE_RUN = " It may have run: check your positions, orders, withdrawals and history before trying again.";

/** Whether a sent request may have run: only a refusal the node signed, or a stop before it left, says it did not; no answer, or one that does not verify, says nothing. */
export function mayHaveRun(error: unknown): boolean {
  return error instanceof UntrustedError || (error instanceof EngineError && error.status === 0);
}

/** What the console says an unexpected error was, naming the node's refusal when it carried one. */
export function errorText(error: unknown): string {
  if (error instanceof EngineError) return error.reject ? describeReject(error.reject) : error.message;
  return error instanceof Error ? error.message : "Something went wrong.";
}

/** Marks the caller as refused when `reject` names a region the node does not serve; true if it did. */
export function noteRegionRefusal(store: ConsoleStore, reject: Reject): boolean {
  if (reject.kind !== "access") return false;
  const { reason } = reject;
  if (reason !== "united_states" && reason !== "sanctioned_jurisdiction") return false;
  store.patch({ blocked: reason satisfies BlockReason });
  return true;
}

/** Marks the caller as refused when `error` is an access refusal; true if it was. */
export function noteAccess(store: ConsoleStore, error: unknown): boolean {
  return error instanceof EngineError && error.reject !== null && error.reject !== undefined && noteRegionRefusal(store, error.reject);
}
