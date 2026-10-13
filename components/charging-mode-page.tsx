"use client";

import { useEffect, useMemo, useState } from "react";
import { calendarMonthRange, classifyDayOperatingMetrics, reconcileModes, summarizeMode, sundaySaturdayRange, type ChargingMode } from "@/lib/charging-mode";
import { loadModeData, type StationProfile } from "@/lib/mode-data";

type Fact = Awaited<ReturnType<typeof loadModeData>>["facts"][number];
type Props = {
  week: string; station: string; operator?: string;
  selectedMode: "all" | ChargingMode;
  periodType: "week" | "month";
  stationTotals: Record<string, number | null>;
};
const number = (value: number | null, suffix = "") => value == null ? "待导入分类数据" : `${value.toLocaleString("zh-CN",{maximumFractionDigits:2})}${suffix}`;

export default function ChargingModePage({week,station,operator,selectedMode,periodType,stationTotals}:Props) {
  const [data,setData]=useState<Awaited<ReturnType<typeof loadModeData>>>({profiles:[],facts:[],calendar:[],tariffs:[],configs:{}});
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [sort,setSort]=useState<"station" | "charge" | "guns">("station");
  const m=week.match(/^(\d{4})年(\d{1,2})月/);
  const range=periodType==="month" && m
    ? calendarMonthRange(Number(m[1]),Number(m[2]))
    : sundaySaturdayRange(week);
  const periodDays=Math.round((Date.parse(range.end+"T00:00:00Z")-Date.parse(range.start+"T00:00:00Z"))/86400000)+1;
  useEffect(()=>{
    let active=true;
    setLoading(true);
    void loadModeData(range.start,range.end).then((result)=>{
      if(active){setData(result);setError("");setLoading(false);}
    }).catch((reason)=>{
      if(active){setError(reason instanceof Error ? reason.message : "分类数据读取失败");setLoading(false);}
    });
    return ()=>{active=false;};
  },[range.start,range.end]);
  const profiles=useMemo(()=>data.profiles.filter((x)=>
    (station==="全部场站" || x.station_name===station) && (!operator || operator==="全部运营商" || x.operator_name===operator)
  ),[data.profiles,station,operator]);
  const rows=profiles.map((profile)=>{
    const facts=data.facts.filter((x)=>x.stationName===profile.station_name);
    const fast=summarizeMode(facts,range.start,range.end,"fast");
    const slow=summarizeMode(facts,range.start,range.end,"slow");
    const daily=data.calendar.filter((x)=>x.station_name===profile.station_name && x.granularity==="day" && x.period_start>=range.start && x.period_start<=range.end);
    const month=data.calendar.find((x)=>x.station_name===profile.station_name && x.granularity==="month" && x.period_start===range.start);
    const actualTotal=daily.length?daily.reduce((acc,x)=>acc+Number(x.total_kwh),0):periodType==="month" && month?Number(month.total_kwh):periodType==="week"?stationTotals[profile.station_name]??null:null;
    const coverage=reconcileModes(actualTotal,fast,slow);
    const metrics=(mode:ChargingMode)=>{
      const matching=facts.filter((x)=>x.mode===mode);
      if (!matching.length) return {electricityRevenue:null,serviceRevenue:null,profit:null};
      const calculated=matching.map((fact)=>classifyDayOperatingMetrics(fact,data.tariffs,data.configs[profile.station_name] || {},data.configs.__monthly__ || {}));
      const sum=(key:"electricityRevenue" | "serviceRevenue" | "profit")=>calculated.every((x)=>x[key]!=null)
        ? calculated.reduce((acc,x)=>acc+Number(x[key]),0) : null;
      return {electricityRevenue:sum("electricityRevenue"),serviceRevenue:sum("serviceRevenue"),profit:sum("profit")};
    };
    const efficiency=(mode:ChargingMode)=>{
      const summary=mode==="fast"?fast:slow;
      const guns=Number(mode==="fast"?profile.fast_guns:profile.slow_guns);
      const power=Number(mode==="fast"?profile.fast_power_kw:profile.slow_power_kw);
      if (summary.charge==null || summary.days!==periodDays || !guns || !power) return {daily:null,utilization:null};
      return {daily:summary.charge/guns/periodDays,utilization:summary.charge/power/24/periodDays*100};
    };
    return {profile,fast,slow,coverage,fastMetrics:metrics("fast"),slowMetrics:metrics("slow"),fastEfficiency:efficiency("fast"),slowEfficiency:efficiency("slow")};
  }).sort((a,b)=>sort==="station" ? a.profile.station_name.localeCompare(b.profile.station_name,"zh-CN")
    : sort==="guns" ? Number(b.profile.guns || 0)-Number(a.profile.guns || 0)
    : Number(b.fast.charge || 0)+Number(b.slow.charge || 0)-Number(a.fast.charge || 0)-Number(a.slow.charge || 0));
  const totals=rows.reduce((acc,row)=>({
    guns:acc.guns+Number(row.profile.guns || 0),fastGuns:acc.fastGuns+Number(row.profile.fast_guns || 0),
    slowGuns:acc.slowGuns+Number(row.profile.slow_guns || 0),
    fastPower:acc.fastPower+Number(row.profile.fast_power_kw || 0),
    slowPower:acc.slowPower+Number(row.profile.slow_power_kw || 0),
    fast:acc.fast+(row.fast.charge || 0),slow:acc.slow+(row.slow.charge || 0),
    hasFast:acc.hasFast || row.fast.charge!=null,hasSlow:acc.hasSlow || row.slow.charge!=null,
    unknown:acc.unknown+(row.coverage.unclassified || 0),knownTotals:acc.knownTotals+(row.coverage.unclassified==null?0:1),excess:acc.excess+row.coverage.excess,
  }),{guns:0,fastGuns:0,slowGuns:0,fastPower:0,slowPower:0,fast:0,slow:0,hasFast:false,hasSlow:false,unknown:0,knownTotals:0,excess:0});
  const shownGuns=selectedMode==="fast" ? totals.fastGuns : selectedMode==="slow" ? totals.slowGuns : totals.guns;
  const metricSum=(mode:"fast" | "slow",key:"electricityRevenue"|"serviceRevenue"|"profit")=>{
    const selected=rows.filter((row)=>(mode==="fast"?row.fast:row.slow).charge!=null);
    if (!selected.length || selected.some((row)=>(mode==="fast"?row.fastMetrics:row.slowMetrics)[key]==null)) return null;
    return selected.reduce((sum,row)=>sum+Number((mode==="fast"?row.fastMetrics:row.slowMetrics)[key]),0);
  };
  const selectedMetric=(key:"electricityRevenue"|"serviceRevenue"|"profit")=>{
    if(selectedMode!=="all") return metricSum(selectedMode,key);
    const relevant=(["fast","slow"] as const).filter((mode)=>mode==="fast"?totals.hasFast:totals.hasSlow);
    return relevant.length && relevant.every((mode)=>metricSum(mode,key)!=null)
      ? relevant.reduce((sum,mode)=>sum+Number(metricSum(mode,key)),0) : null;
  };
  const classified=selectedMode==="fast" ? (totals.hasFast ? totals.fast : null)
    : selectedMode==="slow" ? (totals.hasSlow ? totals.slow : null)
    : totals.hasFast || totals.hasSlow ? totals.fast+totals.slow : null;
  return <div className="mode-page">
    <div className="page-heading"><div><span className="eyebrow">实际充电类型</span><h2>充电模式</h2>
      <p>{range.start}—{range.end} · {periodType==="month" ? "自然月" : "周日～周六"} · {rows.length}个授权场站</p></div></div>
    {loading ? <p className="empty-note">正在读取分类数据…</p> : error ? <p className="empty-note">{error}</p> : <>
      <div className="mode-kpis">
        <div><span>充电枪数</span><strong>{shownGuns}</strong><small>快充 {totals.fastGuns} · 慢充 {totals.slowGuns}</small></div>
        <div><span>设备功率</span><strong>{selectedMode==="fast" ? totals.fastPower : selectedMode==="slow" ? totals.slowPower : totals.fastPower+totals.slowPower} kW</strong><small>快充 {totals.fastPower} · 慢充 {totals.slowPower}</small></div>
        <div><span>分类充电量</span><strong>{number(classified," kWh")}</strong><small>快充 {number(totals.hasFast ? totals.fast : null)} · 慢充 {number(totals.hasSlow ? totals.slow : null)}</small></div>
        <div><span>未分类 / 异常</span><strong>{number(totals.knownTotals?totals.unknown:null," kWh")}</strong><small>{totals.excess>0 ? `分类电量超过站点总量 ${number(totals.excess)} kWh` : `可核对总量 ${totals.knownTotals}/${rows.length} 站；历史总量不会强制归类`}</small></div>
      </div>
      <p className="empty-note">分类日期覆盖：仅当所选周期每天均有明确分类记录时展示单枪日均和利用率。场站总量来自原周报或自然月真实日期；缺少对应总量时不推算未分类电量。</p>
      <div className="mode-kpis">
        <div><span>售电收入</span><strong>{number(selectedMetric("electricityRevenue")," 元")}</strong></div>
        <div><span>服务费收入</span><strong>{number(selectedMetric("serviceRevenue")," 元")}</strong></div>
        <div><span>经营毛利</span><strong>{number(selectedMetric("profit")," 元")}</strong></div>
        <div><span>毛利率</span><strong>{selectedMetric("profit")!=null && selectedMetric("electricityRevenue")!=null && selectedMetric("serviceRevenue")!=null && Number(selectedMetric("electricityRevenue"))+Number(selectedMetric("serviceRevenue"))>0 ? ((Number(selectedMetric("profit"))/(Number(selectedMetric("electricityRevenue"))+Number(selectedMetric("serviceRevenue"))))*100).toFixed(1)+"%" : "待导入分类数据"}</strong></div>
      </div>
      <section className="mode-panel">
        <h3>快慢充经营与效率</h3>
        <p>金额仅在实际分类分时数据、对应价格版本与购电成本齐备时计算。同一时段内存在多种价格时须导入时间明细；利用率还需核实设备级额定功率。</p>
        <div className="mode-compare">
          {(["fast","slow"] as const).filter((x)=>selectedMode==="all" || selectedMode===x).map((x)=>{
            const val=x==="fast" ? totals.fast : totals.slow;
            const has=x==="fast" ? totals.hasFast : totals.hasSlow;
            const ratio=(totals.fast+totals.slow)>0 ? val/(totals.fast+totals.slow)*100 : null;
            return <div key={x}><b>{x==="fast"?"快充":"慢充"}</b><strong>{number(has ? val : null," kWh")}</strong><span>设备 {x==="fast" ? totals.fastGuns : totals.slowGuns} 枪 · 分类占比 {ratio==null ? "待导入" : ratio.toFixed(1)+"%"}</span>
              <div className="mode-bar"><i style={{width:`${ratio || 0}%`}} /></div><small>售电 {number(metricSum(x,"electricityRevenue")," 元")} · 服务费 {number(metricSum(x,"serviceRevenue")," 元")} · 毛利 {number(metricSum(x,"profit")," 元")}</small></div>;
          })}
        </div>
      </section>
      <section className="mode-panel"><div className="mode-table-head"><h3>场站经营明细</h3>
        <select value={sort} onChange={(e)=>setSort(e.target.value as typeof sort)}><option value="station">按站名</option><option value="guns">按枪数</option><option value="charge">按分类电量</option></select></div>
        <div className="mode-table-wrap"><table><thead><tr><th>场站</th><th>快/慢枪</th><th>快/慢功率 kW</th><th>快充电量</th><th>慢充电量</th><th>未分类</th><th>收入 / 毛利 / 利用率</th></tr></thead>
          <tbody>{rows.map(({profile,fast,slow,coverage,fastMetrics,slowMetrics,fastEfficiency,slowEfficiency})=><tr key={profile.station_name}>
            <td><b>{profile.station_name}</b><small>{profile.operator_name} · {profile.region}</small></td>
            <td>{profile.fast_guns ?? "—"} / {profile.slow_guns ?? "—"}</td>
            <td>{profile.fast_power_kw ?? "—"} / {profile.slow_power_kw ?? "—"}</td>
            <td>{number(fast.charge)}</td><td>{number(slow.charge)}</td>
            <td>{coverage.excess ? "分类大于总量" : coverage.unclassified==null ? "暂无总量" : number(coverage.unclassified)}</td>
            <td>快充毛利 {number(fastMetrics.profit)} · 慢充毛利 {number(slowMetrics.profit)}；快/慢利用率 {fastEfficiency.utilization==null?"待完整日数据":fastEfficiency.utilization.toFixed(1)+"%"} / {slowEfficiency.utilization==null?"待完整日数据":slowEfficiency.utilization.toFixed(1)+"%"}</td>
          </tr>)}</tbody></table></div>
      </section>
    </>}
  </div>;
}
