/** Pins the pinned SDK's idle behaviour (@walletconnect/universal-provider 2.26.0): starting it with no stored pairing opens no relay socket. */

import { describe, expect, it } from "vitest";

import { WALLETCONNECT_RELAY } from "./deploy";
import { MemoryStorage } from "./walletconnect-sdk";

describe("the WalletConnect SDK started with nothing stored", () => {
  it("opens no relay socket and makes no request, so a reconnect that yields has nothing to close", async () => {
    const sockets: unknown[] = [];
    const fetches: unknown[] = [];
    const realFetch = globalThis.fetch;
    const realSocket = globalThis.WebSocket;
    globalThis.fetch = (async (input: unknown) => { fetches.push(input); throw new Error("offline"); }) as typeof fetch;
    globalThis.WebSocket = class { constructor(url: unknown) { sockets.push(url); throw new Error("offline"); } } as unknown as typeof WebSocket;
    try {
      const { UniversalProvider } = await import("@walletconnect/universal-provider");
      const provider = await UniversalProvider.init({
        projectId: "0123456789abcdef0123456789abcdef", relayUrl: WALLETCONNECT_RELAY, storage: new MemoryStorage(), telemetryEnabled: false, logger: "silent",
        metadata: { name: "Monkey Trading", description: "test", url: "https://console.example", icons: [] },
      });
      await new Promise((resolve) => setTimeout(resolve, 200)); // `Relayer.init` starts its connect without awaiting it
      const relayer = provider.client.core.relayer;
      expect({ sockets, fetches, connected: relayer.connected, connecting: relayer.connecting }).toEqual({ sockets: [], fetches: [], connected: false, connecting: false });
    } finally {
      globalThis.fetch = realFetch;
      globalThis.WebSocket = realSocket;
    }
  });
});
