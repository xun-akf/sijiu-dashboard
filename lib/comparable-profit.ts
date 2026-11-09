export type ProfitRecord = { charge?: number | null; profit?: number | null };
export type ProfitPair = { current?: ProfitRecord | null; previous?: ProfitRecord | null };

/**
 * Compares weekly profit on one accounting basis. Each station's prior-week
 * volume is valued at its current-week profit per kWh, then station amounts
 * are summed before calculating the percentage.
 */
export function comparableProfitTotals(pairs: ProfitPair[]) {
  let current = 0, previous = 0, coverage = 0;
  for (const pair of pairs) {
    const currentCharge = pair.current?.charge;
    const currentProfit = pair.current?.profit;
    const previousCharge = pair.previous?.charge;
    if (currentCharge == null || currentProfit == null || previousCharge == null ||
        !Number.isFinite(currentCharge) || !Number.isFinite(currentProfit) ||
        !Number.isFinite(previousCharge) || currentCharge <= 0 || previousCharge < 0) continue;
    current += currentProfit;
    previous += currentProfit / currentCharge * previousCharge;
    coverage += 1;
  }
  return { current, previous, coverage,
    change: coverage && previous !== 0 ? current / previous - 1 : null };
}
