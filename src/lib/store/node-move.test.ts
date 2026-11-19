/** What a move to another node keeps of what the console said: each request's outcome where the trader made it, and nothing said of the node left behind. */

import { describe, expect, it } from "vitest";

import { carriedNotices } from "./node-move";
import { NOTICE_SURFACES, type Notices } from "./state";

describe("carriedNotices", () => {
  it("keeps what a request came to, such as an order sent as the old node went down, and drops what was said of the old node's reads", () => {
    const notices: Notices = Object.fromEntries(NOTICE_SURFACES.map((surface, id) => [surface, { id, tone: "error", text: surface }]));
    const kept = Object.keys(carriedNotices(notices)).sort();
    expect(kept).toEqual(NOTICE_SURFACES.filter((surface) => !["node", "feed", "accountRead", "payoutReads", "chart"].includes(surface)).sort());
    expect(kept).toContain("ticket");
    expect(carriedNotices({ ticket: { id: 1, tone: "error", text: "The server did not respond." } })).toEqual({ ticket: { id: 1, tone: "error", text: "The server did not respond." } });
  });

  it("carries nothing from a store that said nothing", () => {
    expect(carriedNotices({})).toEqual({});
  });
});
