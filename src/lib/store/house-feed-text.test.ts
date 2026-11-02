import { describe, expect, it } from "vitest";

import { feedProblem } from "./house-feed-text";
import type { FeedState } from "./house-stats";

const state = (extra: Partial<FeedState<number>>): FeedState<number> => ({ status: "ready", data: 1, stale: false, error: null, ...extra });

describe("feedProblem", () => {
  it("says nothing about a current feed, a loading one, or one the node does not serve", () => {
    expect(feedProblem(state({}), "positions")).toBeNull();
    expect(feedProblem(state({ status: "loading", data: null }), "positions")).toBeNull();
    expect(feedProblem(state({ status: "unavailable", data: null }), "positions")).toBeNull();
    expect(feedProblem(state({ status: "waiting", data: null }), "positions")).toBeNull();
  });

  it("says a feed that never answered has nothing to show, with the reason", () => {
    expect(feedProblem(state({ status: "failed", data: null, error: "the node stalled" }), "positions")).toBe("The node did not answer for positions (the node stalled), so there is nothing to show yet. The page keeps asking.");
  });

  it("says retained figures may be behind after a failed read, or are the last answered once the node stops serving them", () => {
    expect(feedProblem(state({ stale: true, error: "x" }), "MONKEY totals")).toBe("The last read of MONKEY totals failed, so this may be behind.");
    expect(feedProblem(state({ status: "unavailable", stale: true }), "MONKEY totals")).toBe("The node has stopped serving MONKEY totals, so this is the last it answered.");
    expect(feedProblem(state({ status: "waiting", stale: true }), "positions")).toBe("The node is rescanning, so this is the last it answered for positions.");
  });
});
