import { supabase } from "./supabase";

export type DbRecord = {
  week: string;
  charge: number | null;
  chargeChange: number | null;
  serviceRevenue: number | null;
  serviceChange: number | null;
  servicePerKwh: number | null;
  electricityProfitPerKwh: number | null;
  profit: number | null;
  peak: number | null;
  high: number | null;
  flat: number | null;
  valley: number | null;
};
export type DbStation = { name: string; records: DbRecord[] };

export async function loadDashboardData(): Promise<DbStation[] | null> {
  if (!supabase) return null;
  const [
    { data: stations, error: stationError },
    { data: rows, error: rowError },
  ] = await Promise.all([
    supabase.from("stations").select("id,name").order("name"),
    supabase
      .from("weekly_data")
      .select("*")
      .order("year")
      .order("month")
      .order("week_of_month"),
  ]);
  if (stationError || rowError) throw stationError || rowError;
  const grouped = new Map<string, DbRecord[]>();
  for (const row of rows || []) {
    const list = grouped.get(row.station_id) || [];
    list.push({
      week: row.period_key,
      charge: Number(row.total_energy),
      chargeChange: Number(row.energy_change),
      serviceRevenue: Number(row.service_revenue),
      serviceChange: Number(row.service_change),
      servicePerKwh: Number(row.service_per_kwh),
      electricityProfitPerKwh: Number(row.electricity_profit_per_kwh),
      profit: Number(row.operating_profit),
      peak: Number(row.sharp_energy),
      high: Number(row.peak_energy),
      flat: Number(row.flat_energy),
      valley: Number(row.valley_energy),
    });
    grouped.set(row.station_id, list);
  }
  return (stations || []).map((s) => ({
    name: s.name,
    records: grouped.get(s.id) || [],
  }));
}

export async function signInAdmin(email: string, password: string) {
  if (!supabase) throw new Error("尚未配置 Supabase");
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  if (data.user?.app_metadata?.role !== "admin") {
    await supabase.auth.signOut();
    throw new Error("该账号没有管理员权限");
  }
}
export async function signOutAdmin() {
  await supabase?.auth.signOut();
}
export async function currentAdmin() {
  const user = (await supabase?.auth.getUser())?.data.user || null;
  return user?.app_metadata?.role === "admin" ? user : null;
}

export async function upsertWeek(stations: DbStation[], week: string) {
  if (!supabase) throw new Error("尚未配置 Supabase");
  const { data: stationRows, error } = await supabase
    .from("stations")
    .select("id,name,aliases");
  if (error) throw error;
  const map = new Map<string, string>();
  for (const s of stationRows || []) {
    map.set(s.name, s.id);
    for (const a of s.aliases || []) map.set(a, s.id);
  }
  const parsed = week.match(/(\d+)月(?:第)?(\d+)周/);
  if (!parsed) throw new Error("无法识别周次");
  const payload = [];
  for (const st of stations) {
    const id = map.get(st.name),
      r = st.records.find((x) => x.week === week);
    if (!id || !r) continue;
    payload.push({
      station_id: id,
      period_key: week,
      year: 2026,
      month: Number(parsed[1]),
      week_of_month: Number(parsed[2]),
      total_energy: r.charge,
      sharp_energy: r.peak,
      peak_energy: r.high,
      flat_energy: r.flat,
      valley_energy: r.valley,
      service_revenue: r.serviceRevenue,
      service_change: r.serviceChange,
      service_per_kwh: r.servicePerKwh,
      electricity_profit_per_kwh: r.electricityProfitPerKwh,
      operating_profit: r.profit,
      energy_change: r.chargeChange,
      updated_at: new Date().toISOString(),
    });
  }
  const { error: writeError } = await supabase
    .from("weekly_data")
    .upsert(payload, { onConflict: "station_id,period_key" });
  if (writeError) throw writeError;
  return payload.length;
}

export async function weekExists(week: string) {
  if (!supabase) return false;
  const { count, error } = await supabase
    .from("weekly_data")
    .select("*", { count: "exact", head: true })
    .eq("period_key", week);
  if (error) throw error;
  return Boolean(count);
}

export async function loadRemoteConfigs() {
  if (!supabase) return null;
  const [
    { data: stationRows, error: stationError },
    { data: prices, error: priceError },
    { data: competitorRows, error: competitorError },
    { data: notes, error: noteError },
  ] = await Promise.all([
    supabase.from("stations").select("*"),
    supabase.from("station_prices").select("*"),
    supabase.from("competitors").select("*").order("period_key"),
    supabase.from("analysis_notes").select("*").order("period_key"),
  ]);
  if (stationError || priceError || competitorError || noteError)
    throw stationError || priceError || competitorError || noteError;
  const names = new Map((stationRows || []).map((row) => [row.id, row.name]));
  const cfg: Record<string, Record<string, string>> = {};
  for (const row of stationRows || [])
    cfg[row.name] = {
      operator: row.operator || "",
      guns: row.gun_count == null ? "" : String(row.gun_count),
      billingType: row.billing_type || "大工业电价",
      unifiedPrice: row.unified_price == null ? "" : String(row.unified_price),
    };
  const monthly = prices?.find(
    (row) => row.monthly_costs && Object.keys(row.monthly_costs).length,
  );
  cfg.__monthly__ = {
    monthlyCostsJson: JSON.stringify(monthly?.monthly_costs || {}),
    gridFeesJson: JSON.stringify(monthly?.grid_fees || {}),
  };
  for (const row of prices || []) {
    const name = names.get(row.station_id);
    if (!name) continue;
    const item = cfg[name] || (cfg[name] = {});
    const external = JSON.parse(item.externalPricesJson || "{}");
    external[row.period_key] = row.total_prices || {};
    item.externalPricesJson = JSON.stringify(external);
    const electricity = JSON.parse(item.electricityPricesJson || "{}");
    electricity[row.period_key] = row.electricity_prices || {};
    item.electricityPricesJson = JSON.stringify(electricity);
    const service = JSON.parse(item.servicePricesJson || "{}");
    service[row.period_key] = row.service_prices || {};
    item.servicePricesJson = JSON.stringify(service);
  }
  const competitorsByStation = new Map<string, unknown[]>();
  for (const row of competitorRows || []) {
    const name = names.get(row.station_id);
    if (!name) continue;
    const list = competitorsByStation.get(name) || [];
    list.push({
      name: row.name,
      distance: row.distance || "",
      guns: row.gun_count == null ? "" : String(row.gun_count),
      electricity: row.electricity_prices || {},
      service: row.service_prices || {},
      total: row.total_prices || {},
    });
    competitorsByStation.set(name, list);
  }
  for (const [name, list] of competitorsByStation)
    (cfg[name] || (cfg[name] = {})).competitorsJson = JSON.stringify(list);
  for (const row of notes || []) {
    const name = names.get(row.station_id);
    if (name) (cfg[name] || (cfg[name] = {})).analysis = row.analysis || "";
  }
  return cfg;
}

export async function saveRemoteConfigs(
  cfg: Record<string, Record<string, string>>,
  week: string,
) {
  if (!supabase) throw new Error("尚未配置 Supabase");
  const { data: stationRows, error } = await supabase
    .from("stations")
    .select("id,name");
  if (error) throw error;
  const monthly = cfg.__monthly__ || {},
    monthlyCosts = JSON.parse(monthly.monthlyCostsJson || "{}"),
    gridFees = JSON.parse(monthly.gridFeesJson || "{}");
  for (const station of stationRows || []) {
    const item = cfg[station.name] || {};
    await supabase
      .from("stations")
      .update({
        operator: item.operator || null,
        gun_count: item.guns === "" ? null : Number(item.guns),
        billing_type: item.billingType || "大工业电价",
        unified_price:
          item.unifiedPrice === "" ? null : Number(item.unifiedPrice),
        updated_at: new Date().toISOString(),
      })
      .eq("id", station.id);
    const external = JSON.parse(item.externalPricesJson || "{}"),
      electricity = JSON.parse(item.electricityPricesJson || "{}"),
      service = JSON.parse(item.servicePricesJson || "{}");
    const periods = new Set([
      ...Object.keys(external),
      ...Object.keys(electricity),
      ...Object.keys(service),
    ]);
    for (const period of periods) {
      const { error: priceError } = await supabase
        .from("station_prices")
        .upsert(
          {
            station_id: station.id,
            period_key: period,
            billing_type: item.billingType || "大工业电价",
            electricity_prices: electricity[period] || {},
            service_prices: service[period] || {},
            total_prices: external[period] || {},
            monthly_costs: monthlyCosts,
            grid_fees: gridFees,
            unified_price:
              item.unifiedPrice === "" ? null : Number(item.unifiedPrice),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "station_id,period_key" },
        );
      if (priceError) throw priceError;
    }
    const analysis = item.analysis || "";
    if (analysis) {
      const { error: noteError } = await supabase
        .from("analysis_notes")
        .upsert(
          {
            station_id: station.id,
            period_key: week,
            analysis,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "station_id,period_key" },
        );
      if (noteError) throw noteError;
    }
  }
}
