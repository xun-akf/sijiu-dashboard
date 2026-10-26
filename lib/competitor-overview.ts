import { competitorTotal, pricePeriods, readCompetitorHistory, type CompetitorPrice, type PricePeriod } from "./competitor-history.ts";

export type OverviewStatus = "rising" | "falling" | "mixed" | "steady" | "unavailable" | "conflict";
export type OverviewItem = {
  name: string;
  stations: string[];
  periods: Record<PricePeriod, number | null>;
  status: OverviewStatus;
  magnitude: number;
};
export type CompetitorOverview = {
  week: string;
  previousWeek: string;
  items: OverviewItem[];
  rising: number;
  falling: number;
  mixed: number;
  steady: number;
  unavailable: number;
  conflict: number;
};

const identity = (name: string) => name.toLowerCase().replace(/[\s\-—_（）()【】\[\]·]/g, "");
const order = (week: string) => {
  const match = week.replace(/\s/g, "").match(/^(?:(20\d{2})年)?(\d{1,2})月(?:第)?(\d+)周$/);
  return match ? Number(match[1] || 2026) * 1000 + Number(match[2]) * 10 + Number(match[3]) : -1;
};
const uniquePrice = (rows: CompetitorPrice[], period: PricePeriod) => {
  const values = rows.map((row) => competitorTotal(row, period)).filter((value): value is number => value != null);
  if (!values.length) return { price: null, conflict: false };
  return { price: values[0], conflict: values.some((value) => Math.abs(value - values[0]) > 0.00005) };
};

export function buildCompetitorOverview(
  configs: Record<string, { competitorsByWeekJson?: string }>,
  stationNames: string[],
  operatingWeeks: string[] = [],
): CompetitorOverview {
  const historyByStation = stationNames.map((station) => ({
    station, history: readCompetitorHistory(configs[station]?.competitorsByWeekJson),
  }));
  const historyWeeks = [...new Set(historyByStation.flatMap(({ history }) => Object.keys(history)))].filter((week) => order(week) >= 0);
  const week = historyWeeks.sort((a, b) => order(b) - order(a))[0] || "";
  const timeline = [...new Set([...operatingWeeks, ...historyWeeks])].filter((value) => order(value) >= 0)
    .sort((a, b) => order(a) - order(b));
  const previousWeek = timeline[timeline.indexOf(week) - 1] || "";
  const groups = new Map<string, { name: string; stations: Set<string>; current: CompetitorPrice[]; previous: CompetitorPrice[] }>();
  for (const { station, history } of historyByStation) {
    for (const row of history[week] || []) {
      const key = identity(row.name || "");
      if (!key) continue;
      const group = groups.get(key) || { name: row.name, stations: new Set<string>(), current: [], previous: [] };
      group.stations.add(station);
      group.current.push(row);
      groups.set(key, group);
    }
  }
  for (const { history } of historyByStation) {
    for (const row of history[previousWeek] || []) {
      const group = groups.get(identity(row.name || ""));
      if (group) group.previous.push(row);
    }
  }
  const items: OverviewItem[] = [...groups.values()].map((group) => {
    let conflict = false;
    const periods = Object.fromEntries(pricePeriods.map((period) => {
      const current = uniquePrice(group.current, period), previous = uniquePrice(group.previous, period);
      if (current.conflict || previous.conflict) conflict = true;
      return [period, current.price == null || previous.price == null || current.conflict || previous.conflict
        ? null : Number((current.price - previous.price).toFixed(8))];
    })) as Record<PricePeriod, number | null>;
    const comparable = pricePeriods.map((period) => periods[period]).filter((value): value is number => value != null);
    const ups = comparable.some((delta) => delta > 0.00005), downs = comparable.some((delta) => delta < -0.00005);
    const status: OverviewStatus = conflict ? "conflict" : !comparable.length ? "unavailable"
      : ups && downs ? "mixed" : ups ? "rising" : downs ? "falling" : "steady";
    return {
      name: group.name, stations: [...group.stations], periods, status,
      magnitude: comparable.reduce((max, delta) => Math.max(max, Math.abs(delta)), 0),
    };
  }).sort((a, b) => b.magnitude - a.magnitude || a.name.localeCompare(b.name, "zh-CN"));
  const count = (status: OverviewStatus) => items.filter((item) => item.status === status).length;
  return { week, previousWeek, items, rising: count("rising"), falling: count("falling"),
    mixed: count("mixed"), steady: count("steady"), unavailable: count("unavailable"), conflict: count("conflict") };
}
