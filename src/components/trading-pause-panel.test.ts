/** Tests that the pause panel says what is kept only while trading is paused, and once it has resumed shows only the title over the ticked steps. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PAUSE_KEPT, PAUSE_TITLE, RESUMED_TITLE } from "@/lib/trading-pause-words";

import { TradingPausePanel } from "./TradingPausePanel";

describe("TradingPausePanel", () => {
  it("says what is kept while trading is paused, and only the title over the ticked steps once it has resumed", () => {
    const paused = renderToStaticMarkup(createElement(TradingPausePanel, { view: { kind: "paused", steps: { connect: "current", verify: "waiting", prices: "waiting", resume: "waiting" }, long: false, failure: null, hold: null } }));
    expect(paused).toContain(PAUSE_TITLE);
    expect(paused).toContain(PAUSE_KEPT);
    const resumed = renderToStaticMarkup(createElement(TradingPausePanel, { view: { kind: "resumed", leaving: false } }));
    expect(resumed).toContain(RESUMED_TITLE);
    expect(resumed).toContain("Trading resumed");
    expect(resumed).not.toContain(PAUSE_KEPT);
    expect(resumed).not.toMatch(/<p[\s>]/); // no body text at all, the ticks' paths aside
  });
});
