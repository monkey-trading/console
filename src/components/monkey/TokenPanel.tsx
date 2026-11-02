"use client";

/** The token: its supply, how much of it is staked, and where it lives. */

import { formatRate } from "@/lib/format";
import { monkeyText, shareBps } from "@/lib/monkey/figures";

import { useSession } from "../ConsoleProvider";
import { AddressRow } from "./AddressRow";
import { Card } from "./Card";
import { ReadNote } from "./ReadNote";
import { Row } from "./Row";
import { NOTE } from "./styles";
import { usePanelState } from "./use-monkey";

export function TokenPanel() {
  const { overview } = usePanelState();
  const { deploy, store } = useSession();
  const emissions = overview.value?.emissions ?? null;
  const staking = overview.value?.staking ?? null;
  const ratio = emissions === null || staking === null ? null : shareBps(BigInt(staking.total_staked), BigInt(emissions.allocated));
  const contracts = store.deps.client.stats.contracts;
  return (
    <Card id="token-title" title="MONKEY">
      <dl className="space-y-2">
        <Row label="Total allocated">{monkeyText(emissions?.allocated)}</Row>
        <Row label="Maximum supply">{monkeyText(emissions?.max_supply)}</Row>
        <Row label="Staked supply">{monkeyText(staking?.total_staked)}</Row>
        <Row label="Stake ratio">{ratio === null ? "—" : formatRate(ratio)}</Row>
        <AddressRow label="Token" address={deploy.monkey ?? contracts?.token ?? null} />
        <AddressRow label="Staking contract" address={deploy.staking ?? contracts?.staking ?? null} />
      </dl>
      <ReadNote read={overview} />
      <p className={NOTE}>The stake ratio is the staked supply as a share of everything allocated so far.</p>
    </Card>
  );
}
