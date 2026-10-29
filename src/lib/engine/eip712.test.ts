import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import vectors from "./eip712-vectors.json";
import { cancelTypedData, eligibilityTypedData, orderTypedData, requestDomain, reissueTypedData, withdrawalTypedData, type TypedRequest } from "./eip712";
import type { EligibilityClass, OrderRequest } from "./types";

// The vectors are the engine's own fixtures: typed data a wallet signs, and the signature
// `cast wallet sign --data` (or the engine's signer) made with Anvil's public account 0.
const key = vectors.private_key as `0x${string}`;
const signer = privateKeyToAccount(key);
const domain = requestDomain(vectors.chain_id, vectors.vault);

/** The typed data as JSON writes it, with every integer as its decimal text, for comparing with the vectors. */
function canonical(data: { types: object; primaryType: string; domain: object; message: object }) {
  const text = (value: unknown) => (typeof value === "bigint" || typeof value === "number" ? String(value) : value);
  const types = Object.fromEntries(Object.entries(data.types).filter(([name]) => name !== "EIP712Domain"));
  return { types, primaryType: data.primaryType, domain: data.domain, message: Object.fromEntries(Object.entries(data.message).map(([k, v]) => [k, text(v)])) };
}

function fromVector(request: (typeof vectors.requests)[number]): TypedRequest {
  const terms = { nonce: request.nonce, expiresAt: request.expires_at };
  const body = request.body as Record<string, unknown>;
  switch (request.kind) {
    // The vector bodies are the API's own request bodies.
    case "order": return orderTypedData(domain, body as unknown as OrderRequest, terms);
    case "cancel": return cancelTypedData(domain, { account: String(body.account), order_id: Number(body.order_id) }, terms);
    case "withdrawal": return withdrawalTypedData(domain, String(body.account), String(body.amount), terms);
    default: throw new Error(`unknown vector kind ${request.kind}`);
  }
}

// The typed data is viem's shape: domain, types, primaryType and message.
const sign = (data: TypedRequest) => signer.signTypedData(data as unknown as Parameters<typeof signer.signTypedData>[0]);

describe("client request typed data", () => {
  it.each(vectors.requests.map((r) => [`${r.kind} nonce ${r.nonce}`, r] as const))("matches the engine's %s field for field and signs to its signature", async (_, request) => {
    const data = fromVector(request);
    expect(canonical(data)).toEqual(canonical(request.typed_data));
    expect(await sign(data)).toBe(request.signature);
  });

  it.each(vectors.declarations.map((d) => [d.body.class, d] as const))("matches the engine's %s declaration and signs to its signature", async (_, declaration) => {
    const { account, auth } = declaration.body;
    const data = eligibilityTypedData(domain, account, declaration.body.class as EligibilityClass, { nonce: auth.nonce, expiresAt: auth.expires_at });
    expect(canonical(data)).toEqual(canonical(declaration.typed_data));
    expect(await sign(data)).toBe(auth.signature);
  });

  it("binds the chain and the vault: the same order under another domain recovers another signer", async () => {
    const request = vectors.requests[0];
    if (!request) throw new Error("no order vector");
    const data = fromVector(request);
    for (const other of [requestDomain(1, vectors.vault), requestDomain(vectors.chain_id, "0x00000000000000000000000000000000000000aa")]) {
      // The typed data is viem's shape: domain, types, primaryType and message.
      const recovered = await recoverTypedDataAddress({ ...(data as unknown as Parameters<typeof recoverTypedDataAddress>[0]), domain: other, signature: request.signature as `0x${string}` });
      expect(recovered.toLowerCase()).not.toBe(vectors.account);
    }
  });

  it("signs an order that takes the market's slippage bound with hasMaxSlippage false", () => {
    const order = { account: vectors.account, client_id: 3, market: 1, side: "buy", qty: "1", kind: { kind: "market", quoted: "100" } } as const;
    expect(orderTypedData(domain, order, { nonce: 1, expiresAt: 2 }).message).toMatchObject({ hasMaxSlippage: false, maxSlippageBps: 0n, price: 100_000_000_000n, reduceOnly: false });
  });

  it("builds the reissue request the node checks: account, payout nonce and the replaced expiry", () => {
    expect(reissueTypedData(domain, vectors.account, 7, 1_792_627_200)).toEqual({
      domain, primaryType: "ReissueRequest",
      types: { ReissueRequest: [{ name: "account", type: "address" }, { name: "payoutNonce", type: "uint64" }, { name: "replacesExpiresAt", type: "uint64" }] },
      message: { account: vectors.account, payoutNonce: 7n, replacesExpiresAt: 1_792_627_200n },
    });
  });

  it("refuses a vault that is not an address", () => {
    expect(() => requestDomain(1, "0x1234")).toThrow("not a 20-byte 0x address: 0x1234");
  });
});
