/** Tests for the Governance tab's read of the votes the node's log holds, against the mock node. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineClient } from "../engine/client";
import { NODE_READ_MS } from "../monkey/panel";
import { flush, setup } from "../monkey/panel-kit";
import { GovernanceReads } from "./governance-reads";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function started(hidden = () => false) {
  const kit = await setup();
  const calls = { count: 0 };
  const real = kit.node.client.houseState.bind(kit.node.client);
  kit.node.client.houseState = () => {
    calls.count += 1;
    return real();
  };
  const reads = new GovernanceReads(kit.store);
  const stop = reads.start(hidden);
  await flush();
  return { ...kit, reads, stop, calls };
}

describe("GovernanceReads", () => {
  it("reads the waiting changes, the restrictions in force and the parameters in force on open", async () => {
    const { reads, stop, node } = await started();
    const read = reads.getSnapshot();
    expect(read.status).toBe("ready");
    expect(read.value?.view.waiting.map((change) => change.id)).toEqual([5]);
    expect(read.value?.view.inForce.map((restriction) => restriction.id)).toEqual([6]);
    expect(read.value?.params).toEqual(node.client.state.params);
    stop();
  });

  it("reads again at the node read's pace, at once on a vote's outcome in the stream, and not in a hidden tab", async () => {
    const visible = await started();
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(visible.calls.count).toBe(2);
    visible.node.client.state.emit({ type: "tick" }, [{ type: "restriction_lapsed", proposal: 6 }]);
    await flush();
    expect(visible.calls.count).toBe(3);
    visible.node.client.state.emit({ type: "tick" }, [{ type: "market_opened", market: 1 }]);
    await flush();
    expect(visible.calls.count).toBe(3);
    visible.stop();
    const hidden = await started(() => true);
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 3);
    expect(hidden.calls.count).toBe(1);
    hidden.stop();
  });

  it("drops what it read when the node is no longer trusted, and reads again once it is", async () => {
    const { reads, stop, store, calls } = await started();
    const attestation = store.getSnapshot().attestation;
    store.patch({ attestation: { kind: "unverified", reason: "gone" } });
    expect(reads.getSnapshot().status).toBe("loading");
    store.patch({ attestation });
    await flush();
    expect(reads.getSnapshot().status).toBe("ready");
    expect(calls.count).toBe(2);
    stop();
  });

  it("says a node without the route is unavailable and asks it no more, and keeps the last answer through a failure", async () => {
    const { reads, stop, node } = await started();
    const held = reads.getSnapshot().value;
    node.client.houseState = () => Promise.reject(new Error("the node did not answer"));
    await reads.refresh();
    expect(reads.getSnapshot()).toEqual({ status: "failed", value: held, message: "the node did not answer" });
    let asked = 0;
    // A node that predates the route answers null, as the client interface allows.
    const client: Pick<EngineClient, "houseState"> = node.client;
    client.houseState = async () => {
      asked += 1;
      return null;
    };
    await reads.refresh();
    await reads.refresh();
    expect(reads.getSnapshot()).toEqual({ status: "unavailable", value: null, message: null });
    expect(asked).toBe(1);
    stop();
  });

  it("holds what it read across a stop, so a tab switch back shows it while a fresh read runs", async () => {
    const { reads, stop } = await started();
    const held = reads.getSnapshot();
    stop();
    expect(reads.getSnapshot()).toBe(held);
  });
});
