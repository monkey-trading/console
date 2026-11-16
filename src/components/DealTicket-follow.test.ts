/** Tests that the deal ticket pauses while the operator follower waits on a node or finds the operator on one the build does not list (monkey-trading/console#273). */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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

function Seed() {
  const { store } = useSession();
  store.patch({ account, accountRead: true, wallet: { address: "0xabc", label: "w" }, signatures: "checked", selected: 1 });
  return null;
}

const render = (status: FollowStatus | null) => {
  followed.status = status;
  return renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed), createElement(DealTicket)));
};

describe("the ticket while the operator moves", () => {
  it("pauses on a handover and on an operator whose node the build does not list, each in its own words", () => {
    expect(render({ kind: "waiting", origin: "https://a.test", target: "https://b.test", reason: "r" })).toContain("the operator is handing over");
    const unlisted = render({ kind: "unlisted", origin: "https://a.test", hostname: "c.test" });
    expect(unlisted).toContain("Trading is paused: the operator now runs on a node this console does not list, so the console needs an update.");
  });

  it("does not pause on a node followed or pinned", () => {
    expect(render({ kind: "following", origin: "https://a.test" })).not.toContain("Trading is paused: the operator");
    expect(render(null)).not.toContain("Trading is paused: the operator");
  });
});
