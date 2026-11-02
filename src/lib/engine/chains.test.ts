/** Tests for the chain names the deposit form shows. */

import { describe, expect, it } from "vitest";

import { chainName } from "./chains";

describe("chainName", () => {
  it("names the chains a vault sits on from the chain id", () => {
    expect(chainName(31337)).toBe("Anvil");
    expect(chainName(42161)).toBe("Arbitrum One");
    expect(chainName(1)).toBe("Ethereum");
  });

  it("falls back to the id itself for a chain it has no name for", () => {
    expect(chainName(98765)).toBe("chain 98765");
  });

  it("names the mock build's chain when the deployment has no chain id", () => {
    expect(chainName(null)).toBe("the mock chain");
  });
});
