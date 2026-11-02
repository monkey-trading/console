import { describe, expect, it } from "vitest";

import { exitFileName, exitFileText, exitStorageKey, MAX_EXIT_FILE_BYTES, parseExitFile, readStoredExit, removeStoredExit, writeStoredExit } from "./exit-file";
import { ExitProofError } from "./exit-proof";
import { ACCOUNT, exitStorage, fullProof, OTHER, recordAt, SCOPE, VAULT } from "./exit-kit";
import { parseExitProof } from "./exit-proof";

const parsed = (seq: number) => parseExitProof(fullProof(seq));

describe("parseExitFile", () => {
  it("reads back what this page exports", () => {
    const file = parseExitFile(exitFileText(recordAt(100)));
    expect(file).toEqual({ proof: parsed(100), account: ACCOUNT, chainId: 31337, vault: VAULT });
  });

  it("reads what the engine's offline builder prints, which names no deployment", () => {
    const bundle = { seq: 100, root: fullProof(100).root, account: fullProof(100), house_pending_deposits: [], calls: [{ what: "startExit", calldata: "0x00" }] };
    expect(parseExitFile(JSON.stringify(bundle))).toEqual({ proof: parsed(100), account: ACCOUNT, chainId: null, vault: null });
  });

  it.each<[string, string, RegExp]>([
    ["text that is not JSON", "not json", /it is not JSON/],
    ["JSON that is not an object", "5", /it is not an exit proof/],
    ["an object that is neither shape", JSON.stringify({ hello: "world" }), /it is not an exit proof/],
    ["a later format", JSON.stringify({ kind: "monkeytrading.exit-proof", version: 2 }), /version 2 of the format/],
    ["a malformed proof inside", JSON.stringify({ kind: "monkeytrading.exit-proof", version: 1, account: ACCOUNT, proof: { seq: "x" } }), /seq is not a whole number/],
    ["an account the proof does not name", JSON.stringify({ kind: "monkeytrading.exit-proof", version: 1, account: OTHER, proof: fullProof(100) }), /the account it names is not the one its proof names/],
    ["the offline builder's output for the house", JSON.stringify({ seq: 100, root: "0x00", account: null, house_pending_deposits: [], calls: [] }), /for the house/],
  ])("refuses %s", (_name, text, message) => {
    expect(() => parseExitFile(text)).toThrow(ExitProofError);
    expect(() => parseExitFile(text)).toThrow(message);
  });

  it("refuses a file past the limit without reading it", () => {
    expect(() => parseExitFile(" ".repeat(MAX_EXIT_FILE_BYTES + 1))).toThrow(/longer than any exit proof/);
  });
});

describe("exitFileName", () => {
  it("names the account and the checkpoint", () => {
    expect(exitFileName(recordAt(100))).toBe("monkey-exit-proof-0x70997970-100.json");
  });
});

describe("what a browser keeps", () => {
  it("saves one record per chain, vault and account", () => {
    const storage = exitStorage();
    expect(writeStoredExit(() => storage, recordAt(100))).toBeNull();
    expect(readStoredExit(() => storage, SCOPE)).toEqual({ record: { ...recordAt(100), proof: parsed(100) }, problem: null });
    expect(readStoredExit(() => storage, { ...SCOPE, account: OTHER })).toEqual({ record: null, problem: null });
    expect(readStoredExit(() => storage, { ...SCOPE, chainId: 1 })).toEqual({ record: null, problem: null });
    expect(readStoredExit(() => storage, { ...SCOPE, vault: OTHER })).toEqual({ record: null, problem: null });
    expect(new Set([exitStorageKey(SCOPE), exitStorageKey({ ...SCOPE, account: OTHER }), exitStorageKey({ ...SCOPE, chainId: 1 }), exitStorageKey({ ...SCOPE, vault: OTHER })]).size).toBe(4);
  });

  it("replaces the record before it", () => {
    const storage = exitStorage();
    writeStoredExit(() => storage, recordAt(100));
    writeStoredExit(() => storage, recordAt(200));
    expect(storage.held.size).toBe(1);
    expect(readStoredExit(() => storage, SCOPE).record?.proof.seq).toBe(200);
  });

  it("says why a full store would not take it, and leaves the one before it", () => {
    const storage = exitStorage();
    writeStoredExit(() => storage, recordAt(100));
    storage.refuseWrites = true;
    expect(writeStoredExit(() => storage, recordAt(200))).toBe("this browser's storage refused it: the quota is exceeded");
    expect(readStoredExit(() => storage, SCOPE).record?.proof.seq).toBe(100);
  });

  it.each([
    ["denied", () => { throw new Error("denied"); }],
    ["absent", () => null],
  ])("reports %s storage rather than throwing", (_name, storage) => {
    expect(readStoredExit(storage, SCOPE).record).toBeNull();
    expect(readStoredExit(storage, SCOPE).problem).not.toBeNull();
    expect(writeStoredExit(storage, recordAt(100))).not.toBeNull();
  });

  it("reports a corrupt value, and does not use it", () => {
    const storage = exitStorage();
    storage.held.set(exitStorageKey(SCOPE), "{corrupt");
    const read = readStoredExit(() => storage, SCOPE);
    expect(read.record).toBeNull();
    expect(read.problem).toMatch(/could not be read: it is not JSON/);
  });

  it("does not take a record another account's key holds", () => {
    const storage = exitStorage();
    storage.held.set(exitStorageKey(SCOPE), exitFileText({ ...recordAt(100), chainId: 1 }));
    expect(readStoredExit(() => storage, SCOPE).problem).toMatch(/another account or deployment/);
  });

  it("removes what it holds, and says when it could not", () => {
    const storage = exitStorage();
    writeStoredExit(() => storage, recordAt(100));
    expect(removeStoredExit(() => storage, SCOPE)).toBeNull();
    expect(storage.held.size).toBe(0);
    expect(removeStoredExit(() => { throw new Error("denied"); }, SCOPE)).toBe("denied");
  });

  it("keeps the approvals it has seen paid", () => {
    const storage = exitStorage();
    writeStoredExit(() => storage, { ...recordAt(100), paidApprovals: [1] });
    expect(readStoredExit(() => storage, SCOPE).record?.paidApprovals).toEqual([1]);
  });

  it("refuses saved figures that do not read", () => {
    const storage = exitStorage();
    const saved = JSON.parse(exitFileText(recordAt(100))) as Record<string, unknown>;
    storage.held.set(exitStorageKey(SCOPE), JSON.stringify({ ...saved, paid_approvals: ["one"] }));
    expect(readStoredExit(() => storage, SCOPE).problem).toMatch(/saved figures do not read/);
    storage.held.set(exitStorageKey(SCOPE), JSON.stringify({ ...saved, account_claim: "lots" }));
    expect(readStoredExit(() => storage, SCOPE).problem).toMatch(/saved figures do not read/);
  });

  it("keeps a record's figures exact past a float's range", () => {
    const storage = exitStorage();
    const record = { ...recordAt(100), accountClaim: 2n ** 80n };
    writeStoredExit(() => storage, record);
    expect(readStoredExit(() => storage, SCOPE).record?.accountClaim).toBe(2n ** 80n);
  });
});
