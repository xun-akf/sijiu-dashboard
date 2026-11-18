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
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
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
    <div className="member-repeat-detail"><p className="empty-note">按充电开始时间归周（周日至周六），统计已完成且电量大于 0 的订单。使用完整手机号识别会员。</p>
    <div className="member-repeat-mode-picker" onKeyDown={(event) => { if (event.key === "Escape") setModeMenuOpen(false); }}>
      <span>充电模式</span><button type="button" aria-label="选择充电模式" aria-expanded={modeMenuOpen} aria-haspopup="listbox" onClick={() => setModeMenuOpen(!modeMenuOpen)}>
        {mode === "all" ? "全部" : mode === "fast" ? "快充" : "慢充"}<span aria-hidden="true">⌄</span>
      </button>
      {modeMenuOpen && <div className="member-repeat-mode-menu" role="listbox" aria-label="充电模式">
        {([ ["all", "全部"], ["fast", "快充"], ["slow", "慢充"] ] as const).map(([value, label]) =>
          <button key={value} type="button" role="option" aria-selected={mode === value} onClick={() => { setMode(value); setModeMenuOpen(false); }}>{label}</button>)}
      </div>}
    </div>
    <table style={{ width: "100%", textAlign: "left", marginBlock: "0.75rem" }}>
      <thead><tr><th>指标</th><th>本周</th><th>上周</th><th>环比</th></tr></thead>
      <tbody>{definitions.map(([key, label, formula]) => {
        const now = current?.[key], before = previous?.[key];
        const delta = now == null || before == null ? null : (now - before) * 100;
        return <tr key={key}><th scope="row" title={formula}>{label}</th><td>{percent(now)}</td><td>{percent(before)}</td>
          <td>{delta == null ? "暂无数据" : `${delta > 0 ? "+" : ""}${delta.toFixed(2)} 个百分点`}</td></tr>;
      })}</tbody>
    </table>
    {current?.orders ? <p className="empty-note">本周有效订单 {current.orders.toLocaleString()} 笔 · 可识别会员 {current.members.toLocaleString()} 人 · 手机号覆盖率 {percent(current.coverage)}</p> : null}</div>
  </details>;
}
