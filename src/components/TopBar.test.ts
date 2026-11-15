/** Tests for the top bar's account figures: the Free figure is the account strip's, equity above the node's initial requirement. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { fixedFromInt } from "@/lib/fixed";
import type { AccountModel } from "@/lib/models";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { TopBar } from "./TopBar";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const ACCOUNT: AccountModel = {
  balance: fixedFromInt(10_000), unfinalised: 0n, equity: fixedFromInt(10_000), margin: fixedFromInt(500), positions: [], orders: [],
  requirements: { initialMargin: fixedFromInt(2_500), maintenanceMargin: fixedFromInt(250), withdrawable: fixedFromInt(7_400), maxLeverage: new Map() },
};

function Seed({ account }: { account: AccountModel }) {
  const { store } = useSession();
  store.patch({ account });
  return null;
}

const free = (account: AccountModel) => {
  const html = renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { account }), createElement(TopBar)));
  return /Free<\/dt>\s*<dd[^>]*>([^<]*)</.exec(html)?.[1] ?? /Free[^$]*(\$[\d,.]+)/.exec(html)?.[1];
};

describe("TopBar's Free figure", () => {
  it("is equity above the initial requirement at the account's tier, as the Funding strip shows it", () => {
    expect(free(ACCOUNT)).toContain("7,500.00");
  });

  it("is equity above margin before the node serves the requirement", () => {
    expect(free({ ...ACCOUNT, requirements: undefined })).toContain("9,500.00");
  });
});
