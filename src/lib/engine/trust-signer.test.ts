/** Tests for the signer the node says the vault names (monkey-trading/console#280): which answers a signer epoch and key refuse, and that a refusal ends the verdict. */

import { describe, expect, it } from "vitest";

import { dev } from "./live-setup";
import { liveStats } from "./live-stats";
import { SignerNaming, SIGNER_SUPERSEDED } from "./signer-naming";
import type { OperatorRoute } from "./stats-types";
import { NodeTrust, UntrustedError } from "./trust";
import type { Verifier } from "./verifier";

const OLD = "0x00000000000000000000000000000000000000aa";
const NEW = "0x00000000000000000000000000000000000000bb";
const ENCLAVE = (address: string) => ({ ok: true as const, enclave: { address, release: "r", config: "attested" } });
const HARDWARE = JSON.stringify({ provider: "sev_snp", config_sha256: `0x${"c0".repeat(32)}` });

describe("SignerNaming", () => {
  it("passes an answer whose enclave is the key the vault names, at the first epoch seen and a later one that names it again", () => {
    const naming = new SignerNaming();
    expect(naming.judge(OLD, { enclave: OLD, signer: { epoch: 4, address: OLD } })).toBeNull();
    expect(naming.judge(OLD, { enclave: OLD, signer: { epoch: 5, address: OLD.toUpperCase().replace("0X", "0x") } })).toBeNull();
    expect(naming.refuses(OLD)).toBe(false);
  });

  it("refuses the outgoing key once the vault names another at a later epoch, and keeps refusing it", () => {
    const naming = new SignerNaming();
    expect(naming.judge(OLD, { signer: { epoch: 4, address: OLD } })).toBeNull();
    expect(naming.judge(OLD, { signer: { epoch: 5, address: NEW } })).toEqual({ reason: SIGNER_SUPERSEDED, supersede: true });
    expect(naming.refuses(OLD)).toBe(true);
  });

  it("refuses a node that lags behind a promotion: it names an earlier epoch's key, after a later epoch named another", () => {
    const naming = new SignerNaming();
    naming.judge(NEW, { signer: { epoch: 5, address: NEW } });
    expect(naming.judge(OLD, { signer: { epoch: 4, address: OLD } })).toEqual({ reason: SIGNER_SUPERSEDED, supersede: true });
  });

  it("refuses two keys for one epoch, whichever of them signed", () => {
    const naming = new SignerNaming();
    naming.judge(OLD, { signer: { epoch: 4, address: OLD } });
    expect(naming.judge(NEW, { signer: { epoch: 4, address: NEW } })?.supersede).toBe(true);
    const other = new SignerNaming();
    other.judge(OLD, { signer: { epoch: 4, address: OLD } });
    expect(other.judge(OLD, { signer: { epoch: 4, address: NEW } })?.supersede).toBe(true);
  });

  it("lets a refused enclave back only when the vault names it again at a later epoch", () => {
    const naming = new SignerNaming();
    naming.judge(OLD, { signer: { epoch: 4, address: OLD } });
    naming.judge(OLD, { signer: { epoch: 5, address: NEW } });
    expect(naming.refuses(OLD)).toBe(true);
    naming.judge(NEW, { signer: { epoch: 6, address: OLD } });
    expect(naming.refuses(OLD)).toBe(false);
  });

  it("refuses an answer that names an enclave other than the one that signed it, without putting the signer aside", () => {
    const naming = new SignerNaming();
    const refusal = naming.judge(OLD, { enclave: NEW, signer: { epoch: 4, address: OLD } });
    expect(refusal).toMatchObject({ supersede: false });
    expect(naming.refuses(OLD)).toBe(false);
  });

  it("says nothing against an answer with no signer, as a node whose liveness rule does not run answers", () => {
    expect(new SignerNaming().judge(OLD, { enclave: OLD })).toBeNull();
    expect(new SignerNaming().judge(null, { signer: { epoch: 1, address: NEW } })).toBeNull();
  });
});

/** A trust the verifier of which names the address a test sets. */
async function verified(held: { address: string }) {
  const verifier: Verifier = { ...dev, verifyAttestation: () => ENCLAVE(held.address) };
  const statuses: string[] = [];
  const trust = new NodeTrust({
    attestation: async () => HARDWARE, collateral: async () => "{}", verifier: async () => verifier, releases: [], devDigests: [], acceptsMock: true, nowMs: () => 0,
    vaultFacts: () => null, onStatus: (status) => { statuses.push(status.kind); }, onEnclaveChanged: () => {},
  });
  await trust.verify();
  return { trust, statuses };
}

describe("a node the vault no longer names", () => {
  it("ends the verdict, refuses every later read under that enclave, and says why", async () => {
    const held = { address: OLD };
    const { trust, statuses } = await verified(held);
    expect(trust.status.kind).toBe("attested");
    trust.heedOperator({ enclave: OLD, signer: { epoch: 4, address: OLD } });
    expect(() => trust.heedOperator({ enclave: OLD, signer: { epoch: 5, address: NEW } })).toThrow(UntrustedError);
    expect(trust.status).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
    expect(statuses.at(-1)).toBe("unverified");
    // The node still attests the outgoing key, so a new check of it stays refused.
    await expect(trust.signer()).rejects.toThrow(SIGNER_SUPERSEDED);
    expect(trust.status).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
  });

  it("trusts a node that attests the key the vault now names, and passes its answers", async () => {
    const held = { address: OLD };
    const { trust } = await verified(held);
    trust.heedOperator({ enclave: OLD, signer: { epoch: 4, address: OLD } });
    expect(() => trust.heedOperator({ signer: { epoch: 5, address: NEW } })).toThrow(UntrustedError);
    held.address = NEW;
    await expect(trust.signer()).resolves.toBe(NEW);
    expect(() => trust.heedOperator({ enclave: NEW, signer: { epoch: 5, address: NEW } })).not.toThrow();
  });

  it("refuses an answer naming another enclave than the verified one, and leaves the verdict standing", async () => {
    const { trust } = await verified({ address: OLD });
    expect(() => trust.heedOperator({ enclave: NEW })).toThrow("The node named an enclave other than the one that signed its answer");
    expect(trust.status.kind).toBe("attested");
  });
});

describe("the operator route's read", () => {
  const route: OperatorRoute = { operator: OLD, pending_rotation: null, rotation_enabled: true, last_election: null, signer: { epoch: 5, address: NEW } };

  it("hands the route to the signer's judge before it answers, and answers nothing the judge refuses", async () => {
    const judged: OperatorRoute[] = [];
    const stats = liveStats(async () => route, (answer) => { judged.push(answer); });
    await expect(stats.operator()).resolves.toBe(route);
    expect(judged).toEqual([route]);
    const refusing = liveStats(async () => route, () => { throw new UntrustedError(SIGNER_SUPERSEDED); });
    await expect(refusing.operator()).rejects.toThrow(SIGNER_SUPERSEDED);
  });

  it("asks for a page of the turn history with its before mark and limit, and for none without", async () => {
    const paths: string[] = [];
    const stats = liveStats(async (path) => { paths.push(path); return route; });
    await stats.operator();
    await stats.operator({ before: 70, limit: 20 });
    await stats.operator({ limit: 1 });
    expect(paths).toEqual(["/v1/operator", "/v1/operator?before=70&limit=20", "/v1/operator?limit=1"]);
  });
});
