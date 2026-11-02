/** Tests for the In progress panel's deposits on their way. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { fixedFromInt } from "@/lib/fixed";

import { ConsoleProvider, useSession } from "./ConsoleProvider";
import { InProgress } from "./InProgress";

function Seed({ amounts }: { amounts: number[] }) {
  const { store } = useSession();
  store.patch({ pendingDeposits: amounts.map((a, i) => ({ id: i === 0 ? null : String(i), amount: fixedFromInt(a) })) });
  return null;
}

const render = (amounts: number[]) => renderToStaticMarkup(createElement(ConsoleProvider, null, createElement(Seed, { amounts }), createElement(InProgress)));

describe("PendingDeposits", () => {
  it("lists each deposit on its way, with its amount, in the In progress panel", () => {
    const html = render([100, 250]);
    expect(html).toContain("Deposits on their way");
    expect(html).toContain("100 USDC");
    expect(html).toContain("250 USDC");
    expect(html).toContain("The node credits it a few blocks after it is mined.");
  });

  it("shows nothing when none is waiting", () => {
    expect(render([])).not.toContain("Deposits on their way");
  });
});
