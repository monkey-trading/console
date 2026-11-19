/**
 * The vault's exit over an EIP-1193 provider: its reads, the check of a proof by the deployed
 * `ExitVerifier` (monkey-trading/console#36), and the exit's transactions. Nothing here needs the
 * node, and every read is the wallet's own, so a value is as good as the chain the wallet reads.
 */

import { decodeAbiParameters, encodeFunctionData, type Hex } from "viem";

import { approvalArgs, EXIT_STAKING, EXIT_VAULT, EXIT_VERIFIER, PENDING_DEPOSIT_LEAF, previewArgs, queuedArgs, receiptLeaf, termsArgs, UNFINALISED_CREDIT_LEAF } from "./exit-abi";
import { exitPaidIn, stepAction, stepCalldata } from "./exit-calldata";
import { verifierRefusal } from "./exit-refusal";
import type { ExitCheck, ExitClaimFacts, ExitPendingProof, ExitProof, ExitStep, ExitWallet, VaultExitFacts } from "./exit-types";
import { isRevert } from "./provider-errors";
import { hexOf, type Eip1193Provider, type WalletChain } from "./provider-wallet";
import { WALLET_READ_MS, withinMs } from "./serialized-provider";
import type { Address } from "./types";
import type { Progress } from "./wallet";

/** A call with no target runs this as creation code, which returns the block's timestamp: `TIMESTAMP PUSH1 0 MSTORE PUSH1 32 PUSH1 0 RETURN`. */
const BLOCK_TIMESTAMP: Hex = "0x4260005260206000f3";
/** A work bound on one scan of the deposits past the exit's cursor. The vault refuses deposits once checkpoints are stale, so the span is what came in before that. */
const DEPOSIT_SCAN = 1_024;

type SendVault = (data: Hex, action: string, progress: Progress) => Promise<string>;

export class ProviderExit implements ExitWallet {
  private verifier: Hex | null = null;
  /** The two immutables of the vault's exit schedule, read once. */
  private schedule: { exitPeriod: number; claimWindow: number } | null = null;
  /** The approvals a finalized block shows paid, which no reorganisation can undo, so they are not asked about again. */
  private readonly finallyPaid = new Set<number>();
  /** The span of deposits from the exit's cursor on, fixed once the exit has started, as the vault takes no deposit after it. */
  private span: { cursor: number; end: number; complete: boolean } | null = null;
  /** Each deposit's payer and amount read so far. */
  private readonly depositRecords = new Map<number, { payer: string; amount: bigint }>();

  constructor(private readonly address: Address, private readonly chain: WalletChain, private readonly provider: Eip1193Provider, private readonly sendVault: SendVault) {}

  /** A background read: the wallet is not asked to switch chains, and the read is refused on another one. */
  private async onChain(): Promise<void> {
    const current = Number(await withinMs(this.provider, { method: "eth_chainId" }, WALLET_READ_MS));
    if (current !== this.chain.chainId) throw new Error(`your wallet is connected to chain ${current}, not chain ${this.chain.chainId}`);
  }

  private async call(to: string, data: Hex, block: "latest" | "finalized" = "latest"): Promise<Hex> {
    return hexOf(await withinMs(this.provider, { method: "eth_call", params: [{ to, data }, block] }, WALLET_READ_MS));
  }

  private async bool(to: string, data: Hex): Promise<boolean> {
    const [value] = decodeAbiParameters([{ type: "bool" }], await this.call(to, data));
    return value;
  }

  /** A `uint64` or `uint256` answer: both take one word. */
  private async uint(to: string, data: Hex): Promise<bigint> {
    const [value] = decodeAbiParameters([{ type: "uint256" }], await this.call(to, data));
    return value;
  }

  /** The vault's one-word answer at a finalized block; null when the wallet cannot say, as it reads no such block or the vault was not deployed by then, which only costs a proof being kept. */
  private async finalWord(data: Hex): Promise<bigint | null> {
    try {
      const [value] = decodeAbiParameters([{ type: "uint256" }], await this.call(this.chain.vault, data, "finalized"));
      return value;
    } catch {
      return null;
    }
  }

  /** The chain's own clock. A WalletConnect session allows only the methods the console asks of it, which do not read blocks, so the clock falls back to a call that returns the block's timestamp. */
  private async chainSeconds(): Promise<number> {
    try {
      const block = await withinMs(this.provider, { method: "eth_getBlockByNumber", params: ["latest", false] }, WALLET_READ_MS);
      return Number(hexOf(typeof block === "object" && block !== null && "timestamp" in block ? block.timestamp : undefined));
    } catch {
      const answer = hexOf(await withinMs(this.provider, { method: "eth_call", params: [{ data: BLOCK_TIMESTAMP }, "latest"] }, WALLET_READ_MS));
      const [seconds] = decodeAbiParameters([{ type: "uint256" }], answer);
      return Number(seconds);
    }
  }

  async facts(): Promise<VaultExitFacts> {
    await this.onChain();
    const { vault } = this.chain;
    const seconds = async (functionName: "exitStartedAt" | "latestSeq" | "lastCheckpointAt" | "exitPeriod" | "claimWindow") => Number(await this.uint(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName })));
    const exitStartedAt = await seconds("exitStartedAt");
    const hasCheckpoint = await this.bool(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "hasCheckpoint" }));
    const latestSeq = await seconds("latestSeq");
    const latestRoot = await this.latestRoot();
    const lastCheckpointAt = await seconds("lastCheckpointAt");
    this.schedule ??= { exitPeriod: await seconds("exitPeriod"), claimWindow: await seconds("claimWindow") };
    const chainNow = await this.chainSeconds();
    await this.onChain();
    return { hasCheckpoint, latestSeq, latestRoot, lastCheckpointAt, exitStartedAt, chainNow, ...this.schedule };
  }

  private async latestRoot(): Promise<string> {
    return (await this.call(this.chain.vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "latestRoot" }))).toLowerCase();
  }

  /** The verifier the vault deployed, which never changes. */
  private async verifierAddress(): Promise<Hex> {
    if (this.verifier === null) {
      const [address] = decodeAbiParameters([{ type: "address" }], await this.call(this.chain.vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "exitVerifier" })));
      this.verifier = address;
    }
    return this.verifier;
  }

  /**
   * Error cases:
   * - a read fails or the wallet moves chain; a verifier that refuses, by answering false or by
   *   reverting `previewClaim`, is an `ok: false` outcome, whose reason names the error it reverted with
   */
  async check(proof: ExitProof, root: string): Promise<ExitCheck> {
    await this.onChain();
    const verifier = await this.verifierAddress();
    const account = hexOf(this.address);
    const bytes = hexOf(root);
    const proves = (data: Hex) => this.bool(verifier, data);
    const refused = (what: string): ExitCheck => ({ ok: false, reason: `the vault's snapshot does not confirm its ${what}` });
    if (!(await proves(encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "provesTerms", args: [bytes, ...termsArgs(proof.terms)] })))) return refused("exit terms");
    let accountClaim = 0n;
    if (proof.account !== null) {
      try {
        accountClaim = await this.previewRead(verifier, root, proof);
      } catch (error) {
        if (!isRevert(error)) throw error;
        return { ok: false, reason: verifierRefusal("balance and positions", error) };
      }
    }
    const paidApprovals: number[] = [];
    for (const held of proof.approvals) {
      if (await this.paid(account, held.approval.nonce)) {
        paidApprovals.push(held.approval.nonce);
        continue;
      }
      if (!(await proves(encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "provesApproval", args: [bytes, ...approvalArgs(held)] })))) return refused(`withdrawal ${held.approval.nonce}`);
    }
    for (const held of proof.queued) {
      if (!(await proves(encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "provesQueued", args: [bytes, ...queuedArgs(held)] })))) return refused(`queued withdrawal ${held.queued.requested_seq}`);
    }
    let distributionOwed = 0n;
    let finalDistributionOwed = 0n;
    if (proof.distribution !== null) {
      const entitled = BigInt(proof.distribution.entitled);
      if (!(await proves(encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "provesDistribution", args: [bytes, account, entitled, proof.distribution.siblings.map(hexOf)] })))) return refused("distribution");
      const claimed = encodeFunctionData({ abi: EXIT_VAULT, functionName: "distributionsClaimed", args: [account] });
      const paid = await this.uint(this.chain.vault, claimed);
      distributionOwed = entitled > paid ? entitled - paid : 0n;
      const finalPaid = paid === 0n ? 0n : ((await this.finalWord(claimed)) ?? 0n);
      finalDistributionOwed = entitled > finalPaid ? entitled - finalPaid : 0n;
    }
    for (const held of proof.pending_deposits) {
      if (!(await this.receipt(verifier, root, held)).proven) return refused(`pending deposit ${held.deposit.deposit_id}`);
    }
    await this.onChain();
    return { ok: true, paidApprovals, accountClaim, distributionOwed, finalPaidApprovals: paidApprovals.filter((nonce) => this.finallyPaid.has(nonce)), finalDistributionOwed };
  }

  /** The verifier's `previewClaim` of `proof`'s account, which a revert refuses. */
  private previewRead(verifier: Hex, root: string, proof: ExitProof): Promise<bigint> {
    return proof.account === null ? Promise.resolve(0n) : this.uint(verifier, encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "previewClaim", args: previewArgs(root, proof.account, proof.unfinalised_credits) }));
  }

  /**
   * Error cases:
   * - a read fails or the wallet moves chain; a verifier that reverts is a null answer
   */
  async preview(proof: ExitProof, root: string): Promise<bigint | null> {
    await this.onChain();
    const verifier = await this.verifierAddress();
    try {
      return await this.previewRead(verifier, root, proof);
    } catch (error) {
      if (!isRevert(error)) throw error;
      return null;
    }
  }

  /** Whether the vault shows approval `nonce` paid at the chain's head; a wallet that cannot read a finalized block only costs the read being asked again. */
  private async paid(account: Hex, nonce: number): Promise<boolean> {
    if (this.finallyPaid.has(nonce)) return true;
    const data = encodeFunctionData({ abi: EXIT_VAULT, functionName: "usedNonces", args: [account, BigInt(nonce)] });
    if (!(await this.bool(this.chain.vault, data))) return false;
    if (((await this.finalWord(data)) ?? 0n) !== 0n) this.finallyPaid.add(nonce);
    return true;
  }

  /** Deposit `id`'s payer and amount on the vault. Only an exit's reads ask, and it takes no deposit after it starts, so one read of each serves. */
  private async depositRecord(id: number): Promise<{ payer: string; amount: bigint }> {
    let record = this.depositRecords.get(id);
    if (record === undefined) {
      const [payer, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint96" }], await this.call(this.chain.vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "depositRecords", args: [BigInt(id)] })));
      record = { payer: payer.toLowerCase(), amount };
      this.depositRecords.set(id, record);
    }
    return record;
  }

  /** The verifier's word on a pending deposit's receipt at `root`: whether it proves, and whether the vault's record of its deposit has its account, payer and amount, as `refundReceipt` compares them: a reorganisation can put another deposit at its id. */
  private async receipt(verifier: Hex, root: string, held: ExitPendingProof, kind = PENDING_DEPOSIT_LEAF): Promise<{ proven: boolean; matched: boolean }> {
    const answer = await this.call(verifier, encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "provesReceipt", args: [hexOf(root), receiptLeaf(held), kind] }));
    const [proven, matched] = decodeAbiParameters([{ type: "bool" }, { type: "bool" }], answer);
    return { proven, matched };
  }

  /** The account's deposits the exit root does not hold, which `refundDeposit` takes by id alone: from the exit's cursor on, and the gaps below it that `proof` names. */
  private async scanUnheld(proof: ExitProof | null): Promise<{ deposits: { id: number; amount: bigint }[]; complete: boolean }> {
    const { vault } = this.chain;
    if (this.span === null) {
      const cursor = Number(await this.uint(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "exitDepositCursor" })));
      const count = Number(await this.uint(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "depositCount" })));
      this.span = { cursor, end: Math.min(count, cursor + DEPOSIT_SCAN), complete: count <= cursor + DEPOSIT_SCAN };
    }
    const { cursor, end, complete } = this.span;
    const ids = [...(proof?.terms.terms.gaps ?? []).filter((id) => id < cursor), ...Array.from({ length: Math.max(end - cursor, 0) }, (_, index) => cursor + index)];
    const deposits: { id: number; amount: bigint }[] = [];
    for (const id of ids) {
      const record = await this.depositRecord(id);
      if (record.payer === this.address.toLowerCase()) deposits.push({ id, amount: record.amount });
    }
    return { deposits, complete };
  }

  async claims(proof: ExitProof | null): Promise<ExitClaimFacts> {
    await this.onChain();
    const { vault } = this.chain;
    const account = hexOf(this.address);
    const scanned = await this.scanUnheld(proof);
    const unheld: { id: number; amount: bigint }[] = [];
    for (const deposit of scanned.deposits) if (!(await this.bool(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "depositRefunded", args: [BigInt(deposit.id)] })))) unheld.push(deposit);
    const queuedRegistered: number[] = [];
    for (const { queued } of proof?.queued ?? []) if (await this.bool(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "exitQueuedRegistered", args: [BigInt(queued.requested_seq)] }))) queuedRegistered.push(queued.requested_seq);
    const approvalsUsed: number[] = [];
    for (const { approval } of proof?.approvals ?? []) if (await this.paid(account, approval.nonce)) approvalsUsed.push(approval.nonce);
    const verifier = await this.verifierAddress();
    const refunded: number[] = [];
    const mismatched: number[] = [];
    const receiptRefunds: ExitClaimFacts["receiptRefunds"] = [];
    // A receipt the vault's records do not match refunds the vault's own deposit at its id to whoever paid it, which is worth offering when this account did.
    const unmatched = async (held: ExitPendingProof, leafKind: number): Promise<boolean> => {
      const id = held.deposit.deposit_id;
      if (proof === null || (await this.receipt(verifier, proof.root, held, leafKind)).matched) return false;
      const record = await this.depositRecord(id);
      if (record.payer === this.address.toLowerCase() && record.amount > 0n) receiptRefunds.push({ id, amount: record.amount, proof: held, leafKind });
      return true;
    };
    const refundedAt = (id: number) => this.bool(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "depositRefunded", args: [BigInt(id)] }));
    for (const held of proof?.pending_deposits ?? []) {
      const id = held.deposit.deposit_id;
      if (await refundedAt(id)) refunded.push(id);
      else if (await unmatched(held, PENDING_DEPOSIT_LEAF)) mismatched.push(id);
    }
    const creditsCounted: number[] = [];
    const creditsUnmatched: number[] = [];
    for (const held of proof?.unfinalised_credits ?? []) {
      const id = held.deposit.deposit_id;
      if (await this.bool(verifier, encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "creditCounted", args: [BigInt(id)] }))) creditsCounted.push(id);
      // Registering counts every credit, matched or not, and the vault's deposit behind an unmatched one stays refundable while claims register.
      if (!(await refundedAt(id)) && (await unmatched(held, UNFINALISED_CREDIT_LEAF))) creditsUnmatched.push(id);
    }
    return {
      accountRegistered: await this.bool(verifier, encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "exitRegistered", args: [account] })),
      distributionRegistered: await this.bool(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "exitDistributionRegistered", args: [account] })),
      queuedRegistered, approvalsUsed, refunded, mismatched, receiptRefunds, creditsUnmatched, creditsCounted,
      accountClaimed: await this.uint(verifier, encodeFunctionData({ abi: EXIT_VERIFIER, functionName: "exitClaimed", args: [account] })),
      exitClaim: await this.uint(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "exitClaims", args: [account] })),
      exitDistributionClaim: await this.uint(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "exitDistributionClaims", args: [account] })),
      distributionPaid: await this.uint(vault, encodeFunctionData({ abi: EXIT_VAULT, functionName: "distributionsClaimed", args: [account] })),
      unheld, unheldComplete: scanned.complete,
    };
  }

  async stakeHeld(): Promise<boolean> {
    const staking = this.chain.staking ?? null;
    if (staking === null) return false;
    await this.onChain();
    const account = hexOf(this.address);
    if ((await this.uint(staking, encodeFunctionData({ abi: EXIT_STAKING, functionName: "stakes", args: [account] }))) > 0n) return true;
    // `unstakes` answers two words, the amount first, and `uint` reads the first.
    return (await this.uint(staking, encodeFunctionData({ abi: EXIT_STAKING, functionName: "unstakes", args: [account] }))) > 0n;
  }

  async send(step: ExitStep, progress: Progress = () => undefined): Promise<{ hash: string; paid: bigint | null }> {
    const hash = await this.sendVault(stepCalldata(step, hexOf(this.address)), stepAction(step), progress);
    return { hash, paid: step.kind === "claim" ? await exitPaidIn(this.provider, this.chain.vault, this.address, hash) : null };
  }
}
