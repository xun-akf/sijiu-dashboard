import { calculateOperatingMetrics } from "@/lib/operating-metrics";

export type EnergyDay = { date: string; peak: number; high: number; flat: number; valley: number; charge: number };
export type EnergyMonth = Omit<EnergyDay, "date"> & { month: string; complete: boolean };
type RecordLike = { week: string; [key: string]: unknown };
export type PeriodStation<T extends RecordLike> = { name: string; records: T[]; dailyRecords?: EnergyDay[]; monthlySnapshots?: EnergyMonth[] };

export function weekForDate(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  const saturday = new Date(day.getTime() + (6 - day.getUTCDay()) * 86400000);
  const year = saturday.getUTCFullYear(), month = saturday.getUTCMonth() + 1;
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return `${year}年${month}月${Math.floor((saturday.getUTCDate() + first - 1) / 7) + 1}周`;
}

export function mergeEnergyDays(existing: EnergyDay[] = [], incoming: EnergyDay[] = []) {
  return [...new Map([...existing, ...incoming].map((item) => [item.date, item])).values()]
    .sort((a, b) => a.date.localeCompare(b.date));
}

const keys = ["peak", "high", "flat", "valley", "charge"] as const;
const sumEnergy = (rows: Array<EnergyDay | EnergyMonth>) => Object.fromEntries(
  keys.map((key) => [key, rows.reduce((total, row) => total + row[key], 0)]),
) as Pick<EnergyDay, typeof keys[number]>;

export function monthlyPeriods<T extends RecordLike>(source: PeriodStation<T>[], configs: Record<string, Record<string, string>>) {
  const months = [...new Set(source.flatMap((station) => [
    ...(station.dailyRecords || []).map((row) => row.date.slice(0, 7)),
    ...(station.monthlySnapshots || []).map((row) => row.month),
  ]))].sort();
  const coverage = Object.fromEntries(months.map((month) => {
    const dates = [...new Set(source.flatMap((station) => (station.dailyRecords || [])
      .filter((row) => row.date.startsWith(month)).map((row) => row.date)))].sort();
    const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
    const complete = dates.length === end && dates[0] === `${month}-01` && dates.at(-1) === `${month}-${end}`;
    const snapshot = source.some((station) => station.monthlySnapshots?.some((row) => row.month === month && row.complete));
    return [month, { complete: complete || snapshot, through: dates.at(-1) || null, snapshot }];
  })) as Record<string, { complete: boolean; through: string | null; snapshot: boolean }>;
  const stations = source.map((station) => {
    const config = configs[station.name] || {}, monthly = configs.__monthly__ || {};
    const records = months.flatMap((month, index) => {
      const days = (station.dailyRecords || []).filter((row) => row.date.startsWith(month));
      const snapshot = station.monthlySnapshots?.find((row) => row.month === month);
      if (!days.length && !snapshot) return [];
      // Date detail replaces the month snapshot when it covers the whole month.
      const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).getUTCDate();
      const useSnapshot = Boolean(snapshot && days.length < daysInMonth);
      const energy = useSnapshot ? sumEnergy([snapshot!]) : sumEnergy(days);
      // Monthly-only source has no daily mix by price interval; do not invent financial totals.
      const parts = useSnapshot ? [] : days;
      const metrics = parts.map((row) => calculateOperatingMetrics({ ...row, week: weekForDate(row.date) }, config, monthly));
      const sumMetric = (pick: (metric: typeof metrics[number]) => number | null) => metrics.every((metric) => pick(metric) !== null)
        ? metrics.reduce((total, metric) => total + Number(pick(metric)), 0) : null;
      const serviceRevenue = useSnapshot ? null : sumMetric((metric) => metric.serviceRevenue);
      const profit = useSnapshot ? null : sumMetric((metric) => metric.profit);
      const previous = station.monthlySnapshots?.find((row) => row.month === months[index - 1]);
      return [{ ...energy, week: `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`,
        chargeChange: previous?.charge ? energy.charge / previous.charge - 1 : null,
        serviceChange: null, serviceRevenue, profit,
        electricityRevenue: useSnapshot ? null : sumMetric((metric) => metric.electricityRevenue),
        peakServiceRevenue: useSnapshot ? null : sumMetric((metric) => metric.periodService.peak),
        highServiceRevenue: useSnapshot ? null : sumMetric((metric) => metric.periodService.high),
        flatServiceRevenue: useSnapshot ? null : sumMetric((metric) => metric.periodService.flat),
        valleyServiceRevenue: useSnapshot ? null : sumMetric((metric) => metric.periodService.valley),
        periodProfit: useSnapshot ? null : Object.fromEntries((["peak", "high", "flat", "valley"] as const)
          .map((key) => [key, sumMetric((metric) => metric.periodProfit[key])])),
        servicePerKwh: energy.charge && serviceRevenue !== null ? serviceRevenue / energy.charge : null,
        electricityProfitPerKwh: energy.charge && profit !== null && serviceRevenue !== null ? (profit - serviceRevenue) / energy.charge : null,
      } as unknown as T];
    });
    records.forEach((record, index) => {
      const previous = records[index - 1];
      const charge = Number(record.charge || 0), previousCharge = Number(previous?.charge || 0);
      const revenue = Number(record.serviceRevenue || 0), previousRevenue = Number(previous?.serviceRevenue || 0);
      (record as RecordLike)["chargeChange"] = previousCharge ? charge / previousCharge - 1 : null;
      (record as RecordLike)["serviceChange"] = previousRevenue && record.serviceRevenue != null ? revenue / previousRevenue - 1 : null;
    });
    return { ...station, records };
  });
  return { months, coverage, stations };
}

export function weeklyFromDaily<T extends RecordLike>(source: PeriodStation<T>[], configs: Record<string, Record<string, string>>) {
  return source.map((station) => {
    const weeks = new Map<string, EnergyDay[]>();
    (station.dailyRecords || []).forEach((row) => {
      const week = weekForDate(row.date);
      weeks.set(week, [...(weeks.get(week) || []), row]);
    });
    const added = [...weeks].filter(([week, days]) => days.length === 7 &&
      days.some((row) => new Date(`${row.date}T00:00:00Z`).getUTCDay() === 0) &&
      days.some((row) => new Date(`${row.date}T00:00:00Z`).getUTCDay() === 6) &&
      !station.records.some((record) => record.week === week)).map(([week, days]) => {
      const energy = sumEnergy(days);
      const config = configs[station.name] || {}, monthly = configs.__monthly__ || {};
      const calculated = days.map((row) => calculateOperatingMetrics({ ...row, week }, config, monthly));
      const sum = (pick: (value: typeof calculated[number]) => number | null) => calculated.every((item) => pick(item) != null)
        ? calculated.reduce((total, item) => total + Number(pick(item)), 0) : null;
      return { ...energy, week, serviceRevenue: sum((item) => item.serviceRevenue), profit: sum((item) => item.profit),
        chargeChange: null, serviceChange: null, servicePerKwh: null, electricityProfitPerKwh: null } as unknown as T;
    });
    return { ...station, records: [...station.records, ...added].sort((a, b) => a.week.localeCompare(b.week, "zh-CN", { numeric: true })) };
  });
}
