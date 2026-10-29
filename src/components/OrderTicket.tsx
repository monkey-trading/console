"use client";

/** The right pane: the deal ticket, remounted when the market changes so a trigger price typed for one market never reaches another. */

import { useConsole } from "./ConsoleProvider";
import { DealTicket } from "./DealTicket";

export function OrderTicket() {
  const { selected } = useConsole();
  return <DealTicket key={selected} />;
}
