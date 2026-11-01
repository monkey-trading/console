/** What a console store is built from: the node's client, the wallet connectors, and the page's starting state. */

import type { EngineClient } from "../engine/client";
import type { AccountView, EligibilityClass, HistoryEvent, HouseView, MarketView, QueuedWithdrawal, StreamMessage } from "../engine/types";
import type { CheckpointEntry } from "../engine/wire";
import type { HouseParams, QueueTotals } from "../house";
import type { WalletConnector } from "../engine/wallet";
import type { MarketModel } from "../models";
import type { ScanClock } from "./bars-scan";
import type { ConsoleStore } from "./store";
import type { HistorySource } from "./state";

/** The house panel's initial state; a mock session reads it synchronously, a live one leaves it empty until the first verified read. */
export interface HousePanelInit {
  params: HouseParams | null;
  checkpoint: CheckpointEntry | null;
  totals: QueueTotals | null;
}

export interface StoreDeps {
  client: EngineClient;
  wallets: WalletConnector;
  /** Advances a node that runs in this page; absent for a live node. */
  drive?: (ms: number) => void;
  /** What the chart-history scan's backoff waits on; a test substitutes one without real timers. */
  scanClock?: ScanClock;
  /**
   * Starts the archive-scan fallback that seeds the chart for a node without the marks endpoint
   * (a 404 there asks for it once). False when the node has not named a log head yet, so the next
   * read asks again. The live session wires `scanBarsHistory`.
   */
  historyScan?: (store: ConsoleStore, markets: readonly MarketModel[]) => boolean;
  initial: { markets: MarketView[]; house: HouseView; startMs: number; recent?: StreamMessage[]; /** The account whose events the activity log shows before a wallet connects. */ viewer?: string; /** The house panel's state, read synchronously by a mock session; absent for a live node. */ housePanel?: HousePanelInit;
    /** A wallet already connected when the page loads, with what the node holds for it. */
    session?: { wallet: { address: string; label: string; readOnly?: boolean }; account: AccountView | null; eligibility: EligibilityClass | null; queue: QueuedWithdrawal[]; history: HistoryEvent[] };
  };
  /** Price history for the chart, ending at the current mark. */
  history: HistorySource;
}
