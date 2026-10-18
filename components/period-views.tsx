"use client";

import { useEffect, useMemo, useState } from "react";
import { calendarMonthRange, classifyDayOperatingMetrics, sundaySaturdayRange, type ChargingMode } from "@/lib/charging-mode";
import { loadModeData, modeOperatingMetrics, type StationProfile } from "@/lib/mode-data";
import { calculateCalendarDay } from "@/lib/calendar-metrics";
import { displayedModeMetric, sumAvailableMetrics, type StoredWeeklyResult } from "@/lib/weekly-display";
import stationCatalog from "@/data/station-catalog-20261018.json";

type Data = Awaited<ReturnType<typeof loadModeData>>;
type View = "overview" | "station" | "business" | "trend";
type Props = { view:View; week:string; station:string; selectedMode:"all"|ChargingMode; periodType:"week"|"month"; reportingNames:string[]; stationTotals:Record<string,number|null>; stationRecords:Record<string,StoredWeeklyResult|undefined> };
type Row = { name:string; profile:StationProfile; charge:number|null; peak:number|null; high:number|null; flat:number|null; valley:number|null; electricity:number|null; service:number|null; profit:number|null; unknown:number|null; days:number };
const keys=["peak","high","flat","valley"] as const;
const label=(x:number|null,unit="")=>x==null?"待导入真实数据":`${x.toLocaleString("zh-CN",{maximumFractionDigits:2})}${unit}`;
const modeLabel=(value:number|null,charge:number|null,mode:Props["selectedMode"],unit="")=>value==null && mode!=="all"?(charge==null?"该模式暂无记录":"金额待核算"):label(value,unit);
const sum=(values:(number|null)[])=>values.length && values.every((x)=>x!=null)?values.reduce<number>((acc,x)=>acc+Number(x),0):null;
const iso=(date:Date)=>date.toISOString().slice(0,10);
function rangeFor(week:string,periodType:Props["periodType"]){
  const match=week.match(/^(\d{4})年(\d{1,2})月/);
  if(!match) throw new Error("统计周期无效");
  return periodType==="month"?calendarMonthRange(Number(match[1]),Number(match[2])):sundaySaturdayRange(week);
}
function previousRange(start:string,periodType:Props["periodType"]){
  const date=new Date(start+"T00:00:00Z");
  if(periodType==="month") return date.getUTCMonth()===0
    ? calendarMonthRange(date.getUTCFullYear()-1,12)
    : calendarMonthRange(date.getUTCFullYear(),date.getUTCMonth());
  date.setUTCDate(date.getUTCDate()-7);
  const first=iso(date);date.setUTCDate(date.getUTCDate()+6);
  return {start:first,end:iso(date)};
}
function buildRows(data:Data,range:{start:string;end:string},names:Set<string>,mode:Props["selectedMode"],stationTotals:Props["stationTotals"],weekly:boolean,stationRecords:Props["stationRecords"]):Row[]{
  const known=new Map(data.profiles.map((profile)=>[profile.station_name,profile]));
  const catalog=new Map(stationCatalog.map((item)=>[item.name,item]));
  return [...names].map((name):StationProfile=>{
    const item=catalog.get(name);
    return known.get(name)||{station_name:name,operator_name:item?.operator||null,address:item?.address||null,
      region:item?.region||null,guns:item?.guns??null,fast_guns:item?.fastGuns??null,slow_guns:item?.slowGuns??null,
      power_kw:item?.powerKw??null,fast_power_kw:item?.fastPowerKw??null,slow_power_kw:item?.slowPowerKw??null,
      operation_status:item?.status||null};
  }).map((profile)=>{
    const facts=data.facts.filter((f)=>f.stationName===profile.station_name && f.date>=range.start && f.date<=range.end && (mode==="all" || f.mode===mode));
    const isFullMonth=range.start.endsWith("-01") && calendarMonthRange(Number(range.start.slice(0,4)),Number(range.start.slice(5,7))).end===range.end;
    const daily=data.calendar.filter((r)=>r.station_name===profile.station_name && r.granularity==="day" && r.period_start>=range.start && r.period_start<=range.end);
    const monthly=isFullMonth && !daily.length?data.calendar.filter((r)=>r.station_name===profile.station_name && r.granularity==="month" && r.period_start===range.start):[];
    const totals=mode==="all"?(daily.length?daily:monthly):[];
    const classifiedCharge=totals.length?totals.reduce((acc,r)=>acc+Number(r.total_kwh),0):facts.length?sum(facts.map((f)=>f.charge)):null;
    const legacy=weekly?stationRecords[profile.station_name]:undefined;
    const charge=mode==="all"&&weekly&&legacy?.charge!=null?Number(legacy.charge):classifiedCharge;
    const amounts=Object.fromEntries(keys.map((key)=>[key,totals.length?sum(totals.map((r)=>r[`${key}_kwh`])):facts.length?sum(facts.map((f)=>f[key])):null])) as Record<typeof keys[number],number|null>;
    const calculated=facts.map((f)=>modeOperatingMetrics(f,data,profile));
    const classified=calculated.length?sum(facts.map((f)=>f.charge)):null;
    const financiallyComplete=mode!=="all" || (charge!=null && classified!=null && Math.abs(charge-classified)<=0.02);
    const calendarMetrics=mode==="all" && daily.length?daily.map((row)=>{
      const splitRule=data.tariffs.some((rule)=>rule.station_name===profile.station_name && rule.charging_mode!=="all" && rule.effective_from<=row.period_start && (!rule.effective_until || rule.effective_until>=row.period_start));
      return splitRule?{electricityRevenue:null,serviceRevenue:null,profit:null}:calculateCalendarDay(row,data.configs[profile.station_name]||{},data.configs.__monthly__||{});
    }):[];
    const results=calendarMetrics.length?calendarMetrics:financiallyComplete?calculated:[];
    const electricity=displayedModeMetric(mode,weekly?"week":"month",legacy,results.length?sum(results.map((x)=>x.electricityRevenue)):null,"electricityRevenue");
    const service=displayedModeMetric(mode,weekly?"week":"month",legacy,results.length?sum(results.map((x)=>x.serviceRevenue)):null,"serviceRevenue");
    const profit=displayedModeMetric(mode,weekly?"week":"month",legacy,results.length?sum(results.map((x)=>x.profit)):null,"profit");
    const stationTotal=mode==="all"?charge:weekly?stationTotals[profile.station_name]:null;
    const diff=stationTotal==null || charge==null?null:stationTotal-charge;
    return {name:profile.station_name,profile,charge,...amounts,electricity,service,profit,
      unknown:mode==="all" && diff!=null && diff>=-0.02?Math.max(0,diff):null,
      days:totals.length?daily.length:new Set(facts.map((f)=>f.date)).size};
  });
}
function metric(rows:Row[],key:"charge"|"electricity"|"service"|"profit"|typeof keys[number]){
  const values=rows.map((r)=>r[key]);
  if(key==="charge" || keys.includes(key as typeof keys[number])) {
    const available=values.filter((x):x is number=>x!=null);
    return available.length?available.reduce((acc,x)=>acc+x,0):null;
  }
  return sumAvailableMetrics(values).value;
}
export default function PeriodViews({view,week,station,selectedMode,periodType,reportingNames,stationTotals,stationRecords}:Props){
  const current=useMemo(()=>rangeFor(week,periodType),[week,periodType]);
  const prior=useMemo(()=>previousRange(current.start,periodType),[current.start,periodType]);
  const trendRanges=useMemo(()=>{
    const result=[current];
    while(result.length<6) result.unshift(previousRange(result[0].start,periodType));
    return result;
  },[current,periodType]);
  const [data,setData]=useState<Data|null>(null);
  const [error,setError]=useState("");
  const [sort,setSort]=useState<"charge"|"profit"|"name">("charge");
  useEffect(()=>{
    let live=true;
    setData(null);setError("");
    // Only the trend chart needs six periods; other views use this and the previous period.
    const firstDate=view==="trend"?trendRanges[0].start:prior.start;
    void loadModeData(firstDate,current.end).then((result)=>{if(live)setData(result);}).catch((reason)=>{if(live)setError(reason instanceof Error?reason.message:"数据读取失败");});
    return ()=>{live=false;};
  },[view,trendRanges,prior.start,current.end]);
  // The dashboard state's station list is already server-scoped to the signed-in account.
  const names=useMemo(()=>new Set(reportingNames.filter((name)=>station==="全部场站" || station===name)),[reportingNames,station]);
  const rows=useMemo(()=>data?buildRows(data,current,names,selectedMode,stationTotals,periodType==="week",stationRecords):[],[data,current,names,selectedMode,stationTotals,periodType,stationRecords]);
  const before=useMemo(()=>data?buildRows(data,prior,names,selectedMode,stationTotals,false,stationRecords):[],[data,prior,names,selectedMode,stationTotals,stationRecords]);
  const trend=useMemo(()=>data?trendRanges.map((range)=>({range,charge:metric(buildRows(data,range,names,selectedMode,stationTotals,false,stationRecords),"charge")})):[],[data,trendRanges,names,selectedMode,stationTotals,stationRecords]);
  const totalCharge=metric(rows,"charge"),previousCharge=metric(before,"charge");
  const lastDaily=data?.calendar.filter((r)=>r.granularity==="day" && r.period_start>=current.start && r.period_start<=current.end && names.has(r.station_name)).map((r)=>r.period_start).sort().at(-1);
  const monthOnly=data?.calendar.some((r)=>r.granularity==="month" && r.period_start===current.start && names.has(r.station_name));
  const completeness=periodType==="month" && lastDaily && lastDaily<current.end
    ? ` · 累计数据截至${lastDaily.slice(5).replace("-","月")}日（尚未覆盖月底）`
    : periodType==="month" && monthOnly && !lastDaily?" · 来源：整月汇总":"";
  const change=totalCharge!=null && previousCharge!=null && previousCharge>0?(totalCharge/previousCharge-1)*100:null;
  const sorted=[...rows].sort((a,b)=>sort==="name"?a.name.localeCompare(b.name,"zh-CN"):Number(b[sort]??-Infinity)-Number(a[sort]??-Infinity));
  const title={overview:"运营总览",station:"场站分析",business:"经营分析",trend:"趋势洞察"}[view];
  const rangeText=`${current.start}—${current.end}`;
  const metricLabel=(key:"charge"|"service"|"profit"|"electricity",unit="")=>modeLabel(metric(rows,key),totalCharge,selectedMode,unit);
  const dataNote=selectedMode==="all"?"月度按自然月真实日级总量汇总；仅有整月汇总的月份只用于月度，绝不拆为周度。未分类电量保留在场站总量中。":"仅统计已录入的实际快慢充分类记录；该模式无记录不表示站点没有经营。";
  return <div className="mode-page period-view">
    <div className="page-heading"><div><span className="eyebrow">{periodType==="month"?"自然月":"周日～周六"} · {selectedMode==="all"?"全部":selectedMode==="fast"?"快充":"慢充"}</span><h2>{title}</h2><p>{rangeText} · {rows.length}个授权场站{completeness}</p></div></div>
    {error?<p className="empty-note">{error}</p>:!data?<p className="empty-note">正在读取统计数据…</p>:<>
      <div className="mode-kpis">
        <div><span>{selectedMode==="all"?"总充电量":"实际分类电量"}</span><strong>{metricLabel("charge"," kWh")}</strong><small>有记录 {rows.filter((r)=>r.charge!=null).length} / {rows.length} 站</small></div>
        <div><span>服务费收入{rows.some((r)=>r.service==null)?"（可核算小计）":""}</span><strong>{metricLabel("service"," 元")}</strong><small>可计算 {rows.filter((r)=>r.service!=null).length} / {rows.length} 站</small></div>
        <div><span>经营毛利{rows.some((r)=>r.profit==null)?"（可核算小计）":""}</span><strong>{metricLabel("profit"," 元")}</strong><small>可计算 {rows.filter((r)=>r.profit!=null).length} / {rows.length} 站</small></div>
        <div><span>{periodType==="month"?"自然月环比":"周环比"}</span><strong>{change==null?"待两期完整数据":`${change>=0?"+":""}${change.toFixed(1)}%`}</strong></div>
      </div>
      {view==="overview"&&<><section className="mode-panel"><h3>尖峰平谷电量</h3><div className="mode-kpis">{keys.map((key)=><div key={key}><span>{{peak:"尖",high:"峰",flat:"平",valley:"谷"}[key]}</span><strong>{label(metric(rows,key)," kWh")}</strong></div>)}</div></section><details className="mode-panel overview-stations"><summary>场站概览 <span>展开查看全部 {sorted.length} 站</span></summary><StationTable rows={sorted} mode={selectedMode}/></details></>}
      {view==="station"&&<details className="mode-panel data-disclosure"><summary>场站经营明细 <span>展开查看 {sorted.length} 站</span></summary><div className="mode-table-head"><Sort sort={sort} setSort={setSort}/></div><StationTable rows={sorted} mode={selectedMode}/></details>}
      {view==="business"&&<><div className="mode-kpis"><div><span>售电收入</span><strong>{metricLabel("electricity"," 元")}</strong></div><div><span>经营收入</span><strong>{label(sum([metric(rows,"electricity"),metric(rows,"service")])," 元")}</strong></div><div><span>毛利率</span><strong>{(()=>{const income=sum([metric(rows,"electricity"),metric(rows,"service")]),profit=metric(rows,"profit");return income && profit!=null?`${(profit/income*100).toFixed(1)}%`:"待导入真实数据";})()}</strong></div><div><span>已记录场站</span><strong>{rows.filter((r)=>r.charge!=null).length} / {rows.length}</strong></div></div><details className="mode-panel data-disclosure"><summary>分站经营对比 <span>展开查看 {sorted.length} 站</span></summary><StationTable rows={sorted} mode={selectedMode}/></details></>}
      {view==="trend"&&<section className="mode-panel"><h3>六期充电量趋势</h3><div className="period-trend">{trend.map(({range,charge})=><div key={range.start}><span>{range.start.slice(5)}</span><div className="mode-bar"><i style={{width:charge==null?"0%":`${Math.max(2,charge/Math.max(...trend.map((x)=>x.charge||0),1)*100)}%`}} /></div><b>{label(charge," kWh")}</b></div>)}</div><p>趋势只采用真实日期的分类数据；缺失日期不插值。上期毛利 {label(metric(before,"profit")," 元")}。</p></section>}
      <details className="period-data-note"><summary>数据口径与缺失说明</summary><p>{dataNote} 收入、毛利仅显示可核算站点的小计及覆盖数，缺失数据不按零值处理。</p></details>
    </>}
  </div>;
}
function Sort({sort,setSort}:{sort:"charge"|"profit"|"name";setSort:(value:"charge"|"profit"|"name")=>void}){
  return <select value={sort} onChange={(e)=>setSort(e.target.value as typeof sort)}><option value="charge">按电量</option><option value="profit">按毛利</option><option value="name">按站名</option></select>;
}
function StationTable({rows,mode}:{rows:Row[];mode:Props["selectedMode"]}){
  return <div className="mode-table-wrap"><table><thead><tr><th>场站</th><th>电量 kWh</th><th>尖/峰/平/谷 kWh</th><th>售电收入</th><th>服务费</th><th>毛利</th><th>覆盖日期</th></tr></thead><tbody>{rows.map((r)=><tr key={r.name}><td><b>{r.name}</b><small>{r.profile.operator_name}</small></td><td>{modeLabel(r.charge,r.charge,mode)}</td><td>{keys.map((key)=>r[key]==null?"—":label(r[key])).join(" / ")}</td><td>{modeLabel(r.electricity,r.charge,mode)}</td><td>{modeLabel(r.service,r.charge,mode)}</td><td>{modeLabel(r.profit,r.charge,mode)}</td><td>{r.days||"暂无记录"}</td></tr>)}</tbody></table></div>;
}
