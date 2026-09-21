export type TouKey = "peak" | "high" | "flat" | "valley";
export type TouPrice = Record<TouKey, string>;

const emptyPrice = (): TouPrice => ({ peak: "", high: "", flat: "", valley: "" });
const parts = (week: string) => {
  const match = week.replace(/\s/g, "").match(/^(?:(\d{4})年)?(\d{1,2})月(?:第)?(\d+)周$/);
  return { year: Number(match?.[1] || 2026), month: Number(match?.[2] || 0), week: Number(match?.[3] || 0) };
};
const order = (week: string) => { const value = parts(week); return value.year * 1000 + value.month * 10 + value.week; };

export function resolveWeeklyPrice(json: string, week: string): TouPrice {
  let prices: Record<string, TouPrice> = {};
  try { prices = json ? JSON.parse(json) : {}; } catch { return emptyPrice(); }
  const short = week.replace(/^\d{4}年/, "");
  if (prices[week]) return { ...emptyPrice(), ...prices[week] };
  if (prices[short]) return { ...emptyPrice(), ...prices[short] };
  const target = order(week);
  const prior = Object.keys(prices)
    .filter((key) => order(key) <= target)
    .sort((a, b) => order(b) - order(a))[0];
  return prior ? { ...emptyPrice(), ...prices[prior] } : emptyPrice();
}

export function normalizeTouPrice(price: TouPrice): TouPrice {
  return {
    ...price,
    peak: price.peak || price.high,
    high: price.high || price.peak,
  };
}

export type EnergyRecord = { week: string; charge?: number | null; peak?: number | null; high?: number | null; flat?: number | null; valley?: number | null };
export type MetricConfig = {
  guns?: string;
  billingType?: string; unifiedPrice?: string; servicePricesJson?: string;
  electricityPricesJson?: string; monthlyCostsJson?: string; gridFeesJson?: string;
};

export function missingMetricConfigs(week: string, config: MetricConfig, monthly: MetricConfig): string[] {
  const keys: TouKey[] = ["peak", "high", "flat", "valley"];
  const service = normalizeTouPrice(resolveWeeklyPrice(config.servicePricesJson || "", week));
  const electricity = normalizeTouPrice(resolveWeeklyPrice(config.electricityPricesJson || "", week));
  let costs: Record<string, Record<string, TouPrice>> = {};
  try { costs = JSON.parse(monthly.monthlyCostsJson || "{}"); } catch {}
  const weekPart = parts(week), month = String(weekPart.month), yearMonth = `${weekPart.year}-${weekPart.month}`;
  const rawCost = config.billingType === "一口价"
    ? Object.fromEntries(keys.map((key) => [key, config.unifiedPrice || ""])) as TouPrice
    : (costs[yearMonth] || costs[month])?.[config.billingType || "大工业电价"] || emptyPrice();
  const cost = normalizeTouPrice({ ...emptyPrice(), ...rawCost });
  const valid = (price: TouPrice) => keys.every((key) => price[key] !== "" && Number.isFinite(Number(price[key])));
  return [
    ...(!valid(service) ? ["服务费价格"] : []),
    ...(!valid(electricity) ? ["售电价格"] : []),
    ...(!valid(cost) ? [config.billingType === "一口价" ? "一口价成本" : `${config.billingType || "大工业电价"}成本`] : []),
  ];
}

export function calculateOperatingMetrics(record: EnergyRecord, config: MetricConfig, monthly: MetricConfig) {
  const keys: TouKey[] = ["peak", "high", "flat", "valley"];
  const service = normalizeTouPrice(resolveWeeklyPrice(config.servicePricesJson || "", record.week));
  const electricity = normalizeTouPrice(resolveWeeklyPrice(config.electricityPricesJson || "", record.week));
  let costs: Record<string, Record<string, TouPrice>> = {};
  let fees: Record<string, string> = {};
  try { costs = JSON.parse(monthly.monthlyCostsJson || "{}"); } catch {}
  try { fees = JSON.parse(monthly.gridFeesJson || "{}"); } catch {}
  const weekPart = parts(record.week), month = String(weekPart.month), yearMonth = `${weekPart.year}-${weekPart.month}`;
  const rawCost = config.billingType === "一口价"
    ? Object.fromEntries(keys.map((key) => [key, config.unifiedPrice || ""])) as TouPrice
    : (costs[yearMonth] || costs[month])?.[config.billingType || "大工业电价"] || emptyPrice();
  const cost = normalizeTouPrice({ ...emptyPrice(), ...rawCost });
  const values = Object.fromEntries(keys.map((key) => [key, Number(record[key] || 0)])) as Record<TouKey, number>;
  const valid = (price: TouPrice) => keys.every((key) => price[key] !== "" && Number.isFinite(Number(price[key])));
  const gridFee = config.billingType === "售电价" ? Number(fees[yearMonth] ?? fees[month] ?? 0) : 0;
  const periodService = Object.fromEntries(keys.map((key) => [key, valid(service) ? values[key] * Number(service[key]) : null])) as Record<TouKey, number | null>;
  const periodElectricityRevenue = Object.fromEntries(keys.map((key) => [key, valid(electricity) ? values[key] * Number(electricity[key]) : null])) as Record<TouKey, number | null>;
  const periodProfit = Object.fromEntries(keys.map((key) => [key,
    valid(service) && valid(electricity) && valid(cost)
      ? values[key] * (Number(service[key]) + Number(electricity[key]) - Number(cost[key]) - gridFee)
      : null,
  ])) as Record<TouKey, number | null>;
  const sum = (source: Record<TouKey, number | null>) => valid(service) && keys.every((key) => source[key] != null)
    ? keys.reduce((total, key) => total + Number(source[key]), 0) : null;
  const serviceRevenue = sum(periodService);
  const electricityRevenue = keys.every((key) => periodElectricityRevenue[key] != null)
    ? keys.reduce((total, key) => total + Number(periodElectricityRevenue[key]), 0) : null;
  const profit = keys.every((key) => periodProfit[key] != null)
    ? keys.reduce((total, key) => total + Number(periodProfit[key]), 0) : null;
  const charge = Number(record.charge || 0);
  return { service, electricity, cost, gridFee, periodService, periodProfit, serviceRevenue, electricityRevenue, profit,
    servicePerKwh: charge && serviceRevenue != null ? serviceRevenue / charge : null,
    electricityProfitPerKwh: charge && profit != null && serviceRevenue != null ? (profit - serviceRevenue) / charge : null };
}

type DashboardRecord = EnergyRecord & Record<string, unknown>;
type DashboardStation = { name?: unknown; records?: unknown } & Record<string, unknown>;

export function recalculateLatestDashboardWeek(input: unknown, rawConfigs: unknown): unknown {
  if (!Array.isArray(input) || !rawConfigs || typeof rawConfigs !== "object" || Array.isArray(rawConfigs)) return input;
  const configs = rawConfigs as Record<string, MetricConfig>;
  const weekOrder = (week: string) => order(week);
  const allWeeks = input.flatMap((station) => {
    const records = Array.isArray((station as DashboardStation)?.records) ? (station as DashboardStation).records as DashboardRecord[] : [];
    return records.map((record) => String(record.week || "")).filter(Boolean);
  });
  const latestWeek = allWeeks.sort((a, b) => weekOrder(a) - weekOrder(b)).at(-1);
  if (!latestWeek) return input;
  return input.map((rawStation) => {
    const station = rawStation as DashboardStation;
    const stationName = String(station.name || "");
    const records = Array.isArray(station.records) ? (station.records as DashboardRecord[]).map((record) => ({ ...record })) : [];
    const index = records.findIndex((record) => record.week === latestWeek);
    if (index < 0) return { ...station, records };
    const current = records[index];
    const stationConfig = configs[stationName] || {};
    const metrics = calculateOperatingMetrics(current, stationConfig, configs.__monthly__ || {});
    if (Number(stationConfig.guns) > 0) current.guns = Number(stationConfig.guns);
    if (metrics.serviceRevenue != null) {
      records[index] = {
        ...current,
        peakServiceRevenue: metrics.periodService.peak,
        highServiceRevenue: metrics.periodService.high,
        flatServiceRevenue: metrics.periodService.flat,
        valleyServiceRevenue: metrics.periodService.valley,
        electricityRevenue: metrics.electricityRevenue,
        serviceRevenue: metrics.serviceRevenue,
        profit: metrics.profit,
        servicePerKwh: metrics.servicePerKwh,
        electricityProfitPerKwh: metrics.electricityProfitPerKwh,
      };
    }
    const previous = records[index - 1];
    const charge = Number(records[index].charge);
    const previousCharge = Number(previous?.charge);
    const serviceRevenue = Number(records[index].serviceRevenue);
    const previousServiceRevenue = Number(previous?.serviceRevenue);
    records[index].chargeChange = Number.isFinite(charge) && Number.isFinite(previousCharge) && previousCharge !== 0 ? charge / previousCharge - 1 : null;
    records[index].serviceChange = Number.isFinite(serviceRevenue) && Number.isFinite(previousServiceRevenue) && previousServiceRevenue !== 0 ? serviceRevenue / previousServiceRevenue - 1 : null;
    return { ...station, records };
  });
}

