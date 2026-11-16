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
    expect(feedProblem(state({ status: "failed", data: null, error: "the node stalled" }), "positions")).toBe("Couldn't load positions: the node stalled. Trying again automatically.");
  });

  it("says retained figures may be behind after a failed read, or are the last answered once the node stops serving them", () => {
    expect(feedProblem(state({ stale: true, error: "x" }), "MONKEY totals")).toBe("Couldn't refresh MONKEY totals, so this may be out of date.");
    expect(feedProblem(state({ status: "unavailable", stale: true }), "MONKEY totals")).toBe("The server has stopped sending MONKEY totals, so this may be out of date.");
    expect(feedProblem(state({ status: "waiting", stale: true }), "positions")).toBe("The server is updating positions, so this may be out of date.");
  });
});
