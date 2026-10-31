/** What a console store is built from: the node's client, the wallet connectors, and the page's starting state. */

import type { EngineClient } from "../engine/client";
import type { AccountView, EligibilityClass, HistoryEvent, HouseView, MarketView, QueuedWithdrawal, StreamMessage } from "../engine/types";
import type { WalletConnector } from "../engine/wallet";
import type { ScanClock } from "./bars-scan";
import type { HistorySource } from "./state";

export interface StoreDeps {
  client: EngineClient;
  wallets: WalletConnector;
  /** Advances a node that runs in this page; absent for a live node. */
  drive?: (ms: number) => void;
  /** What the chart-history scan's backoff waits on; a test substitutes one without real timers. */
  scanClock?: ScanClock;
  initial: { markets: MarketView[]; house: HouseView; startMs: number; recent?: StreamMessage[]; /** The account whose events the activity log shows before a wallet connects. */ viewer?: string;
    /** A wallet already connected when the page loads, with what the node holds for it. */
    session?: { wallet: { address: string; label: string; readOnly?: boolean }; account: AccountView | null; eligibility: EligibilityClass | null; queue: QueuedWithdrawal[]; history: HistoryEvent[] };
  };
  /** Price history for the chart, ending at the current mark. */
  history: HistorySource;
}
