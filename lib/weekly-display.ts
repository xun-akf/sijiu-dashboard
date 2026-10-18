export type StoredWeeklyResult = {
  week?: string;
  charge?: number | null;
  peak?: number | null;
  high?: number | null;
  flat?: number | null;
  valley?: number | null;
  electricityRevenue?: number | null;
  serviceRevenue?: number | null;
  profit?: number | null;
};
export type MoneyMetric = "electricityRevenue" | "serviceRevenue" | "profit";

export function displayedModeMetric(
  mode: "all" | "fast" | "slow", period: "week" | "month",
  weekly: StoredWeeklyResult | null | undefined, classified: number | null, key: MoneyMetric,
): number | null {
  return mode === "all" && period === "week" && weekly?.[key] != null
    ? Number(weekly[key]) : classified;
}

export function sumAvailableMetrics(values: (number | null)[]) {
  const available = values.filter((value): value is number => value != null && Number.isFinite(value));
  return { value: available.length ? available.reduce((sum, value) => sum + value, 0) : null,
    available: available.length, total: values.length };
}

export function scopedStationNames(names: string[], selected: string, catalog: Record<string,string>, database: Record<string,string>) {
  return selected === "全部运营商" ? names : names.filter((name) => (database[name] || catalog[name]) === selected);
}

export function operatorChoices(names: string[], catalog: Record<string,string>, database: Record<string,string>) {
  return [...new Set(names.map((name) => database[name] || catalog[name]).filter((name): name is string => Boolean(name)))].sort((a,b) => a.localeCompare(b,"zh-CN"));
}

export function reportingStationNames(
  stations: {name:string;records:{week:string;charge?:number|null}[]}[], week:string, period:"week"|"month",
) {
  const month=week.match(/^\d{4}年\d{1,2}月/)?.[0];
  return stations.filter((station)=>station.records.some((record)=>
    (period==="week"?record.week===week:Boolean(month&&record.week.startsWith(month))) && record.charge!=null,
  )).map((station)=>station.name);
}
