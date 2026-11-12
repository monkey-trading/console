/**
 * Tests for the window a MONKEY chart card describes beside its data (monkey-trading/console#323): the
 * line under loaded data follows the window those points were read for, never the one requested, and a
 * driven card (the Dashboard's) shows no timeframe control of its own (#321).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NO_STATS } from "@/lib/engine/live-stats";
import type { SeriesPage, SeriesQuery } from "@/lib/engine/stats-types";
import { ChartFeed } from "@/lib/monkey/feed";
import type { TimeframeId } from "@/lib/monkey/timeframes";

import { ChartCard } from "./ChartCard";

const ALL_LINE = "All covers the most recent 1,998 days";
/** The All line as a visible paragraph, not the unseen one that holds its place. */
const SHOWN_ALL = /<p class="(?![^"]*\binvisible\b)[^"]*">All covers/;

const page = (query: SeriesQuery): SeriesPage => ({
  metric: query.metric, market: null, resolution: query.resolution, kind: "flow", unit: "usdc_base_units", begins_ms: 100, begins_seq: 0, from_genesis: true, retained_from_ms: null,
  entries: [{ ts: 1_000, value: "5000000" }], next: null, max_limit: 2_000,
});

/** A feed opened on `initial` whose reads answer until `fail` is set. */
function feedOn(initial: TimeframeId) {
  const control = { fail: false };
  const feed = new ChartFeed(["total_staked"], {
    ...NO_STATS,
    series: async (query) => {
      if (control.fail) throw new Error("The node did not answer.");
      return page(query);
    },
  }, () => 10_000_000, () => true, initial);
  return { feed, control };
}

const card = (feed: ChartFeed, timeframe?: TimeframeId) =>
  renderToStaticMarkup(createElement(ChartCard, { id: "c", title: "Staked", feed, kind: "lines", lines: [{ metric: "total_staked", label: "Staked", tone: "glow" }], format: String, ...(timeframe === undefined ? {} : { timeframe }) }));

describe("ChartCard's window line", () => {
  it("describes All beside All data, and not beside 7D data", async () => {
    const all = feedOn("all");
    await all.feed.show();
    expect(card(all.feed)).toContain(ALL_LINE);
    const week = feedOn("7d");
    await week.feed.show();
    expect(card(week.feed)).not.toContain(ALL_LINE);
    expect(card(all.feed)).toMatch(SHOWN_ALL);
  });

  it("keeps the All line beside the All data it holds while a change to 7D loads or fails", async () => {
    const { feed, control } = feedOn("all");
    await feed.show();
    control.fail = true;
    await feed.setTimeframe("7d");
    expect(feed.getSnapshot()).toMatchObject({ timeframe: "7d", read: { status: "failed" } });
    const html = card(feed, "7d");
    expect(html).toContain(ALL_LINE);
    expect(html).toContain("The chart shows the All window it already holds.");
  });

  it("drops the All line beside the 7D data it holds while a change to All fails, and leaves a loading card's held place to describe the request", async () => {
    const { feed, control } = feedOn("7d");
    await feed.show();
    control.fail = true;
    await feed.setTimeframe("all");
    const html = card(feed, "all");
    expect(html).toContain("The chart shows the 7D window it already holds.");
    // The line is not shown beside 7D data: only its unseen place is held, for the All the card asked for.
    expect(html).not.toMatch(SHOWN_ALL);
    expect(html).toMatch(/aria-hidden="true" class="[^"]*\binvisible\b[^"]*">All covers/);
    // With nothing held, the placeholder keeps the loaded height, so it describes the window asked for.
    expect(card(feedOn("all").feed, "all")).toContain(ALL_LINE);
  });
});

describe("a driven ChartCard", () => {
  it("shows no timeframe control of its own, and shows one when the card is not driven", async () => {
    const { feed } = feedOn("7d");
    await feed.show();
    expect(card(feed, "7d")).not.toContain("Staked timeframe");
    expect(card(feed)).toContain("Staked timeframe");
  });
});
