/** Shared setup for the closed-epochs reads' tests: the node's closes served newest first against the mock node. */

import type { DistributionEpochsPage, EpochClose } from "../engine/staking-reads";
import { flush, setup } from "../monkey/panel-kit";
import { EpochReads } from "./epoch-reads";

export const close = (epoch: number, over: Partial<EpochClose> = {}): EpochClose => ({
  epoch, close_seq: epoch * 10, close_ms: epoch * 1_000, ended_ms: epoch * 1_000, nav: "5000000", floor: "4900000", excess_usdc_units: "100", allocated_usdc_units: "100",
  stakers_usdc_units: "80", stakers: 2, operator_shares: [{ account: "0x00000000000000000000000000000000000000a1", amount: "20" }], skipped: null, ...over,
});

/** A page of `epochs`, newest first, with `next` the cursor to read on from. */
export const page = (epochs: number[], next: number | null): DistributionEpochsPage => ({
  seq: 1, time_ms: 1, epochs: epochs.map((epoch) => close(epoch)), next, begins_ms: 0, begins_seq: 0, from_genesis: true, truncated: false, retained_from_epoch: null,
});

/** The node's closes numbered 1 to `count`, served newest first and paged as the node pages them. */
export function serve(count: number) {
  const reads: { before?: number; limit?: number }[] = [];
  const answer = async (params: { before?: number; limit?: number }) => {
    reads.push(params);
    const older = Array.from({ length: count }, (_, i) => count - i).filter((epoch) => params.before === undefined || epoch < params.before);
    const shown = older.slice(0, params.limit ?? 50);
    return page(shown, older.length > shown.length ? (shown[shown.length - 1] ?? null) : null);
  };
  return { reads, answer, more: () => { count += 1; } };
}

export async function started(count: number, hidden = () => false) {
  const kit = await setup();
  const served = serve(count);
  kit.node.client.stats.distributionEpochs = (params) => served.answer(params);
  const epochs = new EpochReads(kit.store);
  const stop = epochs.start(hidden);
  await flush();
  return { ...kit, epochs, stop, served };
}
