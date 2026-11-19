/** Tests that the deal ticket pauses while the operator follower waits on a node or finds the operator on one the build does not list (monkey-trading/console#273). */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { signBlock } from "@/lib/engine/attestation";
import type { FollowStatus } from "@/lib/engine/operator-follow";
import { fixedFromInt } from "@/lib/fixed";
import type { AccountModel } from "@/lib/models";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { DealTicket } from "./DealTicket";

const followed = vi.hoisted(() => ({ status: null as FollowStatus | null }));
vi.mock("./ConsoleProvider", async (original) => ({ ...(await original<typeof import("./ConsoleProvider")>()), useNodeFollow: () => followed.status }));

const account: AccountModel = {
  balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: 0n, positions: [], orders: [],
  requirements: { initialMargin: 0n, maintenanceMargin: 0n, withdrawable: fixedFromInt(10_000), maxLeverage: new Map([[1, fixedFromInt(20)]]) },
};

function Seed({ readOnly = false }: { readOnly?: boolean }) {
  const { store } = useSession();
  store.patch({ account, accountRead: true, wallet: { address: "0xabc", label: "w", readOnly }, signatures: "checked", selected: 1 });
  return null;
}

const render = (status: FollowStatus | null) => {
  followed.status = status;
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed), createElement(DealTicket)));
};

describe("the ticket while the operator moves", () => {
  it("pauses on a handover and on an operator whose node the build does not list, each in its own words", () => {
    expect(render({ kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "connecting", reason: null })).toContain("New orders are paused while the trading server changes. They will be accepted again automatically once the new server has been verified and live prices have returned.");
    const unlisted = render({ kind: "unlisted", origin: "https://a.test", hostname: "c.test" });
    expect(unlisted).toContain("This version of the app does not recognise the next trading server, so trading has been suspended. Trading will resume once the app has been updated.");
  });

  it("pauses on a drop held as a change of server around a turn boundary, and not on one away from any", () => {
    expect(render({ kind: "confirming", origin: "https://a.test", scheduled: true })).toContain("New orders are paused while the trading server changes.");
    expect(render({ kind: "confirming", origin: "https://a.test", scheduled: false })).not.toContain("trading server changes");
  });

  it("does not pause on a node followed or pinned", () => {
    expect(render({ kind: "following", origin: "https://a.test" })).not.toContain("trading server changes");
    expect(render(null)).not.toContain("trading server changes");
  });

  it("says why it cannot sign in one sentence, ahead of the market's own state", () => {
    followed.status = { kind: "waiting", origin: "https://a.test", target: "https://b.test", stage: "connecting", reason: null };
    const html = renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { readOnly: true }), createElement(DealTicket)));
    const why = (signBlock({ kind: "mock" }, "live", true) ?? "").replace(/'/g, "&#x27;");
    expect(html).toContain(`Trading is unavailable because ${why}.`);
    expect(html).not.toContain("trading server changes");
  });
});
