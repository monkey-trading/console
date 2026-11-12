/** Tests for what the closed-epochs reads keep across a node that stops serving the route and across a change of enclave. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "../engine/client";
import { NODE_READ_MS } from "../monkey/panel";
import { flush } from "../monkey/panel-kit";
import { EPOCH_PAGE } from "./epoch-reads";
import { started } from "./epoch-reads-kit";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const enclave = (address: string) => ({ kind: "verified", release: "r", config: "c", address }) as const;

describe("EpochReads when the node stops serving the route", () => {
  it("keeps the epochs it holds beside the unavailable state and reads nothing more until the reads restart", async () => {
    const { epochs, node, stop } = await started(3);
    let calls = 0;
    node.client.stats.distributionEpochs = () => { calls += 1; return Promise.reject(new EngineError(404, "not found")); };
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    expect(epochs.getSnapshot().status).toBe("unavailable");
    expect(epochs.getSnapshot().epochs.map((close) => close.epoch)).toEqual([3, 2, 1]);
    const seen = calls;
    await vi.advanceTimersByTimeAsync(NODE_READ_MS * 3);
    expect(calls).toBe(seen);
    stop();
  });
});

describe("EpochReads across a change of verified enclave", () => {
  it("reads afresh when the reads restart under another verified enclave, so no row it signed stays listed", async () => {
    const { epochs, store, stop, served } = await started(EPOCH_PAGE * 3);
    stop();
    store.patch({ attestation: enclave("0xA1") });
    const first = epochs.start(() => false);
    await flush();
    await epochs.loadMore();
    await epochs.loadMore();
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE * 3);
    first();
    // The enclave fails a re-check and a new one verifies at the same origin.
    store.patch({ attestation: { kind: "reverifying" } });
    store.patch({ attestation: enclave("0xB2") });
    const reads = served.reads.length;
    const restart = epochs.start(() => false);
    expect(epochs.getSnapshot()).toMatchObject({ status: "reading", epochs: [], next: null });
    await flush();
    expect(served.reads).toHaveLength(reads + 1);
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE);
    restart();
  });

  it("keeps the loaded pages when the same enclave verifies again", async () => {
    const { epochs, store, stop } = await started(EPOCH_PAGE * 2);
    stop();
    store.patch({ attestation: enclave("0xA1") });
    const first = epochs.start(() => false);
    await flush();
    await epochs.loadMore();
    first();
    store.patch({ attestation: { kind: "reverifying" } });
    store.patch({ attestation: enclave("0xa1") });
    const restart = epochs.start(() => false);
    expect(epochs.getSnapshot().epochs).toHaveLength(EPOCH_PAGE * 2);
    restart();
  });
});
