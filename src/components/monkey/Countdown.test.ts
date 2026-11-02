/** Tests for the MONKEY page's countdowns: where they show, what they say, and when they hide. */

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { MonkeyView } from "@/lib/engine/stats-types";
import { MonkeyPanel } from "@/lib/monkey/panel";

import { EmissionsCard } from "../EmissionsCard";
import { ConsoleProvider, useSession } from "../ConsoleProvider";
import { DistributionClaim } from "./DistributionClaim";
import { MonkeyPanelProvider } from "./use-monkey";

const NOW = 1_793_662_020_000 + 3 * 600_000 + 138_000;
const view = { emissions: { start_ms: 1_793_662_020_000, period_ms: 600_000 }, distribution: { epoch_ms: 300_000, next_close_ms: NOW + 462_000 } } as MonkeyView;

function Page({ overview, now = NOW, children }: { overview: MonkeyView | null; now?: number; children?: ReactNode }) {
  const { store } = useSession();
  store.patch({ now });
  const panel = new MonkeyPanel(store);
  if (overview !== null) (panel as unknown as { state: unknown }).state = { ...panel.getSnapshot(), overview: { status: "ready", value: overview, message: null } };
  return createElement(MonkeyPanelProvider, { value: panel }, children);
}

const render = (overview: MonkeyView | null, card: "emissions" | "distributions", now?: number) =>
  renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Page, { overview, now }, createElement(card === "emissions" ? EmissionsCard : DistributionClaim, { claim: async () => undefined }))));

describe("the countdowns", () => {
  it("shows the next budget in the emissions card, with no wallet connected", () => {
    const html = render(view, "emissions");
    expect(html).toContain("Next in 7m 42s");
    expect(html).toContain('aria-label="Next budget in 8 minutes"');
    expect(html).toContain("text-glow");
    expect(html).toContain("tabular-nums");
  });

  it("shows the next epoch close in the distributions card", () => {
    const html = render(view, "distributions");
    expect(html).toContain("Next in 7m 42s");
    expect(html).toContain('aria-label="Next epoch close in 8 minutes"');
  });

  it("rolls a stale close on to the next one", () => {
    const stale = { ...view, distribution: { epoch_ms: 300_000, next_close_ms: NOW - 1_000 } } as MonkeyView;
    expect(render(stale, "distributions")).toContain("Next in 4m 59s");
  });

  it("is no live region", () => {
    expect(render(view, "emissions")).toContain('aria-live="off"');
  });

  it("hides with no answer, no section or no clock", () => {
    for (const card of ["emissions", "distributions"] as const) {
      expect(render(null, card)).not.toContain("Next in");
      expect(render({ ...view, emissions: null, distribution: null }, card)).not.toContain("Next in");
      expect(render(view, card, 0)).not.toContain("Next in");
    }
  });
});
