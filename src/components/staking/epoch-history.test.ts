/** Tests for what the closed-epochs card shows beside epochs it holds when the node stops serving them. */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EngineError } from "@/lib/engine/client";
import { NODE_READ_MS } from "@/lib/monkey/panel";
import { started } from "@/lib/staking/epoch-reads-kit";
import { unavailableText } from "@/lib/staking/epoch-words";

import { EpochHistory } from "./EpochHistory";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("EpochHistory", () => {
  it("says beside the retained rows that the node no longer serves them, inside the card's fixed viewport", async () => {
    const { epochs, node, stop } = await started(3);
    const render = () => renderToStaticMarkup(createElement(EpochHistory, { epochs, labelOf: (address: string) => address }));
    const line = unavailableText({ status: "unavailable", epochs: epochs.getSnapshot().epochs });
    expect(render()).not.toContain(line);
    node.client.stats.distributionEpochs = () => Promise.reject(new EngineError(404, "not found"));
    await vi.advanceTimersByTimeAsync(NODE_READ_MS);
    const html = render();
    expect(epochs.getSnapshot().status).toBe("unavailable");
    // The line sits in the status region above the table that still lists every retained epoch, all inside the h-96 viewport.
    expect(html).toMatch(new RegExp(`h-96[^>]*><p role="status"[^>]*>${line}</p><table`));
    expect(html.match(/<tr class="border-t/g)).toHaveLength(3);
    stop();
  });
});
