/** Tests for offering several wallet connectors as one. */

import { describe, expect, it } from "vitest";

import { MultiConnector } from "./connectors";
import type { Wallet, WalletConnector } from "./wallet";

/** A connector offering `ids`, whose wallet's label names the option it connected. */
const offering = (...ids: string[]): WalletConnector => ({
  options: ids.map((id) => ({ id, label: id, detail: "" })),
  // Only the label is read below.
  connect: async (optionId) => ({ label: optionId }) as Wallet,
});

describe("MultiConnector", () => {
  it("lists every connector's options in order and connects each through the connector that offers it", async () => {
    const multi = new MultiConnector([offering("injected"), offering("walletconnect", "watch")]);
    expect(multi.options.map((o) => o.id)).toEqual(["injected", "walletconnect", "watch"]);
    expect((await multi.connect("watch")).label).toBe("watch");
    expect((await multi.connect("injected")).label).toBe("injected");
  });

  it("refuses an option no connector offers", async () => {
    await expect(new MultiConnector([offering("injected")]).connect("other")).rejects.toThrow("unknown wallet option: other");
  });
});
