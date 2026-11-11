export type PeriodPrice = { peak: string; high: string; flat: string; valley: string };

export function deriveActivityComponents(originalTotal: PeriodPrice, originalService: PeriodPrice, activityTotal: PeriodPrice) {
  const empty = (): PeriodPrice => ({ peak: '', high: '', flat: '', valley: '' });
  const result = { electricity: empty(), service: empty(), total: activityTotal };
  for (const key of ['peak', 'high', 'flat', 'valley'] as const) {
    const original = originalTotal[key] === '' ? NaN : Number(originalTotal[key]);
    const baseFee = originalService[key] === '' ? NaN : Number(originalService[key]);
    const activity = activityTotal[key] === '' ? NaN : Number(activityTotal[key]);
    const electricity = original - baseFee;
    const activityFee = activity - electricity;
    if (![original, baseFee, activity].every(Number.isFinite) || electricity < 0 || activityFee < -0.00005 || activityFee > baseFee + 0.00005) continue;
    result.electricity[key] = electricity.toFixed(4);
    result.service[key] = Math.max(0, activityFee).toFixed(4);
  }
  return result;
}

export function calculateDiscountedPeriods(
  originalTotal: PeriodPrice,
  originalService: PeriodPrice,
  rate: number,
): { electricity: PeriodPrice; service: PeriodPrice; total: PeriodPrice } {
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new RangeError('Discount must be 0–100%');
  const empty = (): PeriodPrice => ({ peak: '', high: '', flat: '', valley: '' });
  const result = { electricity: empty(), service: empty(), total: empty() };
  for (const key of ['peak', 'high', 'flat', 'valley'] as const) {
    const total = originalTotal[key] === '' ? NaN : Number(originalTotal[key]);
    const fee = originalService[key] === '' ? NaN : Number(originalService[key]);
    if (!Number.isFinite(total) || !Number.isFinite(fee) || fee < 0 || total < fee) continue;
    const electricity = total - fee;
    const discountedFee = fee * rate / 100;
    result.electricity[key] = electricity.toFixed(4);
    result.service[key] = discountedFee.toFixed(4);
    result.total[key] = (electricity + discountedFee).toFixed(4);
  }
  return result;
}
