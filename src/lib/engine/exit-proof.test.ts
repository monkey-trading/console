import { describe, expect, it } from "vitest";

import { approvalUnits, exitProofAccount, ExitProofError, holdsAnything, parseExitProof } from "./exit-proof";
import { ACCOUNT, emptyProof, fullProof, OTHER, rootAt } from "./exit-kit";

/** A copy of `fullProof(100)` as JSON, with each dotted path set to its value, or removed for undefined. */
function changed(changes: Record<string, unknown>): unknown {
  const proof: unknown = JSON.parse(JSON.stringify(fullProof(100)));
  for (const [path, value] of Object.entries(changes)) {
    const keys = path.split(".");
    const last = keys.pop() ?? "";
    // JSON just parsed from the fixture, walked along a path each test names.
    const parent = keys.reduce<Record<string, unknown>>((node, key) => node[key] as Record<string, unknown>, proof as Record<string, unknown>);
    if (value === undefined) delete parent[last];
    else parent[last] = value;
  }
  return proof;
}

describe("parseExitProof", () => {
  it("reads what the node serves, filling in what the engine leaves out at zero", () => {
    const parsed = parseExitProof(fullProof(100));
    expect(parsed.seq).toBe(100);
    expect(parsed.root).toBe(rootAt(100));
    expect(parsed.account?.leaf).toEqual({ balance: "5000", unfinalised_deposits: "0", withdrawal_nonce: 1, toxicity_bps: 0, open_positions: 1, toxicity_fraction: "0", toxicity_history: "0" });
    expect(parsed.queued[0]?.queued.ticket).toBe(7);
    expect(parsed.pending_deposits[0]?.chain_ref).toBe("0xfeed:1");
    expect(parseExitProof(emptyProof(100)).account).toBeNull();
  });

  it("gives a queued request a zero ticket when the engine leaves it out", () => {
    expect(parseExitProof(changed({ "queued.0.queued.ticket": undefined })).queued[0]?.queued.ticket).toBe(0);
  });

  it("lowercases hex, so a root compares with the chain's", () => {
    const upper = rootAt(100).toUpperCase().replace("0X", "0x");
    const parsed = parseExitProof(changed({
      root: upper, "terms.root": upper, "account.root": upper, "account.account": ACCOUNT.toUpperCase().replace("0X", "0x"),
      "approvals.0.root": upper, "queued.0.root": upper, "distribution.root": upper, "pending_deposits.0.root": upper,
    }));
    expect(parsed.root).toBe(rootAt(100));
    expect(parsed.account?.account).toBe(ACCOUNT);
  });

  it.each<[string, unknown, RegExp]>([
    ["not an object", 5, /is not an object/],
    ["null", null, /is not an object/],
    ["a list", [], /is not an object/],
    ["no seq", changed({ seq: undefined }), /seq is not a whole number/],
    ["a negative seq", changed({ seq: -1 }), /seq is not a whole number/],
    ["a seq past safe integers", changed({ seq: 2 ** 60 }), /seq is not a whole number/],
    ["a short root", changed({ root: "0x12" }), /root is not a 32-byte hash/],
    ["no terms", changed({ terms: null }), /terms is not an object/],
    ["terms at another checkpoint", changed({ "terms.seq": 99 }), /terms is for another checkpoint/],
    ["terms at another root", changed({ "terms.root": rootAt(99) }), /terms is for another checkpoint/],
    ["an amount that is not one", changed({ "account.leaf.balance": "lots" }), /account.balance is not an amount/],
    ["an amount past int128", changed({ "account.leaf.balance": "999999999999999999999999999999999" }), /account.balance is not an amount/],
    ["a sibling that is not a hash", changed({ "terms.siblings": ["0x12"] }), /terms.siblings\[0\] is not a 32-byte hash/],
    ["more siblings than the tree is deep", changed({ "terms.siblings": Array.from({ length: 257 }, () => rootAt(1)) }), /terms.siblings is longer/],
    ["more gaps than the vault takes", changed({ "terms.terms.gaps": Array.from({ length: 65 }, (_, i) => i) }), /terms.gaps is longer/],
    ["an unknown quote currency", changed({ "account.markets.0.leaf.quote_currency": { currency: "chf", fx_market: 2 } }), /is not a quote currency/],
    ["an approval of no whole USDC base unit", changed({ "approvals.0.approval.amount": "0.0000001" }), /amount is not a positive whole number/],
    ["a distribution that is not a count", changed({ "distribution.entitled": "1.5" }), /distribution.entitled is not a whole number/],
    ["an empty reference", changed({ "pending_deposits.0.chain_ref": "" }), /is not a receipt's reference/],
    ["a list that is not one", changed({ approvals: {} }), /approvals is not a list/],
    ["two accounts", changed({ "distribution.account": OTHER }), /names more than one account/],
    ["the house's pending deposit", changed({ "pending_deposits.0.deposit.account": null }), /is the house's/],
  ])("refuses %s", (_name, value, message) => {
    expect(() => parseExitProof(value)).toThrow(ExitProofError);
    expect(() => parseExitProof(value)).toThrow(message);
  });
});

describe("exitProofAccount", () => {
  it("names the account any part names, and none when nothing does", () => {
    expect(exitProofAccount(fullProof(100))).toBe(ACCOUNT);
    expect(exitProofAccount({ ...emptyProof(100), distribution: fullProof(100).distribution })).toBe(ACCOUNT);
    expect(exitProofAccount(emptyProof(100))).toBeNull();
  });
});

describe("approvalUnits", () => {
  it("reads whole USDC base units, and nothing else", () => {
    expect(approvalUnits("50")).toBe(50_000_000n);
    expect(approvalUnits("0.000001")).toBe(1n);
    expect(approvalUnits("0.0000001")).toBeNull();
    expect(approvalUnits("0")).toBeNull();
    expect(approvalUnits("-1")).toBeNull();
  });
});

describe("parseExitProof, of a list that repeats an id", () => {
  const { approvals, queued, pending_deposits: pending } = fullProof(100);
  it.each<[string, Record<string, unknown>, string]>([
    ["an approval", { approvals: [...approvals, ...approvals] }, "approvals[1] repeats an earlier entry"],
    ["a queued request", { queued: [...queued, ...queued] }, "queued[1] repeats an earlier entry"],
    ["a pending deposit", { pending_deposits: [...pending, ...pending] }, "pending_deposits[1] repeats an earlier entry"],
  ])("refuses %s named twice, whose copies would each pass the verifier", (_name, change, message) => {
    expect(() => parseExitProof(changed(change))).toThrow(new ExitProofError(message));
  });
  it("takes entries that differ by id, though every other field matches", () => {
    const [approval] = approvals;
    if (approval === undefined) throw new Error("the fixture holds an approval");
    const [deposit] = pending;
    if (deposit === undefined) throw new Error("the fixture holds a pending deposit");
    const parsed = parseExitProof(changed({
      approvals: [approval, { ...approval, approval: { ...approval.approval, nonce: 2 } }],
      pending_deposits: [deposit, { ...deposit, deposit: { ...deposit.deposit, deposit_id: 3 } }],
    }));
    expect(parsed.approvals.map((held) => held.approval.nonce)).toEqual([1, 2]);
    expect(parsed.pending_deposits.map((held) => held.deposit.deposit_id)).toEqual([2, 3]);
  });
});

describe("holdsAnything", () => {
  const empty = emptyProof(100);
  it("says an answer with nothing in it holds nothing", () => {
    expect(holdsAnything(empty, 0n, 0n, [])).toBe(false);
  });
  it("counts each thing a proof can hold", () => {
    const full = fullProof(100);
    expect(holdsAnything(empty, 1n, 0n, [])).toBe(true);
    expect(holdsAnything(empty, 0n, 1n, [])).toBe(true);
    expect(holdsAnything({ ...empty, account: full.account }, 0n, 0n, [])).toBe(true); // an open position, however underwater
    expect(holdsAnything({ ...empty, approvals: full.approvals }, 0n, 0n, [])).toBe(true);
    expect(holdsAnything({ ...empty, queued: full.queued }, 0n, 0n, [])).toBe(true);
    expect(holdsAnything({ ...empty, pending_deposits: full.pending_deposits }, 0n, 0n, [])).toBe(true);
  });
  it("counts exit terms that name a gap, which may be a deposit of the account's to refund", () => {
    expect(holdsAnything({ ...empty, terms: { ...empty.terms, terms: { ...empty.terms.terms, gaps: [1] } } }, 0n, 0n, [])).toBe(true);
  });
  it("does not count an approval a finalized block shows paid", () => {
    const { approvals } = fullProof(100);
    expect(holdsAnything({ ...empty, approvals }, 0n, 0n, [1])).toBe(false);
    expect(holdsAnything({ ...empty, approvals }, 0n, 0n, [2])).toBe(true);
  });
  it("does not count a credited account with an empty balance, or a queued request with nothing left", () => {
    const full = fullProof(100);
    const account = full.account === null ? null : { ...full.account, positions: [], markets: [] };
    expect(holdsAnything({ ...empty, account }, 0n, 0n, [])).toBe(false);
    const done = full.queued.map((held) => ({ ...held, queued: { ...held.queued, remaining: "0" } }));
    expect(holdsAnything({ ...empty, queued: done }, 0n, 0n, [])).toBe(false);
  });
});
