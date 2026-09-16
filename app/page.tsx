"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
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
import support from "./supporting-data.json";
type R = {
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
type S = { name: string; records: R[] };
type View = "overview" | "station" | "business" | "trend" | "config";
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
const allWeeks = () => stations[0]?.records.map((r) => r.week) ?? data.weeks;
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
const DEFAULT_COSTS = support.monthlyCosts as Record<
  string,
  Record<string, PeriodPrice>
>;
const DEFAULT_GRID_FEES = support.gridFees as Record<string, string>;
function useConfigs() {
  const [cfg, setCfg] = useState<Record<string, StationConfig>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const saved = JSON.parse(
          localStorage.getItem("charging-dashboard-config") || "{}",
        ) as Record<string, StationConfig>,
        version = "2026-09-12-week2-v1";
      if (localStorage.getItem("charging-support-version") === version)
        return saved;
      const seeded: Record<string, StationConfig> = {
        ...saved,
        __monthly__: {
          ...emptyConfig,
          ...saved.__monthly__,
          monthlyCostsJson: JSON.stringify(DEFAULT_COSTS),
          gridFeesJson: JSON.stringify(DEFAULT_GRID_FEES),
        },
      };
      Object.entries(support.stations).forEach(([name, item]) => {
        const station = item as {
          guns: string;
          location?: string;
          customers?: string;
          weather?: string;
          analysis?: string;
          weeklyPrice: PeriodPrice;
          electricityPrice: PeriodPrice;
          servicePrice: PeriodPrice;
          competitors: Competitor[];
        };
        const latestWeek = allWeeks().at(-1) || "2026年9月2周",
          weeks = { [latestWeek]: station.weeklyPrice },
          electric = {
            [latestWeek]: station.electricityPrice,
          },
          serviceFee = {
            [latestWeek]: station.servicePrice,
          };
        seeded[name] = {
          ...emptyConfig,
          ...saved[name],
          guns: station.guns,
          location: station.location || saved[name]?.location || "",
          customers: station.customers || saved[name]?.customers || "",
          weather: station.weather || saved[name]?.weather || "",
          analysis: station.analysis || saved[name]?.analysis || "",
          weeklyPeak: station.weeklyPrice.peak,
          weeklyHigh: station.weeklyPrice.high,
          weeklyFlat: station.weeklyPrice.flat,
          weeklyValley: station.weeklyPrice.valley,
          externalPricesJson: JSON.stringify(weeks),
          electricityPricesJson: JSON.stringify(electric),
          servicePricesJson: JSON.stringify(serviceFee),
          competitorsJson: JSON.stringify(station.competitors),
        };
      });
      localStorage.setItem("charging-dashboard-config", JSON.stringify(seeded));
      localStorage.setItem("charging-support-version", version);
      return seeded;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    let live = true;
    fetch("/api/dashboard-state", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("共享配置读取失败");
        return response.json() as Promise<{ configs?: Record<string, StationConfig> }>;
      })
      .then((shared) => {
        if (live && shared.configs && Object.keys(shared.configs).length) {
          setCfg(shared.configs);
          localStorage.setItem("charging-dashboard-config", JSON.stringify(shared.configs));
        }
      })
      .catch((error) => console.warn("暂时使用内置配置", error));
    return () => { live = false; };
  }, []);
  const update = (name: string, key: keyof StationConfig, value: string) =>
    setCfg((prev) => ({
      ...prev,
      [name]: { ...emptyConfig, ...prev[name], [key]: value },
    }));
  const save = async () => {
    localStorage.setItem("charging-dashboard-config", JSON.stringify(cfg));
    const response = await fetch("/api/dashboard-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ configs: cfg }),
    });
    if (!response.ok) throw new Error("保存失败，请检查网络后重试");
    return true;
  };
  return { cfg, update, save };
}
async function parseWeeklyWorkbook(file: File): Promise<S[]> {
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
        serviceRevenue: "K",
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
        service = raw.serviceRevenue || 0,
        rate = num(prev.electricityProfitPerKwh),
        profit = service + charge * rate,
        record: R = {
          week: nextWeek,
          charge,
          chargeChange: num(prev.charge) ? charge / num(prev.charge) - 1 : null,
          serviceRevenue: service,
          serviceChange: num(prev.serviceRevenue)
            ? service / num(prev.serviceRevenue) - 1
            : null,
          servicePerKwh: charge ? service / charge : null,
          electricityProfitPerKwh: charge ? rate : null,
          profit,
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
  const weekByCol = new Map<string, string>();
  Object.entries(rows.get(1) || {}).forEach(([col, text]) => {
      const clean = text.replace(/\s/g, ""),
        match = clean.match(/^(?:(\d{4})年)?(\d{1,2})月(?:第)?(\d+)周$/);
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
  rows.forEach((row, start) => {
    if (
      row.A &&
      row.B === "总览" &&
      !removedStations.has(
        row.A.replace(/\s*[（(]售电[）)]\s*/g, "")
          .replace(/\n/g, " ")
          .trim(),
      )
    ) {
      const name = row.A.replace(/\s*[（(]售电[）)]\s*/g, "")
        .replace(/\n/g, " ")
        .trim();
      result.push({
        name,
        records: cols.map((col, i) => ({
          week: weeks[i],
          peak: value(start, col),
          high: value(start + 2, col),
          flat: value(start + 4, col),
          valley: value(start + 6, col),
          charge: value(start + 8, col),
          chargeChange: value(start + 9, col),
          serviceRevenue: value(start + 18, col),
          serviceChange: value(start + 19, col),
          servicePerKwh: value(start + 20, col),
          electricityProfitPerKwh: value(start + 21, col),
          profit: value(start + 22, col),
        })),
      });
    }
  });
  if (result.length < 1) throw new Error("没有识别到场站数据");
  return result;
}
export default function Home() {
  const [view, setView] = useState<View>("overview"),
    [wi, setWi] = useState(baseStations[0]?.records.length - 1 || 0),
    [sn, setSn] = useState("全部场站"),
    [stationData, setStationData] = useState<S[]>(baseStations),
    [exporting, setExporting] = useState(false),
    [admin, setAdmin] = useState(false),
    [loading, setLoading] = useState(true);
  stations = stationData;
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const session = await fetch("/api/access", { cache: "no-store" });
        const access = (await session.json()) as { role: string | null };
        if (live) setAdmin(access.role === "operator");
        const stateResponse = await fetch("/api/dashboard-state", { cache: "no-store" });
        const shared = stateResponse.ok
          ? await stateResponse.json() as { stationData?: S[] }
          : {};
        if (live && shared.stationData?.length) {
          setStationData(shared.stationData);
          setWi(Math.max(0, shared.stationData[0].records.length - 1));
        }
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
  const applyImport = async (parsed: S[], week: string) => {
    const importedByName = new Map(parsed.map((station) => [station.name, station]));
    const currentByName = new Map(stationData.map((station) => [station.name, station]));
    const names = [...new Set([...currentByName.keys(), ...importedByName.keys()])];
    const merged = names.map((name) => {
      const current = currentByName.get(name);
      const imported = importedByName.get(name);
      const incoming = imported?.records.find((record) => record.week === week)
        ?? imported?.records.at(-1);
      const records = [...(current?.records ?? [])];
      if (incoming) {
        const index = records.findIndex((record) => record.week === week);
        const nextRecord = { ...incoming, week };
        if (index >= 0) records[index] = nextRecord;
        else records.push(nextRecord);
      }
      return { name, records };
    }).filter((station) => station.records.length);
    const response = await fetch("/api/dashboard-state", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stationData: merged }),
    });
    if (!response.ok) throw new Error("线上数据保存失败，请重试");
    setStationData(merged);
    setWi(Math.max(0, merged[0]?.records.length - 1));
    return merged.length;
  };
  const logout = async () => {
    await fetch("/api/access/logout", { method: "POST" });
    window.location.href = "/access";
  };
  const visibleNav = admin ? nav : nav.filter((x) => x.id !== "config");
  if (loading) {
    return (
      <main className="min-h-screen bg-[#061c16] text-[#b6d0c6] flex items-center justify-center">
        <div className="text-center"><RefreshCw className="mx-auto mb-3 animate-spin text-[#35d7a5]" /><p>正在读取四九周报数据…</p></div>
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
            <strong>四九周报</strong>
            <small>{admin ? "运营管理端" : "只读汇报端"}</small>
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
          数据已同步<small>更新至 {allWeeks().at(-1)}</small>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{nav.find((x) => x.id === view)?.label}</h1>
            <p>{admin ? "四九周报 · 运营管理端" : "四九周报 · 只读汇报端"} · 2025年11月至最新一周</p>
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
        {view !== "config" && (
          <Filters wi={wi} setWi={setWi} sn={sn} setSn={setSn} />
        )}{" "}
        {view === "overview" && <Overview wi={wi} sn={sn} />}{" "}
        {view === "station" && (
          <StationAnalysis wi={wi} sn={sn} setSn={setSn} />
        )}{" "}
        {view === "business" && <Business wi={wi} sn={sn} />}{" "}
        {view === "trend" && <TrendInsights sn={sn} />}{" "}
        {view === "config" && admin && <Config onImport={applyImport} />}{" "}
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
      (a, s) => a + num(s.records[i][key] as number | null),
      0,
    ),
  }));
}
function totals(sn: string, wi: number) {
  const ss = scope(sn),
    cur = ss.map((s) => s.records[wi]),
    prev = ss.map((s) => s.records[Math.max(0, wi - 1)]),
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
    selected = scope(sn).map((s) => ({ station: s, record: s.records[wi] })),
    sumMix = (index: number) =>
      scope(sn).reduce(
        (a, s) => ({
          peak: a.peak + num(s.records[index]?.peak),
          high: a.high + num(s.records[index]?.high),
          flat: a.flat + num(s.records[index]?.flat),
          valley: a.valley + num(s.records[index]?.valley),
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
      <WeeklySummary wi={wi} sn={sn} totalsData={t} />
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
}: {
  wi: number;
  sn: string;
  totalsData: ReturnType<typeof totals>;
}) {
  const attention = scope(sn)
    .map((station) => ({ station, record: station.records[wi] }))
    .filter((item) => item.record && num(item.record.chargeChange) < 0)
    .sort((a, b) => num(a.record.chargeChange) - num(b.record.chargeChange))
    .slice(0, 3);
  const status =
    num(totalsData.cc) < -0.05 || num(totalsData.pc) < -0.05
      ? "需关注"
      : num(totalsData.cc) > 0.05 && num(totalsData.pc) > 0
        ? "表现良好"
        : "整体平稳";
  const positive = scope(sn)
    .map((station) => ({ station, record: station.records[wi] }))
    .filter((item) => item.record && num(item.record.chargeChange) > 0)
    .sort((a, b) => num(b.record.chargeChange) - num(a.record.chargeChange))
    .slice(0, 2);
  const summaryText = `全场充电量${pct(totalsData.cc)}，服务费收入${pct(totalsData.rc)}，经营利润${pct(totalsData.pc)}。${positive.length ? `增长较快：${positive.map((x) => x.station.name.replace("充电站", "")).join("、")}；` : ""}${attention.length ? `重点关注：${attention.map((x) => x.station.name.replace("充电站", "")).join("、")}。` : "暂无明显下降站点。"}`;
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
          (a, s) => a + num(s.records[i]?.[key] as number | null),
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
          const fallback = (support.stations as Record<string, { guns?: string }>)[station.name]?.guns;
          return total + Number(configs[station.name]?.guns || fallback || 0);
        }, 0);
        const charge = selectedStations.reduce(
          (total, station) => total + num(station.records[i]?.charge),
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
    profitParts = periods.map(([key, label, color]) => ({
      name: label,
      color,
      data: aggregate(
        allWeeks().map((week, i) => ({
          week,
          value: scope(sn).reduce((a, s) => {
            const r = s.records[i];
            return (
              a +
              (num(r?.charge)
                ? (num(r?.profit) * num(r?.[key])) / num(r?.charge)
                : 0)
            );
          }, 0),
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
    totalMix = Object.values(currentMix).reduce((a, b) => a + b, 0) || 1,
    prevTotal = Object.values(previousMix).reduce((a, b) => a + b, 0) || 1,
    currentProfit = totals(sn, wi).profit,
    previousProfit = totals(sn, Math.max(0, wi - 1)).profit,
    profitMix = {
      peak: (currentProfit * currentMix.peak) / totalMix,
      high: (currentProfit * currentMix.high) / totalMix,
      flat: (currentProfit * currentMix.flat) / totalMix,
      valley: (currentProfit * currentMix.valley) / totalMix,
    },
    prevProfitMix = {
      peak: (previousProfit * previousMix.peak) / prevTotal,
      high: (previousProfit * previousMix.high) / prevTotal,
      flat: (previousProfit * previousMix.flat) / prevTotal,
      valley: (previousProfit * previousMix.valley) / prevTotal,
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
}: {
  wi: number;
  sn: string;
  setSn: (v: string) => void;
}) {
  const chosen =
      sn === "全部场站" ? stations[0] : stations.find((s) => s.name === sn)!,
    r = chosen.records[wi],
    { cfg, update, save } = useConfigs(),
    c = { ...emptyConfig, ...cfg[chosen.name] },
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
          <span className="eyebrow">单站经营画像</span>
          <h2>{chosen.name}</h2>
          {editing ? (
            <div className="inline-edit">
              <input
                value={c.location}
                onChange={(e) =>
                  update(chosen.name, "location", e.target.value)
                }
                placeholder="填写站场位置"
              />
              <input
                value={c.customers}
                onChange={(e) =>
                  update(chosen.name, "customers", e.target.value)
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
        <div className="config-actions">
          {editing && (
            <button className="ghost" onClick={() => setEditing(false)}>
              取消
            </button>
          )}
          <button onClick={() => (editing ? doSave() : setEditing(true))}>
            {saved ? "已保存 ✓" : editing ? "保存" : "编辑资料"}
          </button>
        </div>
      </div>
      <div className="context-strip">
        {editing ? (
          <>
            <label>
              近期天气
              <input
                value={c.weather}
                onChange={(e) => update(chosen.name, "weather", e.target.value)}
                placeholder="如：连续降雨、气温下降"
              />
            </label>
            <label>
              特殊事件
              <input
                value={c.event}
                onChange={(e) => update(chosen.name, "event", e.target.value)}
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
      </div>
      <div className="kpi-grid">
        <Kpi
          icon={<BatteryCharging />}
          label="本周充电量"
          value={`${qty(num(r.charge))} kWh`}
          change={r.chargeChange}
        />
        <Kpi
          icon={<CircleDollarSign />}
          label="每度服务费利润"
          value={`¥${num(r.servicePerKwh).toFixed(3)}`}
          sub="服务费利润 / kWh"
        />
        <Kpi
          icon={<Zap />}
          label="每度电费利润"
          value={`¥${num(r.electricityProfitPerKwh).toFixed(3)}`}
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
            <strong>{money(num(r.profit))}</strong>
          </div>
          <div className="kpi-foot">
            <small>重点指标 · 经营利润口径</small>
          </div>
        </article>
      </div>
      <div className="content-grid equal">
        <Panel title="单站充电量趋势" sub="按周统计，悬停查看准确电量">
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
        <Panel title="单站经营利润趋势" sub="服务费利润与电费利润汇总">
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
      <StationHistoryTable station={chosen} />
    </>
  );
}
function Business({ sn }: { wi: number; sn: string }) {
  const latest = allWeeks().length - 1,
    { cfg, update, save } = useConfigs(),
    [editingStation, setEditingStation] = useState<string | null>(null),
    [savedStation, setSavedStation] = useState<string | null>(null),
    rows = scope(sn)
      .map((s) => ({ station: s, record: s.records[latest] }))
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
      value = (cfg[name] || emptyConfig).analysis,
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
      (a, b) => num(b.records[latest]?.charge) - num(a.records[latest]?.charge),
    ),
    growth = [...stations]
      .filter((s) => num(s.records[latest]?.chargeChange) >= 0)
      .sort(
        (a, b) =>
          num(b.records[latest]?.chargeChange) -
          num(a.records[latest]?.chargeChange),
      ),
    decline = [...stations]
      .filter((s) => num(s.records[latest]?.chargeChange) < 0)
      .sort(
        (a, b) =>
          num(a.records[latest]?.chargeChange) -
          num(b.records[latest]?.chargeChange),
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
          (sum, station) => sum + num(station.records[index]?.charge),
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
            .map((s) => ({ station: s, record: s.records[latest] }))
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
    latest = station.records.at(-1)!,
    doSave = async () => {
      await save();
      setEditing(false);
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
          <button className="ghost" onClick={() => setEditing((v) => !v)}>
            {editing ? "取消编辑" : "编辑价格"}
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
  const ownE =
    safeJson<Record<string, PeriodPrice>>(cfg.electricityPricesJson, {})[latestWeek] ||
    safeJson<Record<string, PeriodPrice>>(cfg.electricityPricesJson, {})[shortWeek(latestWeek)] ||
    blankPrice();
  const ownS =
    safeJson<Record<string, PeriodPrice>>(cfg.servicePricesJson, {})[latestWeek] ||
    safeJson<Record<string, PeriodPrice>>(cfg.servicePricesJson, {})[shortWeek(latestWeek)] ||
    blankPrice();
  const ownT: PeriodPrice = {
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
  const price = (value: string | number | undefined) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0
      ? "¥" + n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
      : "—";
  };
  const composite = (p: PeriodPrice) => {
    const values = keys
      .map((k) => Number(p[k]))
      .filter((v) => Number.isFinite(v) && v > 0);
    return values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : 0;
  };
  const distanceValue = (value: string) => {
    const n = Number((value || "").match(/[\d.]+/)?.[0]);
    return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
  };
  const ownAverage = composite(ownT);
  const rows = competitors
    .map((c, index) => {
      const total = c.total || {
          peak: c.peak,
          high: c.high,
          flat: c.flat,
          valley: c.valley,
        },
        average = composite(total),
        diff = average - ownAverage;
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
  const competitorAverage = rows.length
    ? rows.reduce((sum, row) => sum + row.average, 0) / rows.length
    : 0;
  const rankValues = [ownAverage, ...rows.map((row) => row.average)]
    .filter((v) => v > 0)
    .sort((a, b) => a - b);
  const ranking =
    ownAverage > 0 ? rankValues.findIndex((v) => v === ownAverage) + 1 : 0;
  const lowestRow = [...rows]
    .filter((row) => row.average > 0)
    .sort((a, b) => a.average - b.average)[0];
  const nearestRow = [...rows]
    .filter((row) => Number.isFinite(row.distance))
    .sort((a, b) => a.distance - b.distance)[0];
  const advantage = competitorAverage - ownAverage;
  const competition =
    advantage > 0.05 ? "较强" : advantage < -0.03 ? "较弱" : "接近";
  const sorted = [...rows]
    .filter((row) => !threatOnly || row.diff < -0.03)
    .sort((a, b) =>
      sortBy === "distance"
        ? a.distance - b.distance
        : sortBy === "low"
          ? a.average - b.average
          : sortBy === "high"
            ? b.average - a.average
            : Math.abs(b.diff) - Math.abs(a.diff),
    );
  const judgment = (diff: number) =>
    diff > 0.03
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
              [key]: String(
                Number(value || 0) +
                  Number(
                    (group === "electricity" ? c.service : c.electricity)?.[
                      key
                    ] || 0,
                  ),
              ),
            },
            [key]: String(
              Number(value || 0) +
                Number(
                  (group === "electricity" ? c.service : c.electricity)?.[
                    key
                  ] || 0,
                ),
            ),
          }
        : c,
    );
    update(station.name, "competitorsJson", JSON.stringify(next));
  };
  const PriceRows = ({
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
                price(p[k])
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
            {ranking || "—"}/{rows.length + 1}
          </b>
        </div>
        <div>
          <span>{advantage >= 0 ? "低于" : "高于"}周边均价</span>
          <b>{price(Math.abs(advantage))}/kWh</b>
        </div>
        <div>
          <span>最低价竞站</span>
          <b>{lowestRow?.c.name || "—"}</b>
        </div>
        <div>
          <span>最近竞站</span>
          <b>{nearestRow?.c.name || "—"}</b>
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
      </div>
      <div className="competitor-table">
        <div className="competitor-table-head">
          <span>站点名称</span>
          <span>距离</span>
          {keys.map((k) => (
            <span key={k}>{labels[k]}</span>
          ))}
          <span>与本站差价</span>
          <span>价格判断</span>
          <span>详情</span>
        </div>
        <div className="competitor-row own-row">
          <b>本站 · {station.name}</b>
          <span>本站</span>
          {keys.map((k) => (
            <span key={k}>{price(ownT[k])}</span>
          ))}
          <span>—</span>
          <em>本站</em>
          <span>—</span>
        </div>
        {sorted.map(({ c, index, total, diff }) => {
          const state = judgment(diff),
            isLowest = lowestRow?.index === index,
            isOpen = expanded.includes(index);
          return (
            <div className={"competitor-entry " + state.cls} key={index}>
              <div className="competitor-row">
                <b>
                  {c.name}
                  {isLowest && <small className="lowest-tag">最低价</small>}
                </b>
                <span>{c.distance || "—"}</span>
                {keys.map((k) => (
                  <span key={k}>{price(total[k])}</span>
                ))}
                <span className={state.cls}>
                  {diff >= 0 ? "+" : "-"}
                  {price(Math.abs(diff))}/kWh
                </span>
                <em className={state.cls}>{state.label}</em>
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
              </div>
              {isOpen && (
                <PriceRows
                  e={c.electricity || blankPrice()}
                  s={c.service || blankPrice()}
                  t={total}
                  editableIndex={index}
                />
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
    allOwnPrices = safeJson<Record<string, PeriodPrice>>(cfg.externalPricesJson, {}),
    own = allOwnPrices[latestWeek] || allOwnPrices[shortWeek(latestWeek)] || {
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
      ? "先核查停枪与导航曝光，并对最近的低价竞站做7天小幅调价测试。"
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
function Config({ onImport }: { onImport: (stations: S[], week: string) => Promise<number> }) {
  const [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState(false),
    [savingImport, setSavingImport] = useState(false),
    [preview, setPreview] = useState<{
      parsed: S[];
      week: string;
      exists: boolean;
    } | null>(null),
    [month, setMonth] = useState("8"),
    [priceStation, setPriceStation] = useState(stations[0]?.name || ""),
    [priceWeek, setPriceWeek] = useState(allWeeks().at(-1) || ""),
    { cfg, update, save } = useConfigs(),
    monthly = { ...emptyConfig, ...cfg.__monthly__ },
    list = stations.filter((s) => s.name.includes(search)),
    storedCosts = safeJson<Record<string, Record<string, PeriodPrice>>>(
      monthly.monthlyCostsJson,
      {},
    ),
    costs = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => {
        const m = String(i + 1);
        return [m, { ...DEFAULT_COSTS[m], ...storedCosts[m] }];
      }),
    ) as Record<string, Record<string, PeriodPrice>>,
    gridFees = {
      ...DEFAULT_GRID_FEES,
      ...safeJson<Record<string, string>>(monthly.gridFeesJson, {}),
    },
    stationCfg = { ...emptyConfig, ...cfg[priceStation] },
    external = safeJson<Record<string, PeriodPrice>>(
      stationCfg.externalPricesJson,
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
    setCost = (type: string, key: keyof PeriodPrice, value: string) =>
      update(
        "__monthly__",
        "monthlyCostsJson",
        JSON.stringify({
          ...storedCosts,
          [month]: {
            ...costs[month],
            [type]: { ...blankPrice(), ...costs[month]?.[type], [key]: value },
          },
        }),
      ),
    setGridFee = (value: string) =>
      update(
        "__monthly__",
        "gridFeesJson",
        JSON.stringify({ ...gridFees, [month]: value }),
      ),
    setExternal = (key: keyof PeriodPrice, value: string) =>
      update(
        priceStation,
        "externalPricesJson",
        JSON.stringify({
          ...external,
          [priceWeek]: {
            ...blankPrice(),
            ...external[priceWeek],
            [key]: value,
          },
        }),
      ),
    doSave = async () => {
      setStatus("保存中…");
      try {
        await save();
        setEditing(false);
        setStatus("配置已保存，看板端刷新后同步更新");
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "保存失败");
      }
    },
    importFile = async (file?: File) => {
      if (!file) return;
      setStatus("正在读取并分析…");
      try {
        const parsed = await parseWeeklyWorkbook(file);
        const week = parsed[0]?.records.at(-1)?.week;
        if (!week) throw new Error("没有识别到有效周次");
        const exists = stations.some((station) => station.records.some((record) => record.week === week));
        setPreview({ parsed, week, exists });
        setStatus(`已识别 ${week} · ${parsed.length} 个场站，请核对后确认`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "导入失败");
      }
    },
    confirmImport = async () => {
      if (!preview) return;
      setSavingImport(true);
      setStatus("正在写入数据库…");
      try {
        const count = await onImport(preview.parsed, preview.week);
        setPreview(null);
        setStatus(`更新成功：${preview.week} · ${count} 个场站`);
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
    salePrice = external[priceWeek] || blankPrice(),
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
        : null;
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
            onClick={() => setEditing((v) => !v)}
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
        <button
          onClick={() =>
            setStatus("竞站数据：请在趋势洞察中选择单站后点击“编辑价格”维护")
          }
        >
          竞站数据
        </button>
      </nav>
      {preview && (
        <div className="cost-panel import-preview" id="weekly-data">
          <div className="section-head">
            <div>
              <h3>导入预览 · {preview.week}</h3>
              <p>
                识别场站 {preview.parsed.length} 个
                {preview.exists && " · 该周已存在，确认后仅更新本周"}
              </p>
            </div>
            <div className="config-actions">
              <button className="ghost" onClick={() => setPreview(null)}>
                取消
              </button>
              <button
                className="save-button"
                onClick={confirmImport}
                disabled={savingImport || preview.parsed.length !== 18}
              >
                {savingImport
                  ? "更新中…"
                  : preview.exists
                    ? "更新本周"
                    : "确认更新"}
              </button>
            </div>
          </div>
          {preview.parsed.length !== 18 && (
            <div className="import-warning">
              ⚠ 应识别18个场站，当前为{preview.parsed.length}个，暂不可确认。
            </div>
          )}
          <div className="table-scroll import-preview-table">
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>场站名称</th>
                  <th>充电量</th>
                  <th>服务费收入</th>
                  <th>经营利润</th>
                </tr>
              </thead>
              <tbody>
                {preview.parsed.map((station) => {
                  const row = station.records.find(
                    (record) => record.week === preview.week,
                  );
                  return (
                    <tr key={station.name}>
                      <td>{row ? "✓ 正常" : "⚠ 未识别"}</td>
                      <td>{station.name}</td>
                      <td>{qty(num(row?.charge))}</td>
                      <td>{money(num(row?.serviceRevenue))}</td>
                      <td>{money(num(row?.profit))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="cost-panel matrix-panel" id="price-cost">
        <div className="section-head">
          <div>
            <h3>1–12月电费成本</h3>
            <p>大工业电价与售电价按月匹配；一口价在下方按场站单独设置。</p>
          </div>
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}月
              </option>
            ))}
          </select>
        </div>
        <div className="price-matrix">
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
      </div>
      <div className="cost-panel matrix-panel">
        <div className="section-head">
          <div>
            <h3>每周、每站对外电费</h3>
            <p>
              每个场站每周可使用不同尖峰平谷价格；导入后按站名和周次自动匹配。
            </p>
          </div>
          <div className="inline-selects">
            <select
              value={priceStation}
              onChange={(e) => setPriceStation(e.target.value)}
            >
              {stations.map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
            </select>
            <select
              value={priceWeek}
              onChange={(e) => setPriceWeek(e.target.value)}
            >
              {allWeeks().map((w) => (
                <option key={w}>{w}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="weekly-grid">
          {periods.map(([key, label]) => (
            <label key={key}>
              {label}对外电费
              <input
                disabled={!editing}
                value={external[priceWeek]?.[key] || ""}
                onChange={(e) => setExternal(key, e.target.value)}
                placeholder="元/kWh"
              />
            </label>
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
          <span>{list.length} 个场站</span>
        </div>
        <div className="table-scroll config-table">
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
            onBlur={save}
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
function StationHistoryTable({ station }: { station: S }) {
  return (
    <Panel
      title="单站完整历史数据"
      sub="2025年11月至今；每周均显示上周值与环比，表格可横向滚动"
      extra="ranking station-history-panel"
    >
      <div className="table-scroll history-table">
        <table>
          <thead>
            <tr>
              <th>周次</th>
              <th>充电量 / 上周 / 环比</th>
              <th>尖段 / 环比</th>
              <th>峰段 / 环比</th>
              <th>平段 / 环比</th>
              <th>谷段 / 环比</th>
              <th>服务费收入 / 环比</th>
              <th>经营利润 / 环比</th>
            </tr>
          </thead>
          <tbody>
            {station.records.map((r, i) => {
              const p = station.records[Math.max(0, i - 1)],
                metric = (key: keyof R) => (
                  <>
                    <b>{qty(num(r[key] as number))}</b>
                    <small>上周 {i ? qty(num(p[key] as number)) : "—"}</small>
                    <em
                      className={
                        i && num(p[key] as number)
                          ? num(r[key] as number) >= num(p[key] as number)
                            ? "up"
                            : "down"
                          : ""
                      }
                    >
                      {i && num(p[key] as number)
                        ? pct(num(r[key] as number) / num(p[key] as number) - 1)
                        : "—"}
                    </em>
                  </>
                );
              return (
                <tr key={r.week}>
                  <td>{r.week}</td>
                  <td>{metric("charge")}</td>
                  <td>{metric("peak")}</td>
                  <td>{metric("high")}</td>
                  <td>{metric("flat")}</td>
                  <td>{metric("valley")}</td>
                  <td>{metric("serviceRevenue")}</td>
                  <td>{metric("profit")}</td>
                </tr>
              );
            })}
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
