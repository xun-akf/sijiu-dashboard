"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Info } from "lucide-react";
import { calendarMonthRange, modeFactsInRange, reconcileModes, summarizeMode, sundaySaturdayRange, type ChargingMode } from "@/lib/charging-mode";
import { loadModeData, modeOperatingMetrics, type StationProfile } from "@/lib/mode-data";
import { calculateCalendarDay } from "@/lib/calendar-metrics";
import { missingMetricConfigs } from "@/lib/operating-metrics";
import { modeKeys, scopedModeSummary, selectModeNumber, type ModeScope } from "@/lib/mode-view";
import { displayedModeMetric, sumAvailableMetrics, type StoredWeeklyResult } from "@/lib/weekly-display";
import stationCatalog from "@/data/station-catalog-20261018.json";

type Props = { week:string; station:string; operator?:string; selectedMode:ModeScope; periodType:"week"|"month"; reportingNames:string[]; stationTotals:Record<string,number|null>; stationRecords:Record<string,StoredWeeklyResult|undefined>; previousStationRecords:Record<string,StoredWeeklyResult|undefined> };
type MoneyKey = "electricityRevenue"|"serviceRevenue"|"profit";
const fmt=(value:number|null,suffix="")=>value==null?"待导入分类数据":`${value.toLocaleString("zh-CN",{maximumFractionDigits:2})}${suffix}`;
const modeName=(mode:ChargingMode)=>mode==="fast"?"快充":"慢充";
// Week 2 source reports retain their recorded station totals. These small
// known differences from the time-of-use sums were reviewed separately.
const acknowledgedWeek2TouDifferences:Record<string,{charge:number;difference:number}>={
  "麦电-佛山创雄华府充电站":{charge:1428.586,difference:0.45},
  "雅悦蓝天酒店慢充站（地下室负二）":{charge:427.069,difference:0.07},
  "蔚景云希尔顿欢朋酒店充电站":{charge:627.408,difference:0.6},
};

export default function ChargingModePage({week,station,selectedMode,periodType,reportingNames,stationTotals,stationRecords,previousStationRecords}:Props) {
  const [data,setData]=useState<Awaited<ReturnType<typeof loadModeData>>>({profiles:[],facts:[],calendar:[],tariffs:[],configs:{},fastUnallocated:undefined});
  const [loading,setLoading]=useState(true),[error,setError]=useState("");
  const [sort,setSort]=useState<"station"|"charge"|"profit"|"utilization">("charge");
  const [query,setQuery]=useState(""),[onlyAttention,setOnlyAttention]=useState(false),[expanded,setExpanded]=useState<string|null>(null);
  const match=week.match(/^(\d{4})年(\d{1,2})月/);
  const range=periodType==="month"&&match?calendarMonthRange(Number(match[1]),Number(match[2])):sundaySaturdayRange(week);
  const priorEnd=new Date(Date.parse(range.start+"T00:00:00Z")-86400000);
  const priorRange=periodType==="month"?calendarMonthRange(priorEnd.getUTCFullYear(),priorEnd.getUTCMonth()+1):{start:new Date(priorEnd.getTime()-6*86400000).toISOString().slice(0,10),end:priorEnd.toISOString().slice(0,10)};
  const priorDays=Math.round((Date.parse(priorRange.end+"T00:00:00Z")-Date.parse(priorRange.start+"T00:00:00Z"))/86400000)+1;
  const periodDays=Math.round((Date.parse(range.end+"T00:00:00Z")-Date.parse(range.start+"T00:00:00Z"))/86400000)+1;
  useEffect(()=>{let active=true;setLoading(true);void loadModeData(priorRange.start,range.end).then(result=>{if(active){setData(result);setError("");setLoading(false);}}).catch(reason=>{if(active){setError(reason instanceof Error?reason.message:"分类数据读取失败");setLoading(false);}});return()=>{active=false;};},[priorRange.start,range.end]);

  const rows=useMemo(()=>{
    const known=new Map(data.profiles.map((profile)=>[profile.station_name,profile]));
    const catalog=new Map(stationCatalog.map((item)=>[item.name,item]));
    const profiles=Object.keys(stationRecords).map((name):StationProfile=>{
      const item=catalog.get(name);
      return known.get(name)||{station_name:name,operator_name:item?.operator||null,address:item?.address||null,
        region:item?.region||null,guns:item?.guns??null,fast_guns:item?.fastGuns??null,slow_guns:item?.slowGuns??null,
        power_kw:item?.powerKw??null,fast_power_kw:item?.fastPowerKw??null,slow_power_kw:item?.slowPowerKw??null,
        operation_status:item?.status||null};
    });
    return profiles.filter(profile=>reportingNames.includes(profile.station_name)&&(station==="全部场站"||profile.station_name===station)&&(selectedMode==="all"||Number(selectedMode==="fast"?profile.fast_guns:profile.slow_guns)>0)).map(profile=>{
    const facts=data.facts.filter(fact=>fact.stationName===profile.station_name);
    const priorFast=summarizeMode(facts,priorRange.start,priorRange.end,"fast"),priorSlow=summarizeMode(facts,priorRange.start,priorRange.end,"slow");
    const daily=data.calendar.filter(item=>item.station_name===profile.station_name&&item.granularity==="day"&&item.period_start>=range.start&&item.period_start<=range.end);
    const month=data.calendar.find(item=>item.station_name===profile.station_name&&item.granularity==="month"&&item.period_start===range.start);
    const priorDaily=data.calendar.filter(item=>item.station_name===profile.station_name&&item.granularity==="day"&&item.period_start>=priorRange.start&&item.period_start<=priorRange.end);
    const priorMonth=data.calendar.find(item=>item.station_name===profile.station_name&&item.granularity==="month"&&item.period_start===priorRange.start);
    const actualTotal=daily.length?daily.reduce((sum,item)=>sum+Number(item.total_kwh),0):periodType==="month"&&month?Number(month.total_kwh):periodType==="week"?stationTotals[profile.station_name]??null:null;
    const legacy=stationRecords[profile.station_name];
    const fastGuns=Number(profile.fast_guns||0),slowGuns=Number(profile.slow_guns||0);
    const soleMode=fastGuns>0&&slowGuns===0?"fast":slowGuns>0&&fastGuns===0?"slow":null;
    const conflictingFact=facts.some(fact=>fact.date>=range.start&&fact.date<=range.end&&fact.mode!==soleMode);
    const inferredMode=periodType==="week"&&actualTotal!=null&&soleMode&&!conflictingFact?soleMode:null;
    const weeklySummary={charge:actualTotal,peak:legacy?.peak??null,high:legacy?.high??null,flat:legacy?.flat??null,valley:legacy?.valley??null,orders:null,days:periodDays,rows:1};
    const fastBase=inferredMode==="fast"?weeklySummary:summarizeMode(facts,range.start,range.end,"fast");
    const adjustment=data.fastUnallocated;
    const fastExtra=adjustment?.stationName===profile.station_name&&adjustment.weekStart>=range.start&&adjustment.weekEnd<=range.end?adjustment.charge:0;
    const slow=inferredMode==="slow"?weeklySummary:summarizeMode(facts,range.start,range.end,"slow");
    const reconciledTou=periodType==="week"&&fastExtra>0&&adjustment?.weekStart===range.start&&adjustment.weekEnd===range.end&&actualTotal!=null&&slow.charge!=null
      ? (['peak','high','flat','valley'] as const).map(key=>legacy?.[key]!=null&&slow[key]!=null?Number(legacy[key])-Number(slow[key]):null) : [];
    const reconciledCharge=actualTotal!=null&&slow.charge!=null?actualTotal-slow.charge:null;
    const fastReconciledFact=reconciledTou.length===4&&reconciledTou.every(value=>value!=null&&value>=-0.001)&&reconciledCharge!=null
      && Math.abs(reconciledTou.reduce<number>((sum,value)=>sum+Number(value),0)-reconciledCharge)<0.02
      ? {stationName:profile.station_name,date:range.end,mode:"fast" as const,deviceId:null,peak:Math.max(0,Number(reconciledTou[0])),high:Math.max(0,Number(reconciledTou[1])),flat:Math.max(0,Number(reconciledTou[2])),valley:Math.max(0,Number(reconciledTou[3])),charge:reconciledCharge,orders:null} : null;
    const fast=fastReconciledFact?{...fastBase,charge:fastReconciledFact.charge,peak:fastReconciledFact.peak,high:fastReconciledFact.high,flat:fastReconciledFact.flat,valley:fastReconciledFact.valley}
      :fastExtra>0&&fastBase.charge!=null?{...fastBase,charge:fastBase.charge+fastExtra}:fastBase;
    const coverage=reconcileModes(actualTotal,fast,slow);
    const metrics=(mode:ChargingMode)=>{
      const matching=modeFactsInRange(facts,mode,range.start,range.end);
      if(mode==="fast"&&fastReconciledFact)return modeOperatingMetrics(fastReconciledFact,data,profile);
      if(inferredMode===mode)return {electricityRevenue:legacy?.electricityRevenue??null,serviceRevenue:legacy?.serviceRevenue??null,profit:legacy?.profit??null};
      if(!matching.length||mode==="fast"&&fastExtra>0)return {electricityRevenue:null,serviceRevenue:null,profit:null};
      const calculated=matching.map(fact=>modeOperatingMetrics(fact,data,profile));
      const sum=(key:MoneyKey)=>calculated.every(item=>item[key]!=null)?calculated.reduce((total,item)=>total+Number(item[key]),0):null;
      return {electricityRevenue:sum("electricityRevenue"),serviceRevenue:sum("serviceRevenue"),profit:sum("profit")};
    };
    const priorFacts=facts.filter(fact=>fact.date>=priorRange.start&&fact.date<=priorRange.end);
    const priorMetric=(mode:ChargingMode,key:MoneyKey)=>{
      const matching=priorFacts.filter(fact=>fact.mode===mode);
      if(!matching.length)return null;
      const values=matching.map(fact=>modeOperatingMetrics(fact,data,profile)[key]);
      return values.every(value=>value!=null)?values.reduce<number>((sum,value)=>sum+Number(value),0):null;
    };
    const efficiency=(mode:ChargingMode)=>{
      const summary=mode==="fast"?fast:slow,guns=Number(mode==="fast"?profile.fast_guns:profile.slow_guns),power=Number(mode==="fast"?profile.fast_power_kw:profile.slow_power_kw);
      if(summary.charge==null||summary.days!==periodDays||!guns||!power)return {daily:null,utilization:null};
      return {daily:summary.charge/guns/periodDays,utilization:summary.charge/power/24/periodDays*100};
    };
    const fastMetrics=metrics("fast"),slowMetrics=metrics("slow"),fastEfficiency=efficiency("fast"),slowEfficiency=efficiency("slow");
    const classifiedCharge=scopedModeSummary(selectedMode,{value:fast.charge||0,available:fast.charge!=null},{value:slow.charge||0,available:slow.charge!=null}).value;
    const selectedCharge=selectedMode==="all"?actualTotal:classifiedCharge;
    const priorTotal=periodType==="week"?previousStationRecords[profile.station_name]?.charge??null:priorDaily.length===priorDays?priorDaily.reduce((sum,item)=>sum+Number(item.total_kwh),0):priorMonth?Number(priorMonth.total_kwh):null;
    const priorClassified=scopedModeSummary(selectedMode,{value:priorFast.charge||0,available:priorFast.charge!=null},{value:priorSlow.charge||0,available:priorSlow.charge!=null}).value;
    const previousCharge=selectedMode==="all"?priorTotal:priorClassified;
    const priorServiceClassified=scopedModeSummary(selectedMode,{value:priorMetric("fast","serviceRevenue")||0,available:priorMetric("fast","serviceRevenue")!=null},{value:priorMetric("slow","serviceRevenue")||0,available:priorMetric("slow","serviceRevenue")!=null}).value;
    const priorCalendar=selectedMode==="all"&&periodType==="month"&&priorDaily.length?priorDaily.map(item=>calculateCalendarDay(item,data.configs[profile.station_name]||{},data.configs.__monthly__||{})):[];
    const previousService=selectedMode!=="all"?priorServiceClassified:periodType==="week"?previousStationRecords[profile.station_name]?.serviceRevenue??null:priorCalendar.length===priorDays&&priorCalendar.every(item=>item.serviceRevenue!=null)?priorCalendar.reduce((sum,item)=>sum+Number(item.serviceRevenue),0):null;
    const classifiedMetric=(key:MoneyKey)=>scopedModeSummary(selectedMode,{value:fastMetrics[key]||0,available:fastMetrics[key]!=null},{value:slowMetrics[key]||0,available:slowMetrics[key]!=null}).value;
    const calendarResults=selectedMode==="all"&&periodType==="month"&&daily.length?daily.map(item=>calculateCalendarDay(item,data.configs[profile.station_name]||{},data.configs.__monthly__||{})):[];
    const calendarValue=(key:MoneyKey)=>calendarResults.length&&calendarResults.every(item=>item[key]!=null)?calendarResults.reduce((sum,item)=>sum+Number(item[key]),0):null;
    const completeClassification=actualTotal!=null&&classifiedCharge!=null&&Math.abs(actualTotal-classifiedCharge)<=0.02;
    const amount=(key:MoneyKey)=>calendarResults.length?calendarValue(key):selectedMode!=="all"||completeClassification?classifiedMetric(key):null;
    const selectedProfit=displayedModeMetric(selectedMode,periodType,legacy,amount("profit"),"profit");
    const selectedService=displayedModeMetric(selectedMode,periodType,legacy,amount("serviceRevenue"),"serviceRevenue");
    const selectedElectricity=displayedModeMetric(selectedMode,periodType,legacy,amount("electricityRevenue"),"electricityRevenue");
    const selectedUtilization=selectedMode==="fast"?fastEfficiency.utilization:selectedMode==="slow"?slowEfficiency.utilization:null;
    const attention=coverage.excess>0||coverage.unclassified==null||modeKeys(selectedMode).filter(mode=>Number(mode==="fast"?profile.fast_guns:profile.slow_guns)>0).some(mode=>{
      const summary=mode==="fast"?fast:slow,modeMetrics=mode==="fast"?fastMetrics:slowMetrics;
      return summary.charge==null||modeMetrics.profit==null;
    });
    return {profile,fast,slow,fastExtra:fastReconciledFact?0:fastExtra,coverage,fastMetrics,slowMetrics,fastEfficiency,slowEfficiency,selectedCharge,selectedProfit,selectedService,selectedElectricity,selectedUtilization,previousCharge,previousService,attention};
  });},[data,periodDays,periodType,priorDays,priorRange.end,priorRange.start,range.end,range.start,selectedMode,station,stationTotals,stationRecords,previousStationRecords,reportingNames]);

  const totals=rows.reduce((acc,row)=>({fastGuns:acc.fastGuns+Number(row.profile.fast_guns||0),slowGuns:acc.slowGuns+Number(row.profile.slow_guns||0),fastPower:acc.fastPower+Number(row.profile.fast_power_kw||0),slowPower:acc.slowPower+Number(row.profile.slow_power_kw||0),fast:acc.fast+(row.fast.charge||0),slow:acc.slow+(row.slow.charge||0),hasFast:acc.hasFast||row.fast.charge!=null,hasSlow:acc.hasSlow||row.slow.charge!=null,unknown:acc.unknown+(row.coverage.unclassified||0),knownTotals:acc.knownTotals+(row.coverage.unclassified==null?0:1),excess:acc.excess+row.coverage.excess}),{fastGuns:0,slowGuns:0,fastPower:0,slowPower:0,fast:0,slow:0,hasFast:false,hasSlow:false,unknown:0,knownTotals:0,excess:0});
  const metricSum=(mode:ChargingMode,key:MoneyKey)=>{
    const selected=rows.filter(row=>(mode==="fast"?row.fast:row.slow).charge!=null);
    return sumAvailableMetrics(selected.map(row=>(mode==="fast"?row.fastMetrics:row.slowMetrics)[key]));
  };
  const selectedMetric=(key:MoneyKey)=>sumAvailableMetrics(rows.map((row)=>key==="profit"?row.selectedProfit:key==="serviceRevenue"?row.selectedService:row.selectedElectricity));
  const scopedCharge=sumAvailableMetrics(rows.map((row)=>row.selectedCharge)).value;
  const scopedGuns=selectModeNumber(selectedMode,totals.fastGuns,totals.slowGuns),scopedPower=selectModeNumber(selectedMode,totals.fastPower,totals.slowPower);
  const qualified=rows.flatMap(row=>modeKeys(selectedMode).map(mode=>({row,mode,summary:mode==="fast"?row.fast:row.slow,power:Number(mode==="fast"?row.profile.fast_power_kw:row.profile.slow_power_kw)}))).filter(item=>item.row.profile.operation_status==="正常运行"&&item.summary.charge!=null&&item.summary.days===periodDays&&item.power>0);
  const qualifiedPower=qualified.reduce((sum,item)=>sum+item.power,0),qualifiedCharge=qualified.reduce((sum,item)=>sum+Number(item.summary.charge),0);
  const excludedProfiles=Object.keys(stationRecords).filter(name=>!reportingNames.includes(name)&&(station==="全部场站"||station===name)).map(name=>{
    const profile=data.profiles.find(item=>item.station_name===name),catalog=stationCatalog.find(item=>item.name===name);
    return {name,guns:Number(profile?.guns??catalog?.guns??0),power:Number(profile?.power_kw??catalog?.powerKw??0)};
  });
  const excludedGuns=excludedProfiles.reduce((sum,item)=>sum+item.guns,0);
  const excludedPower=excludedProfiles.reduce((sum,item)=>sum+item.power,0);
  const lastRecordedDay=[...data.facts.filter(item=>rows.some(row=>row.profile.station_name===item.stationName)).map(item=>item.date),...data.calendar.filter(item=>item.granularity==="day"&&rows.some(row=>row.profile.station_name===item.station_name)).map(item=>item.period_start)].filter(day=>day>=range.start&&day<=range.end).sort().at(-1);
  const fullMonthOnly=periodType==="month"&&!lastRecordedDay&&data.calendar.some(item=>item.granularity==="month"&&item.period_start===range.start&&rows.some(row=>row.profile.station_name===item.station_name));
  const incompleteMonth=periodType==="month"&&!fullMonthOnly&&(!lastRecordedDay||lastRecordedDay<range.end);
  const serviceCoverage=selectedMetric("serviceRevenue"),electricityCoverage=selectedMetric("electricityRevenue"),profitCoverage=selectedMetric("profit");
  const serviceRevenue=serviceCoverage.value,electricityRevenue=electricityCoverage.value,profit=profitCoverage.value;
  const revenue=electricityRevenue!=null&&serviceRevenue!=null?electricityRevenue+serviceRevenue:null;
  const margin=profit!=null&&revenue!=null&&revenue>0?profit/revenue*100:null;
  const daily=!incompleteMonth&&scopedCharge!=null&&scopedGuns>0?scopedCharge/scopedGuns/periodDays:null;
  const utilization=qualifiedPower>0?qualifiedCharge/qualifiedPower/24/periodDays*100:null;
  const comparison=(current:"selectedCharge"|"selectedService",previous:"previousCharge"|"previousService")=>{
    const comparable=rows.filter(row=>row[current]!=null&&row[previous]!=null&&Number(row[previous])>0);
    if(!comparable.length)return null;
    const now=comparable.reduce((sum,row)=>sum+Number(row[current]),0);
    const before=comparable.reduce((sum,row)=>sum+Number(row[previous]),0);
    return {change:(now/before-1)*100,count:comparable.length};
  };
  const chargeChange=comparison("selectedCharge","previousCharge"),serviceChange=comparison("selectedService","previousService");
  const changeText=(value:ReturnType<typeof comparison>)=>value==null?"环比待核":`环比 ${value.change>=0?"↑":"↓"}${Math.abs(value.change).toFixed(1)}% · ${value.count}站可比`;
  const missing=rows.map(row=>{
    const fields:string[]=[];
    if(row.selectedCharge==null)fields.push(periodType==="month"?"月度日级电量待导入（周报数据已保留）":"电量/分类");
    if(selectedMode==="all"&&periodType==="week"){
      const record=stationRecords[row.profile.station_name];
      const tou=Number(record?.peak||0)+Number(record?.high||0)+Number(record?.flat||0)+Number(record?.valley||0);
      const known=week==="2026年10月2周"?acknowledgedWeek2TouDifferences[row.profile.station_name]:undefined;
      const acknowledged=known&&record?.charge!=null&&Math.abs(record.charge-known.charge)<0.001&&Math.abs(Math.abs(record.charge-tou)-known.difference)<0.001;
      if(record?.charge!=null&&Math.abs(record.charge-tou)>=0.01&&!acknowledged)fields.push("总量与尖峰平谷合计不符");
      else if(row.selectedService==null||row.selectedProfit==null){
        const hasClassifiedMargin=Boolean((record as StoredWeeklyResult & {partialProfit?:number|null}|undefined)?.partialProfit!=null);
        if(!hasClassifiedMargin)fields.push(...missingMetricConfigs(week,data.configs[row.profile.station_name]||{},data.configs.__monthly__||{}));
        if(!fields.length&&!hasClassifiedMargin)fields.push("经营金额待核对");
      }
    }else{
      if(row.selectedService==null)fields.push(periodType==="month"&&row.selectedCharge==null?"月度收入需日级电量":`${selectedMode==="all"?"分时":"对应模式"}服务费待核`);
      if(row.selectedProfit==null)fields.push(periodType==="month"&&row.selectedCharge==null?"月度毛利需日级电量":`${selectedMode==="all"?"分时":"对应模式"}毛利待核`);
    }
    if(row.profile.guns==null)fields.push("枪数");
    if(row.profile.power_kw==null)fields.push("功率");
    if(row.coverage.excess>0)fields.push("分类超出总量");
    return {name:row.profile.station_name,fields};
  }).filter(item=>item.fields.length);
  const attentionCount=rows.filter(row=>row.attention).length;
  const visibleRows=rows.filter(row=>row.profile.station_name.toLowerCase().includes(query.trim().toLowerCase())&&(!onlyAttention||row.attention)).sort((a,b)=>{
    if(sort==="station")return a.profile.station_name.localeCompare(b.profile.station_name,"zh-CN");
    if(sort==="profit")return Number(b.selectedProfit??-Infinity)-Number(a.selectedProfit??-Infinity);
    if(sort==="utilization")return Number(b.selectedUtilization??-Infinity)-Number(a.selectedUtilization??-Infinity);
    return Number(b.selectedCharge??-Infinity)-Number(a.selectedCharge??-Infinity);
  });
  const rowValue=<T,>(mode:ChargingMode,fast:T,slow:T)=>mode==="fast"?fast:slow;

  return <div className="mode-page">
    <p className="mode-period-note">{range.start}—{range.end} · {selectedMode==="all"?"全部模式":modeName(selectedMode)} · {rows.length}站纳入核对{incompleteMonth?` · 月度日级数据截至${lastRecordedDay||"待导入"}，未覆盖站点的周报数据仍保留，非整月`:fullMonthOnly?" · 整月汇总":""}</p>
    {loading?<p className="empty-note">正在读取分类数据…</p>:error?<p className="empty-note">{error}</p>:<>
      <div className="mode-primary-kpis">
        <div><span>充电量 <Info size={12}/></span><strong>{fmt(scopedCharge," kWh")}</strong><small>{changeText(chargeChange)}</small></div>
        <div><span>服务费收入 <Info size={12}/></span><strong>{fmt(serviceRevenue," 元")}</strong><small>{changeText(serviceChange)} · 可核算 {serviceCoverage.available}/{serviceCoverage.total}站</small></div>
        <div className="highlight"><span>经营毛利 <Info size={12}/></span><strong>{fmt(profit," 元")}</strong><small>毛利率 {margin==null?"待核算":`${margin.toFixed(1)}%`} · 可核算 {profitCoverage.available}/{profitCoverage.total}站</small></div>
        <div><span>单枪日均</span><strong>{incompleteMonth?"待完整月数据":fmt(daily," kWh")}</strong><small>枪利用率 {utilization==null?"待完整运营数据":`${utilization.toFixed(1)}%`} · {qualified.length}组完整运营设备</small></div>
        <div><span>枪数</span><strong>{scopedGuns}</strong><small>设备功率 {scopedPower.toLocaleString("zh-CN")} kW</small></div>
      </div>
      <p className="mode-revenue-note">售电收入 {fmt(electricityRevenue," 元")} · 可核算 {electricityCoverage.available}/{electricityCoverage.total}站{serviceCoverage.available<serviceCoverage.total||profitCoverage.available<profitCoverage.total?" · 收入与毛利为有数据站点小计":""}</p>
      {(attentionCount>0||missing.length>0||excludedProfiles.length>0)&&<details className="mode-alert mode-missing"><summary><AlertTriangle size={14}/><b>{missing.length}站待核 · {excludedProfiles.length}站未纳入</b><span>分类、金额和异常明细</span><ChevronDown size={14}/></summary><p>单一设备类型站按档案归类真实周电量；混合站仅按实测分类电量统计。未分类电量不按枪数拆分。分时差异和缺失金额保留待核。</p>{missing.length>0&&<div className="mode-missing-list">{missing.map(item=><div key={item.name}><b>{item.name}</b><span>{item.fields.join("、")}</span></div>)}</div>}{excludedProfiles.length>0&&<div className="mode-missing-list">{excludedProfiles.map(item=><div key={item.name}><b>{item.name}</b><span>本期无周报记录；档案枪数 {item.guns} · 功率 {item.power} kW，暂不参与经营统计</span></div>)}</div>}<p>未纳入档案合计 {excludedGuns} 枪 · {excludedPower} kW；分类异常超量 {fmt(totals.excess," kWh")}。</p></details>}
      {selectedMode==="all"&&<section className="mode-compare-panel"><header><div><h3>快慢充经营对比</h3><p>同一场站只汇总一次，按真实分类电量拆分。</p></div></header><div className="mode-compare-grid">{(["fast","slow"] as const).map(mode=>{
        const charge=mode==="fast"?totals.fast:totals.slow,available=mode==="fast"?totals.hasFast:totals.hasSlow,ratio=totals.fast+totals.slow>0?charge/(totals.fast+totals.slow)*100:null;
        const service=metricSum(mode,"serviceRevenue"),profit=metricSum(mode,"profit");
        return <div className={`mode-compare-row ${mode}`} key={mode}><div><b>{modeName(mode)}</b><span>{mode==="fast"?totals.fastGuns:totals.slowGuns}枪 · {mode==="fast"?totals.fastPower:totals.slowPower} kW</span></div><strong>{fmt(available?charge:null," kWh")}</strong><div className="mode-share"><i style={{width:`${ratio||0}%`}}/></div><em>{ratio==null?"待导入":`${ratio.toFixed(1)}%`}</em><small>服务费 {fmt(service.value," 元")}（{service.available}/{service.total}站） · 毛利 {fmt(profit.value," 元")}（{profit.available}/{profit.total}站）</small></div>;
      })}</div></section>}
      <details className="mode-detail-panel data-disclosure"><summary>场站经营明细 <span>展开查看 {visibleRows.length} 站</span></summary><div className="mode-table-head"><p>当前为{selectedMode==="all"?"全部模式":modeName(selectedMode)}口径</p><div className="mode-table-tools"><input value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索场站"/><label><input type="checkbox" checked={onlyAttention} onChange={event=>setOnlyAttention(event.target.checked)}/>仅看待核</label><select value={sort} onChange={event=>setSort(event.target.value as typeof sort)}><option value="charge">按充电量</option><option value="profit">按毛利</option>{selectedMode!=="all"&&<option value="utilization">按利用率</option>}<option value="station">按站名</option></select></div></div>
        <div className="mode-table-wrap"><table><thead><tr><th>场站</th>{selectedMode==="all"?<><th>快/慢枪数</th><th>快充电量</th><th>慢充电量</th></>:<><th>{modeName(selectedMode)}枪数</th><th>充电量</th></>}<th>服务费收入</th><th>经营毛利</th><th>{selectedMode==="all"?"状态":"利用率"}</th><th></th></tr></thead><tbody>
          {visibleRows.map(row=>{
            const keys=modeKeys(selectedMode),detailOpen=expanded===row.profile.station_name;
            return <Fragment key={row.profile.station_name}><tr className={row.attention?"needs-attention":""}><td><b>{row.profile.station_name}</b><small>{row.profile.operator_name} · {row.profile.region}</small></td>{selectedMode==="all"?<><td>快 {row.profile.fast_guns||0} · 慢 {row.profile.slow_guns||0}</td><td>{fmt(row.fast.charge)}</td><td>{fmt(row.slow.charge)}</td></>:<><td>{rowValue(selectedMode,row.profile.fast_guns,row.profile.slow_guns)||0}</td><td>{fmt(row.selectedCharge)}</td></>}<td>{fmt(row.selectedService)}</td><td>{fmt(row.selectedProfit)}</td><td>{selectedMode==="all"?(row.selectedProfit!=null?(row.attention?"经营已核·分类待核":"完整"):"金额待核算"):row.selectedUtilization==null?"待完整日数据":`${row.selectedUtilization.toFixed(1)}%`}</td><td><button aria-expanded={detailOpen} onClick={()=>setExpanded(detailOpen?null:row.profile.station_name)}>详情 <ChevronDown size={13}/></button></td></tr>
              {detailOpen&&<tr className="mode-expanded"><td colSpan={selectedMode==="all"?9:7}><div><section><b>场站信息</b><span>{row.profile.address||"地址待补充"}</span><span>运营状态：{row.profile.operation_status||"待补充"}</span></section>{keys.map(mode=>{
                const summary=mode==="fast"?row.fast:row.slow,metrics=mode==="fast"?row.fastMetrics:row.slowMetrics,efficiency=mode==="fast"?row.fastEfficiency:row.slowEfficiency;
                return <section key={mode}><b>{modeName(mode)}经营详情</b><span>功率 {rowValue(mode,row.profile.fast_power_kw,row.profile.slow_power_kw)||0} kW · 单枪日均 {fmt(efficiency.daily," kWh")}</span><span>尖/峰/平/谷：{fmt(summary.peak)} / {fmt(summary.high)} / {fmt(summary.flat)} / {fmt(summary.valley)}</span><span>售电收入 {fmt(metrics.electricityRevenue," 元")} · 服务费 {fmt(metrics.serviceRevenue," 元")}</span></section>;
              })}<section><b>核验状态</b><span>{row.coverage.excess?"分类电量大于站点总量":row.fastExtra>0?`快充 ${fmt(row.fastExtra," kWh")} 已计总量，分时待核`:row.coverage.unclassified==null?"站点总量待补充":`未分类 ${fmt(row.coverage.unclassified," kWh")}`}</span><span>{row.attention?"存在分类缺失或金额待核算":"分类与金额数据完整"}</span></section></div></td></tr>}
            </Fragment>;
          })}
        </tbody></table>{!visibleRows.length&&<p className="mode-empty">没有符合筛选条件的场站</p>}</div>
      </details>
    </>}
  </div>;
}
