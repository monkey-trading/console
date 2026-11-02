/** Tests for a page load in which the wallet reattaches before the node has attested: the reads it starts meet an unverified node, and say nothing (monkey-trading/console#202). */

import { describe, expect, it } from "vitest";

import { UntrustedError } from "../engine/trust";
import { connected } from "./live-kit";
import { loadApprovals, loadPayouts } from "./payouts";

const NOT_VERIFIED = () => new UntrustedError("The node is not verified.");

describe("reads that meet a node not yet verified", () => {
  it("shows no toast and no problem for the approvals and payouts a reattached wallet reads first, and reads them once the node is trusted", async () => {
    const { client, store } = await connected();
    const history = client.history.bind(client);
    const payouts = client.payouts.bind(client);
    client.history = async () => { throw NOT_VERIFIED(); };
    client.payouts = async () => { throw NOT_VERIFIED(); };
    await loadApprovals(store);
    await loadPayouts(store);
    expect(store.getSnapshot().toasts).toEqual([]);
    expect(store.getSnapshot().payoutsProblem).toBeNull();
    // Trust arrives; the page's effect runs both reads again.
    client.history = history;
    client.payouts = payouts;
    await loadApprovals(store);
    await loadPayouts(store);
    expect(store.getSnapshot().toasts).toEqual([]);
    expect(store.getSnapshot().payoutsRead).not.toBeNull();
  });

  it("still reports a read that fails for a real reason", async () => {
    const { client, store } = await connected();
    client.history = async () => { throw new Error("The node answered HTTP 500."); };
    await loadApprovals(store);
    expect(store.getSnapshot().toasts.at(-1)?.text).toBe("Your approved withdrawals could not be read: The node answered HTTP 500.");
  });
});
