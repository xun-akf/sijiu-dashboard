export type ValidationLevel = "warning" | "error";

export type ValidationIssue = {
  level: ValidationLevel;
  station: string;
  week: string;
  field: string;
  currentValue: string;
  reason: string;
  suggestion: string;
};

export type ValidationReport = {
  status: "passed" | "warning" | "error";
  issues: ValidationIssue[];
  stationCount: number;
  weekCount: number;
};

type RecordLike = Record<string, unknown> & { week?: unknown };
type StationLike = { name?: unknown; records?: unknown };
type MetricConfig = { billingType?: string; unifiedPrice?: string; servicePricesJson?: string; electricityPricesJson?: string; monthlyCostsJson?: string };
type Price = Record<"peak" | "high" | "flat" | "valley", string>;
const missingMetricConfigs = (week: string, config: MetricConfig, monthly: MetricConfig) => {
  const blank = (): Price => ({ peak: "", high: "", flat: "", valley: "" });
  const weekParts = (value: string) => { const match = value.replace(/\s/g, "").match(/^(?:(\d{4})年)?(\d{1,2})月(?:第)?(\d+)周$/); return { year: Number(match?.[1] || 2026), month: Number(match?.[2] || 0), week: Number(match?.[3] || 0) }; };
  const order = (value: string) => { const part = weekParts(value); return part.year * 1000 + part.month * 10 + part.week; };
  const resolve = (json: string | undefined) => {
    let prices: Record<string, Price> = {};
    try { prices = json ? JSON.parse(json) : {}; } catch { return blank(); }
    const short = week.replace(/^\d{4}年/, "");
    const found = prices[week] || prices[short] || prices[Object.keys(prices).filter((key) => order(key) <= order(week)).sort((a, b) => order(b) - order(a))[0]];
    const price = { ...blank(), ...found };
    return { ...price, peak: price.peak || price.high, high: price.high || price.peak };
  };
  let costs: Record<string, Record<string, Price>> = {};
  try { costs = JSON.parse(monthly.monthlyCostsJson || "{}"); } catch {}
  const service = resolve(config.servicePricesJson), electricity = resolve(config.electricityPricesJson);
  const part = weekParts(week), month = String(part.month), yearMonth = `${part.year}-${part.month}`;
  const rawCost = config.billingType === "一口价" ? Object.fromEntries(Object.keys(blank()).map((key) => [key, config.unifiedPrice || ""])) as Price : (costs[yearMonth] || costs[month])?.[config.billingType || "大工业电价"] || blank();
  const cost = { ...blank(), ...rawCost, peak: rawCost.peak || rawCost.high, high: rawCost.high || rawCost.peak };
  const valid = (price: Price) => Object.values(price).every((value) => value !== "" && Number.isFinite(Number(value)));
  return [...(!valid(service) ? ["服务费价格"] : []), ...(!valid(electricity) ? ["售电价格"] : []), ...(!valid(cost) ? [config.billingType === "一口价" ? "一口价成本" : `${config.billingType || "大工业电价"}成本`] : [])];
};

const coreNumericFields = [
  ["charge", "总充电量"], ["peak", "尖电量"], ["high", "峰电量"],
  ["flat", "平电量"], ["valley", "谷电量"],
] as const;
const calculatedNumericFields = [
  ["serviceRevenue", "服务费收入"],
  ["profit", "经营利润"], ["servicePerKwh", "每度服务费"],
  ["electricityProfitPerKwh", "每度电费利润"],
] as const;

const finiteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

export function parseImportNumber(value: unknown): number | null {
  const normalized = String(value ?? "").trim().replace(/,/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateDashboardData(
  input: unknown,
  expected: unknown = undefined,
  options: { coreOnly?: boolean; importEnergyOnly?: boolean; configs?: unknown; allowPublishedHistory?: boolean } = {},
): ValidationReport {
  const stations = Array.isArray(input) ? input as StationLike[] : [];
  const expectedStations = Array.isArray(expected) ? expected as StationLike[] : [];
  const issues: ValidationIssue[] = [];
  const add = (level: ValidationLevel, station: string, week: string, field: string, currentValue: unknown, reason: string, suggestion: string) =>
    issues.push({ level, station: station || "—", week: week || "—", field, currentValue: currentValue == null || currentValue === "" ? "缺失" : String(currentValue), reason, suggestion });
  const expectedValue = (stationName: string, week: string, key: string) => {
    const station = expectedStations.find((item) => String(item.name || "").trim() === stationName);
    const record = (Array.isArray(station?.records) ? station.records as RecordLike[] : []).find((item) => String(item.week || "") === week);
    return record?.[key];
  };
  const unchangedPublishedIssue = (stationName: string, week: string, key: string, value: unknown) => {
    if (!options.allowPublishedHistory) return false;
    const previous = expectedValue(stationName, week, key);
    const missing = (item: unknown) => item === null || item === undefined || item === "";
    return missing(value) ? missing(previous) : Object.is(value, previous);
  };

  if (!stations.length) add("error", "—", "—", "导入文件", "缺失", "未识别到任何场站数据", "检查文件、字段识别结果和站点匹配后重新导入");

  const names = stations.map((station) => String(station.name || "").trim());
  names.forEach((name, index) => {
    if (!name) add("error", `第${index + 1}个场站`, "—", "场站名称", "缺失", "场站名称为空", "补充场站名称后重新导入");
    if (name && names.indexOf(name) !== index)
      add("error", name, "—", "场站名称", name, "同一草稿中存在重复场站", "合并重复场站记录，仅保留一个看板站点");
  });

  const expectedNames = expectedStations.map((station) => String(station.name || "").trim()).filter(Boolean);
  if (expectedNames.length) {
    expectedNames.filter((name) => !names.includes(name)).forEach((name) =>
      add("error", name, "—", "场站", "缺失", "已发布数据中存在该场站，但当前草稿整体缺失", "检查草稿合并过程，恢复该看板站点后再发布"));
    names.filter((name) => !expectedNames.includes(name)).forEach((name) =>
      add("warning", name, "—", "场站", name, "草稿中出现已发布数据没有的场站", "确认该站已在站点管理中创建并完成授权"));
    if (names.length !== expectedNames.length)
      add("warning", "全部场站", "—", "场站数量", names.length, `当前草稿${names.length}个，已发布数据${expectedNames.length}个`, "核对站点管理清单；仅数量差异不会单独阻止发布");
  }

  const allWeekSets: string[][] = [];
  stations.forEach((station) => {
    const stationName = String(station.name || "").trim();
    const records = Array.isArray(station.records) ? station.records as RecordLike[] : [];
    if (!records.length) add("error", stationName, "—", "周次", "缺失", "该场站没有任何周次数据", "至少补充一周有效数据");
    const weeks = records.map((record) => String(record.week || "").trim());
    allWeekSets.push(weeks.filter(Boolean));
    weeks.forEach((week, index) => {
      if (!week) add("error", stationName, `第${index + 1}条`, "周次", "缺失", "周次为空", "填写明确的年份、月份和周次");
      if (week && weeks.indexOf(week) !== index)
        add("error", stationName, week, "周次", week, "该场站存在重复周次", "合并重复周次，只保留一条记录");
    });

    records.forEach((record, index) => {
      const week = String(record.week || `第${index + 1}条`);
      coreNumericFields.forEach(([key, label]) => {
        const value = record[key];
        if (value === null || value === undefined || value === "") {
          const historical = unchangedPublishedIssue(stationName, week, key, value);
          add(historical ? "warning" : "error", stationName, week, label, value, historical ? "已发布历史中原本缺失，本次草稿未修改该值" : "核心经营数据为空", historical ? "建议后续补录历史值；不阻断本次新周发布" : "返回导入预览补充该电量；Excel空白不能按0处理");
        }
        else if (!finiteNumber(value)) {
          const historical = unchangedPublishedIssue(stationName, week, key, value);
          add(historical ? "warning" : "error", stationName, week, label, value, historical ? "已发布历史中原本为非数字内容，本次草稿未修改该值" : "核心电量不是有效数字", historical ? "建议后续修复历史值；不阻断本次新周发布" : "修正Excel单元格内容后重新导入");
        }
      });
      if (!options.importEnergyOnly) calculatedNumericFields.forEach(([key, label]) => {
        const value = record[key];
        if (value !== null && value !== undefined && value !== "" && !finiteNumber(value))
          add("error", stationName, week, label, value, "系统计算字段不是有效数字", "重新保存并重算该周；如仍异常请查看保存接口错误");
      });
      (["charge", "peak", "high", "flat", "valley", "serviceRevenue", "servicePerKwh"] as const).forEach((key) => {
        if (finiteNumber(record[key]) && (record[key] as number) < 0) {
          const historical = unchangedPublishedIssue(stationName, week, key, record[key]);
          add(historical ? "warning" : "error", stationName, week, key, record[key], historical ? "已发布历史中原本为负数，本次草稿未修改该值" : "该字段不应为负数", historical ? "建议后续修复历史值；不阻断本次新周发布" : "核对Excel原始电量或价格配置");
        }
      });
      if (["charge", "peak", "high", "flat", "valley"].every((key) => finiteNumber(record[key]))) {
        const total = Number(record.peak) + Number(record.high) + Number(record.flat) + Number(record.valley);
        const tolerance = Math.max(1, Math.abs(Number(record.charge)) * 0.005);
        if (Math.abs(total - Number(record.charge)) > tolerance)
          add("error", stationName, week, "总充电量", record.charge, `尖峰平谷合计${total.toFixed(3)}，与总充电量${Number(record.charge).toFixed(3)}明显不一致`, "核对总电量或尖峰平谷；差异超过0.5%（且超过1kWh）会阻止发布");
      }
      if (!options.importEnergyOnly && finiteNumber(record.charge) && Number(record.charge) > 0 && finiteNumber(record.serviceRevenue) && finiteNumber(record.servicePerKwh)) {
        const calculated = Number(record.serviceRevenue) / Number(record.charge);
        if (Math.abs(calculated - Number(record.servicePerKwh)) > 0.01)
          add("warning", stationName, week, "每度服务费", record.servicePerKwh, `表内值与服务费收入÷充电量不一致，计算值为${calculated.toFixed(3)}`, "点击保存并重算，使用系统计算值更新");
      }
      if (!options.importEnergyOnly && finiteNumber(record.servicePerKwh) && Number(record.servicePerKwh) > 2)
        add("warning", stationName, week, "每度服务费", record.servicePerKwh, "超过2元/kWh，请确认单位或小数点", "检查服务费价格配置");
      if (!options.importEnergyOnly && finiteNumber(record.electricityProfitPerKwh) && Math.abs(Number(record.electricityProfitPerKwh)) > 3)
        add("warning", stationName, week, "每度电费利润", record.electricityProfitPerKwh, "绝对值超过3元/kWh，请确认单位或公式", "检查售电价格、电费成本和过路费配置");
      if (!options.importEnergyOnly && finiteNumber(record.profit) && Number(record.profit) < 0)
        add("warning", stationName, week, "经营利润", record.profit, "经营利润为负数，请确认该站当周确为亏损", "核对价格成本；确认真实亏损后可继续发布");

      const previous = records[index - 1];
      if (!options.importEnergyOnly) ([
        ["charge", "chargeChange", "充电量环比"],
        ["serviceRevenue", "serviceChange", "服务费收入环比"],
      ] as const).forEach(([valueKey, changeKey, label]) => {
        const change = record[changeKey];
        if (!previous) {
          if (finiteNumber(change)) add("warning", stationName, week, label, change, "缺少上期数据，无法核验已有环比", "首周环比应为空");
          return;
        }
        const previousValue = previous[valueKey];
        if (!finiteNumber(previousValue) || Number(previousValue) === 0) {
          if (change !== null && change !== undefined) add("warning", stationName, week, label, change, "上期数据为空或为0，环比应显示—", "重新保存并重算该周环比");
          return;
        }
        if (!finiteNumber(change)) {
          add("warning", stationName, week, label, change, "存在有效上期数据，但环比为空或异常", "重新保存并重算该周环比");
          return;
        }
        const calculated = Number(record[valueKey]) / Number(previousValue) - 1;
        if (Number.isFinite(calculated) && Math.abs(calculated - Number(change)) > 0.005)
          add("warning", stationName, week, label, change, `表内环比与前后周数据不一致，计算值为${(calculated * 100).toFixed(1)}%`, "重新保存并重算该周环比");
      });
    });
  });

  const canonicalWeeks = [...new Set(allWeekSets.flat())];
  allWeekSets.forEach((weeks, index) => {
    canonicalWeeks.filter((week) => !weeks.includes(week)).forEach((week) =>
      add("warning", names[index], week, "周次", "缺失", "其他场站存在该周，但本场站缺失", "确认该站当周是否尚未运营；如应有数据请补充导入"));
  });
  if (expectedStations.length) {
    const historicalWeeks = new Set(expectedStations.flatMap((station) =>
      Array.isArray(station.records) ? (station.records as RecordLike[]).map((record) => String(record.week || "")) : []));
    if (canonicalWeeks.length && historicalWeeks.size && canonicalWeeks.length < historicalWeeks.size)
      add("warning", "全部场站", "—", "周次数量", canonicalWeeks.length, `本次文件识别${canonicalWeeks.length}周，历史数据共${historicalWeeks.size}周`, "周报可只导入单周；系统会与历史数据合并");
  }

  if (!options.importEnergyOnly && canonicalWeeks.length) {
    const latestWeek = canonicalWeeks.at(-1) || "";
    const configs = options.configs && typeof options.configs === "object" ? options.configs as Record<string, MetricConfig> : {};
    stations.forEach((station) => {
      const stationName = String(station.name || "").trim();
      const latest = (Array.isArray(station.records) ? station.records as RecordLike[] : []).find((record) => String(record.week || "") === latestWeek);
      if (!latest || !finiteNumber(latest.charge) || Number(latest.charge) <= 0) return;
      const missing = missingMetricConfigs(latestWeek, configs[stationName] || {}, configs.__monthly__ || {});
      (["serviceRevenue", "profit"] as const).forEach((key) => {
        if (latest[key] !== null && latest[key] !== undefined && latest[key] !== "") return;
        const label = key === "serviceRevenue" ? "服务费收入" : "经营利润";
        add("warning", stationName, latestWeek, label, latest[key], missing.length ? `缺少${missing.join("、")}配置，系统无法计算` : "价格成本配置完整，但该周尚未完成经营指标重算", missing.length ? "先在数据中心补全配置，再点击保存并重算" : "重新保存该周，系统会自动生成完整经营指标");
      });
    });
  }

  const hasError = issues.some((issue) => issue.level === "error");
  return {
    status: hasError ? "error" : issues.length ? "warning" : "passed",
    issues,
    stationCount: stations.length,
    weekCount: canonicalWeeks.length,
  };
}

