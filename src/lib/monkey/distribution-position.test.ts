import { describe, expect, it } from "vitest";

import type { DistributionProof } from "../engine/stats-types";
import { distributionPosition } from "./actions";

const proof = (entitled: bigint, seq = 40): DistributionProof => ({ seq, root: `0x${"11".repeat(32)}`, account: "0x00a1", entitled: entitled.toString(), siblings: [] });

describe("distributionPosition", () => {
  it("names nothing claimable before the node holds a proof, and keeps what the vault says it has paid", () => {
    expect(distributionPosition(null, null)).toEqual({ accrued: 0n, claimed: null, checkpoint: "unknown", claimable: 0n });
    expect(distributionPosition(null, { distributionsClaimed: 5n, latestSeq: 40 })).toEqual({ accrued: 0n, claimed: 5n, checkpoint: "unknown", claimable: 0n });
  });

  it("reads the vault's paid amount as what has been claimed, and its checkpoint seq against the proof's", () => {
    expect(distributionPosition(proof(900n), null)).toEqual({ accrued: 900n, claimed: null, checkpoint: "unknown", claimable: 0n });
    expect(distributionPosition(proof(900n), { distributionsClaimed: 400n, latestSeq: 39 })).toEqual({ accrued: 900n, claimed: 400n, checkpoint: "waiting", claimable: 0n });
    expect(distributionPosition(proof(900n), { distributionsClaimed: 400n, latestSeq: 40 })).toEqual({ accrued: 900n, claimed: 400n, checkpoint: "posted", claimable: 500n });
    expect(distributionPosition(proof(900n), { distributionsClaimed: 400n, latestSeq: 41 })).toEqual({ accrued: 900n, claimed: 400n, checkpoint: "superseded", claimable: 0n });
  });

  it("offers nothing once the vault has paid all of it", () => {
    expect(distributionPosition(proof(900n), { distributionsClaimed: 900n, latestSeq: 40 })).toEqual({ accrued: 900n, claimed: 900n, checkpoint: "posted", claimable: 0n });
  });
});
