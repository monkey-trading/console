/** The store's messages: the surfaces a message shows on, one message each, and those that outlive a change of wallet. */

import type { LevelKind } from "../engine/level-types";

/** Where a message shows: beside the control the trader used, or in the one place its subject has on the page. */
export const NOTICE_SURFACES = [
  "ticket", "orders", "positions", "levels", "accountRead", "account", "deposit", "withdraw", "faucet", "setup", "payouts", "payoutReads", "payoutVault",
  "emissions", "distribution", "stake", "operator", "governance", "settings", "wallet", "node", "feed", "chart", "exit",
] as const;
export type NoticeSurface = (typeof NOTICE_SURFACES)[number];

/** One message on a surface. A failure is `error` and read out as an alert; `info` is a status. `id` tells a repeat of the same text from the message already there. */
export interface Notice {
  id: number;
  tone: "error" | "info";
  text: string;
  /** The level a refusal of a take profit or stop loss concerns, under whose field the levels dialog shows it. */
  field?: LevelKind;
}

export type Notices = Partial<Record<NoticeSurface, Notice>>;

/** The surfaces that outlive a change of wallet: they are about the node, the feed, the chart, or how the last wallet's connection ended. */
export const KEPT_ON_WALLET_CHANGE: readonly NoticeSurface[] = ["wallet", "node", "feed", "chart"];
