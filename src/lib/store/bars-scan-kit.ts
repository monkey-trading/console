/** Shared fixtures for the chart-history scan tests: a store over a fake client and canned marks. */

import { EngineError } from "../engine/client";
import { settle } from "../engine/test-kit";
import { WatchConnector } from "../engine/watch-wallet";
import { scanBarsHistory } from "./bars-scan";
import { ConsoleStore } from "./store";
import type { FakeClient } from "./live-fake";

export const T = 1_800_000_000_000;
export const MARKS = [
  { market: 1, ts: T - 60_000, mid: 100 },
  { market: 1, ts: T, mid: 101 },
];

export function storeOver(client: FakeClient, clock?: import("./bars-scan").ScanClock) {
  // The scan is the marks endpoint's fallback, so these tests run it the way an old node reaches
  // it: the endpoint 404s and the store asks for the scan through its historyScan dependency.
  client.marks = async () => { throw new EngineError(404, "not found"); };
  return new ConsoleStore({
    client, wallets: new WatchConnector(() => ""), history: () => [], historyScan: (store, markets) => scanBarsHistory(store, markets, store.deps.scanClock), ...(clock === undefined ? {} : { scanClock: clock }),
    initial: { markets: [], house: { cash: "0", nav: "0", gross_exposure: "0" }, startMs: 0 },
  });
}

export const flush = async () => { for (let i = 0; i < 6; i++) await settle(); };
