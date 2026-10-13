import { dashboardClient, dashboardFetch } from "@/lib/dashboard-browser";
import type { ModeEnergyFact, TariffVersion } from "@/lib/charging-mode";
import type { ModeImportPreview } from "@/lib/mode-import";

export type StationProfile = {
  station_name: string; source_name?: string; operator_name: string | null; address: string | null;
  region: string | null; guns: number | null; fast_guns: number | null;
  slow_guns: number | null; power_kw: number | null; fast_power_kw: number | null;
  slow_power_kw: number | null; operation_status: string | null;
};
export type CalendarEnergyRow={station_name:string;period_start:string;granularity:"day"|"month";peak_kwh:number|null;high_kwh:number|null;flat_kwh:number|null;valley_kwh:number|null;total_kwh:number};
async function loadCalendarEnergy(start:string,end:string) {
  const rows:CalendarEnergyRow[]=[];
  for(let offset=0;;offset+=500){
    const page=await dashboardClient.from("dashboard_station_energy_calendar")
      .select("station_name,period_start,granularity,peak_kwh,high_kwh,flat_kwh,valley_kwh,total_kwh")
      .gte("period_start",start).lte("period_start",end)
      .order("period_start").order("station_name").range(offset,offset+499);
    if(page.error) throw page.error;
    rows.push(...(page.data||[]) as CalendarEnergyRow[]);
    if((page.data||[]).length<500) return rows;
  }
}
async function loadAllModeFacts(start:string,end:string) {
  type RawFact={station_name:string;charge_date:string;charging_mode:string;device_key:string;peak_kwh:number|null;high_kwh:number|null;flat_kwh:number|null;valley_kwh:number|null;total_kwh:number;orders:number|null};
  const rows:RawFact[]=[];
  for(let offset=0;;offset+=500){
    const page=await dashboardClient.from("dashboard_mode_energy")
      .select("station_name,charge_date,charging_mode,device_key,peak_kwh,high_kwh,flat_kwh,valley_kwh,total_kwh,orders")
      .gte("charge_date",start).lte("charge_date",end)
      .order("charge_date").order("station_name").order("charging_mode").order("device_key")
      .range(offset,offset+499);
    if(page.error) throw page.error;
    rows.push(...(page.data || []) as RawFact[]);
    if((page.data || []).length<500) return rows;
  }
}
export async function loadModeData(start: string, end: string) {
  const [profiles,facts,calendar,tariffs,shared]=await Promise.all([
    dashboardClient.from("dashboard_station_profiles").select("station_name,source_name,operator_name,address,region,guns,fast_guns,slow_guns,power_kw,fast_power_kw,slow_power_kw,operation_status").order("station_name"),
    loadAllModeFacts(start,end),
    loadCalendarEnergy(start,end),
    dashboardClient.from("dashboard_tariff_versions").select("station_name,charging_mode,effective_from,effective_until,windows").lte("effective_from",end),
    dashboardFetch("/api/dashboard-state",{cache:"no-store"}),
  ]);
  if (profiles.error) throw profiles.error;
  if (tariffs.error) throw tariffs.error;
  if (!shared.ok) throw new Error("购电成本配置读取失败");
  const state=await shared.json() as {configs?:Record<string,Record<string,string>>};
  return {
    profiles:(profiles.data || []) as StationProfile[],
    calendar,
    tariffs:(tariffs.data || []) as TariffVersion[],
    configs:state.configs || {},
    facts:facts.map((x):ModeEnergyFact=>({
      stationName:x.station_name,date:x.charge_date,mode:x.charging_mode as "fast" | "slow",
      deviceId:x.device_key || null,peak:x.peak_kwh == null ? null : Number(x.peak_kwh),
      high:x.high_kwh == null ? null : Number(x.high_kwh),
      flat:x.flat_kwh == null ? null : Number(x.flat_kwh),
      valley:x.valley_kwh == null ? null : Number(x.valley_kwh),
      charge:Number(x.total_kwh),orders:x.orders,
    })),
  };
}

export async function saveModeImport(file: File, preview: ModeImportPreview) {
  const sortedDates=preview.rows.map((row)=>row.date).sort();
  if(!sortedDates.length) throw new Error("没有可导入的分类数据");
  const existing=await loadModeData(sortedDates[0],sortedDates.at(-1)!);
  const groups=new Map<string,Set<boolean>>();
  for(const fact of [...existing.facts,...preview.rows]){
    const key=[fact.stationName,fact.date,fact.mode].join("|");
    const types=groups.get(key)||new Set<boolean>();
    types.add(Boolean(fact.deviceId));groups.set(key,types);
  }
  if([...groups.values()].some((types)=>types.size>1)) throw new Error("现有记录与本次导入混用了设备明细和模式汇总，请先核对来源");
  const hash=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());
  const sourceSha256=[...new Uint8Array(hash)].map((x)=>x.toString(16).padStart(2,"0")).join("");
  const { data:batch,error:batchError }=await dashboardClient.from("dashboard_mode_import_batches")
    .insert({source_name:file.name,source_sha256:sourceSha256,field_mapping:preview.fieldMapping,raw_rows:preview.sourceRows}).select("id").single();
  if (batchError) throw batchError;
  const rows=preview.rows.map((x)=>({
    station_name:x.stationName,charge_date:x.date,charging_mode:x.mode,device_key:x.deviceId || "",
    peak_kwh:x.peak,high_kwh:x.high,flat_kwh:x.flat,valley_kwh:x.valley,
    total_kwh:x.charge,orders:x.orders,import_batch_id:batch.id,published:false,
  }));
  const {error}=await dashboardClient.from("dashboard_mode_energy").upsert(rows,{onConflict:"station_name,charge_date,charging_mode,device_key"});
  if (error) throw error;
  return batch.id as string;
}
