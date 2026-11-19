/** The whole trust path a node the follower would move to must hold, run on that node's own client, and how it ended. */

import type { EngineClient } from "./client";
import type { SignerFloorWatch } from "./operator-follow-floor";
import { signedAnswer, type WaitingStage } from "./operator-follow-status";
import type { DeploymentReads } from "./registry";
import { notReady } from "./trust-errors";

/** Trusted, to be moved to; held back at a stage, with why; or failed, `notReady` when the node was only not serving yet. */
export type TrialEnd =
  | { kind: "trusted" }
  | { kind: "held"; stage: WaitingStage; reason: string | null }
  | { kind: "failed"; reason: string; error?: unknown; notReady: boolean };

/**
 * Runs the trust path on `client` under the wallet's chain reads `chain` (null with no wallet), held to the visit's signer `floor`.
 * `answered` is told once the node's verification data arrives: from then on what is left is its check.
 */
export async function runTrial(client: EngineClient, chain: DeploymentReads | null, floor: SignerFloorWatch, answered: () => void): Promise<TrialEnd> {
  try {
    // What each read of the trial names of the signer counts as that read ends, whatever it ends in.
    floor.hear(client);
    await client.attestation();
    answered();
    await client.readChainThrough(chain);
    const status = await client.verify();
    if (status.kind === "unverified") return { kind: "failed", reason: status.reason, notReady: status.notReady === true };
    // Its signed time is not the device's: nothing it signs can be judged until the trader corrects the clock.
    if (status.kind === "clock") return { kind: "held", stage: "clock", reason: null };
    // With no wallet no verdict reads the vault, so an attested node is the best a visit without one can have; it reads, and never signs. With one, the wallet could not read the vault.
    if (status.kind === "attested" && chain !== null) return { kind: "held", stage: "unread", reason: status.why };
    const said = await signedAnswer(client);
    // Each client judges the signer from its own first check, so the floor, the node in use's own word included, is held here, with a wallet or not.
    const behind = floor.lags(said, chain !== null && status.kind === "verified");
    return behind === null ? { kind: "trusted" } : { kind: "held", stage: "refused", reason: behind };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : "The server did not respond.", error, notReady: notReady(error) };
  }
}
