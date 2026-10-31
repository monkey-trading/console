/** Shared fixtures for the chart-history scan tests: a store over a fake client and canned marks. */

import { settle } from "../engine/test-kit";
import { WatchConnector } from "../engine/watch-wallet";
import { ConsoleStore } from "./store";
import type { FakeClient } from "./live-fake";

export const T = 1_800_000_000_000;
export const MARKS = [
  { market: 1, ts: T - 60_000, mid: 100 },
  { market: 1, ts: T, mid: 101 },
];

export function storeOver(client: FakeClient, clock?: import("./bars-scan").ScanClock) {
  return new ConsoleStore({
    client, wallets: new WatchConnector(() => ""), history: () => [], ...(clock === undefined ? {} : { scanClock: clock }),
    initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 },
  });
}

export const flush = async () => { for (let i = 0; i < 6; i++) await settle(); };
