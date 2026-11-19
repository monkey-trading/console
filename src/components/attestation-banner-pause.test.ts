/** Tests that the banner says nothing of the server being left while the console changes server, and calls a drop an outage only once the follower has. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { FollowStatus } from "@/lib/engine/operator-follow";
import type { PauseView } from "@/lib/store/trading-pause";

import { AttestationBanner } from "./AttestationBanner";
import { ConsoleProvider, useSession } from "./ConsoleProvider";

const held = vi.hoisted(() => ({ follow: null as FollowStatus | null, pause: { kind: "none" } as PauseView, path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => held.path }));
vi.mock("./ConsoleProvider", async (original) => ({ ...(await original<typeof import("./ConsoleProvider")>()), useNodeFollow: () => held.follow, useTradingPause: () => held.pause }));

const LOST = "The connection to the trading server has been lost";

/** The banner over a store whose stream dropped and whose server cannot be reached. */
function Dropped() {
  const { store } = useSession();
  store.patch({ stream: "stale", server: { kind: "unreachable" } });
  return null;
}

const render = (follow: FollowStatus | null, pause: PauseView, path = "/") => {
  Object.assign(held, { follow, pause, path });
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Dropped), createElement(AttestationBanner)));
};

const PAUSED: PauseView = { kind: "paused", steps: { connect: "current", verify: "waiting", prices: "waiting", resume: "waiting" }, long: false, failure: null, hold: null };

describe("the banner while the trading server changes", () => {
  it("keeps the outage line for a drop the follower has read as one, as before", () => {
    expect(render({ kind: "following", origin: "https://a.test" }, { kind: "none" })).toContain(LOST);
  });

  it("does not call a drop an outage while the follower is still reading where the operator runs", () => {
    expect(render({ kind: "confirming", origin: "https://a.test", scheduled: false }, { kind: "none" })).not.toContain(LOST);
  });

  it("leaves the trading page's panel to say trading is paused, and says it in one line on every other page", () => {
    const trading = render({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "connecting", reason: null }, PAUSED);
    // Nothing at all on the trading page, not even an empty region; elsewhere one line, which is no second live region beside the pause's own.
    expect(trading).toBe("");
    const other = render({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "connecting", reason: null }, PAUSED, "/funding");
    expect(other).toContain("Trading is paused while the trading server changes.");
    expect(other).not.toContain(LOST);
    expect(other).not.toMatch(/role="(status|alert)"/);
  });

  it("says a move with no pause, as when a page load finds the current server elsewhere, in one calm line", () => {
    const html = render({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "connecting", reason: null }, { kind: "none" });
    expect(html).toContain("Connecting to the current trading server.");
    expect(html).not.toContain(LOST);
  });
});
