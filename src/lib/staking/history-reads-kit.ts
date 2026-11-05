/** Shared setup for the Staking page's distribution-history reads' tests: a started read against the mock node, with its history route mocked. */

import { vi } from "vitest";

import type { HistoryPage } from "../engine/types";
import { DEMO_ADDRESS } from "../mock/demo";
import { flush, setup } from "../monkey/panel-kit";
import { shownRows } from "./distribution-history";
import { DistributionHistoryReads } from "./history-reads";

/** What the demo account is seeded with: one epoch's share, in USDC base units. */
export const SEEDED = 37_250_000n;

type Node = Awaited<ReturnType<typeof setup>>["node"];

/**
 * Serves `epochs` staker shares for the demo account from the history route, newest first and paged
 * as the node pages them; every other read goes to the mock. The mock's own closes share little
 * after the first, since the first takes the house's excess.
 */
function serveEpochs(node: Node, epochs: number) {
  const real = node.client.history.bind(node.client);
  const events = Array.from({ length: epochs }, (_, i) => ({ type: "distribution_allocated" as const, account: DEMO_ADDRESS, epoch: epochs - i, amount: "1000", cursor: `${10 * (epochs - i)}:0`, ts: epochs - i }));
  return vi.spyOn(node.client, "history").mockImplementation(async (address, params): Promise<HistoryPage> => {
    if (params.kind !== "distribution_allocated") return real(address, params);
    const older = events.filter((event) => params.before === undefined || Number(event.cursor.split(":")[0]) < Number(params.before.split(":")[0]));
    const page = older.slice(0, params.limit ?? 50);
    return { events: page, next: older.length > page.length ? (page[page.length - 1]?.cursor ?? null) : null };
  });
}

/** The page's store with the history's reads started for the demo account; `epochs` replaces its staker history with that many. */
export async function started({ epochs, hidden = () => false }: { epochs?: number; hidden?: () => boolean } = {}) {
  const kit = await setup();
  kit.stop();
  const pages = epochs === undefined ? vi.spyOn(kit.node.client, "history") : serveEpochs(kit.node, epochs);
  const history = new DistributionHistoryReads(kit.store);
  const stop = history.start(hidden);
  await flush();
  return { ...kit, history, pages, stop };
}

export const epochsOf = (history: DistributionHistoryReads) => shownRows(history.getSnapshot().data).map((row) => row.epoch);

/** The history route's reads of the kinds this store reads; the console's own account reads use the route too. */
export const mine = (pages: { mock: { calls: [string, { kind?: string }][] } }) => pages.mock.calls.filter(([, params]) => params.kind === "distribution_allocated" || params.kind === "operator_share_allocated");
