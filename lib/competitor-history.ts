export const pricePeriods = ["peak", "high", "flat", "valley"] as const;
export type PricePeriod = typeof pricePeriods[number];
export type PeriodPrices = Record<PricePeriod, string>;
export type CompetitorPrice = {
  name: string; distance: string; guns: string;
  peak: string; high: string; flat: string; valley: string;
  electricity?: PeriodPrices; service?: PeriodPrices; total?: PeriodPrices;
};
export type CompetitorHistory = Record<string, CompetitorPrice[]>;

export function readCompetitorHistory(raw?: string): CompetitorHistory {
  try {
    const value: unknown = JSON.parse(raw || "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, CompetitorPrice[]] =>
      Array.isArray(entry[1])));
  } catch { return {}; }
}

/** Distance is site metadata, so a blank weekly import inherits a known value. */
export function knownCompetitorDistance(history: CompetitorHistory, name: string, fallback: CompetitorPrice[] = []): string {
  const identity = (value: string) => value.trim().toLowerCase().replace(/[\\s\\-—_（）()【】\\[\\]·]/g, "");
  const rows = [...Object.values(history).reverse().flat(), ...fallback];
  return rows.find((row) => identity(row.name) === identity(name) && row.distance?.trim())?.distance || "";
}

export function saveCompetitorWeek(history: CompetitorHistory, week: string, rows: CompetitorPrice[]): CompetitorHistory {
  return { ...history, [week]: rows };
}

export function numericPrice(value: unknown): number | null {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function competitorTotal(competitor: CompetitorPrice, period: PricePeriod): number | null {
  const total = numericPrice(competitor.total?.[period] ?? competitor[period]);
  if (total != null) return total;
  const electricity = numericPrice(competitor.electricity?.[period]);
  const service = numericPrice(competitor.service?.[period]);
  return electricity != null && service != null ? electricity + service : null;
}

const identity = (name: string) => name.trim().replace(/\s+/g, " ");
export type CompetitorChange = { periods: Record<PricePeriod, number | null>; average: number | null };

export function compareCompetitorWeeks(current: CompetitorPrice[], previous?: CompetitorPrice[]) {
  const priorByName = new Map((previous || []).map((row) => [identity(row.name), row]));
  const changes = new Map<string, CompetitorChange>();
  let rising = 0, falling = 0, steady = 0;
  let largest: { name: string; delta: number } | null = null;
  for (const row of current) {
    const before = priorByName.get(identity(row.name));
    const periods = Object.fromEntries(pricePeriods.map((period) => {
      const now = competitorTotal(row, period), then = before ? competitorTotal(before, period) : null;
      return [period, now == null || then == null ? null : now - then];
    })) as Record<PricePeriod, number | null>;
    const values = pricePeriods.map((key) => periods[key]).filter((value): value is number => value != null);
    const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
    changes.set(identity(row.name), { periods, average });
    if (average == null) continue;
    if (average > 0.00005) rising++;
    else if (average < -0.00005) falling++;
    else steady++;
    if (!largest || Math.abs(average) > Math.abs(largest.delta)) largest = { name: row.name, delta: average };
  }
  return { changes, rising, falling, steady, largest, comparable: rising + falling + steady };
}

export function competitorAdvantageChange(
  current: CompetitorPrice[], previous: CompetitorPrice[] | undefined,
  ownCurrent: Partial<PeriodPrices> | null, ownPrevious: Partial<PeriodPrices> | null,
): number | null {
  if (!previous || !ownCurrent || !ownPrevious) return null;
  const priorByName = new Map(previous.map((row) => [identity(row.name), row]));
  const gaps: number[] = [];
  for (const row of current) {
    const before = priorByName.get(identity(row.name));
    if (!before) continue;
    for (const period of pricePeriods) {
      const now = competitorTotal(row, period), then = competitorTotal(before, period);
      const ownNow = numericPrice(ownCurrent[period]), ownThen = numericPrice(ownPrevious[period]);
      if (now != null && then != null && ownNow != null && ownThen != null)
        gaps.push((now - ownNow) - (then - ownThen));
    }
  }
  return gaps.length ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : null;
}
