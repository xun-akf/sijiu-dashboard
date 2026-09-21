"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { strFromU8, unzipSync } from "fflate";
import {
  Activity,
  BarChart3,
  BatteryCharging,
  Building2,
  ChevronDown,
  CircleDollarSign,
  Download,
  Gauge,
  LayoutDashboard,
  MapPin,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import data from "./dashboard-data.json";
import { subscribeToDashboardChanges } from "@/lib/dashboard-realtime";
import { parseImportNumber, validateDashboardData, type ValidationReport } from "@/lib/import-validation";
import { matchStationNames, type StationMatch } from "@/lib/station-matching";
import { calculateOperatingMetrics, resolveWeeklyPrice } from "@/lib/operating-metrics";
import { dashboardFetch, siteUrl } from "@/lib/dashboard-browser";
type R = {
  week: string;
  charge: number | null;
  chargeChange: number | null;
  serviceRevenue: number | null;
  peakServiceRevenue?: number | null;
  highServiceRevenue?: number | null;
  flatServiceRevenue?: number | null;
  valleyServiceRevenue?: number | null;
  electricityRevenue?: number | null;
  serviceChange: number | null;
  servicePerKwh: number | null;
  electricityProfitPerKwh: number | null;
  profit: number | null;
  peak: number | null;
  high: number | null;
  flat: number | null;
  valley: number | null;
  guns?: number | null;
};
type S = { name: string; records: R[] };
type View = "overview" | "station" | "business" | "trend" | "config";
type AdminMeta = { lastModifiedAt: string | null; lastPublishedAt: string | null; publishStatus: "published" | "draft" };
type PartnerBrand = { operator?: string; operatorName?: string; reportName?: string };
const OperatorContext = createContext(false);
const removedStations = new Set([
  "蔚景云创新中心充电站",
  "蔚景云华阳物流园一期",
  "蔚景云华阳物流园二期",
]);
const baseStations = (data.stations as S[]).filter(
  (s) => !removedStations.has(s.name),
);
let stations = baseStations;
const num = (v: number | null | undefined) => v ?? 0,
  money = (v: number) =>
    `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`,
  qty = (v: number) => v.toLocaleString("zh-CN", { maximumFractionDigits: 0 }),
  chartWan = (v: number) => `${Math.round(v / 10000)}万`,
  chartWanLabel = (v: number) => `${(v / 10000).toFixed(1)}万`,
  pct = (v: number | null) =>
    v == null ? "—" : `${v >= 0 ? "↑" : "↓"} ${Math.abs(v * 100).toFixed(1)}%`;
const importValue = (value: number | null | undefined) => value == null
  ? "—"
  : value.toLocaleString("zh-CN", { useGrouping: true, maximumFractionDigits: 12 });
const nav = [
  { id: "overview" as View, label: "运营总览", icon: LayoutDashboard },
  { id: "station" as View, label: "场站分析", icon: MapPin },
  { id: "trend" as View, label: "趋势洞察", icon: Activity },
  { id: "business" as View, label: "经营分析", icon: BarChart3 },
  { id: "config" as View, label: "数据中心", icon: Settings2 },
];
type StationConfig = {
  operator: string;
  guns: string;
  billingType: string;
  location: string;
  customers: string;
  weather: string;
  event: string;
  industryPrice: string;
  salePrice: string;
  unifiedPrice: string;
  externalElectricity: string;
  externalService: string;
  weeklyPeak: string;
  weeklyHigh: string;
  weeklyFlat: string;
  weeklyValley: string;
  monthlyCostsJson: string;
  gridFeesJson: string;
  externalPricesJson: string;
  electricityPricesJson: string;
  servicePricesJson: string;
  competitorsJson: string;
  analysis: string;
  stationAliasesJson: string;
};
const emptyConfig: StationConfig = {
  operator: "",
  guns: "",
  billingType: "大工业电价",
  location: "",
  customers: "",
  weather: "",
  event: "",
  industryPrice: "",
  salePrice: "",
  unifiedPrice: "",
  externalElectricity: "",
  externalService: "",
  weeklyPeak: "",
  weeklyHigh: "",
  weeklyFlat: "",
  weeklyValley: "",
  monthlyCostsJson: "",
  gridFeesJson: "",
  externalPricesJson: "",
  electricityPricesJson: "",
  servicePricesJson: "",
  competitorsJson: "",
  analysis: "",
  stationAliasesJson: "",
};
type PeriodPrice = { peak: string; high: string; flat: string; valley: string };
const blankPrice = (): PeriodPrice => ({
  peak: "",
  high: "",
  flat: "",
  valley: "",
});
const safeJson = <T,>(value: string, fallback: T): T => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
};
const weekOrderValue = (week: string) => {
  const match = week.replace(/\s/g, "").match(/^(?:(\d{4})年)?(\d{1,2})月(?:第)?(\d+)周$/);
  return Number(match?.[1] || 2026) * 1000 + Number(match?.[2] || 0) * 10 + Number(match?.[3] || 0);
};
const allWeeks = () => [...new Set(stations.flatMap((station) => station.records.map((record) => record.week)))]
  .sort((left, right) => weekOrderValue(left) - weekOrderValue(right));
const recordAt = (station: S, index: number) => station.records.find((record) => record.week === allWeeks()[index]);
const round3 = (value: number | null | undefined) =>
  value == null ? null : Number(value.toFixed(3));
const weekParts = (week: string) => {
  const match = week.replace(/\s/g, "").match(/^(?:(\d{4})年)?(\d{1,2})月(?:第)?(\d+)周$/);
  return {
    year: Number(match?.[1] || 2026),
    month: Number(match?.[2] || 0),
    week: Number(match?.[3] || 0),
  };
};
const shortWeek = (week: string) => week.replace(/^\d{4}年/, "");
const colIndex = (col: string) =>
  [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const DEFAULT_COSTS: Record<string, Record<string, PeriodPrice>> = {};
const DEFAULT_GRID_FEES: Record<string, string> = {};
function useConfigs() {
  const [cfg, setCfg] = useState<Record<string, StationConfig>>({});
  const [loaded, setLoaded] = useState(false);
  const lastLoadedConfig = useRef<string | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => dashboardFetch("/api/dashboard-state", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("共享配置读取失败");
        return response.json() as Promise<{ configs?: Record<string, StationConfig> }>;
      })
      .then((shared) => {
        if (live && shared.configs && Object.keys(shared.configs).length) {
          const serialized = JSON.stringify(shared.configs);
          if (serialized !== lastLoadedConfig.current) {
            lastLoadedConfig.current = serialized;
            setCfg(shared.configs);
          }
        }
        if (live) setLoaded(true);
      })
      .catch((error) => {
        console.warn("暂时使用内置配置", error);
        if (live) setLoaded(true);
      });
    void refresh();
    const handleRealtimeChange = () => void refresh();
    window.addEventListener("dashboard-state-changed", handleRealtimeChange);
    return () => {
      live = false;
      window.removeEventListener("dashboard-state-changed", handleRealtimeChange);
    };
  }, []);
  const update = (name: string, key: keyof StationConfig, value: string) =>
    setCfg((prev) => ({
      ...prev,
      [name]: { ...emptyConfig, ...prev[name], [key]: value },
    }));
  const save = async (nextCfg: Record<string, StationConfig> = cfg, stationData?: S[]) => {
    if (!loaded) throw new Error("价格成本配置仍在加载，请稍后再保存，避免覆盖现有配置");
    setCfg(nextCfg);
    await saveDashboardPatch({ configs: nextCfg, ...(stationData ? { stationData } : {}) });
    return true;
  };
  return { cfg, update, save, loaded };
}
async function saveDashboardPatch(patch: { stationData?: S[]; configs?: Record<string, StationConfig> }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await dashboardFetch("/api/dashboard-state", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) {
      if (response.status === 401 || response.status === 403)
        throw new Error(body.error || "管理员登录已失效，请重新登录后再保存");
      throw new Error(body.error || `保存请求失败（HTTP ${response.status}）`);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw new Error("保存请求超时，请检查网络后重试；系统未确认写入成功");
    if (error instanceof TypeError)
      throw new Error("无法连接保存接口，请刷新页面确认登录状态和网络后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
type CoreImportField = "station" | "period" | "peak" | "high" | "flat" | "valley" | "charge";
type ImportRecognition = {
  sheet: string;
  headerRow: number;
  fields: Record<CoreImportField, string>;
  ignoredColumns: string[];
};
type WorkbookParseResult = { parsed: S[]; recognition: ImportRecognition };

async function parseLegacyWeeklyWorkbook(file: File): Promise<S[]> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer())),
    dec = (path: string) => strFromU8(zip[path]);
  if (!zip["xl/worksheets/sheet1.xml"]) throw new Error("未找到周报工作表");
  const parser = new DOMParser(),
    sharedDoc = parser.parseFromString(dec("xl/sharedStrings.xml"), "text/xml"),
    shared = [...sharedDoc.querySelectorAll("si")].map((si) =>
      [...si.querySelectorAll("t")].map((t) => t.textContent || "").join(""),
    );
  const sheet = parser.parseFromString(
      dec("xl/worksheets/sheet1.xml"),
      "text/xml",
    ),
    rows = new Map<number, Record<string, string>>();
  sheet.querySelectorAll("row").forEach((row) => {
    const values: Record<string, string> = {};
    row.querySelectorAll("c").forEach((cell) => {
      const ref = cell.getAttribute("r") || "",
        col = (ref.match(/[A-Z]+/) || [""])[0],
        raw = cell.querySelector("v")?.textContent || "",
        inline = cell.querySelector("is t")?.textContent || "";
      values[col] =
        cell.getAttribute("t") === "s" && raw
          ? shared[Number(raw)] || ""
          : inline || raw;
    });
    rows.set(Number(row.getAttribute("r")), values);
  });
  if (rows.get(1)?.A === "日期") {
    const aliases: Record<string, string> = {
        黄埔鱼珠智谷充电站: "蔚景云黄埔鱼珠智谷充电站",
        "麦电-佛山创雄华府充电站": "佛山创雄华府充电站",
        "阳充-天鹏酒店充电站": "阳充天鹏酒店充电站",
        雅悦蓝天酒店超充站: "蔚景云雅悦蓝天酒店超充站",
      },
      sum: Record<string, Record<string, number>> = {};
    rows.forEach((r, i) => {
      if (i === 1 || !r.B) return;
      const a = (sum[r.B] ??= {});
      for (const [key, col] of Object.entries({
        charge: "D",
        peak: "E",
        high: "F",
        flat: "G",
        valley: "H",
      }))
        a[key] = (a[key] || 0) + (Number(r[col]) || 0);
    });
    const nextWeek = "8月4周";
    return baseStations.map((station) => {
      const raw = sum[aliases[station.name] || station.name] || {},
        prev = station.records.at(-1)!,
        charge =
          (raw.peak || 0) +
          (raw.high || 0) +
          (raw.flat || 0) +
          (raw.valley || 0),
        record: R = {
          week: nextWeek,
          charge,
          chargeChange: num(prev.charge) ? charge / num(prev.charge) - 1 : null,
          serviceRevenue: null,
          serviceChange: null,
          servicePerKwh: null,
          electricityProfitPerKwh: null,
          profit: null,
          peak: raw.peak || 0,
          high: raw.high || 0,
          flat: raw.flat || 0,
          valley: raw.valley || 0,
        };
      return {
        ...station,
        records: [
          ...station.records.filter((r) => r.week !== nextWeek),
          record,
        ],
      };
    });
  }
  const weekPattern = /^(?:(\d{4})年)?(\d{1,2})月(?:第)?(\d+)周$/,
    headerRow = [...rows.entries()].map(([index, row]) => ({
      index,
      matches: Object.values(row).filter((text) => weekPattern.test(text.replace(/\s/g, ""))).length,
    })).sort((a, b) => b.matches - a.matches)[0]?.index || 1,
    weekByCol = new Map<string, string>();
  Object.entries(rows.get(headerRow) || {}).forEach(([col, text]) => {
      const clean = text.replace(/\s/g, ""),
        match = clean.match(weekPattern);
      if (match)
        weekByCol.set(col, `${match[1] ? `${match[1]}年` : ""}${Number(match[2])}月${Number(match[3])}周`);
    });
  const discovered = [...weekByCol.keys()].sort(
      (a, b) => colIndex(a) - colIndex(b),
    ),
    cols = discovered.length ? discovered : ["AK", "AL", "AM", "AN", "AO", "AP", "AQ", "AR"],
    rawWeeks = cols.map((col, i) => weekByCol.get(col) || data.weeks[i] || `第${i + 1}周`),
    months = rawWeeks.map((week) => weekParts(week).month),
    hasRollover = months.some((month, i) => i > 0 && month < months[i - 1]),
    weeks = rawWeeks.reduce<string[]>((result, week, i) => {
      const parts = weekParts(week);
      const previous = result[i - 1] ? weekParts(result[i - 1]) : null;
      const year = /^\d{4}年/.test(week)
        ? parts.year
        : previous && parts.month < previous.month
          ? previous.year + 1
          : previous?.year || (hasRollover ? 2025 : 2026);
      result.push(`${year}年${parts.month}月${parts.week}周`);
      return result;
    }, []),
    value = (r: number, c: string) => {
      const v = rows.get(r)?.[c];
      const parsed = Number(v);
      return v == null || v === "" || !Number.isFinite(parsed) ? null : parsed;
    },
    result: S[] = [];
  const stationStarts = [...rows.entries()].filter(([, row]) =>
    Object.values(row).some((value) => value.includes("总览")) && Boolean(row.A),
  ).map(([index]) => index);
  rows.forEach((row, start) => {
    if (
      row.A &&
      Object.values(row).some((value) => value.includes("总览")) &&
      !removedStations.has(
        row.A.replace(/\s*[（(]售电[）)]\s*/g, "")
          .replace(/\n/g, " ")
          .trim(),
      )
    ) {
      const name = row.A.replace(/\s*[（(]售电[）)]\s*/g, "")
        .replace(/\n/g, " ")
        .trim(),
        nextStart = stationStarts.find((index) => index > start) || start + 30,
        block = [...rows.entries()].filter(([index]) => index >= start && index < nextStart),
        findMetricRow = (patterns: RegExp[], fallback: number) => {
          const found = block.find(([, candidate]) => {
            const label = Object.values(candidate).slice(0, 8).join("").replace(/\s/g, "");
            return patterns.some((pattern) => pattern.test(label));
          });
          return found?.[0] ?? (fallback < 0 ? -1 : start + fallback);
        },
        metricRows = {
          peak: findMetricRow([/尖.*电量/, /尖时段/], 0),
          high: findMetricRow([/峰.*电量/, /峰时段/], 2),
          flat: findMetricRow([/平.*电量/, /平时段/], 4),
          valley: findMetricRow([/谷.*电量/, /谷时段/], 6),
          charge: findMetricRow([/总充电量/, /充电量合计/, /^充电量$/], 8),
        };
      result.push({
        name,
        records: cols.map((col, i) => ({
          week: weeks[i],
          peak: value(metricRows.peak, col),
          high: value(metricRows.high, col),
          flat: value(metricRows.flat, col),
          valley: value(metricRows.valley, col),
          charge: value(metricRows.charge, col),
          chargeChange: null,
          electricityRevenue: null,
          peakServiceRevenue: null,
          highServiceRevenue: null,
          flatServiceRevenue: null,
          valleyServiceRevenue: null,
          serviceRevenue: null,
          serviceChange: null,
          servicePerKwh: null,
          electricityProfitPerKwh: null,
          profit: null,
        })),
      });
    }
  });
  if (result.length < 1) throw new Error("没有识别到场站数据");
  return result;
}

const normalizeImportHeader = (value: string) => value
  .replace(/[\s\n\r_\-—/（）()【】\[\]]/g, "")
  .replace(/千瓦时|kwh|KWH|元|数值/g, "")
  .trim();
const importAliases: Record<CoreImportField, string[]> = {
  station: ["站点名称", "场站名称", "站场名称", "充电站名称", "站点", "场站", "站场"],
  period: ["周次", "周期", "数据周次", "统计周次", "日期", "数据日期", "统计日期", "时间"],
  peak: ["尖电量", "尖段电量", "尖时段电量", "尖充电量"],
  high: ["峰电量", "峰段电量", "峰时段电量", "峰充电量"],
  flat: ["平电量", "平段电量", "平时段电量", "平充电量"],
  valley: ["谷电量", "谷段电量", "谷时段电量", "谷充电量"],
  charge: ["总充电量", "充电量合计", "合计充电量", "总电量", "充电量"],
};
const importWeek = (value: string) => {
  const clean = value.trim().replace(/\s/g, "");
  const direct = clean.match(/^(?:(\d{4})年)?(\d{1,2})月(?:第)?(\d+)周$/);
  if (direct) return `${direct[1] || 2026}年${Number(direct[2])}月${Number(direct[3])}周`;
  let date: Date | null = null;
  const serial = Number(clean);
  if (/^\d{5}(?:\.\d+)?$/.test(clean) && Number.isFinite(serial))
    date = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  else {
    const match = clean.match(/(20\d{2})[年/.\-](\d{1,2})[月/.\-](\d{1,2})/);
    if (match) date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate(), firstDay = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return `${year}年${month}月${Math.floor((day + firstDay - 1) / 7) + 1}周`;
};

async function parseWeeklyWorkbook(file: File): Promise<WorkbookParseResult> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer())), parser = new DOMParser();
  const sharedFile = zip["xl/sharedStrings.xml"];
  const shared = sharedFile
    ? [...parser.parseFromString(strFromU8(sharedFile), "text/xml").querySelectorAll("si")].map((si) => [...si.querySelectorAll("t")].map((t) => t.textContent || "").join(""))
    : [];
  const worksheets = Object.keys(zip).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort();
  for (const [sheetIndex, path] of worksheets.entries()) {
    const rows = new Map<number, Record<string, string>>();
    parser.parseFromString(strFromU8(zip[path]), "text/xml").querySelectorAll("row").forEach((row) => {
      const values: Record<string, string> = {};
      row.querySelectorAll("c").forEach((cell) => {
        const ref = cell.getAttribute("r") || "", col = (ref.match(/[A-Z]+/) || [""])[0], raw = cell.querySelector("v")?.textContent || "", inline = [...cell.querySelectorAll("is t")].map((node) => node.textContent || "").join("");
        values[col] = cell.getAttribute("t") === "s" && raw ? shared[Number(raw)] || "" : inline || raw;
      });
      rows.set(Number(row.getAttribute("r")), values);
    });
    const candidates = [...rows.entries()].map(([rowNumber, row]) => {
      const mapped = {} as Partial<Record<CoreImportField, string>>;
      Object.entries(row).forEach(([col, label]) => {
        const normalized = normalizeImportHeader(label);
        (Object.keys(importAliases) as CoreImportField[]).forEach((field) => {
          if (!mapped[field] && importAliases[field].some((alias) => normalizeImportHeader(alias) === normalized)) mapped[field] = col;
        });
      });
      return { rowNumber, row, mapped, score: Object.keys(mapped).length };
    }).sort((a, b) => b.score - a.score);
    const header = candidates[0];
    if (!header || header.score < 5 || !header.mapped.station || !header.mapped.period) continue;
    const required: CoreImportField[] = ["station", "period", "peak", "high", "flat", "valley"];
    const missing = required.filter((field) => !header.mapped[field]);
    if (missing.length) throw new Error(`核心字段无法识别：${missing.map((field) => ({ station: "站点名称", period: "周次/日期", peak: "尖电量", high: "峰电量", flat: "平电量", valley: "谷电量", charge: "总充电量" }[field])).join("、")}`);
    const groups = new Map<string, { name: string; week: string; values: Record<string, number>; present: Set<string> }>();
    [...rows.entries()].filter(([number]) => number > header.rowNumber).forEach(([, row]) => {
      const name = String(row[header.mapped.station!] || "").replace(/\s*[（(]售电[）)]\s*/g, "").trim();
      const week = importWeek(String(row[header.mapped.period!] || ""));
      if (!name && !week) return;
      if (!name || !week) return;
      const key = `${name}\u0000${week}`, group = groups.get(key) || { name, week, values: {}, present: new Set<string>() };
      (["peak", "high", "flat", "valley", "charge"] as const).forEach((field) => {
        const column = header.mapped[field];
        if (!column) return;
        const value = parseImportNumber(row[column]);
        if (value !== null) { group.values[field] = (group.values[field] || 0) + value; group.present.add(field); }
      });
      groups.set(key, group);
    });
    if (!groups.size) throw new Error("已识别字段，但没有读取到有效的场站与周次数据");
    const byStation = new Map<string, R[]>();
    groups.forEach((group) => {
      const list = byStation.get(group.name) || [];
      const tou = ["peak", "high", "flat", "valley"].every((field) => group.present.has(field));
      list.push({ week: group.week, peak: group.present.has("peak") ? group.values.peak : null, high: group.present.has("high") ? group.values.high : null, flat: group.present.has("flat") ? group.values.flat : null, valley: group.present.has("valley") ? group.values.valley : null, charge: group.present.has("charge") ? group.values.charge : tou ? group.values.peak + group.values.high + group.values.flat + group.values.valley : null, chargeChange: null, serviceRevenue: null, serviceChange: null, servicePerKwh: null, electricityProfitPerKwh: null, profit: null });
      byStation.set(group.name, list);
    });
    const parsed = [...byStation].map(([name, records]) => ({ name, records: records.sort((a, b) => { const x = weekParts(a.week), y = weekParts(b.week); return x.year - y.year || x.month - y.month || x.week - y.week; }) }));
    const used = new Set(Object.values(header.mapped));
    return {
      parsed,
      recognition: { sheet: `工作表${sheetIndex + 1}`, headerRow: header.rowNumber, fields: { ...header.mapped, charge: header.mapped.charge || "未提供，将按尖峰平谷计算" } as Record<CoreImportField, string>, ignoredColumns: Object.entries(header.row).filter(([col]) => !used.has(col)).map(([, label]) => label).filter(Boolean) },
    };
  }
  const parsed = await parseLegacyWeeklyWorkbook(file);
  return { parsed: parsed.map((station) => ({ name: station.name, records: station.records.map((record) => ({ ...record, electricityRevenue: null, peakServiceRevenue: null, highServiceRevenue: null, flatServiceRevenue: null, valleyServiceRevenue: null, serviceRevenue: null, profit: null, servicePerKwh: null, electricityProfitPerKwh: null })) })), recognition: { sheet: "原周报结构", headerRow: 0, fields: { station: "自动识别", period: "自动识别", peak: "自动识别", high: "自动识别", flat: "自动识别", valley: "自动识别", charge: "自动识别" }, ignoredColumns: [] } };
}
export default function Home() {
  const [view, setView] = useState<View>("overview"),
    [wi, setWi] = useState(baseStations[0]?.records.length - 1 || 0),
    [sn, setSn] = useState("全部场站"),
    [stationData, setStationData] = useState<S[]>(baseStations),
    [exporting, setExporting] = useState(false),
    [admin, setAdmin] = useState(false),
    [accessRole, setAccessRole] = useState<"viewer" | "operator" | "partner" | null>(null),
    [adminMeta, setAdminMeta] = useState<AdminMeta | null>(null),
    [partnerBrand, setPartnerBrand] = useState<PartnerBrand>({}),
    [publishing, setPublishing] = useState(false),
    [publishReport, setPublishReport] = useState<ValidationReport | null>(null),
    [showPublishIssues, setShowPublishIssues] = useState(false),
    [loading, setLoading] = useState(true),
    [realtimeStatus, setRealtimeStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  const lastLoadedData = useRef<string | null>(null);
  const lastLoadedSharedConfigs = useRef<string | null>(null);
  // Legacy dashboard helpers synchronously read this snapshot during render.
  // eslint-disable-next-line react-hooks/globals
  stations = stationData;
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await dashboardFetch("/api/access", { cache: "no-store" });
        const access = (await session.json()) as { role: "viewer" | "operator" | "partner" | null };
        if (!access.role) {
          window.location.replace(siteUrl("/access"));
          return;
        }
        if (live) {
          setAccessRole(access.role);
          setAdmin(access.role === "operator");
        }
        const stateResponse = await dashboardFetch("/api/dashboard-state", { cache: "no-store" });
        const shared = stateResponse.ok
          ? await stateResponse.json() as { stationData?: S[]; meta?: AdminMeta } & PartnerBrand
          : {};
        if (live && shared.stationData?.length) {
          lastLoadedData.current = JSON.stringify(shared.stationData);
          setStationData(shared.stationData);
          setWi(Math.max(0, shared.stationData[0].records.length - 1));
        }
        if (live && shared.meta) setAdminMeta(shared.meta);
        if (live && "configs" in shared) lastLoadedSharedConfigs.current = JSON.stringify(shared.configs);
        if (live && shared.reportName) setPartnerBrand({ operator: shared.operator, operatorName: shared.operatorName, reportName: shared.reportName });
      } catch (error) {
        console.warn("数据库暂不可用", error);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!accessRole) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const refreshSharedData = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        try {
          const response = await dashboardFetch("/api/dashboard-state", { cache: "no-store" });
          if (!response.ok) return;
          const shared = (await response.json()) as { stationData?: S[]; configs?: Record<string, StationConfig>; meta?: AdminMeta } & PartnerBrand;
          let changed = false;
          if (shared.stationData?.length) {
            const serialized = JSON.stringify(shared.stationData);
            if (serialized !== lastLoadedData.current) {
              lastLoadedData.current = serialized;
              changed = true;
              setStationData(shared.stationData);
              setWi((current) => Math.min(current, shared.stationData![0].records.length - 1));
            }
          }
          if (shared.configs) {
            const serialized = JSON.stringify(shared.configs);
            if (serialized !== lastLoadedSharedConfigs.current) {
              lastLoadedSharedConfigs.current = serialized;
              changed = true;
            }
          }
          if (shared.meta) setAdminMeta((current) => JSON.stringify(current) === JSON.stringify(shared.meta) ? current : shared.meta!);
          if (shared.reportName) setPartnerBrand((current) => current.reportName === shared.reportName && current.operator === shared.operator && current.operatorName === shared.operatorName ? current : { operator: shared.operator, operatorName: shared.operatorName, reportName: shared.reportName });
          if (changed) window.dispatchEvent(new Event("dashboard-state-changed"));
        } catch (error) {
          console.warn("实时数据刷新失败", error);
        }
      }, 180);
    };
    const unsubscribe = subscribeToDashboardChanges(refreshSharedData, setRealtimeStatus);
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribe();
    };
  }, [accessRole]);
  const applyImport = async (parsed: S[], _week: string, deferSave = false, commitLocal = !deferSave) => {
    const importedByName = new Map(parsed.map((station) => [station.name, station]));
    const currentByName = new Map(stationData.map((station) => [station.name, station]));
    const names = [...new Set([...currentByName.keys(), ...importedByName.keys()])];
    const merged = names.map((name) => {
      const current = currentByName.get(name);
      const imported = importedByName.get(name);
      const records = [...(current?.records ?? [])];
      (imported?.records ?? []).forEach((incoming) => {
        const index = records.findIndex((record) => record.week === incoming.week);
        if (index >= 0) records[index] = { ...records[index], ...incoming };
        else records.push({ ...incoming });
      });
      records.sort((a, b) => {
        const x = weekParts(a.week), y = weekParts(b.week);
        return x.year - y.year || x.month - y.month || x.week - y.week;
      });
      return { name, records };
    }).filter((station) => station.records.length);
    if (!deferSave) await saveDashboardPatch({ stationData: merged });
    if (commitLocal) {
      const mergedWeeks = [...new Set(merged.flatMap((station) => station.records.map((record) => record.week)))];
      setStationData(merged);
      setWi(Math.max(0, mergedWeeks.length - 1));
    }
    return merged;
  };
  const updateWeeklyRecord = async (stationName: string, week: string, patch: Partial<R>, deferSave = false) => {
    const merged = stationData.map((station) => {
      if (station.name !== stationName) return station;
      const records = station.records.map((record) => ({ ...record }));
      const index = records.findIndex((record) => record.week === week);
      if (index < 0) throw new Error("没有找到该周数据");
      records[index] = { ...records[index], ...patch };
      const edited = records[index];
      edited.charge = num(edited.peak) + num(edited.high) + num(edited.flat) + num(edited.valley);
      records.forEach((record, recordIndex) => {
        const previous = records[recordIndex - 1];
        record.chargeChange = previous && num(previous.charge)
          ? num(record.charge) / num(previous.charge) - 1
          : null;
        record.serviceChange = previous && num(previous.serviceRevenue)
          ? num(record.serviceRevenue) / num(previous.serviceRevenue) - 1
          : null;
        record.servicePerKwh = num(record.charge)
          ? num(record.serviceRevenue) / num(record.charge)
          : null;
        record.electricityProfitPerKwh = num(record.charge)
          ? (num(record.profit) - num(record.serviceRevenue)) / num(record.charge)
          : null;
      });
      return { ...station, records };
    });
    if (!deferSave) await saveDashboardPatch({ stationData: merged });
    setStationData(merged);
    return merged;
  };
  const logout = async () => {
    await dashboardFetch("/api/access/logout", { method: "POST" });
    window.location.href = siteUrl("/access");
  };
  const publishDashboard = async () => {
    if (!window.confirm("确认将当前草稿发布给所有只读端？")) return;
    setPublishing(true);
    try {
      let response = await dashboardFetch("/api/dashboard-state", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmWarnings: false }) });
      let body = await response.json().catch(() => ({})) as { error?: string; report?: ValidationReport };
      if (body.report) setPublishReport(body.report);
      if (response.status === 409 && body.report) {
        const summary = body.report.issues.slice(0, 5).map((issue) => `${issue.station} · ${issue.week} · ${issue.field}：${issue.reason}`).join("\n");
        if (!window.confirm(`发布校验发现${body.report.issues.length}项警告：\n\n${summary}${body.report.issues.length > 5 ? "\n…" : ""}\n\n确认这些警告后继续发布？`)) return;
        response = await dashboardFetch("/api/dashboard-state", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmWarnings: true }) });
        body = await response.json().catch(() => ({}));
      }
      if (!response.ok) {
        if (response.status === 422 && body.report) {
          setShowPublishIssues(true);
          throw new Error(`发布已拦截：发现${body.report.issues.filter((issue) => issue.level === "error").length}项必须处理的问题，请查看错误详情`);
        }
        throw new Error(body.error || "发布失败，请重试");
      }
      setPublishReport(null);
      setShowPublishIssues(false);
      setAdminMeta((current) => ({ lastModifiedAt: current?.lastModifiedAt ?? new Date().toISOString(), lastPublishedAt: new Date().toISOString(), publishStatus: "published" }));
      window.alert("已发布：所有只读端将自动同步最新正式数据");
    } catch (error) {
      if (error instanceof TypeError) window.alert("无法连接发布接口，请刷新页面确认管理员登录和网络状态后重试");
      else window.alert(error instanceof Error ? error.message : "发布失败，请重试");
    } finally {
      setPublishing(false);
    }
  };
  const partner = accessRole === "partner";
  const visibleNav = admin ? nav : nav.filter((x) => x.id !== "config");
  if (loading) {
    return (
      <main className="min-h-screen bg-[#061c16] text-[#b6d0c6] flex items-center justify-center">
        <div className="text-center"><RefreshCw className="mx-auto mb-3 animate-spin text-[#35d7a5]" /><p>正在读取周报数据…</p></div>
      </main>
    );
  }
  return (
    <OperatorContext.Provider value={admin}>
    <main className={`dashboard-shell ${admin ? "operator-mode" : "viewer-mode"}`}>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Zap size={19} fill="currentColor" />
          </span>
          <div>
            <strong>{partner ? partnerBrand.reportName || "运营周报" : "四九实业周报"}</strong>
            <small>{admin ? "运营管理端" : "只读端"}</small>
          </div>
        </div>
        <nav>
          {visibleNav.map((x) => {
            const I = x.icon;
            return (
              <button
                key={x.id}
                className={view === x.id ? "active" : ""}
                onClick={() => setView(x.id)}
              >
                <I />
                {x.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <span className="status-dot" />
          {realtimeStatus === "connecting" ? "正在连接数据同步" : "已开启自动同步"}
          <small>更新至 {allWeeks().at(-1)}</small>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{nav.find((x) => x.id === view)?.label}</h1>
            <p>{admin ? "四九实业周报 · 运营管理端" : partner ? `${partnerBrand.reportName || "运营周报"} · 只读端` : "四九实业周报 · 只读端"} · 2025年11月至最新一周</p>
          </div>
          <div className="actions">
            <button
              className="ghost refresh-button"
              onClick={() => window.location.reload()}
              title="刷新数据"
            >
              <RefreshCw />
              <span>刷新</span>
            </button>
            <button className="primary" onClick={() => setExporting(true)}>
              <Download />
              导出周报
            </button>
            {admin ? (
              <button className="primary" onClick={publishDashboard} disabled={publishing}>
                {publishing ? "发布中..." : "发布更新"}
              </button>
            ) : null}
            <button
              className="ghost"
              onClick={() =>
                admin ? logout() : logout()
              }
            >
              {admin ? "退出运营管理端" : "切换权限"}
            </button>
          </div>
        </header>
        {publishReport?.issues.length ? (
          <section className={`publish-validation-banner ${publishReport.status}`}>
            <div>
              <b>{publishReport.status === "error" ? "发布已拦截" : "发布前有校验提醒"}</b>
              <span>错误 {publishReport.issues.filter((issue) => issue.level === "error").length} 项 · 警告 {publishReport.issues.filter((issue) => issue.level === "warning").length} 项</span>
            </div>
            <button onClick={() => setShowPublishIssues((current) => !current)}>{showPublishIssues ? "收起错误详情" : "查看错误详情"}</button>
            {showPublishIssues ? <div className="publish-issue-table">
              <table>
                <thead><tr><th>站点名称</th><th>错误字段</th><th>当前值</th><th>错误原因</th><th>处理建议</th></tr></thead>
                <tbody>{publishReport.issues.map((issue, index) => <tr key={`${issue.station}-${issue.week}-${issue.field}-${index}`} className={issue.level}>
                  <td>{issue.station}<small>{issue.week !== "—" ? issue.week : ""}</small></td>
                  <td>{issue.field}</td><td>{issue.currentValue}</td><td>{issue.reason}</td><td>{issue.suggestion}</td>
                </tr>)}</tbody>
              </table>
            </div> : null}
          </section>
        ) : null}
        {view !== "config" && (
          <Filters wi={wi} setWi={setWi} sn={sn} setSn={setSn} />
        )}{" "}
        {view === "overview" && <Overview wi={wi} sn={sn} />}{" "}
        {view === "station" && (
          <StationAnalysis wi={wi} sn={sn} setSn={setSn} onRecordSave={updateWeeklyRecord} />
        )}{" "}
        {view === "business" && <Business wi={wi} sn={sn} />}{" "}
        {view === "trend" && <TrendInsights sn={sn} />}{" "}
        {view === "config" && admin && (
          <Config onImport={applyImport} onRecordSave={updateWeeklyRecord} adminMeta={adminMeta} />
        )}{" "}
        {exporting && (
          <ExportDialog
            stations={scope(sn)}
            onClose={() => setExporting(false)}
          />
        )}{" "}
      </section>
    </main>
    </OperatorContext.Provider>
  );
}
function Filters({
  wi,
  setWi,
  sn,
  setSn,
}: {
  wi: number;
  setWi: (v: number) => void;
  sn: string;
  setSn: (v: string) => void;
}) {
  return (
    <div className="filterbar">
      <label>
        <span>统计周期</span>
        <select value={wi} onChange={(e) => setWi(+e.target.value)}>
          {allWeeks().map((w, i) => (
            <option key={w} value={i}>
              {w}
            </option>
          ))}
        </select>
        <ChevronDown />
      </label>
      <label>
        <span>场站范围</span>
        <select value={sn} onChange={(e) => setSn(e.target.value)}>
          <option>全部场站</option>
          {stations.map((s) => (
            <option key={s.name}>{s.name}</option>
          ))}
        </select>
        <ChevronDown />
      </label>
      <div className="data-note">
        <Sparkles />
        曲线支持鼠标悬停查看数值
      </div>
    </div>
  );
}
function scope(sn: string) {
  return sn === "全部场站" ? stations : stations.filter((s) => s.name === sn);
}
function series(sn: string, key: keyof R) {
  return allWeeks().map((week, i) => ({
    week,
    value: scope(sn).reduce(
      (a, s) => a + num(recordAt(s, i)?.[key] as number | null),
      0,
    ),
  }));
}
function totals(sn: string, wi: number) {
  const ss = scope(sn),
    cur = ss.map((s) => recordAt(s, wi)).filter((record): record is R => Boolean(record)),
    prev = ss.map((s) => recordAt(s, Math.max(0, wi - 1))).filter((record): record is R => Boolean(record)),
    sum = (rs: R[], k: keyof R) =>
      rs.reduce((a, r) => a + num(r[k] as number | null), 0),
    charge = sum(cur, "charge"),
    revenue = sum(cur, "serviceRevenue"),
    profit = sum(cur, "profit"),
    pc = sum(prev, "charge"),
    pr = sum(prev, "serviceRevenue"),
    pp = sum(prev, "profit");
  return {
    charge,
    revenue,
    profit,
    active: cur.filter((r) => num(r.charge) > 0).length,
    cc: pc ? charge / pc - 1 : null,
    rc: pr ? revenue / pr - 1 : null,
    pc: pp ? profit / pp - 1 : null,
  };
}
function Overview({ wi, sn }: { wi: number; sn: string }) {
  const { cfg } = useConfigs();
  const t = useMemo(() => totals(sn, wi), [wi, sn]),
    charge = series(sn, "charge"),
    profit = series(sn, "profit"),
    selected = scope(sn).map((s) => ({ station: s, record: recordAt(s, wi) })).filter((item): item is { station: S; record: R } => Boolean(item.record)),
    sumMix = (index: number) =>
      scope(sn).reduce(
        (a, s) => ({
          peak: a.peak + num(recordAt(s, index)?.peak),
          high: a.high + num(recordAt(s, index)?.high),
          flat: a.flat + num(recordAt(s, index)?.flat),
          valley: a.valley + num(recordAt(s, index)?.valley),
        }),
        { peak: 0, high: 0, flat: 0, valley: 0 },
      ),
    mix = sumMix(wi),
    prevMix = sumMix(Math.max(0, wi - 1));
  return (
    <>
      <div className="kpi-grid">
        <Kpi
          icon={<BatteryCharging />}
          label="总充电量"
          value={`${qty(t.charge)} kWh`}
          change={t.cc}
        />
        <Kpi
          icon={<CircleDollarSign />}
          label="服务费收入"
          value={money(t.revenue)}
          change={t.rc}
        />
        <Kpi
          icon={<Gauge />}
          label="经营毛利 / 利润"
          value={money(t.profit)}
          change={t.pc}
        />
        {sn === "全部场站" ? (
          <Kpi
            icon={<Building2 />}
            label="有数据场站"
            value={`${t.active} / ${scope(sn).length}`}
            sub="本周产生充电量"
          />
        ) : (
          <GunCard station={sn} />
        )}
      </div>
      <WeeklySummary
        wi={wi}
        sn={sn}
        totalsData={t}
        generatedAnalysis={(() => {
          const saved = sn === "全部场站" ? cfg.__summary__?.analysis : cfg[sn]?.analysis;
          if (saved && !saved.startsWith(sn === "全部场站" ? "全场充电量" : "充电量")) return saved;
          const week = allWeeks()[wi];
          if (!week) return saved;
          return sn === "全部场站"
            ? generateWeeklyAnalyses(scope(sn), week, cfg).__summary__?.analysis
            : generateStationAnalysis(scope(sn)[0], week, { ...emptyConfig, ...cfg[sn] });
        })()}
      />
      <OverviewTrends
        sn={sn}
        wi={wi}
        currentMix={mix}
        previousMix={prevMix}
        configs={cfg}
      />
      <Panel
        title="18站完整经营结果"
        sub={`${allWeeks()[wi]} · 尖峰平谷、收入、每度利润、当周利润同屏`}
        extra="ranking"
      >
        <StationTable
          rows={[...selected].sort(
            (a, b) => num(b.record.profit) - num(a.record.profit),
          )}
          detailed
        />
      </Panel>
    </>
  );
}
function WeeklySummary({
  wi,
  sn,
  totalsData,
  generatedAnalysis,
}: {
  wi: number;
  sn: string;
  totalsData: ReturnType<typeof totals>;
  generatedAnalysis?: string;
}) {
  const attention = scope(sn)
    .map((station) => ({ station, record: recordAt(station, wi) }))
    .filter((item): item is { station: S; record: R } => Boolean(item.record && num(item.record.chargeChange) < 0))
    .sort((a, b) => num(a.record.chargeChange) - num(b.record.chargeChange))
    .slice(0, 3);
  const status =
    num(totalsData.cc) < -0.05 || num(totalsData.pc) < -0.05
      ? "需关注"
      : num(totalsData.cc) > 0.05 && num(totalsData.pc) > 0
        ? "表现良好"
        : "整体平稳";
  const positive = scope(sn)
    .map((station) => ({ station, record: recordAt(station, wi) }))
    .filter((item): item is { station: S; record: R } => Boolean(item.record && num(item.record.chargeChange) > 0))
    .sort((a, b) => num(b.record.chargeChange) - num(a.record.chargeChange))
    .slice(0, 2);
  const summaryText = generatedAnalysis || `全场充电量${pct(totalsData.cc)}，服务费收入${pct(totalsData.rc)}，经营利润${pct(totalsData.pc)}。${positive.length ? `增长较快：${positive.map((x) => x.station.name.replace("充电站", "")).join("、")}；` : ""}${attention.length ? `重点关注：${attention.map((x) => x.station.name.replace("充电站", "")).join("、")}。` : "暂无明显下降站点。"}`;
  return (
    <section
      className={`weekly-summary ${status === "需关注" ? "warning" : ""}`}
    >
      <div className="weekly-summary-status">
        <span>本周运营</span>
        <b>{status}</b>
      </div>
      <div className="weekly-summary-metrics">
        <span>
          充电量{" "}
          <b className={num(totalsData.cc) >= 0 ? "up" : "down"}>
            {pct(totalsData.cc)}
          </b>
        </span>
        <span>
          服务费{" "}
          <b className={num(totalsData.rc) >= 0 ? "up" : "down"}>
            {pct(totalsData.rc)}
          </b>
        </span>
        <span>
          经营利润{" "}
          <b className={num(totalsData.pc) >= 0 ? "up" : "down"}>
            {pct(totalsData.pc)}
          </b>
        </span>
      </div>
      <div className="weekly-summary-focus">
        <span>重点关注</span>
        {attention.length ? (
          attention.map(({ station, record }) => (
            <b key={station.name}>
              {station.name.replace("充电站", "")}{" "}
              <em>{pct(record.chargeChange)}</em>
            </b>
          ))
        ) : (
          <b>暂无明显下降站点</b>
        )}
      </div>
      <p className="weekly-summary-conclusion">{summaryText}</p>
    </section>
  );
}
function OverviewTrends({
  sn,
  wi,
  currentMix,
  previousMix,
  configs,
}: {
  sn: string;
  wi: number;
  currentMix: Record<keyof PeriodPrice, number>;
  previousMix: Record<keyof PeriodPrice, number>;
  configs: Record<string, StationConfig>;
}) {
  const [mode, setMode] = useState<"week" | "month">("week"),
    [offset, setOffset] = useState(0),
    [dragStart, setDragStart] = useState<number | null>(null),
    periods: [keyof PeriodPrice, string, string][] = [
      ["peak", "尖段", "#ff6b6b"],
      ["high", "峰段", "#ffb454"],
      ["flat", "平段", "#59d7b4"],
      ["valley", "谷段", "#6f8cff"],
    ],
    aggregate = (points: { week: string; value: number }[]) => {
      if (mode === "week") return points;
      const grouped = new Map<string, number>();
      points.forEach((x) => {
        const parts = weekParts(x.week), m = `${parts.year}年${parts.month}月`;
        grouped.set(m, (grouped.get(m) || 0) + x.value);
      });
      return [...grouped].map(([week, value]) => ({ week, value }));
    },
    aggregateAverage = (points: { week: string; value: number }[]) => {
      if (mode === "week") return points;
      const grouped = new Map<string, { total: number; count: number }>();
      points.forEach((x) => {
        const parts = weekParts(x.week), m = `${parts.year}年${parts.month}月`;
        const current = grouped.get(m) || { total: 0, count: 0 };
        grouped.set(m, { total: current.total + x.value, count: current.count + 1 });
      });
      return [...grouped].map(([week, value]) => ({
        week,
        value: value.count ? value.total / value.count : 0,
      }));
    },
    raw = (key: keyof R) =>
      allWeeks().map((week, i) => ({
        week,
        value: scope(sn).reduce(
          (a, s) => a + num(recordAt(s, i)?.[key] as number | null),
          0,
        ),
      })),
    chargeTotal = aggregate(raw("charge")),
    profitTotal = aggregate(raw("profit")),
    serviceTotal = aggregate(raw("serviceRevenue")),
    gunUtilization = aggregateAverage(
      allWeeks().map((week, i) => {
        const selectedStations = scope(sn);
        const gunCount = selectedStations.reduce((total, station) => {
          return total + Number(recordAt(station, i)?.guns || configs[station.name]?.guns || 0);
        }, 0);
        const charge = selectedStations.reduce(
          (total, station) => total + num(recordAt(station, i)?.charge),
          0,
        );
        const capacity = gunCount * 25 * 24 * 7;
        return { week, value: capacity ? (charge / capacity) * 100 : 0 };
      }),
    ),
    chargeParts = periods.map(([key, label, color]) => ({
      name: label,
      color,
      data: aggregate(raw(key)),
    })),
    periodProfitAt = (index: number, key: keyof PeriodPrice) => scope(sn).reduce((total, station) => {
      const record = recordAt(station, index);
      if (!record) return total;
      const stationConfig = { ...emptyConfig, ...configs[station.name] };
      const monthlyConfig = { ...emptyConfig, ...configs.__monthly__ };
      return total + num(calculateOperatingMetrics(record, stationConfig, monthlyConfig).periodProfit[key]);
    }, 0),
    profitParts = periods.map(([key, label, color]) => ({
      name: label,
      color,
      data: aggregate(
        allWeeks().map((week, i) => ({
          week,
          value: periodProfitAt(i, key),
        })),
      ),
    })),
    size = 8,
    maxOffset = Math.max(0, chargeTotal.length - size),
    start = Math.max(0, maxOffset - offset),
    slice = <T,>(x: T[]) => x.slice(start, start + size),
    visibleLabels = chargeTotal.map((x) => x.week),
    endIndex = Math.min(chargeTotal.length - 1, start + size - 1),
    move = (older: boolean) =>
      setOffset((v) => Math.max(0, Math.min(maxOffset, v + (older ? 1 : -1)))),
    handleUp = (x: number) => {
      if (dragStart !== null && Math.abs(x - dragStart) > 38)
        move(x < dragStart);
      setDragStart(null);
    },
    profitMix = {
      peak: periodProfitAt(wi, "peak"),
      high: periodProfitAt(wi, "high"),
      flat: periodProfitAt(wi, "flat"),
      valley: periodProfitAt(wi, "valley"),
    },
    prevProfitMix = {
      peak: periodProfitAt(Math.max(0, wi - 1), "peak"),
      high: periodProfitAt(Math.max(0, wi - 1), "high"),
      flat: periodProfitAt(Math.max(0, wi - 1), "flat"),
      valley: periodProfitAt(Math.max(0, wi - 1), "valley"),
    },
    chargeLines = [
      { name: "总量", color: "#e8fff7", data: slice(chargeTotal) },
      ...chargeParts.map((x) => ({ ...x, data: slice(x.data) })),
    ],
    profitLines = [
      { name: "毛利总额", color: "#e8fff7", data: slice(profitTotal) },
      ...profitParts.map((x) => ({ ...x, data: slice(x.data) })),
    ];
  return (
    <div className="overview-trends">
      <div className="trend-toolbar">
        <div>
          <button
            className={mode === "week" ? "active" : ""}
            onClick={() => {
              setMode("week");
              setOffset(0);
            }}
          >
            周度
          </button>
          <button
            className={mode === "month" ? "active" : ""}
            onClick={() => {
              setMode("month");
              setOffset(0);
            }}
          >
            月度
          </button>
        </div>
        <span>
          默认显示最近8{mode === "week" ? "周" : "个月"} ·
          在图表上按住鼠标向左拖动查看历史
        </span>
        <label>
          时间
          <select
            value={visibleLabels[endIndex] || ""}
            onChange={(e) => {
              const i = visibleLabels.indexOf(e.target.value),
                desired = Math.max(0, i - size + 1);
              setOffset(Math.max(0, maxOffset - desired));
            }}
          >
            {visibleLabels.map((label) => (
              <option key={label}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="trend-pair drag-surface"
        onPointerDown={(e) => setDragStart(e.clientX)}
        onPointerUp={(e) => handleUp(e.clientX)}
        onPointerCancel={() => setDragStart(null)}
      >
        <Panel
          title="充电量趋势图"
          sub="折线标注总量；点击某周查看尖峰平谷明细"
        >
          <InteractiveChart
            lines={chargeLines}
            showPrimaryLabels
            tooltipRequiresPin
            valueFormatter={(value) => `${value.toFixed(2)} kWh`}
          />
        </Panel>
        <Panel
          title="尖峰平谷 · 电量"
          sub={(allWeeks()[wi] || "最新周") + " · 本周、上周及环比"}
        >
          <MixComparison current={currentMix} previous={previousMix} />
        </Panel>
      </div>
      <div
        className="trend-pair drag-surface"
        onPointerDown={(e) => setDragStart(e.clientX)}
        onPointerUp={(e) => handleUp(e.clientX)}
        onPointerCancel={() => setDragStart(null)}
      >
        <Panel
          title="毛利额趋势图"
          sub="折线标注毛利总额；点击某周查看尖峰平谷明细"
        >
          <InteractiveChart
            lines={profitLines}
            showPrimaryLabels
            tooltipRequiresPin
            valueFormatter={(value) => `¥${value.toFixed(2)}`}
          />
        </Panel>
        <Panel title="尖峰平谷 · 毛利额" sub="分时毛利额及占比">
          <MoneyMixComparison current={profitMix} previous={prevProfitMix} />
        </Panel>
      </div>
      <div className="trend-pair">
        <Panel
          title="服务费收入趋势图"
          sub="按周展示服务费收入变化；悬停查看具体数值"
          extra="trend-service-panel"
        >
          <InteractiveChart
            lines={[
              {
                name: "服务费收入",
                color: "#36d399",
                data: slice(serviceTotal),
              },
            ]}
            showPrimaryLabels
            tooltipRequiresPin
            valueFormatter={(value) => `¥${value.toFixed(2)}`}
          />
        </Panel>
        <Panel
          title="枪利用率趋势图"
          sub="实际充电量 ÷ 理论最大充电量；悬停查看具体数值"
          extra="trend-utilization-panel"
        >
          <InteractiveChart
            lines={[
              {
                name: "枪利用率",
                color: "#36d399",
                data: slice(gunUtilization),
              },
            ]}
            showPrimaryLabels
            tooltipRequiresPin
            valueFormatter={(value) => `${value.toFixed(2)}%`}
            primaryLabelFormatter={(value) => `${value.toFixed(1)}%`}
          />
        </Panel>
      </div>
    </div>
  );
}
function MoneyMixComparison({
  current,
  previous,
}: {
  current: Record<keyof PeriodPrice, number>;
  previous: Record<keyof PeriodPrice, number>;
}) {
  const [active, setActive] = useState<keyof PeriodPrice>("flat"),
    total = Object.values(current).reduce((a, b) => a + b, 0) || 1,
    items: [keyof PeriodPrice, string, string][] = [
      ["peak", "尖段", "#ff6b6b"],
      ["high", "峰段", "#ffb454"],
      ["flat", "平段", "#59d7b4"],
      ["valley", "谷段", "#6f8cff"],
    ],
    change = previous[active] ? current[active] / previous[active] - 1 : null;
  return (
    <div className="money-mix">
      <div className="money-mix-total">
        <span>{items.find((x) => x[0] === active)?.[1]}毛利额</span>
        <strong>{money(current[active])}</strong>
        <small className={num(change) >= 0 ? "up" : "down"}>
          {change == null ? "无上期数据" : `环比 ${pct(change)}`}
        </small>
      </div>
      {items.map(([key, label, color]) => (
        <button
          key={key}
          className={active === key ? "active" : ""}
          onMouseEnter={() => setActive(key)}
          onFocus={() => setActive(key)}
        >
          <i style={{ background: color }} />
          <span>{label}</span>
          <b>{money(current[key])}</b>
          <small>{((current[key] / total) * 100).toFixed(1)}%</small>
        </button>
      ))}
    </div>
  );
}
function StationAnalysis({
  wi,
  sn,
  setSn,
  onRecordSave,
}: {
  wi: number;
  sn: string;
  setSn: (v: string) => void;
  onRecordSave: (station: string, week: string, patch: Partial<R>, deferSave?: boolean) => Promise<S[]>;
}) {
  const { cfg, update, save } = useConfigs(),
    isAll = sn === "全部场站",
    selected = stations.find((s) => s.name === sn) || stations[0],
    chosen = useMemo(() => {
      if (!isAll) return selected;
      const weeks = allWeeks();
      const records = weeks.map((week, index) => {
        const rows = stations
          .map((station) => station.records.find((record) => record.week === week))
          .filter((record): record is R => Boolean(record));
        const sum = (key: keyof R) => rows.reduce((total, row) => {
          const value = row[key];
          return total + (typeof value === "number" ? value : 0);
        }, 0),
          periodService = (period: "peak" | "high" | "flat" | "valley") => stations.reduce((total, station) => {
            const record = station.records.find((item) => item.week === week);
            if (!record) return total;
            const storedKey = `${period}ServiceRevenue` as keyof R,
              stored = record[storedKey];
            if (typeof stored === "number") return total + stored;
            const config = { ...emptyConfig, ...cfg[station.name] },
              weekPrices = resolveWeeklyPrice(config.servicePricesJson, week),
              price = Number(weekPrices[period] || 0);
            if (price) return total + num(record[period]) * price;
            return total + (num(record.charge)
              ? num(record.serviceRevenue) * num(record[period]) / num(record.charge)
              : 0);
          }, 0);
        const charge = sum("charge"), serviceRevenue = sum("serviceRevenue"),
          profit = sum("profit"), previousWeek = weeks[index - 1],
          previousRows = previousWeek ? stations
            .map((station) => station.records.find((record) => record.week === previousWeek))
            .filter((record): record is R => Boolean(record)) : [],
          previousCharge = previousRows.reduce((total, row) => total + num(row.charge), 0),
          previousService = previousRows.reduce((total, row) => total + num(row.serviceRevenue), 0);
        return {
          week,
          charge,
          chargeChange: previousCharge ? charge / previousCharge - 1 : null,
          serviceRevenue,
          peakServiceRevenue: periodService("peak"),
          highServiceRevenue: periodService("high"),
          flatServiceRevenue: periodService("flat"),
          valleyServiceRevenue: periodService("valley"),
          electricityRevenue: sum("electricityRevenue"),
          serviceChange: previousService ? serviceRevenue / previousService - 1 : null,
          servicePerKwh: charge ? serviceRevenue / charge : null,
          electricityProfitPerKwh: charge ? (profit - serviceRevenue) / charge : null,
          profit,
          peak: sum("peak"), high: sum("high"), flat: sum("flat"), valley: sum("valley"),
        } satisfies R;
      });
      return { name: "全部场站", records };
    }, [cfg, isAll, selected]),
    r = isAll ? chosen.records.find((record) => record.week === allWeeks()[wi]) || chosen.records.at(-1) : recordAt(chosen, wi) || chosen.records.at(-1),
    c = { ...emptyConfig, ...cfg[selected.name] },
    [editing, setEditing] = useState(false),
    [saved, setSaved] = useState(false);
  const doSave = async () => {
    await save();
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  return (
    <>
      <div className="page-heading station-heading">
        <div>
          <span className="eyebrow">{isAll ? "全场站经营汇总" : "单站经营画像"}</span>
          <h2>{isAll ? `全部场站（${stations.length}个有效场站）` : selected.name}</h2>
          {isAll ? (
            <div className="station-meta"><span>按周汇总全部有效场站</span><span>单度指标按汇总数据重新计算</span></div>
          ) : editing ? (
            <div className="inline-edit">
              <input
                value={c.location}
                onChange={(e) =>
                  update(selected.name, "location", e.target.value)
                }
                placeholder="填写站场位置"
              />
              <input
                value={c.customers}
                onChange={(e) =>
                  update(selected.name, "customers", e.target.value)
                }
                placeholder="填写主要充电人群"
              />
            </div>
          ) : (
            <div className="station-meta">
              <span>{c.location || "场站位置暂未填写"}</span>
              <span>{c.customers || "主要充电人群暂未填写"}</span>
            </div>
          )}
        </div>
        {!isAll && <div className="config-actions">
          {editing && (
            <button className="ghost" onClick={() => setEditing(false)}>
              取消
            </button>
          )}
          <button onClick={() => (editing ? doSave() : setEditing(true))}>
            {saved ? "已保存 ✓" : editing ? "保存" : "编辑资料"}
          </button>
        </div>}
      </div>
      {!isAll && <div className="context-strip">
        {editing ? (
          <>
            <label>
              近期天气
              <input
                value={c.weather}
                onChange={(e) => update(selected.name, "weather", e.target.value)}
                placeholder="如：连续降雨、气温下降"
              />
            </label>
            <label>
              特殊事件
              <input
                value={c.event}
                onChange={(e) => update(selected.name, "event", e.target.value)}
                placeholder="如：节假日、道路施工、活动"
              />
            </label>
          </>
        ) : (
          <>
            <div className="context-readonly">
              <span>近期天气</span>
              <b>{c.weather || "暂无记录"}</b>
            </div>
            <div className="context-readonly">
              <span>特殊事件</span>
              <b>{c.event || "暂无记录"}</b>
            </div>
          </>
        )}
        <span>统计周期：上周日—本周六</span>
      </div>}
      <div className="kpi-grid">
        <Kpi
          icon={<BatteryCharging />}
          label="本周充电量"
          value={`${qty(num(r?.charge))} kWh`}
          change={r?.chargeChange ?? null}
        />
        <Kpi
          icon={<CircleDollarSign />}
          label="每度服务费"
          value={`¥${num(r?.servicePerKwh).toFixed(3)}`}
          sub="服务费收入 / kWh"
        />
        <Kpi
          icon={<Zap />}
          label="每度电费利润"
          value={`¥${num(r?.electricityProfitPerKwh).toFixed(3)}`}
          sub="电费利润 / kWh"
        />
        <article className="kpi emphasis">
          <div className="kpi-top">
            <span className="kpi-icon">
              <Gauge />
            </span>
            <span>当周经营利润</span>
          </div>
          <div className="kpi-body">
            <strong>{money(num(r?.profit))}</strong>
          </div>
          <div className="kpi-foot">
            <small>重点指标 · 经营利润口径</small>
          </div>
        </article>
      </div>
      <div className="content-grid equal">
        <Panel title={isAll ? "全站充电量趋势" : "单站充电量趋势"} sub="按周统计，悬停查看准确电量">
          <FilteredInteractiveChart
            lines={[
              {
                name: "充电量",
                color: "#36d399",
                data: chosen.records.map((x) => ({
                  week: x.week,
                  value: num(x.charge),
                })),
              },
            ]}
            showPrimaryLabels
            tooltipRequiresPin
            valueFormatter={(value) => `${value.toFixed(2)} kWh`}
          />
        </Panel>
        <Panel title={isAll ? "全站经营利润趋势" : "单站经营利润趋势"} sub="服务费利润与电费利润汇总">
          <FilteredInteractiveChart
            lines={[
              {
                name: "经营利润",
                color: "#ffb454",
                data: chosen.records.map((x) => ({
                  week: x.week,
                  value: num(x.profit),
                })),
              },
            ]}
            showPrimaryLabels
            tooltipRequiresPin
            valueFormatter={(value) => `¥${value.toFixed(2)}`}
          />
        </Panel>
      </div>
      <StationHistoryTable station={chosen} onRecordSave={onRecordSave} aggregate={isAll} />
    </>
  );
}
function Business({ sn }: { wi: number; sn: string }) {
  const latest = allWeeks().length - 1,
    { cfg, update, save } = useConfigs(),
    [editingStation, setEditingStation] = useState<string | null>(null),
    [savedStation, setSavedStation] = useState<string | null>(null),
    rows = scope(sn)
      .map((s) => ({ station: s, record: recordAt(s, latest) }))
      .filter((item): item is { station: S; record: R } => Boolean(item.record))
      .sort((a, b) => num(b.record.profit) - num(a.record.profit)),
    attention = rows
      .filter((x) => num(x.record.chargeChange) < -0.12)
      .sort((a, b) => num(a.record.chargeChange) - num(b.record.chargeChange)),
    doSave = async (name: string) => {
      await save();
      setEditingStation(null);
      setSavedStation(name);
      setTimeout(() => setSavedStation(null), 1500);
    };
  const AnalysisBlock = ({
    item,
    compact = false,
  }: {
    item: (typeof rows)[number];
    compact?: boolean;
  }) => {
    const name = item.station.name,
      savedAnalysis = (cfg[name] || emptyConfig).analysis,
      value = editingStation === name ? savedAnalysis :
        savedAnalysis && !savedAnalysis.startsWith("充电量") ? savedAnalysis :
        generateStationAnalysis(item.station, allWeeks()[latest], { ...emptyConfig, ...cfg[name] }),
      editing = editingStation === name;
    return (
      <div className={`analysis-view ${compact ? "compact" : ""}`}>
        {editing ? (
          <>
            <textarea
              autoFocus
              value={value}
              onChange={(e) => update(name, "analysis", e.target.value)}
              placeholder="填写主要原因与下一步改进措施…"
            />
            <div className="analysis-actions">
              <button className="ghost" onClick={() => setEditingStation(null)}>
                取消
              </button>
              <button className="save-button" onClick={() => doSave(name)}>
                保存
              </button>
            </div>
          </>
        ) : (
          <>
            <p>{value || "暂未填写运营分析"}</p>
            <button onClick={() => setEditingStation(name)}>
              {value ? "编辑" : "添加分析"}
            </button>
            {savedStation === name && <small className="up">已保存 ✓</small>}
          </>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="page-heading business-head">
        <div>
          <span className="eyebrow">最新一周经营诊断</span>
          <h2>{allWeeks()[latest]} 全场站分析</h2>
          <p>优先关注严重下降站点，再查看完整利润排名与全场诊断。</p>
        </div>
        <span className="attention-count">重点关注 {attention.length} 个</span>
      </div>
      <div className="content-grid equal">
        <Panel title="经营利润排名" sub="排名、利润与充电量环比同屏">
          <BarList rows={rows} />
        </Panel>
        <Panel
          title={`重点下降站点 · ${attention.length}个`}
          sub="充电量环比下降超过 12%，按降幅排序"
        >
          <div className="attention-list">
            {attention.length ? (
              attention.slice(0, 5).map((x, index) => (
                <div key={x.station.name}>
                  <div className="attention-main">
                    <i>{index + 1}</i>
                    <div>
                      <b>{x.station.name}</b>
                      <small>经营利润 {money(num(x.record.profit))}</small>
                    </div>
                    <span className="down">{pct(x.record.chargeChange)}</span>
                  </div>
                  <AnalysisBlock item={x} compact />
                </div>
              ))
            ) : (
              <p className="empty-note">本周暂无下降超过 12% 的场站</p>
            )}
          </div>
        </Panel>
      </div>
      <Panel
        title="全场站数据诊断"
        sub="默认展示结果；需要时再添加或编辑运营分析"
        extra="ranking"
      >
        <div className="diagnosis-grid">
          {rows.map((x) => (
            <div
              key={x.station.name}
              className={
                num(x.record.chargeChange) < 0 ? "negative" : "positive"
              }
            >
              <header>
                <b>{x.station.name}</b>
                <span>{pct(x.record.chargeChange)}</span>
              </header>
              <p>
                充电量 {qty(num(x.record.charge))} kWh · 经营利润{" "}
                {money(num(x.record.profit))}
              </p>
              <AnalysisBlock item={x} />
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
function TrendInsights({ sn }: { sn: string }) {
  if (sn === "全部场站") return <AllStationTrendSummary />;
  const chosen = stations.find((s) => s.name === sn)!;
  return <SingleStationTrend station={chosen} />;
}
function AllStationTrendSummary() {
  const latest = allWeeks().length - 1,
    [mode, setMode] = useState<
      "all" | "top5" | "growth" | "decline" | "custom"
    >("top5"),
    [focus, setFocus] = useState<string | null>(null),
    [custom, setCustom] = useState<string[]>([]),
    ranked = [...stations].sort(
      (a, b) => num(recordAt(b, latest)?.charge) - num(recordAt(a, latest)?.charge),
    ),
    growth = [...stations]
      .filter((s) => num(recordAt(s, latest)?.chargeChange) >= 0)
      .sort(
        (a, b) =>
          num(recordAt(b, latest)?.chargeChange) -
          num(recordAt(a, latest)?.chargeChange),
      ),
    decline = [...stations]
      .filter((s) => num(recordAt(s, latest)?.chargeChange) < 0)
      .sort(
        (a, b) =>
          num(recordAt(a, latest)?.chargeChange) -
          num(recordAt(b, latest)?.chargeChange),
      ),
    shown =
      mode === "all"
        ? stations
        : mode === "growth"
          ? growth
          : mode === "decline"
            ? decline
            : mode === "custom"
              ? stations.filter((s) => custom.includes(s.name))
              : ranked.slice(0, 5),
    colors = [
      "#36d399",
      "#ffb454",
      "#66a8ff",
      "#c28cff",
      "#ff7474",
      "#5eead4",
      "#f9a8d4",
      "#a3e635",
    ],
    aggregate = {
      name: "全场趋势",
      color: "#e8fff7",
      data: allWeeks().map((week, index) => ({
        week,
        value: stations.reduce(
          (sum, station) => sum + num(recordAt(station, index)?.charge),
          0,
        ),
      })),
    },
    lines = [
      aggregate,
      ...shown.map((station, index) => ({
        name: station.name,
        color: colors[index % colors.length],
        data: station.records.map((record) => ({
          week: record.week,
          value: num(record.charge),
        })),
      })),
    ];
  return (
    <>
      <div className="executive-note">
        <Sparkles />
        <div>
          <b>18站趋势洞察</b>
          <span>默认聚焦 TOP5；点击场站后突出该线，其余曲线自动降权。</span>
        </div>
      </div>
      <div className="trend-filterbar">
        {(
          [
            ["all", "全部"],
            ["top5", "TOP5"],
            ["growth", "增长"],
            ["decline", "下降"],
            ["custom", "自定义"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            className={mode === key ? "active" : ""}
            onClick={() => {
              setMode(key);
              setFocus(null);
            }}
          >
            {label}
          </button>
        ))}
        <span>当前显示 {shown.length} 个场站 + 全场趋势</span>
      </div>
      {mode === "custom" && (
        <div className="trend-custom-list">
          {stations.map((station) => (
            <label key={station.name}>
              <input
                type="checkbox"
                checked={custom.includes(station.name)}
                onChange={() =>
                  setCustom((value) =>
                    value.includes(station.name)
                      ? value.filter((name) => name !== station.name)
                      : [...value, station.name],
                  )
                }
              />
              {station.name}
            </label>
          ))}
        </div>
      )}
      <Panel
        title="充电量趋势对比"
        sub="悬停查看本周、上周、环比与当前排名；点击图例聚焦场站"
      >
        <FilteredInteractiveChart
          lines={lines}
          large
          focusedLine={focus}
          onFocusLine={setFocus}
          rankedTooltip
          valueFormatter={(value) => `${value.toFixed(2)} kWh`}
        />
      </Panel>
      <Panel
        title="18站最新周经营结果"
        sub="一次查看全部场站，不用逐站切换"
        extra="ranking"
      >
        <StationTable
          rows={stations
            .map((s) => ({ station: s, record: recordAt(s, latest) }))
            .filter((item): item is { station: S; record: R } => Boolean(item.record))
            .sort((a, b) => num(b.record.profit) - num(a.record.profit))}
          detailed
        />
      </Panel>
    </>
  );
}
function SingleStationTrend({ station }: { station: S }) {
  const { cfg, update, save } = useConfigs(),
    c = { ...emptyConfig, ...cfg[station.name] },
    [editing, setEditing] = useState(false),
    [originalCompetitors, setOriginalCompetitors] = useState<string | null>(null),
    latest = station.records.at(-1)!,
    doSave = async () => {
      const latestWeek = station.records.at(-1)?.week || "",
        updated = {
          ...c,
          analysis: generateStationAnalysis(station, latestWeek, c),
        };
      await save({ ...cfg, [station.name]: updated });
      setEditing(false);
      setOriginalCompetitors(null);
    };
  return (
    <>
      <div className="page-heading trend-head">
        <div>
          <span className="eyebrow">本站尖峰平谷与竞站洞察</span>
          <h2>{station.name}</h2>
          <p>外售价格及竞站价格按周维护；保存后锁定。</p>
        </div>
        <div className="config-actions">
          <button className="ghost" onClick={() => {
            if (editing) {
              if (originalCompetitors != null)
                update(station.name, "competitorsJson", originalCompetitors);
              setEditing(false);
              setOriginalCompetitors(null);
            } else {
              setOriginalCompetitors(c.competitorsJson);
              setEditing(true);
            }
          }}>
            {editing ? "取消编辑" : "编辑竞站"}
          </button>
          {editing && (
            <button className="save-button" onClick={doSave}>
              保存并锁定
            </button>
          )}
        </div>
      </div>
      <Panel title="本站尖峰平谷充电量趋势" sub="移动鼠标联动查看各时段电量">
        <FilteredInteractiveChart
          lines={[
            {
              name: "尖段",
              color: "#ff6b6b",
              data: station.records.map((r) => ({
                week: r.week,
                value: num(r.peak),
              })),
            },
            {
              name: "峰段",
              color: "#ffb454",
              data: station.records.map((r) => ({
                week: r.week,
                value: num(r.high),
              })),
            },
            {
              name: "平段",
              color: "#36d399",
              data: station.records.map((r) => ({
                week: r.week,
                value: num(r.flat),
              })),
            },
            {
              name: "谷段",
              color: "#6f8cff",
              data: station.records.map((r) => ({
                week: r.week,
                value: num(r.valley),
              })),
            },
          ]}
          large
          valueFormatter={(value) => `${value.toFixed(2)} kWh`}
        />
      </Panel>
      <CompetitorEditor
        station={station}
        editing={editing}
        cfg={c}
        update={update}
      />
      <Panel
        title="自动分析与可执行建议"
        sub="根据周报电量变化、价格与竞站数据自动生成"
      >
        <AdviceEditor station={station} record={latest} />
      </Panel>
    </>
  );
}
type Competitor = {
  name: string;
  distance: string;
  guns: string;
  peak: string;
  high: string;
  flat: string;
  valley: string;
  electricity?: PeriodPrice;
  service?: PeriodPrice;
  total?: PeriodPrice;
};
function CompetitorEditor({
  station,
  editing,
  cfg,
  update,
}: {
  station: S;
  editing: boolean;
  cfg: StationConfig;
  update: (n: string, k: keyof StationConfig, v: string) => void;
}) {
  const competitors = safeJson<Competitor[]>(cfg.competitorsJson, []);
  const keys = ["peak", "high", "flat", "valley"] as const;
  const labels = { peak: "尖", high: "峰", flat: "平", valley: "谷" };
  const latestWeek = station.records.at(-1)?.week || "2026年9月2周";
  const ownE = resolveWeeklyPrice(cfg.electricityPricesJson, latestWeek);
  const ownS = resolveWeeklyPrice(cfg.servicePricesJson, latestWeek);
  const hasSplitOwnPrice = [...Object.values(ownE), ...Object.values(ownS)].some(
    (value) => Number(value) > 0,
  );
  const addRawPrice = (left: string, right: string) => {
    if (left === "" || right === "") return "";
    const total = Number(left) + Number(right);
    if (!Number.isFinite(total)) return "";
    const decimals = Math.min(
      8,
      Math.max(left.split(".")[1]?.length || 0, right.split(".")[1]?.length || 0),
    );
    return total.toFixed(decimals).replace(/\.?0+$/, "");
  };
  const ownT: PeriodPrice = hasSplitOwnPrice
    ? {
        peak: addRawPrice(ownE.peak, ownS.peak),
        high: addRawPrice(ownE.high, ownS.high),
        flat: addRawPrice(ownE.flat, ownS.flat),
        valley: addRawPrice(ownE.valley, ownS.valley),
      }
    : {
        peak: cfg.weeklyPeak,
        high: cfg.weeklyHigh,
        flat: cfg.weeklyFlat,
        valley: cfg.weeklyValley,
      };
  const [sortBy, setSortBy] = useState<"distance" | "low" | "high" | "diff">(
    "distance",
  );
  const [threatOnly, setThreatOnly] = useState(false);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [ownExpanded, setOwnExpanded] = useState(false);
  const validPrice = (value: string | number | null | undefined) => {
    if (value === "" || value == null) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };
  const price = (value: string | number | undefined, digits = 2) => {
    const n = validPrice(value);
    return n != null ? `¥${n.toFixed(digits)}` : "—";
  };
  const composite = (p: PeriodPrice) => {
    const values = keys
      .map((k) => validPrice(p[k]))
      .filter((v): v is number => v != null);
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null;
  };
  const distanceValue = (value: string) => {
    const n = Number((value || "").match(/[\d.]+/)?.[0]);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  const ownAverage = composite(ownT);
  const rows = competitors
    .map((c, index) => {
      const hasSplit = Boolean(c.electricity || c.service),
        total = Object.fromEntries(keys.map((key) => {
          const electricity = validPrice(c.electricity?.[key]),
            service = validPrice(c.service?.[key]),
            legacy = validPrice(c.total?.[key] ?? c[key]);
          return [key, legacy != null
            ? String(legacy)
            : hasSplit && electricity != null && service != null
              ? String(electricity + service)
              : ""];
        })) as PeriodPrice,
        average = composite(total),
        comparableDiffs = keys.flatMap((key) => {
          const own = validPrice(ownT[key]), competitor = validPrice(total[key]);
          return own == null || competitor == null ? [] : [competitor - own];
        }),
        diff = comparableDiffs.length
          ? comparableDiffs.reduce((sum, value) => sum + value, 0) / comparableDiffs.length
          : null;
      return {
        c,
        index,
        total,
        average,
        diff,
        distance: distanceValue(c.distance),
      };
    })
    .filter((x) => x.c.name);
  const pricedRows = rows.filter((row) => row.average != null),
    competitorAverage = pricedRows.length
    ? pricedRows.reduce((sum, row) => sum + num(row.average), 0) / pricedRows.length
    : null;
  const rankValues = [ownAverage, ...rows.map((row) => row.average)]
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);
  const ranking =
    ownAverage != null ? rankValues.findIndex((v) => v === ownAverage) + 1 : 0;
  const lowestRow = [...rows]
    .filter((row): row is typeof row & { average: number } => row.average != null)
    .sort((a, b) => a.average - b.average)[0];
  const nearestRow = [...rows]
    .filter((row) => Number.isFinite(row.distance))
    .sort((a, b) => a.distance - b.distance)[0];
  const advantage = competitorAverage != null && ownAverage != null
    ? competitorAverage - ownAverage
    : null;
  const competition =
    advantage == null ? "待补充价格" : advantage > 0.05 ? "较强" : advantage < -0.03 ? "较弱" : "接近";
  const sorted = [...rows]
    .filter((row) => !threatOnly || (row.diff != null && row.diff < -0.03))
    .sort((a, b) =>
      sortBy === "distance"
        ? a.distance - b.distance
        : sortBy === "low"
          ? (a.average ?? Number.POSITIVE_INFINITY) - (b.average ?? Number.POSITIVE_INFINITY)
          : sortBy === "high"
            ? (b.average ?? Number.NEGATIVE_INFINITY) - (a.average ?? Number.NEGATIVE_INFINITY)
            : Math.abs(b.diff ?? 0) - Math.abs(a.diff ?? 0),
    );
  const judgment = (diff: number | null) =>
    diff == null
      ? { label: "待补充价格", cls: "near" }
      : diff > 0.03
      ? { label: "本站便宜", cls: "safe" }
      : diff < -0.03
        ? { label: "竞站便宜", cls: "threat" }
        : { label: "价格接近", cls: "near" };
  const setOwn = (key: keyof PeriodPrice, value: string) =>
    update(
      station.name,
      (
        {
          peak: "weeklyPeak",
          high: "weeklyHigh",
          flat: "weeklyFlat",
          valley: "weeklyValley",
        } as const
      )[key],
      value,
    );
  const change = (
    i: number,
    group: "electricity" | "service",
    key: keyof PeriodPrice,
    value: string,
  ) => {
    const next = competitors.map((c, index) =>
      index === i
        ? {
            ...c,
            [group]: { ...blankPrice(), ...c[group], [key]: value },
            total: {
              ...blankPrice(),
              ...c.total,
              [key]: (() => {
                const own = validPrice(value),
                  other = validPrice((group === "electricity" ? c.service : c.electricity)?.[key]);
                return own == null || other == null ? "" : String(own + other);
              })(),
            },
            [key]: (() => {
              const own = validPrice(value),
                other = validPrice((group === "electricity" ? c.service : c.electricity)?.[key]);
              return own == null || other == null ? "" : String(own + other);
            })(),
          }
        : c,
    );
    update(station.name, "competitorsJson", JSON.stringify(next));
  };
  const changeBase = (i: number, key: "name" | "distance" | "guns", value: string) =>
    update(
      station.name,
      "competitorsJson",
      JSON.stringify(competitors.map((competitor, index) =>
        index === i ? { ...competitor, [key]: value } : competitor,
      )),
    );
  const addCompetitor = () => {
    const next = [
      ...competitors,
      {
        name: "新竞站",
        distance: "",
        guns: "",
        peak: "",
        high: "",
        flat: "",
        valley: "",
        electricity: blankPrice(),
        service: blankPrice(),
        total: blankPrice(),
      },
    ];
    update(station.name, "competitorsJson", JSON.stringify(next));
    setExpanded((current) => [...current, next.length - 1]);
  };
  const removeCompetitor = (i: number) => {
    if (!window.confirm(`确定删除“${competitors[i]?.name || "该竞站"}”吗？保存后生效。`)) return;
    update(
      station.name,
      "competitorsJson",
      JSON.stringify(competitors.filter((_, index) => index !== i)),
    );
    setExpanded((current) => current.filter((index) => index !== i).map((index) => index > i ? index - 1 : index));
  };
  const renderPriceRows = ({
    e,
    s,
    t,
    editableIndex,
  }: {
    e: PeriodPrice;
    s: PeriodPrice;
    t: PeriodPrice;
    editableIndex?: number;
  }) => (
    <div className="compact-fee-details">
      {(
        [
          ["电费", e],
          ["服务费", s],
          ["总费用", t],
        ] as [string, PeriodPrice][]
      ).map(([label, p]) => (
        <div key={label} className={label === "总费用" ? "total-fee" : ""}>
          <b>{label}</b>
          {keys.map((k) => (
            <span key={k}>
              <small>{labels[k]}</small>
              {editing && editableIndex !== undefined && label !== "总费用" ? (
                <input
                  value={p[k] || ""}
                  onChange={(event) =>
                    change(
                      editableIndex,
                      label === "电费" ? "electricity" : "service",
                      k,
                      event.target.value,
                    )
                  }
                />
              ) : (
                price(p[k], 4)
              )}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
  return (
    <Panel
      title="本站与周边竞站"
      sub="默认展示用户最终支付总价；展开详情查看电费与服务费"
      extra="ranking compact-competitor-panel"
    >
      <div className="own-price-benchmark">
        <div>
          <b>本站价格基准</b>
          <small>用户最终支付总价</small>
        </div>
        {keys.map((key) => (
          <label key={key}>
            <span>{labels[key]}</span>
            <input
              aria-label={"本站" + labels[key] + "段价格"}
              disabled={!editing}
              value={ownT[key]}
              onChange={(event) => setOwn(key, event.target.value)}
              placeholder="—"
            />
          </label>
        ))}
      </div>
      <div
        className={
          "competitor-summary " + (competition === "较弱" ? "weak" : "")
        }
      >
        <div>
          <span>价格竞争力</span>
          <b>{competition}</b>
        </div>
        <div>
          <span>周边竞站</span>
          <b>{rows.length}个</b>
        </div>
        <div>
          <span>本站价格排名</span>
          <b>
            {ranking || "—"}/{pricedRows.length + 1}
          </b>
        </div>
        <div>
          <span>{advantage == null ? "与周边均价" : advantage >= 0 ? "低于周边均价" : "高于周边均价"}</span>
          <b>{advantage == null ? "待补充价格" : `${price(Math.abs(advantage))}/kWh`}</b>
        </div>
        <div>
          <span>最低价竞站</span>
          <b>{lowestRow?.c.name || "—"}</b>
        </div>
        <div>
          <span>最近竞站</span>
          <b>{nearestRow?.c.name || "待补充距离"}</b>
        </div>
        <p>
          {competition === "较弱"
            ? "⚠ 本站价格高于周边平均水平"
            : competition === "较强"
              ? "✓ 本站价格具备竞争优势"
              : "≈ 本站价格与周边平均水平接近"}
        </p>
      </div>
      <div className="competitor-tools">
        <select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as typeof sortBy)}
          aria-label="竞站排序"
        >
          <option value="distance">距离最近</option>
          <option value="low">价格最低</option>
          <option value="high">价格最高</option>
          <option value="diff">与本站差价最大</option>
        </select>
        <label>
          <input
            type="checkbox"
            checked={threatOnly}
            onChange={(event) => setThreatOnly(event.target.checked)}
          />
          只看比本站便宜的竞站
        </label>
        {editing && <button className="add-competitor-button" onClick={addCompetitor}>新增竞站</button>}
      </div>
      <div className="competitor-table">
        <div className="competitor-table-head">
          <span>站点名称</span>
          <span>枪数</span>
          <span>距离</span>
          {keys.map((k) => (
            <span key={k}>{labels[k]}</span>
          ))}
          <span>与本站差价</span>
          <span>价格判断</span>
          <span>详情</span>
        </div>
        <div className="competitor-entry own-entry">
          <div className="competitor-row own-row">
            <b>本站 · {station.name}</b>
            <span>{cfg.guns ? `${cfg.guns}枪` : "—"}</span>
            <span>本站</span>
            {keys.map((k) => (
              <span key={k}>{price(ownT[k])}</span>
            ))}
            <span>—</span>
            <em>本站</em>
            <button onClick={() => setOwnExpanded((value) => !value)}>
              {ownExpanded ? "收起" : "详情"}
            </button>
          </div>
          {ownExpanded && renderPriceRows({ e: ownE, s: ownS, t: ownT })}
        </div>
        {sorted.map(({ c, index, total, diff }) => {
          const state = judgment(diff),
            isLowest = lowestRow?.index === index,
            isOpen = expanded.includes(index);
          return (
            <div className={"competitor-entry " + state.cls} key={index}>
              <div className="competitor-row">
                {editing ? (
                  <input className="competitor-base-input" value={c.name} onChange={(event) => changeBase(index, "name", event.target.value)} aria-label="竞站名称" />
                ) : (
                  <b>
                    {c.name}
                    {isLowest && <small className="lowest-tag">最低价</small>}
                  </b>
                )}
                {editing ? (
                  <input className="competitor-base-input" value={c.guns || ""} onChange={(event) => changeBase(index, "guns", event.target.value)} placeholder="如 12" aria-label="竞站枪数" />
                ) : <span>{c.guns ? `${c.guns}枪` : "待补充"}</span>}
                {editing ? (
                  <input className="competitor-base-input" value={c.distance} onChange={(event) => changeBase(index, "distance", event.target.value)} placeholder="如 1.2km" aria-label="竞站距离" />
                ) : <span>{c.distance || "待补充距离"}</span>}
                {keys.map((k) => (
                  <span key={k}>{price(total[k])}</span>
                ))}
                <span className={state.cls}>
                  {diff == null ? "—" : `${diff >= 0 ? "+" : "-"}${price(Math.abs(diff))}/kWh`}
                </span>
                <em className={state.cls}>{state.label}</em>
                <div className="competitor-row-actions">
                  <button
                    onClick={() =>
                      setExpanded((v) =>
                        v.includes(index)
                          ? v.filter((x) => x !== index)
                          : [...v, index],
                      )
                    }
                  >
                    {isOpen ? "收起" : "详情"}
                  </button>
                  {editing && <button className="delete-competitor-button" onClick={() => removeCompetitor(index)}>删除</button>}
                </div>
              </div>
              {isOpen && (
                renderPriceRows({
                  e: c.electricity || blankPrice(),
                  s: c.service || blankPrice(),
                  t: total,
                  editableIndex: index,
                })
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
          <div className="competitor-empty">暂无符合条件的竞站</div>
        )}
      </div>
    </Panel>
  );
}
function AdviceEditor({ station, record }: { station: S; record: R }) {
  const { cfg, update, save } = useConfigs(),
    c = { ...emptyConfig, ...cfg[station.name] },
    [editing, setEditing] = useState(false),
    doSave = async () => {
      await save();
      setEditing(false);
    };
  return (
    <>
      <div className="advice-actions">
        <span>系统建议可人工修订，保存后锁定</span>
        <div>
          <button onClick={() => setEditing((v) => !v)}>
            {editing ? "取消修改" : "修改"}
          </button>
          {editing && (
            <button className="save-button" onClick={doSave}>
              保存并锁定
            </button>
          )}
        </div>
      </div>
      <AutoAdvice station={station} record={record} cfg={c} />
      <textarea
        className="manual-advice"
        disabled={!editing}
        value={c.analysis}
        onChange={(e) => update(station.name, "analysis", e.target.value)}
        placeholder="如需调整系统建议，可点击修改后填写最终执行方案…"
      />
    </>
  );
}
function AutoAdvice({
  station,
  record,
  cfg,
}: {
  station: S;
  record: R;
  cfg: StationConfig;
}) {
  const change = num(record.chargeChange),
    competitors = safeJson<Competitor[]>(cfg.competitorsJson, []),
    latestWeek = station.records.at(-1)?.week || "2026年9月2周",
    resolvedOwn = resolveWeeklyPrice(cfg.externalPricesJson, latestWeek),
    own = Object.values(resolvedOwn).some(Boolean) ? resolvedOwn : {
      peak: cfg.weeklyPeak,
      high: cfg.weeklyHigh,
      flat: cfg.weeklyFlat,
      valley: cfg.weeklyValley,
    },
    keys = ["peak", "high", "flat", "valley"] as const,
    labels = { peak: "尖", high: "峰", flat: "平", valley: "谷" },
    priceAdvice = keys.flatMap((key) => {
      const v = competitors
          .map((c) => Number((c.total || c)[key]))
          .filter((x) => x > 0),
        o = Number(own[key]);
      if (!v.length || !o) return [];
      const avg = v.reduce((a, b) => a + b, 0) / v.length,
        diff = (o / avg - 1) * 100;
      return [
        `${labels[key]}段本站 ¥${o.toFixed(3)}，比竞站均价${diff >= 0 ? "高" : "低"} ${Math.abs(diff).toFixed(1)}%。`,
      ];
    });
  const action =
    change < -0.12
      ? "先核查停枪与导航曝光，并对已核验的低价竞站做7天小幅调价测试。"
      : change > 0.12
        ? "保持当前价格，复盘增长时段并复制到同区域低效站。"
        : "总体稳定，优先用平谷时段小幅调价测试提升利用率。";
  return (
    <div className="advice-box">
      <div>
        <b>{station.name}</b>
        <span className={change < 0 ? "down" : "up"}>
          {pct(record.chargeChange)}
        </span>
      </div>
      <p>当周经营利润 {money(num(record.profit))}</p>
      <ol>
        {[...priceAdvice, action].map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ol>
    </div>
  );
}
const metricChangeText = (label: string, current: number | null, previous: number | null) => {
  if (!previous) return `${label}暂无可比上期`;
  const change = num(current) / previous - 1;
  return `${label}${change >= 0 ? "增长" : "下降"}${Math.abs(change * 100).toFixed(1)}%`;
};
function generateStationAnalysis(station: S, week: string, cfg: StationConfig) {
  const index = station.records.findIndex((record) => record.week === week),
    current = station.records[index],
    previous = station.records[index - 1];
  if (!current) return "该周期暂无数据，暂不生成分析。";
  const periods: [keyof Pick<R, "peak" | "high" | "flat" | "valley">, string][] = [
      ["peak", "尖"], ["high", "峰"], ["flat", "平"], ["valley", "谷"],
    ],
    periodChanges = periods.map(([key, label]) => ({
      label,
      value: previous && num(previous[key])
        ? num(current[key]) / num(previous[key]) - 1
        : null,
    })).filter((item) => item.value != null),
    weakest = [...periodChanges].sort((a, b) => num(a.value) - num(b.value))[0],
    strongest = [...periodChanges].sort((a, b) => num(b.value) - num(a.value))[0],
    competitors = safeJson<Competitor[]>(cfg.competitorsJson, []),
    resolvedOwnPrices = resolveWeeklyPrice(cfg.externalPricesJson, week),
    ownPrices = Object.values(resolvedOwnPrices).some(Boolean) ? resolvedOwnPrices
      : { peak: cfg.weeklyPeak, high: cfg.weeklyHigh, flat: cfg.weeklyFlat, valley: cfg.weeklyValley },
    validPrice = (value: string | number | undefined) => {
      if (value === "" || value == null) return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    },
    priceDiffs = periods.flatMap(([key]) => {
      const own = validPrice(ownPrices[key]),
        values = competitors.map((competitor) => validPrice((competitor.total || competitor)[key]))
          .filter((value): value is number => value != null);
      if (own == null || !values.length) return [];
      return [own - values.reduce((sum, value) => sum + value, 0) / values.length];
    }),
    averagePriceDiff = priceDiffs.length
      ? priceDiffs.reduce((sum, value) => sum + value, 0) / priceDiffs.length
      : null,
    validDistances = competitors.map((competitor) => ({
      name: competitor.name,
      value: Number((competitor.distance || "").match(/[\d.]+/)?.[0]),
    })).filter((item) => Number.isFinite(item.value)),
    nearest = [...validDistances].sort((a, b) => a.value - b.value)[0],
    context = [cfg.location, cfg.customers, cfg.weather].filter(Boolean).join("；"),
    cause = num(current.chargeChange) < -0.05
      ? `${weakest ? `${weakest.label}段降幅最大（${pct(weakest.value)}）` : "分时段需继续核验"}${cfg.weather ? `，结合天气：${cfg.weather}` : ""}`
      : `${strongest ? `${strongest.label}段表现较好（${pct(strongest.value)}）` : "各时段总体平稳"}`,
    action = competitors.length
      ? `${averagePriceDiff == null ? "竞站分时价格待补充" : `本站有效时段均价较周边${averagePriceDiff >= 0 ? "高" : "低"}${Math.abs(averagePriceDiff).toFixed(3)}元/度`}${nearest ? `，最近竞站为${nearest.name}` : "，距离待补充"}；建议优先核查下降时段的客流与设备状态。`
      : "竞站价格暂未完整核验，先核查客流、设备在线情况与分时结构，不对原因作主观判断。";
  return `${metricChangeText("充电量", current.charge, previous?.charge ?? null)}，${metricChangeText("服务费收入", current.serviceRevenue, previous?.serviceRevenue ?? null)}，经营利润${money(num(current.profit))}；${cause}。${context ? `场景核验：${context}。` : ""}${action}`;
}
function generateWeeklyAnalyses(source: S[], week: string, configs: Record<string, StationConfig>) {
  const next = { ...configs };
  source.forEach((station) => {
    const stationCfg = { ...emptyConfig, ...configs[station.name] };
    next[station.name] = {
      ...stationCfg,
      analysis: generateStationAnalysis(station, week, stationCfg),
    };
  });
  const recordPair = (station: S) => {
      const currentIndex = station.records.findIndex((record) => record.week === week);
      return { current: station.records[currentIndex], previous: station.records[currentIndex - 1], beforePrevious: station.records[currentIndex - 2] };
    },
    totalCurrent = source.reduce((sum, station) => sum + num(recordPair(station).current?.charge), 0),
    totalPrevious = source.reduce((sum, station) => sum + num(recordPair(station).previous?.charge), 0),
    serviceCurrent = source.reduce((sum, station) => sum + num(recordPair(station).current?.serviceRevenue), 0),
    servicePrevious = source.reduce((sum, station) => sum + num(recordPair(station).previous?.serviceRevenue), 0),
    profitCurrent = source.reduce((sum, station) => sum + num(recordPair(station).current?.profit), 0),
    profitPrevious = source.reduce((sum, station) => sum + num(recordPair(station).previous?.profit), 0),
    stationMoves = source.map((station) => {
      const { current, previous, beforePrevious } = recordPair(station);
      return {
        name: station.name.replace("充电站", ""),
        change: current?.chargeChange,
        contribution: num(current?.charge) - num(previous?.charge),
        consecutiveDown: Boolean(current && previous && beforePrevious
          && num(current.charge) < num(previous.charge)
          && num(previous.charge) < num(beforePrevious.charge)),
      };
    }),
    growth = [...stationMoves].filter((item) => item.contribution > 0).sort((a, b) => b.contribution - a.contribution).slice(0, 2),
    attention = [...stationMoves].filter((item) => item.contribution < 0).sort((a, b) => a.contribution - b.contribution).slice(0, 3),
    continuous = stationMoves.filter((item) => item.consecutiveDown).slice(0, 3),
    pressure = source.flatMap((station) => {
      const stationCfg = { ...emptyConfig, ...configs[station.name] },
        own = resolveWeeklyPrice(stationCfg.externalPricesJson, week),
        competitors = safeJson<Competitor[]>(stationCfg.competitorsJson, []);
      if (!Object.values(own).some(Boolean) || !competitors.length) return [];
      const diffs = (["peak", "high", "flat", "valley"] as const).flatMap((key) => {
        const ownValue = Number(own[key]), values = competitors.map((item) => Number((item.total || item)[key])).filter((value) => Number.isFinite(value) && value > 0);
        return Number.isFinite(ownValue) && values.length ? [ownValue - Math.min(...values)] : [];
      });
      return diffs.length && diffs.reduce((sum, value) => sum + value, 0) / diffs.length > 0.03
        ? [station.name.replace("充电站", "")] : [];
    }).slice(0, 3);
  next.__summary__ = {
    ...emptyConfig,
    ...configs.__summary__,
    analysis: `${metricChangeText("全场充电量", totalCurrent, totalPrevious)}，${metricChangeText("服务费收入", serviceCurrent, servicePrevious)}，${metricChangeText("经营利润", profitCurrent, profitPrevious)}。${growth.length ? `主要增长贡献：${growth.map((item) => `${item.name}+${qty(item.contribution)}kWh`).join("、")}；` : "本周暂无明显增长贡献站；"}${attention.length ? `主要拖累：${attention.map((item) => `${item.name}${qty(item.contribution)}kWh`).join("、")}。` : "暂无明显拖累站。"}${continuous.length ? `连续下降需关注：${continuous.map((item) => item.name).join("、")}；` : ""}${pressure.length ? `价格压力站：${pressure.join("、")}。` : "竞站价格不足以证明明显价格压力，建议继续核验。"}`,
  };
  return next;
}
type SuboperatorAccount = {
  slug: string;
  operatorName: string;
  reportName: string;
  loginAccount: string;
  enabled: boolean;
  stations: string[];
  updatedAt?: string;
};
type SuboperatorDraft = SuboperatorAccount & { password: string };
const emptySuboperator = (): SuboperatorDraft => ({
  slug: "", operatorName: "", reportName: "", loginAccount: "", password: "", enabled: true, stations: [],
});

function SuboperatorManager({ stationNames, onStatus }: { stationNames: string[]; onStatus: (message: string) => void }) {
  const [accounts, setAccounts] = useState<SuboperatorAccount[]>([]),
    [expanded, setExpanded] = useState(false),
    [draft, setDraft] = useState<SuboperatorDraft | null>(null),
    [stationSearch, setStationSearch] = useState(""),
    [saving, setSaving] = useState(false);
  const loadAccounts = async () => {
    const response = await dashboardFetch("/api/operators", { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json() as { operators?: SuboperatorAccount[] };
    setAccounts(body.operators ?? []);
  };
  useEffect(() => {
    let active = true;
    void dashboardFetch("/api/operators", { cache: "no-store" })
      .then(async (response): Promise<{ operators?: SuboperatorAccount[] }> => response.ok ? response.json() : {})
      .then((body) => {
        if (active) setAccounts(body.operators ?? []);
      });
    return () => { active = false; };
  }, []);
  const edit = (account?: SuboperatorAccount) => {
    setDraft(account ? { ...account, stations: [...account.stations], password: "" } : emptySuboperator());
    setStationSearch("");
    setExpanded(true);
  };
  const cancel = () => { setDraft(null); setExpanded(false); setStationSearch(""); };
  const saveAccount = async () => {
    if (!draft) return;
    const slug = draft.slug || draft.loginAccount.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    setSaving(true);
    try {
      const response = await dashboardFetch("/api/operators", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...draft, slug }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || "账号权限保存失败");
      await loadAccounts();
      cancel();
      onStatus(`${draft.operatorName}账号及授权场站已保存，立即按最新权限生效`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "账号权限保存失败");
    } finally { setSaving(false); }
  };
  const visibleStations = stationNames.filter((name) => name.includes(stationSearch.trim()));
  return (
    <div className="cost-panel suboperator-manager" id="partner-account">
      <div className="section-head">
        <div><h3>账号/权限管理</h3><p>新增子运营商并配置周报名称、登录账号、启停状态和授权场站；所有账号只读正式数据。</p></div>
        <div className="config-actions"><button className="panel-toggle" onClick={() => expanded ? cancel() : setExpanded(true)}>{expanded ? "收起" : "详情"}</button><button className="save-button" onClick={() => edit()}>新增子运营商</button></div>
      </div>
      {!expanded ? (
        <div className="compact-config-summary"><span>子运营商 <b>{accounts.length}个</b></span><span>已启用 <b>{accounts.filter((item) => item.enabled).length}个</b></span><span>权限 <b>授权场站 · 只读正式数据</b></span></div>
      ) : (
        <>
          <div className="suboperator-list">
            {accounts.map((account) => <div key={account.slug}>
              <span className={account.enabled ? "account-state enabled" : "account-state"}>{account.enabled ? "已启用" : "已停用"}</span>
              <b>{account.operatorName}</b><span>{account.reportName}</span><code>{account.loginAccount}</code><span>{account.stations.length}个场站</span>
              <button onClick={() => edit(account)}>编辑</button>
            </div>)}
            {!accounts.length ? <p className="empty-note">暂无子运营商账号</p> : null}
          </div>
          {draft ? <div className="suboperator-editor">
            <div className="suboperator-fields">
              <label>运营商名称<input value={draft.operatorName} onChange={(event) => setDraft({ ...draft, operatorName: event.target.value })} placeholder="例如：四川飞凡" /></label>
              <label>登录后的周报名称<input value={draft.reportName} onChange={(event) => setDraft({ ...draft, reportName: event.target.value })} placeholder="例如：四川飞凡周报" /></label>
              <label>登录账号<input value={draft.loginAccount} disabled={Boolean(draft.slug)} onChange={(event) => setDraft({ ...draft, loginAccount: event.target.value.toLowerCase() })} placeholder="英文、数字、短横线" /></label>
              <label>{draft.slug ? "重置密码（留空则不变）" : "初始密码（至少12位）"}<input type="password" autoComplete="new-password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} /></label>
              <label className="account-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用账号</label>
            </div>
            <div className="station-permission-picker">
              <header><div><b>授权场站</b><span>已选 {draft.stations.length} 个</span></div><input value={stationSearch} onChange={(event) => setStationSearch(event.target.value)} placeholder="搜索场站" /></header>
              <div>{visibleStations.map((name) => <label key={name}><input type="checkbox" checked={draft.stations.includes(name)} onChange={(event) => setDraft({ ...draft, stations: event.target.checked ? [...draft.stations, name] : draft.stations.filter((item) => item !== name) })} /><span>{name}</span></label>)}</div>
            </div>
            <div className="config-actions suboperator-actions"><button className="ghost" onClick={cancel}>取消</button><button className="save-button" disabled={saving} onClick={saveAccount}>{saving ? "保存中…" : "保存账号与权限"}</button></div>
          </div> : null}
        </>
      )}
    </div>
  );
}

function Config({
  onImport,
  onRecordSave,
  adminMeta,
}: {
  onImport: (stations: S[], week: string, deferSave?: boolean, commitLocal?: boolean) => Promise<S[]>;
  onRecordSave: (station: string, week: string, patch: Partial<R>, deferSave?: boolean) => Promise<S[]>;
  adminMeta: AdminMeta | null;
}) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState(false),
    [savingImport, setSavingImport] = useState(false),
    [preview, setPreview] = useState<{
      parsed: S[];
      week: string;
      exists: boolean;
      report: ValidationReport;
      recognition: ImportRecognition;
      matches: StationMatch[];
      source: S[];
    } | null>(null),
    [month, setMonth] = useState("8"),
    [dataStation, setDataStation] = useState(stations[0]?.name || ""),
    [stationQuery, setStationQuery] = useState(stations[0]?.name || ""),
    [stationPickerOpen, setStationPickerOpen] = useState(false),
    [dataWeek, setDataWeek] = useState(allWeeks().at(-1) || ""),
    [openPanels, setOpenPanels] = useState<Record<string, boolean>>({}),
    [dataDraft, setDataDraft] = useState<Partial<R>>({}),
    [analysisPreview, setAnalysisPreview] = useState<Record<string, StationConfig> | null>(null),
    { cfg, update, save } = useConfigs(),
    monthly = { ...emptyConfig, ...cfg.__monthly__ },
    stationOptions = stations.filter((station) => station.name.includes(stationQuery.trim())),
    list = stations.filter((s) => s.name.includes(search)),
    storedCosts = safeJson<Record<string, Record<string, PeriodPrice>>>(
      monthly.monthlyCostsJson,
      {},
    ),
    costYear = weekParts(dataWeek).year,
    costs = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => {
        const m = String(i + 1);
        return [m, { ...DEFAULT_COSTS[m], ...(storedCosts[`${costYear}-${m}`] || storedCosts[m]) }];
      }),
    ) as Record<string, Record<string, PeriodPrice>>,
    storedGridFees = safeJson<Record<string, string>>(monthly.gridFeesJson, {}),
    gridFees = Object.fromEntries(Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1);
      return [m, storedGridFees[`${costYear}-${m}`] ?? storedGridFees[m] ?? DEFAULT_GRID_FEES[m] ?? ""];
    })) as Record<string, string>,
    priceStation = dataStation,
    priceWeek = dataWeek,
    stationCfg = { ...emptyConfig, ...cfg[priceStation] },
    external = safeJson<Record<string, PeriodPrice>>(
      stationCfg.externalPricesJson,
      {},
    ),
    electricityPrices = safeJson<Record<string, PeriodPrice>>(
      stationCfg.electricityPricesJson,
      {},
    ),
    servicePrices = safeJson<Record<string, PeriodPrice>>(
      stationCfg.servicePricesJson,
      {},
    ),
    periods: [keyof PeriodPrice, string][] = [
      ["peak", "尖段"],
      ["high", "峰段"],
      ["flat", "平段"],
      ["valley", "谷段"],
    ],
    types = ["大工业电价", "售电价"],
    billingTypes = ["大工业电价", "售电价", "一口价"],
    togglePanel = (key: string) => setOpenPanels((current) => ({ ...current, [key]: !current[key] })),
    toggleEditablePanel = (key: string) => {
      if (!openPanels[key]) setEditing(true);
      togglePanel(key);
    },
    setCost = (type: string, key: keyof PeriodPrice, value: string) =>
      update(
        "__monthly__",
        "monthlyCostsJson",
        JSON.stringify({
          ...storedCosts,
          [`${costYear}-${month}`]: {
            ...costs[month],
            [type]: { ...blankPrice(), ...costs[month]?.[type], [key]: value },
          },
        }),
      ),
    setGridFee = (value: string) =>
      update(
        "__monthly__",
        "gridFeesJson",
        JSON.stringify({ ...storedGridFees, [`${costYear}-${month}`]: value }),
      ),
    setWeeklyPrice = (
      group: "electricity" | "service",
      key: keyof PeriodPrice,
      value: string,
    ) => {
      const own = group === "electricity" ? electricityPrices : servicePrices,
        other = group === "electricity" ? servicePrices : electricityPrices,
        nextOwn = {
          ...blankPrice(),
          ...own[priceWeek],
          [key]: value,
        },
        totalValue = String(Number(value || 0) + Number(other[priceWeek]?.[key] || 0)),
        nextTotal = {
          ...blankPrice(),
          ...external[priceWeek],
          [key]: totalValue,
        };
      update(
        priceStation,
        group === "electricity" ? "electricityPricesJson" : "servicePricesJson",
        JSON.stringify({ ...own, [priceWeek]: nextOwn }),
      );
      update(
        priceStation,
        "externalPricesJson",
        JSON.stringify({ ...external, [priceWeek]: nextTotal }),
      );
      update(
        priceStation,
        ({ peak: "weeklyPeak", high: "weeklyHigh", flat: "weeklyFlat", valley: "weeklyValley" } as const)[key],
        totalValue,
      );
    },
    doSave = async () => {
      setStatus("保存中…");
      try {
        await save();
        setEditing(false);
        setOpenPanels({});
        setStatus("配置已保存，看板端刷新后同步更新");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "保存失败");
      }
    },
    calculateImportedMetrics = (input: S[], resolvedNames: Record<string, string>) => input.map((importedStation) => {
      const stationName = resolvedNames[importedStation.name] || importedStation.name;
      const stationConfig = { ...emptyConfig, ...cfg[stationName] };
      const historical = stations.find((station) => station.name === stationName)?.records || [];
      const records = importedStation.records.map((record) => ({ ...record }));
      records.forEach((record, index) => {
        const week = record.week;
        const metrics = calculateOperatingMetrics(record, stationConfig, monthly);
        record.guns = Number(stationConfig.guns) > 0 ? Number(stationConfig.guns) : null;
        record.peakServiceRevenue = metrics.periodService.peak;
        record.highServiceRevenue = metrics.periodService.high;
        record.flatServiceRevenue = metrics.periodService.flat;
        record.valleyServiceRevenue = metrics.periodService.valley;
        record.electricityRevenue = metrics.electricityRevenue;
        record.serviceRevenue = metrics.serviceRevenue;
        record.profit = metrics.profit;
        record.servicePerKwh = metrics.servicePerKwh;
        record.electricityProfitPerKwh = metrics.electricityProfitPerKwh;
        const previous = records[index - 1] || [...historical].reverse().find((item) => {
          const current = weekParts(week), candidate = weekParts(item.week);
          return candidate.year < current.year || candidate.year === current.year && (candidate.month < current.month || candidate.month === current.month && candidate.week < current.week);
        });
        record.chargeChange = previous && num(previous.charge) ? num(record.charge) / num(previous.charge) - 1 : null;
        record.serviceChange = previous && num(previous.serviceRevenue) && record.serviceRevenue != null ? record.serviceRevenue / num(previous.serviceRevenue) - 1 : null;
      });
      return { name: stationName, records };
    }),
    importFile = async (file?: File) => {
      if (!file) return;
      setStatus("正在读取并分析…");
      try {
        const result = await parseWeeklyWorkbook(file);
        const savedAliases = Object.fromEntries(stations.flatMap((station) =>
          safeJson<string[]>(({ ...emptyConfig, ...cfg[station.name] }).stationAliasesJson, []).map((alias) => [alias, station.name])));
        const builtInAliases: Record<string, string> = {
          "蔚景云黄埔鱼珠智谷充电站": "黄埔鱼珠智谷充电站",
          "佛山创雄华府充电站": "麦电-佛山创雄华府充电站",
          "阳充天鹏酒店充电站": "阳充-天鹏酒店充电站",
          "蔚景云雅悦蓝天酒店超充站": "雅悦蓝天酒店超充站",
        };
        const matches = matchStationNames(result.parsed.map((station) => station.name), stations.map((station) => station.name), { ...builtInAliases, ...savedAliases });
        const resolvedNames = Object.fromEntries(matches.filter((match) => match.status === "matched").map((match) => [match.excelName, match.dashboardName]));
        const matchedSource = result.parsed.filter((station) => resolvedNames[station.name]);
        const parsed = calculateImportedMetrics(matchedSource, resolvedNames);
        const week = parsed[0]?.records.at(-1)?.week;
        if (!week) throw new Error("没有自动匹配到看板已有站点；请先确认待匹配站点");
        const exists = stations.some((station) => station.records.some((record) => record.week === week));
        const report = validateDashboardData(parsed, undefined, { importEnergyOnly: true });
        parsed.forEach((station) => station.records.forEach((record) => {
          if (record.serviceRevenue == null || record.profit == null) report.issues.push({
            level: "warning",
            station: station.name,
            week: record.week,
            field: "经营指标",
            currentValue: "缺失",
            reason: "该周缺少可沿用的价格或成本配置，暂时无法生成完整经营数据",
            suggestion: "先补全该站服务费、售电价格及当月成本，再保存并重算后发布",
          });
        }));
        if (report.issues.some((issue) => issue.level === "error")) report.status = "error";
        setPreview({ parsed, week, exists, report, recognition: result.recognition, matches, source: result.parsed });
        setStatus(`已读取 ${result.parsed.length} 个Excel站点 · 自动匹配 ${parsed.length} 个 · 待确认 ${matches.filter((match) => match.status === "pending").length} 个`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "导入失败");
      }
    },
    confirmStationMatch = (excelName: string, dashboardName: string) => {
      setPreview((current) => {
        if (!current) return current;
        const matches = current.matches.map((match) => match.excelName === excelName ? { status: "matched", excelName, dashboardName, method: "alias" } as StationMatch : match);
        const resolved = Object.fromEntries(matches.filter((match) => match.status === "matched").map((match) => [match.excelName, match.dashboardName]));
        const parsed = calculateImportedMetrics(current.source.filter((station) => resolved[station.name]), resolved);
        return { ...current, matches, parsed, report: validateDashboardData(parsed, undefined, { importEnergyOnly: true }) };
      });
    },
    confirmImport = async () => {
      if (!preview) return;
      if (preview.report.status === "error") { setStatus("存在严重错误，禁止写入草稿；请修正Excel后重新导入"); return; }
      if (preview.report.status === "warning" && !window.confirm(`发现${preview.report.issues.length}项警告。确认原始数据无误并继续写入草稿？`)) return;
      setSavingImport(true);
      setStatus("正在写入数据库…");
      try {
        const merged = await onImport(preview.parsed, preview.week, true);
        const generated = generateWeeklyAnalyses(merged, preview.week, cfg);
        const nextCfg = { ...generated };
        preview.matches.filter((match): match is Extract<StationMatch, { status: "matched" }> => match.status === "matched" && match.method === "alias").forEach((match) => {
          const current = { ...emptyConfig, ...nextCfg[match.dashboardName] };
          const aliases = safeJson<string[]>(current.stationAliasesJson, []);
          nextCfg[match.dashboardName] = { ...current, stationAliasesJson: JSON.stringify([...new Set([...aliases, match.excelName])]) };
        });
        await save(nextCfg, merged);
        await onImport(preview.parsed, preview.week, true, true);
        setPreview(null);
        setAnalysisPreview(null);
        setStatus(`更新成功：${preview.week} · ${merged.length} 个场站，整体及逐站分析已自动生成`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "数据库更新失败");
      } finally {
        setSavingImport(false);
      }
    },
    chosen = stations.find((s) => s.name === priceStation),
    record = chosen?.records.find((r) => r.week === priceWeek),
    monthKey = String(weekParts(priceWeek).month),
    costPrice =
      stationCfg.billingType === "一口价"
        ? {
            peak: stationCfg.unifiedPrice,
            high: stationCfg.unifiedPrice,
            flat: stationCfg.unifiedPrice,
            valley: stationCfg.unifiedPrice,
          }
        : costs[monthKey]?.[stationCfg.billingType] || blankPrice(),
    salePrice = external[priceWeek] || {
      peak: String(Number(electricityPrices[priceWeek]?.peak || 0) + Number(servicePrices[priceWeek]?.peak || 0)),
      high: String(Number(electricityPrices[priceWeek]?.high || 0) + Number(servicePrices[priceWeek]?.high || 0)),
      flat: String(Number(electricityPrices[priceWeek]?.flat || 0) + Number(servicePrices[priceWeek]?.flat || 0)),
      valley: String(Number(electricityPrices[priceWeek]?.valley || 0) + Number(servicePrices[priceWeek]?.valley || 0)),
    },
    complete = periods.every(
      ([k]) => Number(costPrice[k]) > 0 && Number(salePrice[k]) > 0,
    ),
    estimate =
      record && complete
        ? num(record.serviceRevenue) +
          periods.reduce(
            (sum, [k]) =>
              sum +
              num(record[k]) *
                (Number(salePrice[k]) -
                  Number(costPrice[k]) -
                  (stationCfg.billingType === "售电价"
                    ? Number(gridFees[monthKey] || 0)
                    : 0)),
            0,
          )
        : null,
    editableStation = stations.find((station) => station.name === dataStation),
    editableRecord = editableStation?.records.find((item) => item.week === dataWeek),
    editFields: [keyof R, string][] = [
      ["peak", "尖段电量"], ["high", "峰段电量"], ["flat", "平段电量"],
      ["valley", "谷段电量"], ["serviceRevenue", "服务费收入"], ["profit", "经营利润"],
    ],
    openRecordEditor = () => setDataDraft(editableRecord ? Object.fromEntries(
      Object.entries(editableRecord).map(([key, value]) => [key, typeof value === "number" ? round3(value) : value]),
    ) as Partial<R> : {}),
    saveRecordEditor = async () => {
      setStatus("正在保存历史数据并重算环比…");
      try {
        const charge = num(dataDraft.peak) + num(dataDraft.high) + num(dataDraft.flat) + num(dataDraft.valley);
        const metrics = calculateOperatingMetrics({ ...editableRecord, ...dataDraft, week: dataWeek, charge }, stationCfg, monthly);
        const merged = await onRecordSave(dataStation, dataWeek, {
          ...dataDraft, charge,
          peakServiceRevenue: metrics.periodService.peak,
          highServiceRevenue: metrics.periodService.high,
          flatServiceRevenue: metrics.periodService.flat,
          valleyServiceRevenue: metrics.periodService.valley,
          electricityRevenue: metrics.electricityRevenue,
          serviceRevenue: metrics.serviceRevenue,
          profit: metrics.profit,
          servicePerKwh: metrics.servicePerKwh,
          electricityProfitPerKwh: metrics.electricityProfitPerKwh,
        }, true);
        const latestWeek = [...new Set(merged.flatMap((station) => station.records.map((item) => item.week)))]
          .sort((left, right) => weekOrderValue(left) - weekOrderValue(right)).at(-1) || dataWeek;
        await save(generateWeeklyAnalyses(merged, latestWeek, cfg), merged);
        setDataDraft({});
        setOpenPanels((current) => ({ ...current, record: false }));
        setStatus(`${dataStation} · ${dataWeek} 已保存，相关环比及最新周分析已自动重算`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "历史数据保存失败");
      }
    },
    previewAnalyses = () => {
      const week = allWeeks().at(-1) || "";
      setAnalysisPreview(generateWeeklyAnalyses(stations, week, cfg));
      setStatus(`已生成 ${week} 整体及 ${stations.length} 个场站分析，请预览后确认发布`);
    },
    publishAnalyses = async () => {
      if (!analysisPreview) return;
      setStatus("正在发布本周分析…");
      try {
        await save(analysisPreview);
        setAnalysisPreview(null);
        setOpenPanels((current) => ({ ...current, analysis: false }));
        setStatus("本周整体及逐站分析已保存为草稿；点击顶部“发布更新”后同步到所有只读端");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "分析发布失败");
      }
    };
  return (
    <>
      <div className="page-heading config-head">
        <div>
          <span className="eyebrow">自动化数据中心</span>
          <h2>导入周报，自动更新与分析</h2>
          <p>月度成本按月份自动匹配；对外电费按场站、按周匹配并重算利润。</p>
        </div>
        <div className="config-actions">
          <label className="upload-button">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => importFile(e.target.files?.[0])}
            />
            导入周报 Excel
          </label>
          <button
            className="ghost edit-toggle"
            onClick={() => {
              if (editing) setOpenPanels({});
              setEditing((v) => !v);
            }}
          >
            {editing ? "取消修改" : "修改"}
          </button>
          {editing && (
            <button className="save-button" onClick={doSave}>
              保存并锁定
            </button>
          )}
        </div>
      </div>
      {status && (
        <div className="import-status">
          <Sparkles />
          {status}
        </div>
      )}
      <div className="admin-meta-strip" aria-label="管理员管理信息">
        <span>最后修改时间 <b>{adminMeta?.lastModifiedAt ? new Date(adminMeta.lastModifiedAt).toLocaleString("zh-CN", { hour12: false }) : "—"}</b></span>
        <span>最后发布时间 <b>{adminMeta?.lastPublishedAt ? new Date(adminMeta.lastPublishedAt).toLocaleString("zh-CN", { hour12: false }) : "尚未发布"}</b></span>
        <span>当前发布状态 <b className={adminMeta?.publishStatus === "draft" ? "pending" : "published"}>{adminMeta?.publishStatus === "draft" ? "有未发布修改" : "已发布"}</b></span>
      </div>
      <nav className="data-center-shortcuts" aria-label="数据中心快捷入口">
        <button
          onClick={() =>
            document
              .getElementById("weekly-data")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          周报数据
        </button>
        <button
          onClick={() =>
            document
              .getElementById("station-profile")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          场站资料
        </button>
        <button
          onClick={() =>
            document
              .getElementById("price-cost")
              ?.scrollIntoView({ behavior: "smooth" })
          }
        >
          价格成本
        </button>
        <button onClick={() => document.getElementById("record-editor")?.scrollIntoView({ behavior: "smooth" })}>历史数据修改</button>
        <button onClick={() => document.getElementById("auto-analysis")?.scrollIntoView({ behavior: "smooth" })}>本周分析</button>
        <button onClick={() => setStatus("竞站数据：请在趋势洞察中选择单站后点击“编辑价格”维护")}>竞站数据</button>
      </nav>
      <div className="data-center-scope">
        <div>
          <span>当前编辑范围</span>
          <b>{dataStation} · {dataWeek}</b>
        </div>
        <div className="station-search-select">
          <Search />
          <input
            value={stationQuery}
            onFocus={() => setStationPickerOpen(true)}
            onChange={(event) => {
              const value = event.target.value;
              setStationQuery(value);
              setStationPickerOpen(true);
              setDataDraft({});
            }}
            onBlur={() => window.setTimeout(() => setStationPickerOpen(false), 120)}
            placeholder="搜索或选择场站"
          />
          <ChevronDown />
          {stationPickerOpen && <div className="station-picker-menu">
            {stationOptions.length ? stationOptions.map((station) => <button type="button" key={station.name} onMouseDown={(event) => event.preventDefault()} onClick={() => {
              setDataStation(station.name);
              setStationQuery(station.name);
              setStationPickerOpen(false);
              setDataDraft({});
            }}>{station.name}</button>) : <span>没有匹配场站</span>}
          </div>}
        </div>
        <select value={dataWeek} onChange={(event) => { setDataWeek(event.target.value); setDataDraft({}); }}>
          {allWeeks().map((week) => <option key={week}>{week}</option>)}
        </select>
      </div>
      <SuboperatorManager stationNames={stations.map((station) => station.name)} onStatus={setStatus} />
      <div className="cost-panel record-editor" id="record-editor">
        <div className="section-head">
          <div>
            <h3>历史经营数据修改</h3>
            <p>用于纠正单站单周数据；充电量由尖、峰、平、谷自动合计，保存后本周及下一周环比自动重算。</p>
          </div>
          <button className="panel-toggle" onClick={() => togglePanel("record")}>{openPanels.record ? "收起" : "详情/编辑"}</button>
        </div>
        {!openPanels.record ? (
          <div className="compact-config-summary">
            {editableRecord ? <><span>充电量 <b>{qty(num(editableRecord.charge))} kWh</b></span><span>服务费 <b>{money(num(editableRecord.serviceRevenue))}</b></span><span>经营利润 <b>{money(num(editableRecord.profit))}</b></span></> : <span>该场站本周暂无数据</span>}
          </div>
        ) : Object.keys(dataDraft).length ? (
          <>
            <div className="record-edit-grid">
              {editFields.map(([key, label]) => (
                <label key={key}>{label}<input type="number" step="0.001" value={dataDraft[key] ?? ""} onChange={(event) => setDataDraft((current) => ({ ...current, [key]: event.target.value === "" ? null : Number(event.target.value) }))} /></label>
              ))}
            </div>
            <div className="record-edit-summary">
              修正后充电量：<b>{qty(num(dataDraft.peak) + num(dataDraft.high) + num(dataDraft.flat) + num(dataDraft.valley))} kWh</b>
              <div className="config-actions"><button className="ghost" onClick={() => { setDataDraft({}); setOpenPanels((current) => ({ ...current, record: false })); }}>取消</button><button className="save-button" onClick={saveRecordEditor}>保存并重算环比</button></div>
            </div>
          </>
        ) : (
          <div className="record-readonly">
            {editableRecord ? <>
              <span>充电量 <b>{qty(num(editableRecord.charge))} kWh</b></span>
              <span>尖/峰/平/谷 <b>{[editableRecord.peak, editableRecord.high, editableRecord.flat, editableRecord.valley].map((value) => qty(num(value))).join(" / ")}</b></span>
              <span>服务费收入 <b>{money(num(editableRecord.serviceRevenue))}</b></span>
              <span>经营利润 <b>{money(num(editableRecord.profit))}</b></span>
              <button onClick={openRecordEditor}>修改本周数据</button>
            </> : <span>该场站本周暂无数据</span>}
          </div>
        )}
      </div>
      <div className="cost-panel auto-analysis-panel" id="auto-analysis">
        <div className="section-head">
          <div><h3>自动生成本周分析</h3><p>基于环比、尖峰平谷、服务费收入、利润、场景客群、天气和已有竞站数据生成；待核验内容不会猜测。</p></div>
          <div className="config-actions"><button className="panel-toggle" onClick={() => togglePanel("analysis")}>{openPanels.analysis ? "收起" : "详情/生成"}</button>{openPanels.analysis && <button onClick={previewAnalyses}>重新生成</button>}{analysisPreview && <button className="save-button" onClick={publishAnalyses}>确认发布</button>}</div>
        </div>
        {!openPanels.analysis ? (
          <div className="compact-config-summary"><span>当前整体分析 <b>{cfg.__summary__?.analysis ? "草稿已生成" : "尚未生成"}</b></span><span>导入新周报后自动重算全部场站分析</span></div>
        ) : analysisPreview ? (
          <div className="analysis-preview-list">
            <article><b>整体分析</b><p>{analysisPreview.__summary__?.analysis}</p></article>
            {stations.map((station) => <article key={station.name}><b>{station.name}</b><p>{analysisPreview[station.name]?.analysis}</p></article>)}
          </div>
        ) : (
          <div className="record-readonly"><span>当前已发布分析：<b>{cfg.__summary__?.analysis ? "已生成" : "尚未生成"}</b></span><span>导入新周报并确认后，也会自动生成并发布最新一周分析。</span></div>
        )}
      </div>
      {preview && (
        <div className="cost-panel import-preview" id="weekly-data">
          <div className="section-head">
            <div>
              <h3>导入预览 · {preview.week}</h3>
              <div className="import-counts">
                <span>Excel站点数 <b>{preview.matches.length}</b></span>
                <span>成功匹配 <b>{preview.matches.filter((match) => match.status === "matched").length}</b></span>
                <span className="pending">待确认 <b>{preview.matches.filter((match) => match.status === "pending").length}</b></span>
                <span>已忽略 <b>{preview.matches.filter((match) => match.status === "ignored").length}</b></span>
                <span className={preview.report.issues.length ? "abnormal" : ""}>异常 <b>{preview.report.issues.length}</b></span>
              </div>
              {preview.exists && <p>该周已存在，确认后仅更新本周</p>}
            </div>
            <div className="config-actions">
              <button className="ghost" onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="save-button"
                onClick={confirmImport}
                disabled={savingImport || preview.report.status === "error"}
              >
                {savingImport
                  ? "更新中…"
                  : preview.exists
                    ? "更新本周"
                    : "确认更新"}
              </button>
            </div>
          </div>
          <div className="field-recognition">
            <div>
              <b>字段识别结果</b>
              <span>{preview.recognition.sheet}{preview.recognition.headerRow ? ` · 表头第${preview.recognition.headerRow}行` : ""}</span>
            </div>
            <div className="recognized-fields">
              {([
                ["station", "站点名称"], ["period", "周次/日期"], ["peak", "尖电量"],
                ["high", "峰电量"], ["flat", "平电量"], ["valley", "谷电量"], ["charge", "总充电量"],
              ] as [CoreImportField, string][]).map(([key, label]) => (
                <span key={key}><small>{label}</small><b>{preview.recognition.fields[key]}</b></span>
              ))}
            </div>
            <p>
              仅读取站名、尖峰平谷和总充电量；{preview.recognition.ignoredColumns.length ? `金额、价格、成本等其他${preview.recognition.ignoredColumns.length}列已忽略。` : "未读取其他业务字段。"}
            </p>
          </div>
          {preview.matches.some((match) => match.status === "pending") && <div className="pending-matches">
            <b>待确认匹配</b>
            {preview.matches.filter((match): match is Extract<StationMatch, { status: "pending" }> => match.status === "pending").map((match) => (
              <div key={match.excelName}><span>Excel：{match.excelName}</span><span>建议：{match.dashboardName}</span><small>相似度 {(match.score * 100).toFixed(0)}%</small><button onClick={() => confirmStationMatch(match.excelName, match.dashboardName)}>确认并记住</button></div>
            ))}
          </div>}
          {preview.report.issues.length > 0 && (
            <div className="validation-report">
              <div className="validation-report-head"><b>发布前数据校验</b><span>错误会阻止导入和发布；警告需主管理员确认</span></div>
              <div className="validation-issues">{preview.report.issues.map((issue, index) => (
                <div key={`${issue.station}-${issue.week}-${issue.field}-${index}`} className={issue.level}><span>{issue.level === "error" ? "错误" : "警告"}</span><b>{issue.station}</b><em>{issue.week}</em><strong>{issue.field}</strong><p>{issue.reason}</p></div>
              ))}</div>
            </div>
          )}
          <div className="import-preview-table">
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>看板站名</th>
                  <th>Excel站名</th>
                  <th>尖电量</th>
                  <th>峰电量</th>
                  <th>平电量</th>
                  <th>谷电量</th>
                  <th>总电量</th>
                </tr>
              </thead>
              <tbody>
                {preview.matches.filter((match): match is Exclude<StationMatch, { status: "ignored" }> => match.status !== "ignored").map((match) => {
                  const station = match.status === "matched" ? preview.parsed.find((item) => item.name === match.dashboardName) : undefined;
                  const row = station?.records.find(
                    (record) => record.week === preview.week,
                  );
                  return (
                    <tr key={match.excelName} className={match.status}>
                      <td>{match.status === "matched" ? "✓ 已匹配" : "待确认"}</td>
                      <td>{match.dashboardName}</td>
                      <td>{match.excelName}</td>
                      <td>{importValue(row?.peak)}</td>
                      <td>{importValue(row?.high)}</td>
                      <td>{importValue(row?.flat)}</td>
                      <td>{importValue(row?.valley)}</td>
                      <td>{importValue(row?.charge)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <details className="ignored-stations"><summary>已忽略 {preview.matches.filter((match) => match.status === "ignored").length} 个非看板站点</summary><p>{preview.matches.filter((match) => match.status === "ignored").map((match) => match.excelName).join("、") || "无"}</p></details>
        </div>
      )}
      <div className="cost-panel matrix-panel" id="price-cost">
        <div className="section-head">
          <div>
            <h3>{weekParts(dataWeek).year}年1–12月电费成本</h3>
            <p>大工业电价与售电价按月匹配；一口价在下方按场站单独设置。</p>
          </div>
          <div className="config-actions"><select value={month} onChange={(e) => setMonth(e.target.value)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>{weekParts(dataWeek).year}年{i + 1}月</option>)}</select><button className="panel-toggle" onClick={() => toggleEditablePanel("cost")}>{openPanels.cost ? "收起" : "详情/编辑"}</button></div>
        </div>
        {!openPanels.cost ? <div className="compact-config-summary"><span>{weekParts(dataWeek).year}年{month}月成本配置</span><span>大工业电价、售电价及电网过路费</span><b>{Object.values(costs[month]?.["大工业电价"] || {}).filter(Boolean).length}/4 时段已配置</b></div> : <><div className="price-matrix">
          <div className="matrix-row header">
            <b>计费类型</b>
            {periods.map(([, label]) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          {types.map((type) => (
            <div className="matrix-row" key={type}>
              <b>{type}</b>
              {periods.map(([key]) => (
                <input
                  key={key}
                  disabled={!editing}
                  value={costs[month]?.[type]?.[key] || ""}
                  onChange={(e) => setCost(type, key, e.target.value)}
                  placeholder="元/kWh"
                />
              ))}
            </div>
          ))}
        </div>
        <label className="grid-fee-field">
          售电价电网过路费
          <input
            disabled={!editing}
            value={gridFees[month] || ""}
            onChange={(e) => setGridFee(e.target.value)}
            placeholder="元/kWh"
          />
        </label>
        <small className="cost-source">
          已从Excel表2导入1–12月售电价及电网过路费，从表3导入3–8月大工业电价；源表空白月份保持空白。
        </small>
        </>}
      </div>
      <div className="cost-panel matrix-panel">
        <div className="section-head">
          <div>
            <h3>每周、每站对外价格</h3>
            <p>
              电费和服务费按场站、周次分别保存；最终总价自动相加并同步至竞站对比。
            </p>
          </div>
          <button className="panel-toggle" onClick={() => toggleEditablePanel("weeklyPrice")}>{openPanels.weeklyPrice ? "收起" : "详情/编辑"}</button>
        </div>
        {!openPanels.weeklyPrice ? <div className="compact-config-summary"><span>当前总价</span>{periods.map(([key, label]) => <span key={key}>{label} <b>{salePrice[key] ? `¥${Number(salePrice[key]).toFixed(3)}` : "—"}</b></span>)}</div> : <><div className="weekly-price-groups">
          {(["electricity", "service"] as const).map((group) => (
            <div className="weekly-price-group" key={group}>
              <b>{group === "electricity" ? "电费" : "服务费"}</b>
              <div className="weekly-grid">
                {periods.map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      disabled={!editing}
                      value={(group === "electricity" ? electricityPrices : servicePrices)[priceWeek]?.[key] || ""}
                      onChange={(event) => setWeeklyPrice(group, key, event.target.value)}
                      placeholder="元/kWh"
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="profit-preview">
          <b>自动利润测算</b>
          <span>
            {estimate == null ? "待补全该周成本和对外电费" : money(estimate)}
          </span>
          <small>
            服务费收入 + Σ（分时电量 ×（对外电费－月度成本－售电过路费））
          </small>
        </div>
        </>}
      </div>
      <div className="config-card" id="station-profile">
        <div className="table-tools">
          <div className="search">
            <Search />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索场站"
            />
          </div>
          <span>{list.length} 个场站</span><button className="panel-toggle" onClick={() => toggleEditablePanel("profiles")}>{openPanels.profiles ? "收起" : "详情/编辑"}</button>
        </div>
        {!openPanels.profiles ? <div className="compact-config-summary"><span>场站资料</span><span>运营商、计费类型、一口价成本及枪数量</span><b>{stations.length} 个运营场站</b></div> : <div className="table-scroll config-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>场站名称</TableHead>
                <TableHead>运营状态</TableHead>
                <TableHead>最新周期</TableHead>
                <TableHead>运营商</TableHead>
                <TableHead>计费类型</TableHead>
                <TableHead>一口价成本</TableHead>
                <TableHead>枪数量</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((s) => {
                const c = { ...emptyConfig, ...cfg[s.name] };
                return (
                  <TableRow key={s.name}>
                    <TableCell>{s.name}</TableCell>
                    <TableCell>
                      <span className="online">
                        <i />
                        运营中
                      </span>
                    </TableCell>
                    <TableCell>
                      {s.records.findLast((r) => r.charge != null)?.week ?? "—"}
                    </TableCell>
                    <TableCell>
                      <input
                        disabled={!editing}
                        className="config-input"
                        value={c.operator}
                        onChange={(e) =>
                          update(s.name, "operator", e.target.value)
                        }
                        placeholder="运营商"
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        disabled={!editing}
                        className="config-input"
                        value={c.billingType}
                        onChange={(e) =>
                          update(s.name, "billingType", e.target.value)
                        }
                      >
                        {billingTypes.map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </TableCell>
                    <TableCell>
                      <input
                        disabled={!editing}
                        className="config-input"
                        value={c.unifiedPrice}
                        onChange={(e) =>
                          update(s.name, "unifiedPrice", e.target.value)
                        }
                        placeholder="元/kWh"
                      />
                    </TableCell>
                    <TableCell>
                      <input
                        disabled={!editing}
                        className="config-input short"
                        value={c.guns}
                        onChange={(e) => update(s.name, "guns", e.target.value)}
                        type="number"
                        placeholder="—"
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        }
      </div>
    </>
  );
}
function MixComparison({
  current,
  previous,
}: {
  current: Record<keyof PeriodPrice, number>;
  previous: Record<keyof PeriodPrice, number>;
}) {
  const [active, setActive] = useState<keyof PeriodPrice>("flat"),
    total = Object.values(current).reduce((a, b) => a + b, 0) || 1,
    items: [keyof PeriodPrice, string, string][] = [
      ["peak", "尖段", "#ff6b6b"],
      ["high", "峰段", "#ffb454"],
      ["flat", "平段", "#59d7b4"],
      ["valley", "谷段", "#6f8cff"],
    ],
    change = previous[active] ? current[active] / previous[active] - 1 : null;
  return (
    <div className="donut-row interactive-mix">
      <div
        className="donut"
        style={{
          background: `conic-gradient(#ff6b6b 0 ${(current.peak / total) * 100}%,#ffb74d 0 ${((current.peak + current.high) / total) * 100}%,#59d7b4 0 ${((current.peak + current.high + current.flat) / total) * 100}%,#6f8cff 0 100%)`,
        }}
      >
        <div>
          <strong>{qty(current[active])}</strong>
          <span>{items.find((x) => x[0] === active)?.[1]} · kWh</span>
          <small className={num(change) >= 0 ? "up" : "down"}>
            {change == null ? "无上周数据" : `环比 ${pct(change)}`}
          </small>
        </div>
      </div>
      <div className="mix-list">
        {items.map(([key, label, color]) => (
          <button
            key={key}
            className={active === key ? "active" : ""}
            onMouseEnter={() => setActive(key)}
            onFocus={() => setActive(key)}
          >
            <span>
              <i style={{ background: color }} />
              {label}
            </span>
            <strong>{((current[key] / total) * 100).toFixed(1)}%</strong>
            <small>本周 {qty(current[key])}</small>
            <small>上周 {qty(previous[key])}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
function GunCard({ station }: { station: string }) {
  const { cfg, update, save } = useConfigs(),
    c = { ...emptyConfig, ...cfg[station] },
    canEdit = useContext(OperatorContext);
  return (
    <article className="kpi">
      <div className="kpi-top">
        <span className="kpi-icon">
          <Building2 />
        </span>
        <span>充电枪数</span>
      </div>
      <div className="kpi-body">
        {canEdit ? (
          <input
            className="gun-input"
            type="number"
            value={c.guns}
            onChange={(e) => update(station, "guns", e.target.value)}
            onBlur={() => void save()}
            placeholder="填写枪数"
          />
        ) : (
          <strong>{c.guns || "—"}</strong>
        )}
      </div>
      <div className="kpi-foot">
        <small>按场站保存，用于竞站效率对比</small>
      </div>
    </article>
  );
}
function StationHistoryTable({
  station,
  onRecordSave,
  aggregate = false,
}: {
  station: S;
  onRecordSave: (station: string, week: string, patch: Partial<R>, deferSave?: boolean) => Promise<S[]>;
  aggregate?: boolean;
}) {
  const admin = useContext(OperatorContext),
    scrollRef = useRef<HTMLDivElement>(null),
    { cfg, save } = useConfigs(),
    stationCfg = { ...emptyConfig, ...cfg[station.name] },
    [editingWeek, setEditingWeek] = useState<string | null>(null),
    [draft, setDraft] = useState<Partial<R>>({}),
    [status, setStatus] = useState(""),
    serviceKeys = {
      peak: "peakServiceRevenue",
      high: "highServiceRevenue",
      flat: "flatServiceRevenue",
      valley: "valleyServiceRevenue",
    } as const,
    priceForWeek = resolveWeeklyPrice,
    calculatedRevenue = (record: R, kind: "electricity" | "service") => {
      if (kind === "electricity" && record.electricityRevenue != null)
        return record.electricityRevenue;
      const source = kind === "electricity"
          ? stationCfg.electricityPricesJson || stationCfg.externalPricesJson
          : stationCfg.servicePricesJson,
        prices = priceForWeek(source, record.week),
        value = num(record.peak) * Number(prices.peak || 0)
          + num(record.high) * Number(prices.high || 0)
          + num(record.flat) * Number(prices.flat || 0)
          + num(record.valley) * Number(prices.valley || 0);
      return value || (kind === "service" ? num(record.serviceRevenue) : 0);
    },
    periodServiceRevenue = (record: R, period: keyof typeof serviceKeys) => {
      const stored = record[serviceKeys[period]];
      if (stored != null) return num(stored);
      const prices = priceForWeek(stationCfg.servicePricesJson, record.week),
        priceValue = Number(prices[period] || 0);
      if (priceValue > 0) return num(record[period]) * priceValue;
      return num(record.charge)
        ? num(record.serviceRevenue) * num(record[period]) / num(record.charge)
        : 0;
    },
    metricValue = (current: number, previous: number, index: number, currency = false) => (
      <>
        <b>{currency ? money(current) : qty(current)}</b>
        <small>上周 {index ? (currency ? money(previous) : qty(previous)) : "—"}</small>
        <em className={index && previous ? current >= previous ? "up" : "down" : ""}>
          {index && previous ? pct(current / previous - 1) : "—"}
        </em>
      </>
    ),
    draftElectricityRevenue = (next: Partial<R>, week: string) => {
      const prices = priceForWeek(
        stationCfg.electricityPricesJson || stationCfg.externalPricesJson,
        week,
      );
      return num(next.peak) * Number(prices.peak || 0)
        + num(next.high) * Number(prices.high || 0)
        + num(next.flat) * Number(prices.flat || 0)
        + num(next.valley) * Number(prices.valley || 0);
    },
    beginEdit = (record: R) => {
      setEditingWeek(record.week);
      setDraft({
        ...Object.fromEntries(Object.entries(record).map(([key, value]) => [key, typeof value === "number" ? round3(value) : value])) as R,
        electricityRevenue: round3(calculatedRevenue(record, "electricity")),
        peakServiceRevenue: round3(periodServiceRevenue(record, "peak")),
        highServiceRevenue: round3(periodServiceRevenue(record, "high")),
        flatServiceRevenue: round3(periodServiceRevenue(record, "flat")),
        valleyServiceRevenue: round3(periodServiceRevenue(record, "valley")),
      });
      setStatus("");
    },
    saveEdit = async () => {
      if (!editingWeek) return;
      setStatus("保存中…");
      try {
        const serviceRevenue = num(draft.peakServiceRevenue)
          + num(draft.highServiceRevenue)
          + num(draft.flatServiceRevenue)
          + num(draft.valleyServiceRevenue),
          charge = num(draft.peak) + num(draft.high) + num(draft.flat) + num(draft.valley),
          metrics = calculateOperatingMetrics({ ...station.records.find((item) => item.week === editingWeek), ...draft, week: editingWeek, charge }, stationCfg, { ...emptyConfig, ...cfg.__monthly__ }),
          merged = await onRecordSave(station.name, editingWeek, {
            ...draft, charge,
            peakServiceRevenue: metrics.periodService.peak,
            highServiceRevenue: metrics.periodService.high,
            flatServiceRevenue: metrics.periodService.flat,
            valleyServiceRevenue: metrics.periodService.valley,
            electricityRevenue: metrics.electricityRevenue,
            serviceRevenue: metrics.serviceRevenue ?? serviceRevenue,
            profit: metrics.profit,
            servicePerKwh: metrics.servicePerKwh,
            electricityProfitPerKwh: metrics.electricityProfitPerKwh,
          }, true);
        const latestWeek = [...new Set(merged.flatMap((item) => item.records.map((record) => record.week)))]
          .sort((left, right) => weekOrderValue(left) - weekOrderValue(right)).at(-1) || editingWeek;
        await save(generateWeeklyAnalyses(merged, latestWeek, cfg), merged);
        setEditingWeek(null);
        setDraft({});
        setStatus("已保存，电量、环比和最新周分析已重新计算");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "保存失败");
      }
    };
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = scrollRef.current;
      if (element) element.scrollLeft = element.scrollWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [station.name, station.records.length]);
  const changeFor = (current: number, previous: number, index: number) =>
      index && previous ? current / previous - 1 : null,
    cell = (value: number, previous: number, index: number, format: "qty" | "money" | "decimal" = "qty") => {
      const display = format === "money" ? money(value)
        : format === "decimal" ? `¥${value.toFixed(3)}` : qty(value),
        change = changeFor(value, previous, index);
      return <><b>{display}</b><em className={change == null ? "" : change >= 0 ? "up" : "down"}>{pct(change)}</em></>;
    },
    editableValue = (record: R, key: keyof R, service = false) => {
      if (editingWeek !== record.week) return null;
      const draftKey = service ? serviceKeys[key as keyof typeof serviceKeys] : key;
      return <input type="number" step="0.001" value={draft[draftKey] ?? ""} onChange={(event) => setDraft((value) => ({
        ...value,
        [draftKey]: event.target.value === "" ? null : Number(event.target.value),
      }))} />;
    },
    rows: Array<{ section?: string; label?: string; value?: (record: R) => number; format?: "qty" | "money" | "decimal"; editKey?: keyof R; service?: boolean }> = [
      { section: "充电量" },
      { label: "尖", value: (record) => num(record.peak), editKey: "peak" },
      { label: "峰", value: (record) => num(record.high), editKey: "high" },
      { label: "平", value: (record) => num(record.flat), editKey: "flat" },
      { label: "谷", value: (record) => num(record.valley), editKey: "valley" },
      { label: "总充电量", value: (record) => num(record.charge) },
      { section: "服务费收入" },
      { label: "尖", value: (record) => periodServiceRevenue(record, "peak"), format: "money", editKey: "peak", service: true },
      { label: "峰", value: (record) => periodServiceRevenue(record, "high"), format: "money", editKey: "high", service: true },
      { label: "平", value: (record) => periodServiceRevenue(record, "flat"), format: "money", editKey: "flat", service: true },
      { label: "谷", value: (record) => periodServiceRevenue(record, "valley"), format: "money", editKey: "valley", service: true },
      { label: "总服务费收入", value: (record) => num(record.serviceRevenue), format: "money" },
      { section: "总计" },
      { label: "每度服务费", value: (record) => num(record.servicePerKwh), format: "decimal" },
      { label: "每度电费利润", value: (record) => num(record.electricityProfitPerKwh), format: "decimal" },
      { label: "经营利润", value: (record) => num(record.profit), format: "money" },
    ];
  return (
    <Panel
      title={aggregate ? "全部场站完整历史数据" : "单站完整历史数据"}
      sub="2025年至今；左侧指标固定，周次横向排列并默认定位最新周"
      extra="ranking station-history-panel"
    >
      {status && <div className="history-edit-status">{status}</div>}
      <div ref={scrollRef} className="table-scroll history-table history-matrix-scroll">
        <table className="history-matrix">
          <thead>
            <tr>
              <th className="metric-col">经营指标</th>
              {station.records.map((record, index) => <th className={index === station.records.length - 1 ? "latest-week" : ""} key={record.week}>{record.week}{index === station.records.length - 1 && <small className="latest-badge">最新</small>}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => row.section ? (
              <tr className="history-section-row" key={row.section}><th className="metric-col">{row.section}</th><td colSpan={station.records.length} /></tr>
            ) : (
              <tr key={`${row.label}-${rowIndex}`}>
                <th className="metric-col">{row.label}</th>
                {station.records.map((record, index) => {
                  const previous = station.records[Math.max(0, index - 1)], value = row.value!(record), previousValue = row.value!(previous),
                    input = !aggregate && row.editKey ? editableValue(record, row.editKey, row.service) : null;
                  return <td className={index === station.records.length - 1 ? "latest-week" : ""} key={record.week}>{input || cell(value, previousValue, index, row.format)}</td>;
                })}
              </tr>
            ))}
            {admin && !aggregate && <tr className="history-actions-row">
              <th className="metric-col">操作</th>
              {station.records.map((record, index) => <td className={index === station.records.length - 1 ? "latest-week" : ""} key={record.week}>{editingWeek === record.week ? <div className="history-row-actions"><button className="ghost" onClick={() => setEditingWeek(null)}>取消</button><button className="save-button" onClick={saveEdit}>保存</button></div> : <button className="history-edit-button" onClick={() => beginEdit(record)}>修改</button>}</td>)}
            </tr>}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
function ExportDialog({
  stations: onStations,
  onClose,
}: {
  stations: S[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(onStations.map((s) => s.name)),
    toggle = (name: string) =>
      setSelected((v) =>
        v.includes(name) ? v.filter((x) => x !== name) : [...v, name],
      ),
    download = () => {
      const rows = [
          [
            "场站",
            "周次",
            "充电量",
            "尖",
            "峰",
            "平",
            "谷",
            "服务费收入",
            "经营利润",
          ],
          ...onStations
            .filter((s) => selected.includes(s.name))
            .flatMap((s) =>
              s.records.map((r) => [
                s.name,
                r.week,
                r.charge,
                r.peak,
                r.high,
                r.flat,
                r.valley,
                r.serviceRevenue,
                r.profit,
              ]),
            ),
        ],
        blob = new Blob(["\ufeff" + rows.map((r) => r.join(",")).join("\n")], {
          type: "text/csv;charset=utf-8",
        }),
        a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "充电站运营周报.csv";
      a.click();
      URL.revokeObjectURL(a.href);
    };
  return (
    <div className="modal-backdrop">
      <div className="export-dialog">
        <h3>导出周报</h3>
        <p>选择单站或多站，并选择导出格式。</p>
        <div className="export-stations">
          {onStations.map((s) => (
            <label key={s.name}>
              <input
                type="checkbox"
                checked={selected.includes(s.name)}
                onChange={() => toggle(s.name)}
              />
              {s.name}
            </label>
          ))}
        </div>
        <div className="export-buttons">
          <button onClick={download}>导出 Excel</button>
          <button onClick={() => window.print()}>导出 PDF / 打印</button>
          <button className="ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
function Kpi({
  icon,
  label,
  value,
  change,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  change?: number | null;
  sub?: string;
}) {
  return (
    <article className="kpi">
      <div className="kpi-top">
        <span className="kpi-icon">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="kpi-body">
        <strong>{value}</strong>
      </div>
      <div className="kpi-foot">
        {change != null ? (
          <>
            <span className={change >= 0 ? "up" : "down"}>
              {change >= 0 ? <TrendingUp /> : <TrendingDown />}
              {pct(change)}
            </span>
            <small>较上周</small>
          </>
        ) : (
          <small>{sub}</small>
        )}
      </div>
    </article>
  );
}
function Panel({
  title,
  sub,
  children,
  extra = "",
}: {
  title: string;
  sub: string;
  children: React.ReactNode;
  extra?: string;
}) {
  return (
    <article className={`panel ${extra}`}>
      <div className="panel-title">
        <div>
          <h2>{title}</h2>
          <p>{sub}</p>
        </div>
      </div>
      {children}
    </article>
  );
}
function FilteredInteractiveChart({
  lines,
  large = false,
  focusedLine = null,
  onFocusLine,
  rankedTooltip = false,
  valueFormatter = chartWan,
  showPrimaryLabels = true,
  tooltipRequiresPin = true,
  primaryLabelFormatter = chartWanLabel,
}: {
  lines: { name: string; color: string; data: { week: string; value: number }[] }[];
  large?: boolean;
  focusedLine?: string | null;
  onFocusLine?: (name: string | null) => void;
  rankedTooltip?: boolean;
  valueFormatter?: (value: number) => string;
  showPrimaryLabels?: boolean;
  tooltipRequiresPin?: boolean;
  primaryLabelFormatter?: (value: number) => string;
}) {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [endLabel, setEndLabel] = useState("");
  const aggregate = (data: { week: string; value: number }[]) => {
    if (mode === "week") return data;
    const grouped = new Map<string, number>();
    data.forEach((point) => {
      const parts = weekParts(point.week);
      const label = `${parts.year}年${parts.month}月`;
      grouped.set(label, (grouped.get(label) || 0) + point.value);
    });
    return [...grouped].map(([week, value]) => ({ week, value }));
  };
  const aggregated = lines.map((line) => ({ ...line, data: aggregate(line.data) }));
  const labels = aggregated[0]?.data.map((point) => point.week) || [];
  const selectedEnd = labels.includes(endLabel) ? labels.indexOf(endLabel) : labels.length - 1;
  const start = Math.max(0, selectedEnd - 7);
  const visible = aggregated.map((line) => ({
    ...line,
    data: line.data.slice(start, selectedEnd + 1),
  }));
  return (
    <>
      <div className="trend-toolbar chart-filter-toolbar">
        <div>
          <button className={mode === "week" ? "active" : ""} onClick={() => { setMode("week"); setEndLabel(""); }}>周度</button>
          <button className={mode === "month" ? "active" : ""} onClick={() => { setMode("month"); setEndLabel(""); }}>月度</button>
        </div>
        <label>
          时间
          <select value={labels[selectedEnd] || ""} onChange={(event) => setEndLabel(event.target.value)}>
            {labels.map((label) => <option key={label}>{label}</option>)}
          </select>
        </label>
      </div>
      <InteractiveChart
        lines={visible}
        large={large}
        focusedLine={focusedLine}
        onFocusLine={onFocusLine}
        rankedTooltip={rankedTooltip}
        valueFormatter={valueFormatter}
        showPrimaryLabels={showPrimaryLabels}
        tooltipRequiresPin={tooltipRequiresPin}
        primaryLabelFormatter={primaryLabelFormatter}
      />
    </>
  );
}
function InteractiveChart({
  lines,
  large = false,
  focusedLine = null,
  onFocusLine,
  rankedTooltip = false,
  valueFormatter = chartWan,
  showPrimaryLabels = false,
  tooltipRequiresPin = false,
  primaryLabelFormatter = chartWanLabel,
}: {
  lines: {
    name: string;
    color: string;
    data: { week: string; value: number }[];
  }[];
  large?: boolean;
  focusedLine?: string | null;
  onFocusLine?: (name: string | null) => void;
  rankedTooltip?: boolean;
  valueFormatter?: (value: number) => string;
  showPrimaryLabels?: boolean;
  tooltipRequiresPin?: boolean;
  primaryLabelFormatter?: (value: number) => string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const visibleLines = lines.filter((line) => !hidden.includes(line.name));
  const weeks = lines[0]?.data.map((point) => point.week) ?? [];
  const activePoint = pinned ?? hover;
  const all = visibleLines.flatMap((line) =>
    line.data.map((point) => point.value),
  );
  const max = Math.max(...all, 1),
    min = Math.min(...all, 0);
  const x = (index: number) => 8 + (index * 84) / Math.max(weeks.length - 1, 1);
  const y = (value: number) =>
    145 - ((value - min) / Math.max(max - min, 1)) * 112;
  return (
    <div className={`interactive-chart ${large ? "large" : ""}`}>
      <div className="chart-legend">
        {lines.map((line) => (
          <button
            key={line.name}
            className={`${hidden.includes(line.name) ? "hidden" : ""} ${focusedLine === line.name ? "focused" : ""} ${focusedLine && focusedLine !== line.name ? "muted" : ""}`}
            onClick={() =>
              onFocusLine
                ? onFocusLine(focusedLine === line.name ? null : line.name)
                : setHidden((v) =>
                    v.includes(line.name)
                      ? v.filter((x) => x !== line.name)
                      : [...v, line.name],
                  )
            }
          >
            <i style={{ background: line.color }} />
            {line.name}
          </button>
        ))}
      </div>
      <svg
        viewBox="0 0 100 170"
        preserveAspectRatio="none"
        aria-label="趋势图；点击可固定或取消当前周数据"
        onMouseLeave={() => pinned === null && setHover(null)}
        onMouseMove={(event) => {
          if (pinned !== null) return;
          const box = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - box.left) / box.width) * 100;
          setHover(
            Math.max(
              0,
              Math.min(
                weeks.length - 1,
                Math.round(((px - 8) / 84) * Math.max(weeks.length - 1, 1)),
              ),
            ),
          );
        }}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const px = ((event.clientX - box.left) / box.width) * 100;
          const index = Math.max(
            0,
            Math.min(
              weeks.length - 1,
              Math.round(((px - 8) / 84) * Math.max(weeks.length - 1, 1)),
            ),
          );
          setPinned((current) => (current === index ? null : index));
          setHover(index);
        }}
      >
        {[32, 60, 88, 116, 145].map((value) => (
          <line
            key={value}
            x1="6"
            x2="94"
            y1={value}
            y2={value}
            className="gridline"
          />
        ))}
        {visibleLines.map((line) => (
          <polyline
            key={line.name}
            points={line.data
              .map((point, index) => `${x(index)},${y(point.value)}`)
              .join(" ")}
            fill="none"
            stroke={line.color}
            strokeWidth={focusedLine === line.name ? "3" : "1.8"}
            opacity={focusedLine && focusedLine !== line.name ? 0.18 : 1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {visibleLines.flatMap((line) =>
          line.data.map((point, index) => {
            const radius = activePoint === index ? 1.8 : 1.05;
            return (
              <circle
                key={`${line.name}-${index}`}
                cx={x(index)}
                cy={y(point.value)}
                r={radius}
                fill={line.color}
                stroke="#0d241e"
                strokeWidth=".45"
                vectorEffect="non-scaling-stroke"
                opacity={focusedLine && focusedLine !== line.name ? 0.16 : 1}
              />
            );
          }),
        )}
        {activePoint !== null && (
          <line
            x1={x(activePoint)}
            x2={x(activePoint)}
            y1="24"
            y2="146"
            className="hover-line"
          />
        )}
        {weeks.map((_, index) => (
          <rect
            key={index}
            x={x(index) - 6}
            y="20"
            width="12"
            height="130"
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>
      <div className="xlabels">
        {weeks.map((week) => (
          <span key={week}>{week}</span>
        ))}
      </div>
      {showPrimaryLabels &&
        visibleLines[0]?.data.map((point, index) => (
          <span
            className="chart-value-label"
            key={`primary-label-${point.week}`}
            style={{
              left: `${x(index)}%`,
              top: `${20 + (y(point.value) / 170) * 184 - 15}px`,
            }}
          >
            {primaryLabelFormatter(point.value)}
          </span>
        ))}
      {activePoint !== null &&
        weeks[activePoint] &&
        (!tooltipRequiresPin || pinned !== null) && (
        <div
          className={`chart-tooltip ${rankedTooltip ? "ranked" : ""}`}
          style={{ left: `${Math.min(82, Math.max(9, x(activePoint)))}%` }}
        >
          <b>{weeks[activePoint]}{pinned !== null ? " · 已固定" : ""}</b>
          {visibleLines.map((line) => (
            <span key={line.name}>
              <i style={{ background: line.color }} />
              {line.name}
              <strong>
                {valueFormatter(line.data[activePoint]?.value || 0)}
                {rankedTooltip &&
                  activePoint > 0 &&
                  (() => {
                    const current = line.data[activePoint]?.value || 0,
                      previous = line.data[activePoint - 1]?.value || 0,
                      rank =
                        visibleLines
                          .filter((item) => item.name !== "全场趋势")
                          .sort(
                            (a, b) =>
                              (b.data[activePoint]?.value || 0) -
                              (a.data[activePoint]?.value || 0),
                          )
                          .findIndex((item) => item.name === line.name) + 1;
                    return ` · 上周 ${valueFormatter(previous)} · ${previous ? pct(current / previous - 1) : "—"}${line.name === "全场趋势" ? "" : ` · 第${rank}名`}`;
                  })()}
              </strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
function BarList({
  rows,
  danger = false,
}: {
  rows: { station: S; record: R }[];
  danger?: boolean;
}) {
  const max = Math.max(...rows.map((x) => num(x.record.profit)), 1);
  return (
    <div className="bar-list">
      {rows.map((x, i) => (
        <div key={x.station.name} className={i < 3 ? "top-three" : ""}>
          <span>{i + 1}</span>
          <div>
            <b>{x.station.name}</b>
            <i>
              <em
                style={{
                  width: `${Math.max(3, (num(x.record.profit) / max) * 100)}%`,
                  background: danger ? "#ff7474" : "#36d399",
                }}
              />
            </i>
          </div>
          <strong>{money(num(x.record.profit))}</strong>
          <small className={num(x.record.chargeChange) >= 0 ? "up" : "down"}>
            {pct(x.record.chargeChange)}
          </small>
        </div>
      ))}
    </div>
  );
}
function StationTable({
  rows,
  detailed = false,
}: {
  rows: { station: S; record: R }[];
  detailed?: boolean;
}) {
  const [q, setQ] = useState("");
  const filtered = rows.filter((x) => x.station.name.includes(q));
  return (
    <>
      <div className="table-tools">
        <div className="search">
          <Search />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索场站"
          />
        </div>
        <span>共 {filtered.length} 个场站</span>
      </div>
      <div className="table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>排名 / 场站</TableHead>
              <TableHead className="num">充电量(kWh)</TableHead>
              {detailed && (
                <>
                  <TableHead className="num">尖(kWh)</TableHead>
                  <TableHead className="num">峰(kWh)</TableHead>
                  <TableHead className="num">平(kWh)</TableHead>
                  <TableHead className="num">谷(kWh)</TableHead>
                </>
              )}
              <TableHead className="num">服务费收入</TableHead>
              {detailed && (
                <>
                  <TableHead className="num">每度服务费</TableHead>
                  <TableHead className="num">每度电费利润</TableHead>
                </>
              )}
              <TableHead className="num">经营利润</TableHead>
              <TableHead className="num">环比</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((x, i) => (
              <TableRow key={x.station.name}>
                <TableCell>
                  <div className="station-cell">
                    <b>{String(i + 1).padStart(2, "0")}</b>
                    <span>{x.station.name}</span>
                  </div>
                </TableCell>
                <TableCell className="num">
                  {x.record.charge == null ? "—" : qty(x.record.charge)}
                </TableCell>
                {detailed && (
                  <>
                    <TableCell className="num">
                      {x.record.peak == null ? "—" : qty(x.record.peak)}
                    </TableCell>
                    <TableCell className="num">
                      {x.record.high == null ? "—" : qty(x.record.high)}
                    </TableCell>
                    <TableCell className="num">
                      {x.record.flat == null ? "—" : qty(x.record.flat)}
                    </TableCell>
                    <TableCell className="num">
                      {x.record.valley == null ? "—" : qty(x.record.valley)}
                    </TableCell>
                  </>
                )}
                <TableCell className="num">
                  {x.record.serviceRevenue == null
                    ? "—"
                    : money(x.record.serviceRevenue)}
                </TableCell>
                {detailed && (
                  <>
                    <TableCell className="num">
                      {x.record.servicePerKwh == null
                        ? "—"
                        : `¥${x.record.servicePerKwh.toFixed(3)}`}
                    </TableCell>
                    <TableCell className="num">
                      {x.record.electricityProfitPerKwh == null
                        ? "—"
                        : `¥${x.record.electricityProfitPerKwh.toFixed(3)}`}
                    </TableCell>
                  </>
                )}
                <TableCell className="num profit">
                  {x.record.profit == null ? "—" : money(x.record.profit)}
                </TableCell>
                <TableCell
                  className={`num ${num(x.record.chargeChange) >= 0 ? "up" : "down"}`}
                >
                  {pct(x.record.chargeChange)}
                </TableCell>
              </TableRow>
            ))}
            {!filtered.length && (
              <TableRow>
                <TableCell colSpan={detailed ? 11 : 5} className="empty-cell">
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
