/** Tests for the inline message every surface renders: its markup, roles and what it shows. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { NoticeView } from "./Notice";

const render = (notice: Parameters<typeof NoticeView>[0]["notice"], prompt: string | null = null) => renderToStaticMarkup(createElement(NoticeView, { notice, prompt }));

describe("NoticeView", () => {
  it("shows a failure inside the alert region and no status", () => {
    const html = render({ id: 1, tone: "error", text: "The node refused the order." });
    expect(html).toContain('<div role="alert" class="empty:hidden"><p class="mt-2 text-label leading-relaxed [overflow-wrap:anywhere] text-ember">The node refused the order.</p></div>');
    expect(html).toContain('<div role="status" class="empty:hidden"></div>');
  });

  it("shows an information notice inside the status region and no alert", () => {
    const html = render({ id: 1, tone: "info", text: "Requested." });
    expect(html).toContain('<div role="status" class="empty:hidden"><p class="mt-2 text-label leading-relaxed [overflow-wrap:anywhere] text-fg-2">Requested.</p></div>');
    expect(html).toContain('<div role="alert" class="empty:hidden"></div>');
  });

  it("keeps both live regions mounted and empty with nothing to say, so the first message is announced", () => {
    expect(render(undefined)).toBe('<div role="status" class="empty:hidden"></div><div role="alert" class="empty:hidden"></div>');
  });

  it("shows the wallet's pending request in the status region, above the last result", () => {
    const html = render({ id: 2, tone: "error", text: "Declined." }, "Confirm in your wallet: withdraw 100 USDC.");
    expect(html.indexOf("Confirm in your wallet: withdraw 100 USDC.")).toBeGreaterThan(html.indexOf('role="status"'));
    expect(html.indexOf("Confirm in your wallet: withdraw 100 USDC.")).toBeLessThan(html.indexOf('role="alert"'));
    expect(html).toContain("Declined.");
  });

  it("has no dismiss button, no timer and nothing fixed in the page", () => {
    const html = render({ id: 1, tone: "error", text: "x" }, "y");
    expect(html).not.toMatch(/<button|popover|fixed|data-toast/);
  });
});
