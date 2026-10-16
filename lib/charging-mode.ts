export type ChargingMode = "fast" | "slow";
export type Tou = "peak" | "high" | "flat" | "valley";
export type ModeEnergyFact = {
  stationName: string;
  date: string; // local station calendar date, YYYY-MM-DD
  mode: ChargingMode;
  deviceId: string | null;
  peak: number | null;
  high: number | null;
  flat: number | null;
  valley: number | null;
  charge: number;
  orders: number | null;
};
export type ModeSummary = {
  charge: number | null;
  peak: number | null;
  high: number | null;
  flat: number | null;
  valley: number | null;
  orders: number | null;
  days: number;
  rows: number;
};
export type Coverage = {
  fast: number | null;
  slow: number | null;
  unclassified: number | null;
  excess: number;
};

const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
  && new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date;

export function modeFactKey(row: ModeEnergyFact): string {
  if (!validDate(row.date) || !row.stationName.trim() || !["fast", "slow"].includes(row.mode)) throw new Error("站点、日期或充电模式无效");
  return [row.stationName, row.date, row.mode, row.deviceId?.trim() || ""].join("\u001f");
}

export function upsertModeFacts(existing: ModeEnergyFact[], incoming: ModeEnergyFact[]): ModeEnergyFact[] {
  const index = new Map(existing.map((row) => [modeFactKey(row), row]));
  for (const row of incoming) {
    if (!Number.isFinite(row.charge) || row.charge < 0) throw new Error("分类总电量必须为非负实测值");
    const tou = (["peak", "high", "flat", "valley"] as const).map((key) => row[key]);
    if (tou.some((value) => value != null && (!Number.isFinite(value) || value < 0))) throw new Error("分时电量无效");
    if (tou.every((value) => value != null) && Math.abs(tou.reduce<number>((sum, value) => sum + Number(value), 0) - row.charge) > 0.02) throw new Error("分类分时电量与总电量不一致");
    index.set(modeFactKey(row), row);
  }
  return [...index.values()];
}

export function summarizeMode(facts: ModeEnergyFact[], start: string, end: string, mode: ChargingMode): ModeSummary {
  if (!validDate(start) || !validDate(end) || start > end) throw new Error("统计日期区间无效");
  const rows = facts.filter((row) => row.date >= start && row.date <= end && row.mode === mode);
  if (!rows.length) return { charge: null, peak: null, high: null, flat: null, valley: null, orders: null, days: 0, rows: 0 };
  const sumIfComplete = (field: "peak" | "high" | "flat" | "valley" | "orders") =>
    rows.every((row) => row[field] != null) ? rows.reduce((sum, row) => sum + Number(row[field]), 0) : null;
  return {
    charge: rows.reduce((sum, row) => sum + row.charge, 0),
    peak: sumIfComplete("peak"), high: sumIfComplete("high"),
    flat: sumIfComplete("flat"), valley: sumIfComplete("valley"),
    orders: sumIfComplete("orders"),
    days: new Set(rows.map((row) => row.date)).size, rows: rows.length,
  };
}

export function reconcileModes(stationCharge: number | null, fast: ModeSummary, slow: ModeSummary): Coverage {
  if (stationCharge == null) return { fast: fast.charge, slow: slow.charge, unclassified: null, excess: 0 };
  const classified = (fast.charge || 0) + (slow.charge || 0);
  const diff = stationCharge - classified;
  return {
    fast: fast.charge, slow: slow.charge,
    unclassified: diff >= -0.02 ? Math.max(0, diff) : null,
    excess: diff < -0.02 ? -diff : 0,
  };
}

export function calendarMonthRange(year: number, month: number) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) throw new Error("自然月无效");
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

export function sundaySaturdayRange(label: string) {
  const m=label.match(/^(\d{4})年(\d{1,2})月(?:第)?(\d+)周$/);
  if (!m) throw new Error("周次无效");
  const year=Number(m[1]), month=Number(m[2]), ordinal=Number(m[3]);
  const first=new Date(Date.UTC(year,month-1,1));
  const firstWednesday=new Date(first);
  firstWednesday.setUTCDate(1+(3-first.getUTCDay()+7)%7);
  const wednesday=new Date(firstWednesday);
  wednesday.setUTCDate(firstWednesday.getUTCDate()+7*(ordinal-1));
  const sunday=new Date(wednesday);
  sunday.setUTCDate(wednesday.getUTCDate()-3);
  const saturday=new Date(sunday);
  saturday.setUTCDate(sunday.getUTCDate()+6);
  return {start:sunday.toISOString().slice(0,10),end:saturday.toISOString().slice(0,10)};
}

export type TariffVersion = {
  station_name: string; charging_mode: "all" | ChargingMode;
  effective_from: string; effective_until: string | null;
  windows: { start: string; end: string; period: string; electricity: number; service: number }[];
};
export type OperatingResult = { electricityRevenue: number | null; serviceRevenue: number | null; profit: number | null };
type CostConfig = {
  purchaseCostType?: string; billingType?: string; unifiedPrice?: string;
};
type MonthlyCostConfig = { monthlyCostsJson?: string; gridFeesJson?: string };
const touKeys = ["peak","high","flat","valley"] as const;
const periodKey = (value: string): typeof touKeys[number] | "all" | null =>
  ({ 尖:"peak", 峰:"high", 平:"flat", 谷:"valley", 标准电费:"all" } as Record<string,typeof touKeys[number] | "all">)[value] || null;

export function classifyDayOperatingMetrics(
  fact: ModeEnergyFact, versions: TariffVersion[], stationConfig: CostConfig, monthlyConfig: MonthlyCostConfig,
): OperatingResult {
  const unavailable={electricityRevenue:null,serviceRevenue:null,profit:null};
  if (touKeys.some((key)=>fact[key]==null)) return unavailable;
  const relevant=versions.filter((version)=>version.station_name===fact.stationName
    && version.effective_from<=fact.date && (!version.effective_until || version.effective_until>=fact.date)
    && (version.charging_mode===fact.mode || version.charging_mode==="all"))
    .sort((a,b)=>(a.charging_mode===fact.mode ? -1 : 1)-(b.charging_mode===fact.mode ? -1 : 1)
      || b.effective_from.localeCompare(a.effective_from));
  const tariff=relevant[0];
  if (!tariff) return unavailable;
  const rates: Record<string,{electricity:number;service:number}>={};
  for (const window of tariff.windows) {
    const key=periodKey(window.period);
    if (!key) return unavailable;
    const current=rates[key];
    if (current && (Math.abs(current.electricity-window.electricity)>0.000001 || Math.abs(current.service-window.service)>0.000001))
      return unavailable; // Same TOU bucket contains two prices. Need time-stamped orders.
    rates[key]={electricity:window.electricity,service:window.service};
  }
  const amounts=touKeys.map((key)=>Number(fact[key]));
  const sell=touKeys.map((key)=>rates[key] || rates.all);
  if (sell.some((rate,index)=>amounts[index]>0 && (!rate || !Number.isFinite(rate.electricity) || !Number.isFinite(rate.service)))) return unavailable;
  const electricityRevenue=amounts.reduce((sum,amount,index)=>sum+amount*(sell[index]?.electricity || 0),0);
  const serviceRevenue=amounts.reduce((sum,amount,index)=>sum+amount*(sell[index]?.service || 0),0);
  let costs: Record<string,Record<string,Record<string,string>>>={};
  let fees: Record<string,string>={};
  try {costs=JSON.parse(monthlyConfig.monthlyCostsJson || "{}");fees=JSON.parse(monthlyConfig.gridFeesJson || "{}");}
  catch {return {electricityRevenue,serviceRevenue,profit:null};}
  const date=new Date(fact.date+"T00:00:00Z"), month=String(date.getUTCMonth()+1);
  const yearMonth=`${date.getUTCFullYear()}-${month}`;
  const costType=stationConfig.purchaseCostType || stationConfig.billingType || "大工业电价";
  const perTou=costType==="一口价"
    ? Object.fromEntries(touKeys.map((key)=>[key,stationConfig.unifiedPrice]))
    : (costs[yearMonth] || costs[month])?.[costType];
  const gridFee=costType==="售电价" ? Number(fees[yearMonth] ?? fees[month] ?? 0) : 0;
  if (!Number.isFinite(gridFee)) return {electricityRevenue,serviceRevenue,profit:null};
  let profit=0;
  for (let index=0;index<touKeys.length;index++){
    const amount=amounts[index];
    if (!amount) continue;
    const key=touKeys[index];
    const raw=perTou?.[key] || (key==="peak" ? perTou?.high : null);
    if (raw==null || raw==="" || !Number.isFinite(Number(raw))) return {electricityRevenue,serviceRevenue,profit:null};
    profit+=amount*((sell[index]?.electricity || 0)+(sell[index]?.service || 0)-Number(raw)-gridFee);
  }
  return {electricityRevenue,serviceRevenue,profit};
}
