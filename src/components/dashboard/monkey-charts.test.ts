/** Tests for the Dashboard's MONKEY section while the overview behind its budget line is read (monkey-trading/console#319). */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MonkeyPanel } from "@/lib/monkey/panel";

import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { MonkeyPanelProvider } from "../monkey/use-monkey";
import { MonkeyCharts } from "./MonkeyCharts";

function Section() {
  const { store } = useSession();
  return createElement(MonkeyPanelProvider, { value: new MonkeyPanel(store, "dashboard") }, createElement(MonkeyCharts, { range: "all" }));
}

describe("MonkeyCharts before its overview is read", () => {
  it("holds the budget line's place unseen, and the chart's begins and All lines, so the card keeps its loaded height", () => {
    const html = renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Section)));
    expect(html).toMatch(/aria-hidden="true" class="[^"]*\binvisible\b[^"]*">The budget is 1,000 MONKEY per period, and halves at 1 Jan 00:00:00 UTC\. Halvings that have passed are marked\./);
    expect(html).toMatch(/aria-hidden="true" class="invisible">[^]*Data begins 1 Jan 00:00:00 UTC\.[^]*All covers the most recent 1,998 days/);
    // The supply card's two figures wrap onto two lines once read, so the held line carries both labels with a typical figure.
    expect(html).toContain("Allocated 000,000,000 MONKEY  ·  Staked 000,000,000 MONKEY");
    expect(html).toContain("Latest —");
  });
});
