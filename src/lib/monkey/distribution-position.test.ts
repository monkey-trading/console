import { describe, expect, it } from "vitest";

import type { DistributionProof } from "../engine/stats-types";
import { carryAccrued } from "../engine/claim-standing";
import { distributionPosition } from "./actions";

const proof = (entitled: bigint, seq = 40): DistributionProof => ({ seq, root: `0x${"11".repeat(32)}`, account: "0x00a1", entitled: entitled.toString(), siblings: [] });

describe("distributionPosition", () => {
  it("names nothing claimable before the node holds a proof, and keeps what the vault says it has paid", () => {
    expect(distributionPosition(null, null)).toEqual({ accrued: 0n, awaiting: 0n, claimed: null, checkpoint: "unknown", claimable: 0n });
    expect(distributionPosition(null, { distributionsClaimed: 5n, latestSeq: 40 })).toEqual({ accrued: 0n, awaiting: 0n, claimed: 5n, checkpoint: "unknown", claimable: 0n });
  });

  it("reads the vault's paid amount as what has been claimed, and its checkpoint seq against the proof's", () => {
    expect(distributionPosition(proof(900n), null)).toEqual({ accrued: 900n, awaiting: 0n, claimed: null, checkpoint: "unknown", claimable: 0n });
    expect(distributionPosition(proof(900n), { distributionsClaimed: 400n, latestSeq: 39 })).toEqual({ accrued: 900n, awaiting: 0n, claimed: 400n, checkpoint: "waiting", claimable: 0n });
    expect(distributionPosition(proof(900n), { distributionsClaimed: 400n, latestSeq: 40 })).toEqual({ accrued: 900n, awaiting: 0n, claimed: 400n, checkpoint: "posted", claimable: 500n });
    expect(distributionPosition(proof(900n), { distributionsClaimed: 400n, latestSeq: 41 })).toEqual({ accrued: 900n, awaiting: 0n, claimed: 400n, checkpoint: "posted", claimable: 500n });
  });

  it("offers nothing once the vault has paid all of it", () => {
    expect(distributionPosition(proof(900n), { distributionsClaimed: 900n, latestSeq: 40 })).toEqual({ accrued: 900n, awaiting: 0n, claimed: 900n, checkpoint: "posted", claimable: 0n });
  });
});

describe("distributionPosition against a node that says what is newest", () => {
  /** The proof at checkpoint `seq` naming `entitled`, while the node's newest checkpoint names `newest`. */
  const answered = (entitled: bigint, newest: bigint, seq: number) => ({ ...proof(entitled, seq), accepted_seq: seq, newest_seq: 44, newest_entitled: newest.toString(), claimable: true });

  it("shows what the newest checkpoint names as accrued while the vault lags, and claims only what the proof pays", () => {
    const lagging = distributionPosition(answered(900n, 1_400n, 40), { distributionsClaimed: 400n, latestSeq: 40 });
    expect(lagging).toEqual({ accrued: 1_400n, awaiting: 500n, claimed: 400n, checkpoint: "posted", claimable: 500n });
  });

  it("has nothing awaiting once the vault has reached the newest checkpoint", () => {
    const caughtUp = distributionPosition({ ...proof(1_400n, 44), accepted_seq: 44, newest_seq: 44, newest_entitled: "1400", claimable: true }, { distributionsClaimed: 400n, latestSeq: 44 });
    expect(caughtUp).toEqual({ accrued: 1_400n, awaiting: 0n, claimed: 400n, checkpoint: "posted", claimable: 1_000n });
  });

  it("does not let accrued fall when an answer moves back to the older checkpoint the vault has just reached", () => {
    const first = { ...proof(1_400n, 44), accepted_seq: null, newest_seq: 44, newest_entitled: "1400", claimable: false };
    const later = carryAccrued(first, answered(900n, 1_400n, 40));
    const before = distributionPosition(first, { distributionsClaimed: 400n, latestSeq: 40 });
    const after = distributionPosition(later, { distributionsClaimed: 400n, latestSeq: 40 });
    expect(before.accrued).toBe(1_400n);
    expect(before).toMatchObject({ checkpoint: "waiting", claimable: 0n });
    expect(after).toEqual({ accrued: 1_400n, awaiting: 500n, claimed: 400n, checkpoint: "posted", claimable: 500n });
    // Even an older answer that understates the newest checkpoint cannot lower it.
    expect(distributionPosition(carryAccrued(first, answered(900n, 900n, 40)), { distributionsClaimed: 400n, latestSeq: 40 }).accrued).toBe(1_400n);
  });

  it("takes the node's claimable flag over the vault's latest seq, in both directions", () => {
    const unaccepted = { ...proof(1_400n, 44), accepted_seq: 40, newest_seq: 44, newest_entitled: "1400", claimable: false };
    expect(distributionPosition(unaccepted, { distributionsClaimed: 400n, latestSeq: 44 })).toMatchObject({ checkpoint: "waiting", claimable: 0n });
    const accepted = { ...unaccepted, claimable: true };
    // A new checkpoint arrives while the wallet's read is behind: the claim stays offered, and unread vault records change nothing.
    expect(distributionPosition(accepted, { distributionsClaimed: 400n, latestSeq: 39 })).toMatchObject({ checkpoint: "posted", claimable: 1_000n });
    expect(distributionPosition(accepted, null)).toMatchObject({ checkpoint: "posted", claimed: null, claimable: 0n });
  });

  it("falls back to the vault's latest seq against a node that does not say, and calls the pair unknown until it is read", () => {
    expect(distributionPosition(proof(900n, 41), { distributionsClaimed: 400n, latestSeq: 40 }).checkpoint).toBe("waiting");
    expect(distributionPosition(proof(900n, 41), { distributionsClaimed: 400n, latestSeq: 41 })).toMatchObject({ checkpoint: "posted", claimable: 500n });
    expect(distributionPosition(proof(900n, 41), null).checkpoint).toBe("unknown");
  });

  it("works as before against a node without the fields", () => {
    expect(distributionPosition(proof(900n), { distributionsClaimed: 400n, latestSeq: 40 })).toEqual({ accrued: 900n, awaiting: 0n, claimed: 400n, checkpoint: "posted", claimable: 500n });
  });
});
