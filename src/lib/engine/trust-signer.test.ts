/** Tests for the signer the node says the vault names (monkey-trading/console#280): which answers a signer epoch and key refuse, and that a refusal ends the verdict. */

import { describe, expect, it } from "vitest";

import { dev } from "./live-setup";
import { liveStats } from "./live-stats";
import { SignerNaming, SIGNER_SUPERSEDED, SIGNER_UNREAD, type OperatorClaim, type SignerFloor } from "./signer-naming";
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

  it("refuses the key named at an earlier epoch when a later epoch names another, whichever of them signed", () => {
    const naming = new SignerNaming();
    naming.judge(OLD, { signer: { epoch: 4, address: OLD } });
    expect(naming.judge(NEW, { signer: { epoch: 5, address: NEW } })).toBeNull();
    expect(naming.refuses(OLD)).toBe(true);
    expect(naming.refuses(NEW)).toBe(false);
    const unsigned = new SignerNaming();
    unsigned.judge(null, { signer: { epoch: 4, address: OLD } });
    unsigned.judge(null, { signer: { epoch: 5, address: NEW } });
    expect(unsigned.refuses(OLD)).toBe(true);
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

  it("keeps a key a read of the vault put aside refused when a word names it at a later epoch, until a read of the vault names it", () => {
    const naming = new SignerNaming();
    naming.judge(OLD, { signer: { epoch: 4, address: OLD } });
    naming.vaultSays(OLD, NEW);
    naming.judge(null, { signer: { epoch: 5, address: OLD } });
    expect([naming.highest, naming.refuses(OLD)]).toEqual([{ epoch: 5, address: OLD }, true]);
    naming.vaultSays(OLD, OLD);
    expect(naming.refuses(OLD)).toBe(false);
  });

  it("holds a word heard before the node was in use without putting any key aside, and only when it is the highest (monkey-trading/console#376)", () => {
    const naming = new SignerNaming();
    naming.judge(NEW, { signer: { epoch: 7, address: NEW } });
    naming.hold({ epoch: 8, address: OLD.toUpperCase().replace("0X", "0x") });
    naming.hold({ epoch: 6, address: NEW });
    expect([naming.highest, naming.refuses(NEW), naming.refuses(OLD)]).toEqual([{ epoch: 8, address: OLD }, false, false]);
  });

  it("tells each rise of the highest epoch once the judgement that raised it is settled, and nothing else (monkey-trading/console#377)", () => {
    const THIRD = "0x00000000000000000000000000000000000000cc";
    const told: { epoch: number | undefined; trustedRefused: boolean }[] = [];
    const naming: SignerNaming = new SignerNaming(undefined, () => { told.push({ epoch: naming.highest?.epoch, trustedRefused: naming.refuses(THIRD) }); });
    naming.judge(null, { signer: { epoch: 4, address: OLD } });
    naming.judge(null, { signer: { epoch: 4, address: OLD } });
    naming.judge(null, { signer: { epoch: 3, address: NEW } });
    naming.judge(OLD, { enclave: NEW, signer: { epoch: 9, address: NEW } });
    naming.judge(THIRD, { signer: { epoch: 5, address: NEW } });
    expect(told).toEqual([{ epoch: 4, trustedRefused: false }, { epoch: 5, trustedRefused: true }]);
  });

  it("names no key at an epoch two keys were named at, however the second came, tells it, and refuses each key there until a later epoch names one (monkey-trading/console#381)", async () => {
    const THIRD = "0x00000000000000000000000000000000000000cc";
    const seconds: { way: string; second: (naming: SignerNaming) => void }[] = [
      { way: "the node's own word", second: (naming) => naming.judge(OLD, { signer: { epoch: 4, address: NEW } }) },
      { way: "a word put to it", second: (naming) => naming.judge(null, { signer: { epoch: 4, address: NEW } }) },
      { way: "a word held to it", second: (naming) => naming.hold({ epoch: 4, address: NEW }) },
      { way: "a floor of two keys held to it", second: (naming) => naming.hold({ epoch: 4, address: null }) },
    ];
    for (const { way, second } of seconds) {
      const told: (Readonly<SignerFloor> | null)[] = [];
      const naming: SignerNaming = new SignerNaming(async () => ({}), () => told.push(naming.highest));
      naming.judge(null, { signer: { epoch: 4, address: OLD } });
      second(naming);
      naming.judge(null, { signer: { epoch: 3, address: OLD } });
      expect(told, way).toEqual([{ epoch: 4, address: OLD }, { epoch: 4, address: null }]);
      expect(naming.judge(OLD, { signer: { epoch: 4, address: OLD } }), way).toEqual({ reason: SIGNER_SUPERSEDED, supersede: true });
      // A node that states no signer: refused with no read of the vault, taken when this check's own read named it.
      await expect(naming.refusal(NEW, false), way).resolves.toEqual({ reason: SIGNER_SUPERSEDED, unread: true });
      await expect(naming.refusal(THIRD, true), way).resolves.toBeNull();
      naming.judge(null, { signer: { epoch: 5, address: NEW } });
      expect([naming.highest, await naming.refusal(NEW, false)], way).toEqual([{ epoch: 5, address: NEW }, null]);
    }
  });

  it("marks a refusal no read of the vault was there to lift, and only that (monkey-trading/console#379)", async () => {
    const said: { claim: OperatorClaim | Error } = { claim: {} };
    const refusals: { refusal: string; set: (naming: SignerNaming) => void; claim: OperatorClaim | Error; vaultJudged: boolean; unread: boolean | null }[] = [
      { refusal: "another key named at the highest epoch", set: (naming) => naming.hold({ epoch: 4, address: OLD }), claim: {}, vaultJudged: false, unread: true },
      { refusal: "put aside by a read of the vault", set: (naming) => naming.vaultSays(NEW, OLD), claim: {}, vaultJudged: false, unread: true },
      { refusal: "put aside, with a read that named it at a check a newer read overtook", set: (naming) => naming.vaultSays(NEW, OLD), claim: {}, vaultJudged: true, unread: false },
      { refusal: "its own word names another key", set: () => undefined, claim: { signer: { epoch: 4, address: OLD } }, vaultJudged: false, unread: false },
      { refusal: "its word cannot be read", set: () => undefined, claim: new Error("Failed to fetch"), vaultJudged: false, unread: false },
      { refusal: "none: nothing names another key", set: () => undefined, claim: {}, vaultJudged: false, unread: null },
    ];
    for (const { refusal, set, claim, vaultJudged, unread } of refusals) {
      const naming = new SignerNaming(async () => { if (said.claim instanceof Error) throw said.claim; return said.claim; });
      set(naming);
      said.claim = claim;
      const reason = claim instanceof Error ? expect.stringContaining(SIGNER_UNREAD) : SIGNER_SUPERSEDED;
      await expect(naming.refusal(NEW, vaultJudged), refusal).resolves.toEqual(unread === null ? null : { reason, unread });
    }
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

  it("judges an operator answer against the enclave that signed it while a check runs, and refuses that enclave", async () => {
    const { trust } = await verified({ address: OLD });
    trust.heedOperator({ enclave: OLD, signer: { epoch: 4, address: OLD } });
    const checking = trust.verify(); // a check starts, so no enclave is trusted until it ends
    expect(() => trust.heedOperator({ enclave: OLD, signer: { epoch: 5, address: NEW } })).toThrow(SIGNER_SUPERSEDED);
    expect(trust.refuses(OLD)).toBe(true);
    await checking;
    expect(trust.status).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
  });

  it("refuses an answer naming another enclave than the verified one, and leaves the verdict standing", async () => {
    const { trust } = await verified({ address: OLD });
    expect(() => trust.heedOperator({ enclave: NEW })).toThrow("The node named an enclave other than the one that signed its answer");
    expect(trust.status.kind).toBe("attested");
  });
});

describe("another node's word on the signer (monkey-trading/console#374)", () => {
  it("ends a read-only verdict when it names another key at a later epoch, the node's own word or none before it, and refuses the enclave", async () => {
    for (const own of [{ epoch: 4, address: OLD }, null]) {
      const { trust, statuses } = await verified({ address: OLD });
      if (own !== null) trust.heedOperator({ enclave: OLD, signer: own });
      expect(trust.status.kind).toBe("attested");
      trust.heedSigner({ epoch: 5, address: NEW });
      expect(trust.status).toEqual({ kind: "unverified", reason: SIGNER_SUPERSEDED });
      expect(statuses.at(-1)).toBe("unverified");
      expect(trust.refuses(OLD)).toBe(true);
      expect(trust.signerNamed).toEqual({ epoch: 5, address: NEW });
      await expect(trust.signer()).rejects.toThrow(SIGNER_SUPERSEDED);
    }
  });

  it("leaves the verdict for an earlier epoch's word, and for the same key at the node's own epoch, and names the highest heard", async () => {
    const { trust } = await verified({ address: OLD });
    expect(trust.signerNamed).toBeNull();
    trust.heedOperator({ enclave: OLD, signer: { epoch: 4, address: OLD } });
    trust.heedSigner({ epoch: 3, address: NEW });
    trust.heedSigner({ epoch: 4, address: OLD.toUpperCase().replace("0X", "0x") });
    expect(trust.status.kind).toBe("attested");
    expect(trust.refuses(OLD)).toBe(false);
    expect(trust.signerNamed).toEqual({ epoch: 4, address: OLD });
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
