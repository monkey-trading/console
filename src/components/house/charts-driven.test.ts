/**
 * Tests for the House charts when a page drives their range (the Dashboard, monkey-trading/console#321):
 * no chart shows a timeframe control of its own, the NAV chart says the floor note it is given, and the
 * queue chart's headline does not lean on queue-walk totals a House visit left behind.
 */

import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { parseFixed } from "@/lib/fixed";
import type { QueueTotals } from "@/lib/house";
import type { ConsoleState } from "@/lib/store/state";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { ExposureChart, NavChart, QueueChart } from "./Charts";

const owed = parseFixed("1234.5");
const WALKED: QueueTotals | null = owed === null ? null : { count: 3, remaining: owed, largest: owed, head: owed, seq: 7, complete: true, stable: true };

/** `chart` rendered under the console's provider with `state` set first. */
function render(chart: ComponentType, state: Partial<ConsoleState> = {}): string {
  const Seeded = () => {
    useSession().store.patch(state);
    return createElement(chart);
  };
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seeded)));
}

const nav = (props: Parameters<typeof NavChart>[0]) => () => createElement(NavChart, props);
const queue = (props: Parameters<typeof QueueChart>[0]) => () => createElement(QueueChart, props);

describe("the House charts under a driven range", () => {
  it("shows no timeframe control while a range is supplied, and its own control without one", () => {
    const floor = { value: null, note: null };
    expect(render(nav({ range: "7d", floor }))).not.toContain("NAV timeframe");
    expect(render(() => createElement(ExposureChart, { range: "7d" }))).not.toContain("House exposure timeframe");
    expect(render(queue({ range: "7d", walked: false }))).not.toContain("Queue total timeframe");
    expect(render(nav({ floor }))).toContain("NAV timeframe");
    expect(render(() => createElement(ExposureChart))).toContain("House exposure timeframe");
    expect(render(queue({}))).toContain("Queue total timeframe");
  });

  it("says the note the page supplies for the NAV floor", () => {
    const note = "The node did not answer for the liquidity floor, so there is nothing to show yet.";
    expect(render(nav({ range: "7d", floor: { value: 5_000_000, note } }))).toContain(note);
    expect(render(nav({ range: "7d", floor: { value: 5_000_000, note: null } }))).not.toContain("liquidity floor, so");
  });

  it("leaves the queue headline to the chart's own series where the walk is not the page's, and shows a complete walk's total where it is", () => {
    const state = { withdrawalTotals: WALKED, queueFailed: false };
    // The House page's walked headline reads $1.23K; the Dashboard's has no walk behind it, so it shows no figure until its series answers.
    expect(render(queue({ range: "7d" }), state)).toContain("$1.23K");
    expect(render(queue({ range: "7d", walked: false }), state)).not.toContain("$1.23K");
  });
});

/** What the pending panel's unseen footnote holds: the loaded footnote's sentences, in an element hidden from sight and assistive technology. */
const heldFootnote = (html: string) => html.match(/<span aria-hidden="true" class="invisible">([^<]*)<\/span>/)?.[1] ?? null;

describe("the House charts while their page waits for the first answers (monkey-trading/console#319)", () => {
  it("holds the loaded footnote's sentences unseen under the reading line, the All window's and the scan's included", () => {
    const html = render(() => createElement(ExposureChart, { range: "all", pending: true }));
    expect(heldFootnote(html)).toBe("Data begins 1 Jan 00:00:00 UTC, from the log&#x27;s first command. All covers the most recent 1,998 days, the most one read holds at daily buckets. These figures are the node&#x27;s periodic scan of every account, so a position opened and closed between two scans does not show.");
    expect(html).toContain("Reading the node&#x27;s signed history…");
    expect(heldFootnote(render(nav({ range: "7d", pending: true, floor: { value: null, note: null } })))).toBe("Data begins 1 Jan 00:00:00 UTC, from the log&#x27;s first command.");
  });

  it("shows no figure while pending, even where the store holds a queue total", () => {
    const state = { withdrawalTotals: WALKED, queueFailed: false };
    expect(render(queue({ range: "7d", pending: true }), state)).not.toContain("$1.23K");
    expect(render(queue({ range: "7d", pending: true }), state)).toContain("—");
  });
});

