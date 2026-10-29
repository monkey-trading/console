/** Tests for the read-only account taken from the page address. */

import { describe, expect, it } from "vitest";

import { cancelTypedData, requestDomain } from "./eip712";
import { WatchConnector } from "./watch-wallet";

const ADDRESS = "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

describe("WatchConnector", () => {
  it("watches the account the page address names, lowercased, and signs nothing", async () => {
    const connector = new WatchConnector(() => `?x=1&account=${ADDRESS}`);
    const wallet = await connector.connect();
    expect(wallet.address).toBe(ADDRESS.toLowerCase());
    expect(wallet.label).toBe("Read-only");
    expect(wallet.readOnly).toBe(true);
    const typed = cancelTypedData(requestDomain(31337, ADDRESS), { account: ADDRESS, order_id: 1 }, { nonce: 0, expiresAt: 0 });
    await expect(wallet.sign({ summary: "", typed })).rejects.toThrow("read-only");
    await expect(wallet.deposit(1n)).rejects.toThrow("read-only");
    await expect(wallet.claimed(1)).resolves.toBe(false);
  });

  it("explains how to name an account when the page address has none or a bad one", async () => {
    for (const search of ["", "?account=", "?account=0x12", `?account=${ADDRESS}00`, "?other=1"]) {
      await expect(new WatchConnector(() => search).connect()).rejects.toThrow("?account=<address>");
      expect(new WatchConnector(() => search).address()).toBeNull();
    }
  });
});
