import { useEffect, useState } from "react";
import { dashboardClient } from "@/lib/dashboard-browser";

type Mode = "all" | "fast" | "slow";
type Metrics = {
  repeat: number | null;
  returning: number | null;
  energy: number | null;
  coverage: number | null;
  orders: number;
  members: number;
};

type RepeatData = { stations: string[]; scopes: Record<string, { stations: string[]; modes: Record<Mode, Record<string, Metrics>> }> };
const definitions = [
  ["repeat", "会员复购率", "周内至少充电两次的可识别会员数 ÷ 本周可识别充电会员数"],
  ["returning", "跨周留存率", "上周充电且本周再次充电的可识别会员数 ÷ 上周可识别充电会员数"],
  ["energy", "复购会员电量贡献率", "周内复购会员的充电电量 ÷ 同范围全部有效订单电量"],
] as const;

const percent = (value: number | null | undefined) => value == null ? "暂无数据" : `${(value * 100).toFixed(2)}%`;

export function MemberRepeatAnalysis({ week, previousWeek, operator, station, allowedNames }: {
  week: string;
  previousWeek?: string;
  operator: string;
  station: string;
  allowedNames: string[];
}) {
  const [mode, setMode] = useState<Mode>("all");
  const [data, setData] = useState<RepeatData | null>(null);
  useEffect(() => {
    let active = true;
    void dashboardClient.from("dashboard_state").select("value")
      .eq("key", "member_repeat_published").maybeSingle().then(({ data, error }) => {
        if (active && !error) setData(data?.value as RepeatData ?? null);
      });
    return () => { active = false; };
  }, []);
  const scope = data?.scopes[station === "全部场站" ? operator : station];
  const relevant = new Set(allowedNames.filter((name) => data?.stations.includes(name)));
  const permitted = scope && (station === "全部场站"
    ? scope.stations.length === relevant.size && scope.stations.every((name) => relevant.has(name))
    : relevant.has(station));
  const current = permitted ? scope.modes[mode][week] : undefined;
  const previous = permitted && previousWeek ? scope.modes[mode][previousWeek] : undefined;

  return <details className="member-repeat-card kpi">
    <summary><span>会员复购 <strong>{percent(current?.repeat)}</strong></span><small>展开查看留存与电量贡献 ▾</small></summary>
    <div className="member-repeat-detail">
    <div className="member-repeat-mode" role="group" aria-label="充电模式"><span>充电模式</span>{([ ["all", "全部"], ["fast", "快充"], ["slow", "慢充"] ] as const).map(([value, label]) =>
      <button key={value} type="button" className={mode === value ? "active" : ""} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</button>)}</div>
    <div className="member-repeat-metrics">{definitions.map(([key, label, formula]) => {
        const now = current?.[key], before = previous?.[key];
        const delta = now == null || before == null ? null : (now - before) * 100;
        return <div key={key} title={formula}><span>{label}</span><strong>{percent(now)}</strong><small>上周 {percent(before)} · 环比 {delta == null ? "暂无数据" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)} 个百分点`}</small></div>;
      })}</div>
    {current?.orders ? <p className="empty-note">有效订单 {current.orders.toLocaleString()} 笔 · 可识别会员 {current.members.toLocaleString()} 人 · 手机号覆盖率 {percent(current.coverage)}</p> : null}</div>
  </details>;
}
