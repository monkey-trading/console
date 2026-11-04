export interface DistributionBreakdown {
  grossReward: number;
  operatorCommissionBps: number;
  operatorFeeAmount: number;
  netStakerDistribution: number;
}

/**
 * Separates the operator commission cut from net staker distribution figures (#295).
 */
export function computeStakerNetDistribution(
  grossReward: number,
  operatorCommissionBps: number = 1000
): DistributionBreakdown {
  const safeGross = Math.max(0, Number(grossReward) || 0);
  const clampedBps = Math.min(10_000, Math.max(0, Number(operatorCommissionBps) || 0));
  const operatorFeeAmount = Number(((safeGross * clampedBps) / 10_000).toFixed(6));
  const netStakerDistribution = Number((safeGross - operatorFeeAmount).toFixed(6));

  return {
    grossReward: safeGross,
    operatorCommissionBps: clampedBps,
    operatorFeeAmount,
    netStakerDistribution,
  };
}
