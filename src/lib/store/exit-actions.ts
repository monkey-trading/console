/**
 * What the trader does with an exit proof: import a file, start the vault's exit, register a claim,
 * refund a deposit, and claim. None of it signs anything for the node, so it needs only the wallet:
 * it runs with the node gone, whatever the attestation banner says. A failure stays in the panel until
 * the next action replaces it, and a success the panel shows by itself gets no message.
 */

import { ExitProofError } from "../engine/exit-proof";
import { withTimeout } from "../engine/provider-errors";
import { MAX_EXIT_FILE_BYTES, parseExitFile } from "../engine/exit-file";
import { exitPhase, NO_TERMS, refundSteps, registeredTotal, registerSteps } from "../engine/exit-steps";
import type { ExitStep, ExitWallet } from "../engine/exit-types";
import type { Wallet } from "../engine/wallet";
import { shortHex } from "../format";
import { formatUsdc, USDC_UNIT } from "../vault";
import { acceptedRecord, type ExitResult } from "./exit-state";
import { clause } from "./exit-view";
import { abandoned, errorText, notBusy, prompting } from "./signing";
import type { ConsoleStore } from "./store";

/** How long a chosen file may take to read, in milliseconds: one from a cloud drive is fetched on demand. */
const FILE_READ_MS = 120_000;

/** A wallet that can act on the vault; with none the panel says so, and offers nothing that reaches here. */
function exitWallet(store: ConsoleStore): { wallet: Wallet; exit: ExitWallet } | null {
  const wallet = store.liveWallet;
  const exit = wallet?.exit;
  return wallet === null || exit === undefined ? null : { wallet, exit };
}

/** Asks the wallet onto the vault's chain, which a press may and a background read never does: null once it is there, or why it would not go. */
async function onChain(wallet: Wallet): Promise<string | null> {
  try {
    await wallet.ensureChain?.();
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** What an action came to: why it failed, or what it did, which the panel shows by itself once it has read the vault; null when there is nothing to tell. */
type Ended = { failed: string } | { did: string } | null;

/** Reads and checks an imported file; a refusal says why, and leaves the saved proof as it was. */
export async function importExitFile(store: ConsoleStore, text: string): Promise<void> {
  const held = exitWallet(store);
  if (held === null) return;
  const { wallet } = held;
  const scope = store.exit.keeper.scope(wallet);
  if (scope === null) return;
  const finish = (result: ExitResult) => {
    if (store.liveWallet === wallet) store.exit.note(result, false);
  };
  const refuse = (why: string) => finish({ ok: false, text: `The file was not imported: ${clause(why)}.` });
  store.exit.note(null, true);
  try {
    const file = parseExitFile(text);
    if ((file.chainId !== null && file.chainId !== scope.chainId) || (file.vault !== null && file.vault !== scope.vault)) return refuse(`it is for another deployment (chain ${file.chainId ?? "unnamed"}, vault ${shortHex(file.vault ?? "unnamed")})`);
    if (file.account !== null && file.account !== scope.account) return refuse(`it is for account ${shortHex(file.account)}. Connect that wallet to import it`);
    const offChain = await onChain(wallet);
    if (offChain !== null) return refuse(`your wallet could not check it: ${offChain}`);
    const outcome = await store.exit.keeper.adopter.adopt(wallet, scope, file.proof);
    switch (outcome.kind) {
      case "saved": // the panel's saved line says it, and its storage line when the browser would not keep it
        if (store.liveWallet === wallet) store.exit.announce(`Imported the proof for checkpoint ${file.proof.seq}.`);
        return finish(null);
      case "empty": {
        const now = store.getSnapshot().exit.vault;
        return now !== null && exitPhase(now) === "due" ? finish({ ok: true, text: "It holds nothing for this account, but the vault accepts its exit terms, so it can start the exit." }) : refuse("it gives this account nothing");
      }
      case "holds-less": return refuse("it holds less than the proof already saved for that checkpoint");
      case "other-root": return refuse(`it is for checkpoint ${outcome.proofSeq}, and the vault's latest is checkpoint ${outcome.vaultSeq}, so the vault would refuse a claim from it`);
      case "refused": return refuse(`the vault's verifier refused it: ${outcome.reason}`);
      default: return outcome satisfies never;
    }
  } catch (error) {
    if (error instanceof ExitProofError) return refuse(error.message);
    return refuse(`your wallet could not check it: ${errorText(error)}`);
  }
}

/**
 * Takes a file the trader chose, for the wallet that chose it: one connected by the time it has been
 * read did not. The controls are held from now to the end of its check, as a file fetched on demand can
 * be slow, so its result cannot replace a later one; one that never comes gives them back in time.
 */
export async function importChosenFile(store: ConsoleStore, file: Pick<File, "size" | "text">): Promise<void> {
  const owner = store.liveWallet;
  if (exitWallet(store) === null || store.getSnapshot().exit.importing) return;
  if (file.size > MAX_EXIT_FILE_BYTES) return store.exit.note({ ok: false, text: "The file was not imported: it is longer than any exit proof." });
  store.exit.note(null, true);
  let text: string;
  try {
    text = await withTimeout(file.text(), FILE_READ_MS);
  } catch {
    if (store.liveWallet === owner) store.exit.note({ ok: false, text: "The file could not be read." }, false);
    return;
  }
  if (store.liveWallet === owner) await importExitFile(store, text);
}

/** Runs `action` holding the page's buttons from the first moment to the end of the read after it, so nothing can join it or come between. That read runs whatever it came to. The panel says why it failed, if it did; what it did shows once that read answers, and is said outright if the read does not. */
async function holding(store: ConsoleStore, wallet: Wallet, action: () => Promise<Ended>): Promise<void> {
  store.patch({ busy: true });
  store.exit.note(null);
  const current = () => store.liveWallet === wallet;
  try {
    const offChain = await onChain(wallet);
    const ended: Ended = offChain !== null ? { failed: offChain } : await action();
    if (ended !== null && "failed" in ended && current()) store.exit.note({ ok: false, text: ended.failed });
    await store.exit.refresh();
    if (ended === null || !("did" in ended) || !current()) return;
    const { vaultProblem, claimsProblem } = store.getSnapshot().exit;
    if (vaultProblem !== null || claimsProblem !== null) store.exit.note({ ok: true, text: `${ended.did} What the vault holds is read again by itself.` });
    else store.exit.announce(ended.did);
  } finally {
    notBusy(store, wallet);
  }
}

/** Runs `steps` in order, one wallet prompt each, while the connection that asked lasts; a step that fails or is declined stops them, and the vault's record says how far they got. */
async function sendSteps(store: ConsoleStore, wallet: Wallet, exit: ExitWallet, steps: readonly ExitStep[], prompt: (step: ExitStep) => string): Promise<{ ended: (did: string) => Ended; done: boolean; paid: bigint | null }> {
  let paid: bigint | null = null;
  try {
    for (const step of steps) {
      // A wallet stays reachable once disconnected, and `prompting` shows nothing for it, so it would be asked with no word on the page.
      if (store.liveWallet !== wallet) return { ended: () => null, done: false, paid };
      const sent = await prompting(store, wallet, "exit", prompt(step), (progress) => exit.send(step, progress));
      paid = sent.paid;
    }
    return { ended: (did) => ({ did }), done: true, paid };
  } catch (error) {
    const failed = abandoned(store, wallet, error) ? null : errorText(error);
    return { ended: () => (failed === null ? null : { failed }), done: false, paid };
  }
}

/** Starts the vault's exit against its latest root: anyone may once no checkpoint has been posted for the exit period, and it is permanent. It takes exit terms the vault's verifier has accepted, but for a vault that has never had a checkpoint, which ignores them. */
export async function startVaultExit(store: ConsoleStore): Promise<void> {
  const held = exitWallet(store);
  if (held === null) return;
  const { wallet, exit } = held;
  await holding(store, wallet, async () => {
    if (!(await store.exit.readFresh())) return { failed: "The vault could not be read, so nothing was sent." };
    const { vault, terms: accepted } = store.getSnapshot().exit;
    if (vault === null || exitPhase(vault) !== "due") return { failed: "The vault's exit is not due, so nothing was sent." };
    const terms = !vault.hasCheckpoint ? NO_TERMS : accepted?.root === vault.latestRoot ? accepted : null;
    if (terms === null) return { failed: "The exit needs a proof the vault accepts at its latest checkpoint, so nothing was sent." };
    return (await sendSteps(store, wallet, exit, [{ kind: "start", terms }], () => "Confirm in your wallet: start the vault's exit.")).ended("The vault's exit has started.");
  });
}

/** Registers everything the saved proof has left, asking the wallet once for each. Anyone may register for any account, so the vault's record, read now, decides what is left. */
export async function registerExitClaims(store: ConsoleStore): Promise<void> {
  const held = exitWallet(store);
  if (held === null) return;
  const { wallet, exit } = held;
  await holding(store, wallet, async () => {
    if (!(await store.exit.readFresh()) || !(await store.exit.readClaims())) return { failed: "The vault's record could not be read, so nothing was sent." };
    const state = store.getSnapshot().exit;
    const { vault, claims } = state;
    const record = acceptedRecord(state);
    if (vault === null || exitPhase(vault) !== "open") return { failed: "The claim window is not open, so nothing was sent." };
    if (record === null || claims === null) return { failed: "The vault has not accepted a proof at its latest checkpoint, so nothing was sent." };
    const steps = registerSteps(record, claims);
    if (steps.length === 0) return { did: "Everything this proof holds is registered." }; // that read has taken the rows off the panel
    return (await sendSteps(store, wallet, exit, steps, (step) => `Confirm in your wallet: register step ${steps.indexOf(step) + 1} of ${steps.length} of your claim.`)).ended("Your claim is registered. The vault pays it once the claim window closes.");
  });
}

type RefundStep = Extract<ExitStep, { kind: "refund" | "refund-unheld" }>;

/** The id a refund step's deposit goes by. */
const depositId = (step: RefundStep): number => (step.kind === "refund" ? step.proof.deposit.deposit_id : step.id);

/** Refunds one deposit to the address that paid it, once the vault's record, read now, still shows it owed. */
export async function refundExitDeposit(store: ConsoleStore, step: RefundStep): Promise<void> {
  const held = exitWallet(store);
  if (held === null) return;
  const { wallet, exit } = held;
  const id = depositId(step);
  await holding(store, wallet, async () => {
    if (!(await store.exit.readClaims())) return { failed: "The vault's record could not be read, so nothing was sent." };
    const state = store.getSnapshot().exit;
    const { claims } = state;
    const record = acceptedRecord(state);
    if (step.kind === "refund" && (record === null || claims === null)) return { failed: "The vault has not accepted a proof at its latest checkpoint, so nothing was sent." };
    if (step.kind === "refund" && claims?.mismatched.includes(id) === true) return { failed: `The vault's record of deposit ${id} is not what this proof says, so nothing was sent.` };
    if (claims === null || !refundSteps(record, claims).some((left) => depositId(left) === id)) return { did: `Deposit ${id} has been refunded already.` }; // that read has taken its row off the panel
    return (await sendSteps(store, wallet, exit, [step], () => `Confirm in your wallet: refund deposit ${id} to the address that paid it.`)).ended(`Deposit ${id} was refunded to the address that paid it.`);
  });
}

/** Claims what is registered, once the window has closed and the vault's record, read now, still holds it; the vault pays the account, whoever sends it, so another tab or a relayer may have claimed it. */
export async function claimVaultExit(store: ConsoleStore): Promise<void> {
  const held = exitWallet(store);
  if (held === null) return;
  const { wallet, exit } = held;
  await holding(store, wallet, async () => {
    if (!(await store.exit.readFresh()) || !(await store.exit.readClaims())) return { failed: "The vault's record could not be read, so nothing was sent." };
    const { vault, claims } = store.getSnapshot().exit;
    if (vault === null || exitPhase(vault) !== "closed") return { failed: "The vault's claim window has not closed, so nothing was sent." };
    if (claims === null || registeredTotal(claims) === 0n) return { failed: "Nothing is registered for this account, or the vault has paid it, so nothing was sent." };
    const { ended, done, paid } = await sendSteps(store, wallet, exit, [{ kind: "claim" }], () => "Confirm in your wallet: claim your exit from the vault.");
    if (done && store.liveWallet === wallet) store.exit.notePaid(paid);
    return ended(paid === null ? "The vault paid your claim." : `The vault paid ${formatUsdc(paid * USDC_UNIT)} to your wallet.`);
  });
}
