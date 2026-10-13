import { normalizeTouPrice, resolveWeeklyPrice, type MetricConfig, type TouKey } from "./operating-metrics";
import { weekLabelFromDateUtc } from "./weekly-period.mjs";
import type { CalendarEnergyRow } from "./mode-data";

const keys:TouKey[]=["peak","high","flat","valley"];
const blank={electricityRevenue:null,serviceRevenue:null,profit:null};
export function calculateCalendarDay(row:CalendarEnergyRow,config:MetricConfig,monthly:MetricConfig){
  if(row.granularity!=="day") return blank;
  const quantities=keys.map((key)=>row[`${key}_kwh`]);
  if(quantities.some((x)=>x==null) || Math.abs(quantities.reduce<number>((acc,x)=>acc+Number(x),0)-Number(row.total_kwh))>.02) return blank;
  const date=new Date(row.period_start+"T00:00:00Z");
  const week=weekLabelFromDateUtc(date);
  const month=`${date.getUTCFullYear()}-${date.getUTCMonth()+1}`;
  const shortMonth=String(date.getUTCMonth()+1);
  const service=normalizeTouPrice(resolveWeeklyPrice(config.servicePricesJson||"",week));
  const electricity=normalizeTouPrice(resolveWeeklyPrice(config.electricityPricesJson||"",week));
  const external=normalizeTouPrice(resolveWeeklyPrice(config.externalPricesJson||"",week));
  const costType=config.purchaseCostType||config.billingType||"大工业电价";
  let costs:Record<string,Record<string,Record<string,string>>>;
  let fees:Record<string,string>;
  try{costs=JSON.parse(monthly.monthlyCostsJson||"{}");fees=JSON.parse(monthly.gridFeesJson||"{}");}
  catch{return blank;}
  const cost=costType==="一口价"?Object.fromEntries(keys.map((key)=>[key,config.unifiedPrice]))
    :(costs[month]||costs[shortMonth])?.[costType];
  const gridFee=costType==="售电价"?Number(fees[month]??fees[shortMonth]??0):0;
  const has=(price:Record<string,string|undefined>|undefined,key:TouKey)=>price?.[key]!=="" && price?.[key]!=null && Number.isFinite(Number(price[key]));
  const useExternal=Boolean(config.purchaseCostType) && keys.every((key)=>has(external,key));
  if(!keys.every((key)=>has(service,key) && (useExternal||has(electricity,key))))return blank;
  let electricityRevenue=0,serviceRevenue=0,profit=0;
  let costComplete=Number.isFinite(gridFee);
  keys.forEach((key,index)=>{
    const quantity=Number(quantities[index]);
    const fee=Number(service[key]);
    const sale=useExternal?Number(external[key]):Number(electricity[key])+fee;
    electricityRevenue+=quantity*(sale-fee);
    serviceRevenue+=quantity*fee;
    if(quantity && !has(cost,key))costComplete=false;
    if(costComplete)profit+=quantity*(sale-Number(cost?.[key]||0)-gridFee);
  });
  return {electricityRevenue,serviceRevenue,profit:costComplete?profit:null};
}
