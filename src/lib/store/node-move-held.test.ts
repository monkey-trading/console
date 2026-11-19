/** Tests that a change of trading server held for a request in flight moves the moment the request ends (monkey-trading/console#493). */

import { describe, expect, it } from "vitest";

import { B, named, rig, TrialClient, VERIFIED } from "../engine/operator-follow-kit";
import { settle } from "../engine/test-kit";
import { followNode } from "./node-move";
import type { ConsoleStore } from "./store";

describe("followNode", () => {
  it("checks again at once when a request ends that a change of server waited for, not at the next timed retry", async () => {
    const successor = new TrialClient();
    successor.verdict = VERIFIED;
    const kit = rig({ operator: async () => named({ hostname: "b.example" }), clients: { [B]: successor } });
    kit.follower.start(() => false);
    // A minimal store: the wallet request in flight is its `busy`.
    const listeners = new Set<() => void>();
    const state = { busy: true };
    const set = (busy: boolean) => { state.busy = busy; kit.held.busy = busy; for (const listener of listeners) listener(); };
    const store = { liveWallet: null, deps: { client: kit.trial }, getSnapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => void listeners.delete(listener); } } as unknown as ConsoleStore; // followNode reads only these
    kit.held.busy = true;
    const stop = followNode(store, kit.follower);
    await kit.follower.check();
    expect(kit.follower.getSnapshot()).toMatchObject({ kind: "waiting", target: B, stage: "wallet" });
    kit.advance(1_000); // well before the next timed retry
    set(false);
    await settle();
    expect(kit.adopted).toEqual([B]);
    expect(kit.follower.getSnapshot()).toEqual({ kind: "following", origin: B });
    stop();
  });
});
