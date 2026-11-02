/**
 * The vault's exit calls and the verifier's structs, as `contracts/src/Vault.sol` and
 * `contracts/src/ExitVerifier.sol` declare them, and an exit proof in the vault's raw units:
 * `crates/node/src/exit.rs` builds the same calls from a published log. An amount's raw unit is the
 * engine's nine-place `Fixed`, except an approval's, in USDC base units as its leaf hashes it.
 */

import { parseAbi, stringToHex, type Hex } from "viem";

import { fixedFromWire } from "../fixed";
import { approvalUnits } from "./exit-proof";
import type { ExitAccountProof, ExitApprovalProof, ExitPendingProof, ExitQueuedProof, ExitQuoteCurrency, ExitTermsProof } from "./exit-types";
import { hexOf } from "./provider-wallet";

const STRUCTS = [
  "struct AccountState { int128 balance; int128 unfinalisedDeposits; uint64 withdrawalNonce; int64 toxicityBps; uint32 openPositions; int128 toxicityFraction; int128 toxicityHistory; bytes32[] siblings; }",
  "struct PositionState { uint32 market; int128 qty; int128 entry; bytes32[] siblings; }",
  "struct MarketState { uint32 market; bool marked; int128 mark; uint8 quoteCurrency; uint32 fxMarket; bool fxMarked; int128 fxMark; int128 clientQty; int128 clientCost; bytes32 stateHash; bytes32[] siblings; }",
  "struct ExitTerms { uint64 depositCursor; uint64 depositBase; int128 pending; int128 held; int128 unheld; int128 heldReceipts; uint64[] gaps; }",
  "struct QueuedWithdrawal { address account; int128 amount; int128 remaining; uint64 requestedSeq; uint64 ticket; }",
  "struct PendingDeposit { uint64 depositId; address account; address payer; int128 amount; }",
  "struct Approval { address account; uint256 amount; uint64 nonce; uint64 approvedSeq; }",
] as const;

export const EXIT_VERIFIER = parseAbi([
  ...STRUCTS,
  "function accountClaim(bytes32 root, address account, AccountState state, PositionState[] positions, MarketState[] markets) pure returns (uint256)",
  "function provesTerms(bytes32 root, ExitTerms terms, bytes32[] siblings) pure returns (bool)",
  "function provesQueued(bytes32 root, QueuedWithdrawal queued, bytes32[] siblings) pure returns (bool)",
  "function provesPending(bytes32 root, bytes chainRef, PendingDeposit pending, bytes32[] siblings) pure returns (bool)",
  "function provesApproval(bytes32 root, Approval approval, bytes32[] siblings) pure returns (bool)",
  "function provesDistribution(bytes32 root, address account, uint256 entitled, bytes32[] siblings) pure returns (bool)",
]);

export const EXIT_VAULT = parseAbi([
  ...STRUCTS,
  "function exitVerifier() view returns (address)",
  "function hasCheckpoint() view returns (bool)",
  "function latestSeq() view returns (uint64)",
  "function latestRoot() view returns (bytes32)",
  "function lastCheckpointAt() view returns (uint64)",
  "function exitPeriod() view returns (uint64)",
  "function claimWindow() view returns (uint64)",
  "function exitStartedAt() view returns (uint64)",
  "function usedNonces(address account, uint64 nonce) view returns (bool)",
  "function depositCount() view returns (uint256)",
  "function exitDepositCursor() view returns (uint64)",
  "function depositRecords(uint256 id) view returns (address payer, uint96 amount)",
  "function distributionsClaimed(address account) view returns (uint256)",
  "function exitAccountRegistered(address account) view returns (bool)",
  "function exitDistributionRegistered(address account) view returns (bool)",
  "function exitQueuedRegistered(uint64 requestedSeq) view returns (bool)",
  "function depositRefunded(uint256 id) view returns (bool)",
  "function exitClaims(address account) view returns (uint256)",
  "function exitDistributionClaims(address account) view returns (uint256)",
  "function startExit(ExitTerms terms, bytes32[] siblings)",
  "function registerExit(address account, AccountState state, PositionState[] positions, MarketState[] markets)",
  "function registerExitWithdrawal(Approval approval, bytes32[] siblings)",
  "function registerExitQueued(QueuedWithdrawal queued, bytes32[] siblings)",
  "function registerExitDistribution(address account, uint256 entitled, bytes32[] siblings)",
  "function refundPendingDeposit(bytes chainRef, PendingDeposit pending, bytes32[] siblings)",
  "function refundDeposit(uint256 id)",
  "function claimExit(address account) returns (uint256)",
  "event ExitPaid(address indexed account, uint256 amount)",
]);

export const EXIT_STAKING = parseAbi([
  "function stakes(address account) view returns (uint256)",
  "function unstakes(address account) view returns (uint256 amount, uint256 claimableAt)",
]);

/** The zero address, which a pending deposit's leaf holds for no payer. */
const NO_ADDRESS: Hex = "0x0000000000000000000000000000000000000000";

const hexes = (values: readonly string[]) => values.map(hexOf);
const raw = (value: string | undefined) => fixedFromWire(value ?? "0");

/** `QuoteCurrency`, as a market's leaf holds it: 0 for USD, 1 for EUR, 2 for GBP, 3 for JPY. */
function currencyOf(quote: ExitQuoteCurrency): { quoteCurrency: number; fxMarket: number } {
  switch (quote.currency) {
    case "usd": return { quoteCurrency: 0, fxMarket: 0 };
    case "eur": return { quoteCurrency: 1, fxMarket: quote.fx_market };
    case "gbp": return { quoteCurrency: 2, fxMarket: quote.fx_market };
    case "jpy": return { quoteCurrency: 3, fxMarket: quote.fx_market };
    default: return quote satisfies never;
  }
}

/** `ExitVerifier.ExitTerms` and its siblings. */
export function termsArgs({ terms, siblings }: ExitTermsProof) {
  return [
    { depositCursor: BigInt(terms.deposit_cursor), depositBase: BigInt(terms.deposit_base), pending: raw(terms.pending), held: raw(terms.held), unheld: raw(terms.unheld), heldReceipts: raw(terms.held_receipts), gaps: terms.gaps.map(BigInt) },
    hexes(siblings),
  ] as const;
}

/** The account, state, positions and markets `registerExit` and `accountClaim` take. */
export function accountArgs(proof: ExitAccountProof) {
  const { leaf } = proof;
  return [
    hexOf(proof.account),
    {
      balance: raw(leaf.balance), unfinalisedDeposits: raw(leaf.unfinalised_deposits), withdrawalNonce: BigInt(leaf.withdrawal_nonce), toxicityBps: BigInt(leaf.toxicity_bps), openPositions: leaf.open_positions,
      toxicityFraction: raw(leaf.toxicity_fraction), toxicityHistory: raw(leaf.toxicity_history), siblings: hexes(proof.siblings),
    },
    proof.positions.map((held) => ({ market: held.market, qty: raw(held.position.qty), entry: raw(held.position.entry), siblings: hexes(held.siblings) })),
    proof.markets.map((market) => ({
      market: market.market, marked: market.leaf.mark !== null, mark: raw(market.leaf.mark ?? "0"), ...currencyOf(market.leaf.quote_currency),
      fxMarked: market.leaf.fx_mark !== null, fxMark: raw(market.leaf.fx_mark ?? "0"), clientQty: raw(market.leaf.client_qty), clientCost: raw(market.leaf.client_cost), stateHash: hexOf(market.leaf.state_hash), siblings: hexes(market.siblings),
    })),
  ] as const;
}

/**
 * `ExitVerifier.Approval` and its siblings.
 * Error cases:
 * - the amount is not whole USDC base units; `parseExitProof` refused any such proof
 */
export function approvalArgs({ approval, siblings }: ExitApprovalProof) {
  const amount = approvalUnits(approval.amount);
  if (amount === null) throw new Error(`Approval ${approval.nonce} is not a whole number of USDC base units.`);
  return [{ account: hexOf(approval.account), amount, nonce: BigInt(approval.nonce), approvedSeq: BigInt(approval.approved_seq) }, hexes(siblings)] as const;
}

/** `ExitVerifier.QueuedWithdrawal` and its siblings. */
export function queuedArgs({ queued, siblings }: ExitQueuedProof) {
  return [{ account: hexOf(queued.account), amount: raw(queued.amount), remaining: raw(queued.remaining), requestedSeq: BigInt(queued.requested_seq), ticket: BigInt(queued.ticket ?? 0) }, hexes(siblings)] as const;
}

/** The reference's UTF-8 bytes, `ExitVerifier.PendingDeposit` and its siblings. */
export function pendingArgs({ chain_ref: chainRef, deposit, siblings }: ExitPendingProof) {
  return [
    stringToHex(chainRef),
    { depositId: BigInt(deposit.deposit_id), account: hexOf(deposit.account ?? NO_ADDRESS), payer: hexOf(deposit.payer ?? NO_ADDRESS), amount: raw(deposit.amount) },
    hexes(siblings),
  ] as const;
}
