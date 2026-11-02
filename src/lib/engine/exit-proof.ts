/**
 * Reads an exit proof from JSON that is not yet trusted: an imported file, a stored copy, or the
 * node's answer. It only proves the shape; the vault's `ExitVerifier` judges the contents.
 */

import { parseFixed } from "../fixed";
import { USDC_UNIT } from "../vault";
import type { ExitAccountProof, ExitApprovalProof, ExitDistributionProof, ExitPendingProof, ExitProof, ExitQueuedProof, ExitQuoteCurrency, ExitTermsProof } from "./exit-types";
import type { Address } from "./types";

/** The state tree's depth (`StateTree.proves`): no proof has more siblings. */
const MAX_SIBLINGS = 256;
/** The vault's bound on the gaps the terms may name (`MAX_EXIT_GAPS`). */
const MAX_GAPS = 64;
/** A work bound on each list of proofs, far past what one account holds, so a crafted file cannot keep the wallet reading for good. */
const MAX_ITEMS = 65_536;
/** `int128`, which the vault's raw amounts are. */
const INT128_LIMIT = 1n << 127n;

const HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UNITS = /^\d{1,78}$/;

/** Why a value is not an exit proof, written to end a sentence for the user. */
export class ExitProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExitProofError";
  }
}

const refuse = (path: string, what: string): never => {
  throw new ExitProofError(`${path} ${what}`);
};

function object(value: unknown, path: string): Record<string, unknown> {
  // Narrowed to a non-null, non-array object, whose values are unknown until each is read below.
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : refuse(path, "is not an object");
}

function whole(value: unknown, path: string): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : refuse(path, "is not a whole number");
}

/** An `i64` as JSON gives it: a safe integer, negative or not. */
const signedInteger = (value: unknown, path: string): number => (typeof value === "number" && Number.isSafeInteger(value) ? value : refuse(path, "is not an integer"));

function fixed(value: unknown, path: string): string {
  const parsed = typeof value === "string" ? parseFixed(value) : null;
  if (parsed === null || parsed >= INT128_LIMIT || parsed < -INT128_LIMIT) return refuse(path, "is not an amount");
  return String(value);
}

const optionalFixed = (value: unknown, path: string): string => (value === undefined ? "0" : fixed(value, path));

function hash(value: unknown, path: string): string {
  return typeof value === "string" && HASH.test(value) ? value.toLowerCase() : refuse(path, "is not a 32-byte hash");
}

function address(value: unknown, path: string): Address {
  return typeof value === "string" && ADDRESS.test(value) ? value.toLowerCase() : refuse(path, "is not an address");
}

function list(value: unknown, path: string, max = MAX_ITEMS): unknown[] {
  if (!Array.isArray(value)) return refuse(path, "is not a list");
  return value.length <= max ? value : refuse(path, "is longer than any proof holds");
}

const siblings = (value: unknown, path: string): string[] => list(value, path, MAX_SIBLINGS).map((item, index) => hash(item, `${path}[${index}]`));

const mapped = <T>(value: unknown, path: string, read: (item: unknown, at: string) => T): T[] => list(value, path).map((item, index) => read(item, `${path}[${index}]`));

/** The `seq` and `root` every part of a proof names, which must be the whole proof's. */
function stamp(fields: Record<string, unknown>, path: string, seq: number, root: string): { seq: number; root: string } {
  if (whole(fields.seq, `${path}.seq`) !== seq || hash(fields.root, `${path}.root`) !== root) return refuse(path, "is for another checkpoint than the rest of the proof");
  return { seq, root };
}

function quoteCurrency(value: unknown, path: string): ExitQuoteCurrency {
  const fields = object(value, path);
  if (fields.currency === "usd") return { currency: "usd" };
  if (fields.currency === "eur" || fields.currency === "gbp" || fields.currency === "jpy") return { currency: fields.currency, fx_market: whole(fields.fx_market, `${path}.fx_market`) };
  return refuse(path, "is not a quote currency");
}

function terms(value: unknown, seq: number, root: string): ExitTermsProof {
  const fields = object(value, "terms");
  const leaf = object(fields.terms, "terms.terms");
  return {
    ...stamp(fields, "terms", seq, root),
    terms: {
      deposit_cursor: whole(leaf.deposit_cursor, "terms.deposit_cursor"), deposit_base: whole(leaf.deposit_base, "terms.deposit_base"),
      pending: fixed(leaf.pending, "terms.pending"), held: fixed(leaf.held, "terms.held"), unheld: fixed(leaf.unheld, "terms.unheld"), held_receipts: fixed(leaf.held_receipts, "terms.held_receipts"),
      gaps: list(leaf.gaps, "terms.gaps", MAX_GAPS).map((gap, index) => whole(gap, `terms.gaps[${index}]`)),
    },
    siblings: siblings(fields.siblings, "terms.siblings"),
  };
}

function account(value: unknown, seq: number, root: string): ExitAccountProof {
  const fields = object(value, "account");
  const leaf = object(fields.leaf, "account.leaf");
  return {
    ...stamp(fields, "account", seq, root),
    account: address(fields.account, "account.account"),
    leaf: {
      balance: fixed(leaf.balance, "account.balance"), unfinalised_deposits: optionalFixed(leaf.unfinalised_deposits, "account.unfinalised_deposits"),
      withdrawal_nonce: whole(leaf.withdrawal_nonce, "account.withdrawal_nonce"), toxicity_bps: signedInteger(leaf.toxicity_bps, "account.toxicity_bps"), open_positions: whole(leaf.open_positions, "account.open_positions"),
      toxicity_fraction: optionalFixed(leaf.toxicity_fraction, "account.toxicity_fraction"), toxicity_history: optionalFixed(leaf.toxicity_history, "account.toxicity_history"),
    },
    siblings: siblings(fields.siblings, "account.siblings"),
    positions: mapped(fields.positions, "account.positions", (item, at) => {
      const held = object(item, at);
      const position = object(held.position, `${at}.position`);
      return { market: whole(held.market, `${at}.market`), position: { qty: fixed(position.qty, `${at}.qty`), entry: fixed(position.entry, `${at}.entry`) }, siblings: siblings(held.siblings, `${at}.siblings`) };
    }),
    markets: mapped(fields.markets, "account.markets", (item, at) => {
      const market = object(item, at);
      const marketLeaf = object(market.leaf, `${at}.leaf`);
      return {
        market: whole(market.market, `${at}.market`),
        leaf: {
          mark: marketLeaf.mark === null ? null : fixed(marketLeaf.mark, `${at}.mark`), quote_currency: quoteCurrency(marketLeaf.quote_currency, `${at}.quote_currency`), fx_mark: marketLeaf.fx_mark === null ? null : fixed(marketLeaf.fx_mark, `${at}.fx_mark`),
          client_qty: fixed(marketLeaf.client_qty, `${at}.client_qty`), client_cost: fixed(marketLeaf.client_cost, `${at}.client_cost`), state_hash: hash(marketLeaf.state_hash, `${at}.state_hash`),
        },
        siblings: siblings(market.siblings, `${at}.siblings`),
      };
    }),
  };
}

function approval(value: unknown, at: string, seq: number, root: string): ExitApprovalProof {
  const fields = object(value, at);
  const leaf = object(fields.approval, `${at}.approval`);
  const amount = fixed(leaf.amount, `${at}.amount`);
  if (approvalUnits(amount) === null) return refuse(`${at}.amount`, "is not a positive whole number of USDC base units");
  return { ...stamp(fields, at, seq, root), approval: { account: address(leaf.account, `${at}.account`), amount, nonce: whole(leaf.nonce, `${at}.nonce`), approved_seq: whole(leaf.approved_seq, `${at}.approved_seq`) }, siblings: siblings(fields.siblings, `${at}.siblings`) };
}

function queued(value: unknown, at: string, seq: number, root: string): ExitQueuedProof {
  const fields = object(value, at);
  const leaf = object(fields.queued, `${at}.queued`);
  return {
    ...stamp(fields, at, seq, root),
    queued: { account: address(leaf.account, `${at}.account`), amount: fixed(leaf.amount, `${at}.amount`), remaining: fixed(leaf.remaining, `${at}.remaining`), requested_seq: whole(leaf.requested_seq, `${at}.requested_seq`), ticket: leaf.ticket === undefined ? 0 : whole(leaf.ticket, `${at}.ticket`) },
    siblings: siblings(fields.siblings, `${at}.siblings`),
  };
}

function distribution(value: unknown, seq: number, root: string): ExitDistributionProof {
  const fields = object(value, "distribution");
  const entitled = fields.entitled;
  if (typeof entitled !== "string" || !UNITS.test(entitled)) return refuse("distribution.entitled", "is not a whole number of USDC base units");
  return { ...stamp(fields, "distribution", seq, root), account: address(fields.account, "distribution.account"), entitled, siblings: siblings(fields.siblings, "distribution.siblings") };
}

function pending(value: unknown, at: string, seq: number, root: string): ExitPendingProof {
  const fields = object(value, at);
  const deposit = object(fields.deposit, `${at}.deposit`);
  if (typeof fields.chain_ref !== "string" || fields.chain_ref === "") return refuse(`${at}.chain_ref`, "is not a receipt's reference");
  return {
    ...stamp(fields, at, seq, root),
    chain_ref: fields.chain_ref,
    deposit: {
      deposit_id: whole(deposit.deposit_id, `${at}.deposit_id`), account: deposit.account === null ? null : address(deposit.account, `${at}.account`),
      payer: deposit.payer === null ? null : address(deposit.payer, `${at}.payer`), amount: fixed(deposit.amount, `${at}.amount`),
    },
    siblings: siblings(fields.siblings, `${at}.siblings`),
  };
}

/**
 * The exit proof `value` holds, normalized: lowercase hex, and each optional field the engine leaves
 * out at its zero. Fields it does not know are dropped.
 * Error cases:
 * - `value` is not an exit proof, or its parts name different checkpoints or accounts: `ExitProofError`
 */
export function parseExitProof(value: unknown): ExitProof {
  const fields = object(value, "the proof");
  const seq = whole(fields.seq, "seq");
  const root = hash(fields.root, "root");
  const proof: ExitProof = {
    seq, root,
    terms: terms(fields.terms, seq, root),
    account: fields.account === null ? null : account(fields.account, seq, root),
    approvals: mapped(fields.approvals, "approvals", (item, at) => approval(item, at, seq, root)),
    queued: mapped(fields.queued, "queued", (item, at) => queued(item, at, seq, root)),
    distribution: fields.distribution === null ? null : distribution(fields.distribution, seq, root),
    pending_deposits: mapped(fields.pending_deposits, "pending_deposits", (item, at) => pending(item, at, seq, root)),
  };
  exitProofAccount(proof);
  return proof;
}

/**
 * The account `proof` names, or null when nothing in it names one: every part must name the same.
 * Error cases:
 * - two parts name different accounts, or a pending deposit is the house's: `ExitProofError`
 */
export function exitProofAccount(proof: ExitProof): Address | null {
  const named = [
    proof.account?.account, proof.distribution?.account,
    ...proof.approvals.map((held) => held.approval.account), ...proof.queued.map((held) => held.queued.account),
    ...proof.pending_deposits.map((held) => held.deposit.account ?? refuse("a pending deposit", "is the house's, not an account's")),
  ].filter((name) => name !== undefined);
  const [first] = named;
  if (named.some((name) => name !== first)) return refuse("the proof", "names more than one account");
  return first ?? null;
}

/** An approval's amount in USDC base units, as `WithdrawalApproval::amount_usdc`; null unless it is a positive whole number of them. */
export function approvalUnits(amount: string): bigint | null {
  const raw = parseFixed(amount);
  return raw === null || raw <= 0n || raw % USDC_UNIT !== 0n ? null : raw / USDC_UNIT;
}

/** Whether a verified `proof`, with `accountClaim`, `distributionOwed` and the approvals the vault has paid, gives the account anything: nothing else is worth keeping or reading again. */
export function holdsAnything(proof: ExitProof, accountClaim: bigint, distributionOwed: bigint, paidApprovals: readonly number[]): boolean {
  return accountClaim > 0n || (proof.account?.positions.length ?? 0) > 0 || proof.approvals.some((held) => !paidApprovals.includes(held.approval.nonce)) || proof.queued.some((held) => (parseFixed(held.queued.remaining) ?? 0n) > 0n) || distributionOwed > 0n || proof.pending_deposits.length > 0;
}
