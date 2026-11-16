/** Tests that each reason the console refuses a node for the signer the vault names says its own words, at the banner and at the control it blocks, and that the refusal itself is the one it was (monkey-trading/console#387). */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { AttestationStatus } from "@/lib/engine/attestation";
import { dev } from "@/lib/engine/live-setup";
import { SIGNER_AWAITING_VAULT, SIGNER_CONFLICT, SIGNER_SUPERSEDED } from "@/lib/engine/signer-naming";
import { NodeTrust } from "@/lib/engine/trust";
import { NotSentError } from "@/lib/engine/trust-errors";
import type { Verifier } from "@/lib/engine/verifier";

import { AttestationBanner } from "./AttestationBanner";
import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { useSignGate } from "./SignGate";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const OLD = "0x00000000000000000000000000000000000000aa";
const NEW = "0x00000000000000000000000000000000000000bb";
const THIRD = "0x00000000000000000000000000000000000000cc";
const HARDWARE = JSON.stringify({ provider: "sev_snp", config_sha256: `0x${"c0".repeat(32)}` });

/** A trust that reads a hardware quote naming `held.address`, with no wallet to read the vault. */
async function attested(held: { address: string }) {
  const verifier: Verifier = { ...dev, verifyAttestation: () => ({ ok: true as const, enclave: { address: held.address, release: "r", config: "c" } }) };
  const trust = new NodeTrust({
    attestation: async () => HARDWARE, collateral: async () => "{}", verifier: async () => verifier, releases: [], devDigests: [], acceptsMock: true, nowMs: () => 0,
    vaultFacts: () => null, onStatus: () => {}, onEnclaveChanged: () => {},
  });
  await trust.verify();
  return { trust, held };
}

/** Each refusal reached as the console reaches it, with the key it puts aside and the word that takes the node back. */
const REFUSALS = [
  {
    reason: "another signer named", message: SIGNER_SUPERSEDED, aside: OLD,
    async reach() {
      const node = await attested({ address: OLD });
      node.trust.heedOperator({ enclave: OLD, signer: { epoch: 4, address: OLD } });
      expect(() => node.trust.heedOperator({ enclave: OLD, signer: { epoch: 5, address: NEW } })).toThrow(SIGNER_SUPERSEDED);
      return node;
    },
    async lift({ trust, held }: Awaited<ReturnType<typeof attested>>) { held.address = NEW; await trust.verify(); },
    lifted: NEW,
  },
  {
    reason: "conflicting keys at the current epoch", message: SIGNER_CONFLICT, aside: OLD,
    async reach() {
      const node = await attested({ address: OLD });
      node.trust.heedOperator({ enclave: OLD, signer: { epoch: 4, address: OLD } });
      expect(() => node.trust.heedOperator({ enclave: OLD, signer: { epoch: 4, address: NEW } })).toThrow(SIGNER_CONFLICT);
      return node;
    },
    async lift({ trust, held }: Awaited<ReturnType<typeof attested>>) { held.address = NEW; trust.heedSigner({ epoch: 5, address: NEW }); await trust.verify(); },
    lifted: NEW,
  },
  {
    reason: "no vault read yet for a node that states no signer", message: SIGNER_AWAITING_VAULT, aside: THIRD,
    async reach() {
      const node = await attested({ address: OLD });
      node.trust.heedSigner({ epoch: 5, address: NEW });
      node.held.address = THIRD;
      await node.trust.verify();
      return node;
    },
    async lift({ trust, held }: Awaited<ReturnType<typeof attested>>) { held.address = THIRD; trust.heedSigner({ epoch: 6, address: THIRD }); await trust.verify(); },
    lifted: THIRD,
  },
] as const;

/** What the page renders for `attestation`: the banner and the note under a funding form's button. */
function Gate() {
  const { note } = useSignGate("gate");
  return note;
}

function pages(attestation: AttestationStatus) {
  function Seed() {
    const { store } = useSession();
    store.patch({ attestation, stream: "live" });
    return null;
  }
  const render = (child: ReturnType<typeof createElement>) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed), child)).replaceAll("&#x27;", "'");
  return { banner: render(createElement(AttestationBanner)), control: render(createElement(Gate)) };
}

describe("a node refused for the signer the vault names", () => {
  for (const { reason, message, reach } of REFUSALS) {
    it(`says its own reason at the banner and at the control it blocks: ${reason}`, async () => {
      const { trust } = await reach();
      expect(trust.status).toEqual({ kind: "unverified", reason: message });
      const { banner, control } = pages(trust.status);
      expect(banner).toContain(message);
      expect(control).toContain("You cannot sign at the moment because");
      expect(control).not.toContain("the server could not be verified");
      // Each page names its reason and neither of the others'.
      for (const other of REFUSALS.filter((refusal) => refusal.message !== message)) {
        expect(banner).not.toContain(other.message);
        expect(control).not.toContain(other.message);
      }
    });
  }

  it("gives three different sentences at the banner and three different clauses at the control", async () => {
    const shown = await Promise.all(REFUSALS.map(async ({ reach }) => pages((await reach()).trust.status)));
    expect(new Set(shown.map((page) => page.banner)).size).toBe(3);
    expect(new Set(shown.map((page) => page.control)).size).toBe(3);
  });

  it("leaves a refusal for another reason as general as it was", () => {
    const { banner, control } = pages({ kind: "unverified", reason: "This server's hardware report failed verification." });
    expect(banner).toContain("This server's hardware report failed verification.");
    expect(control).toContain("the server could not be verified");
  });

  for (const { reason, reach, aside, lift, lifted } of REFUSALS) {
    it(`still refuses the node and puts its key aside, and trusts it once the vault names it: ${reason}`, async () => {
      const node = await reach();
      const { trust } = node;
      expect(trust.status.kind).toBe("unverified");
      expect(trust.refuses(aside)).toBe(true);
      await expect(trust.signer()).rejects.toThrow();
      await expect(trust.sendingSigner()).rejects.toBeInstanceOf(NotSentError);
      await lift(node);
      expect(trust.status.kind).toBe("attested");
      expect(trust.refuses(lifted)).toBe(false);
      await expect(trust.signer()).resolves.toBe(lifted);
    });
  }

  it("refuses an answer in flight under the key put aside with the reason that put it aside", async () => {
    for (const { message, reach, aside } of REFUSALS) {
      const { trust } = await reach();
      expect(trust.whyRefused(aside)).toBe(message);
    }
  });
});
