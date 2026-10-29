/** Tests for reading a WalletConnect session, the SDK's in-memory storage, and SDK error text. */

import { describe, expect, it } from "vitest";

import { detail, MemoryStorage, sessionScope } from "./walletconnect-sdk";

const ACCOUNT = "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("sessionScope", () => {
  it("takes the first account on the chain, lowercased, and the methods of every namespace that covers it", () => {
    const scope = sessionScope({
      topic: "t",
      namespaces: {
        eip155: { chains: ["eip155:1", "eip155:31337"], accounts: [`eip155:1:${ACCOUNT}`, `eip155:31337:0x12`, `eip155:31337:${ACCOUNT}`], methods: ["eth_call"] },
        "eip155:31337": { accounts: [], methods: ["eth_signTypedData_v4"] },
        "eip155:10": { accounts: [`eip155:10:${ACCOUNT}`], methods: ["eth_sendTransaction"] },
      },
    }, 31337);
    expect(scope).toEqual({ address: ACCOUNT.toLowerCase(), methods: new Set(["eth_call", "eth_signTypedData_v4"]) });
  });

  it("counts a namespace that lists an account on the chain but names no chains", () => {
    expect(sessionScope({ topic: "t", namespaces: { eip155: { accounts: [`eip155:31337:${ACCOUNT}`], methods: ["eth_call"] } } }, 31337))
      .toEqual({ address: ACCOUNT.toLowerCase(), methods: new Set(["eth_call"]) });
  });

  it("finds no account and no methods for a chain the session does not cover", () => {
    expect(sessionScope({ topic: "t", namespaces: { eip155: { chains: ["eip155:1"], accounts: [`eip155:1:${ACCOUNT}`], methods: ["eth_call"] } } }, 31337))
      .toEqual({ address: null, methods: new Set() });
    // eip155:313370 starts with the same digits, but is another chain.
    expect(sessionScope({ topic: "t", namespaces: { eip155: { accounts: [`eip155:313370:${ACCOUNT}`], methods: ["eth_call"] } } }, 31337).address).toBeNull();
  });
});

describe("MemoryStorage", () => {
  it("keeps what the SDK writes in memory, and forgets what it removes", async () => {
    const storage = new MemoryStorage();
    await storage.setItem("wc@2:core:keychain", { a: 1 });
    await storage.setItem("wc@2:client:session", [{ topic: "t" }]);
    expect(await storage.getItem("wc@2:core:keychain")).toEqual({ a: 1 });
    expect(await storage.getKeys()).toEqual(["wc@2:core:keychain", "wc@2:client:session"]);
    await storage.removeItem("wc@2:core:keychain");
    expect(await storage.getEntries()).toEqual([["wc@2:client:session", [{ topic: "t" }]]]);
    expect(await storage.getItem("wc@2:core:keychain")).toBeUndefined();
  });
});

describe("detail", () => {
  it("reads an Error, a JSON-RPC error object, or anything else", () => {
    expect(detail(new Error("boom"))).toBe("boom");
    expect(detail({ code: 5000, message: "User rejected." })).toBe("User rejected.");
    expect(detail("plain")).toBe("plain");
  });
});
