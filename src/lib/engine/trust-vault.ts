/** The vault's word through the connected wallet, as a check of the node reads it. */

import type { VaultFacts } from "./registry";

/** What a read of the vault came to: no wallet to read it through, the facts, or the reason it failed. */
type VaultRead = { kind: "none" } | { kind: "read"; facts: VaultFacts } | { kind: "failed"; reason: string };

/** The vault's facts through the connected wallet, from `read` (null with none); a failed read says why, and never counts as the vault's word. */
export async function readVault(read: Promise<VaultFacts> | null): Promise<VaultRead> {
  if (read === null) return { kind: "none" };
  try {
    return { kind: "read", facts: await read };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : "the read failed" };
  }
}
