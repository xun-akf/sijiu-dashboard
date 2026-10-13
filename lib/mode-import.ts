import { strFromU8, unzipSync } from "fflate";
import { parseImportNumber } from "@/lib/import-validation";
import { matchStationNames } from "@/lib/station-matching";
import { type ModeEnergyFact, upsertModeFacts } from "@/lib/charging-mode";

type Column = "station" | "date" | "mode" | "device" | "peak" | "high" | "flat" | "valley" | "charge" | "orders";
const aliases: Record<Column, string[]> = {
  station: ["站点名称", "场站名称", "充电站名称", "站场名称"],
  date: ["统计日期", "充电日期", "日期", "交易日期"],
  mode: ["充电模式", "充电类型", "快慢充类型", "设备类型"],
  device: ["设备编号", "充电枪编号", "枪编号", "桩编号"],
  peak: ["尖电量", "尖时段电量"],
  high: ["峰电量", "峰时段电量"],
  flat: ["平电量", "平时段电量"],
  valley: ["谷电量", "谷时段电量"],
  charge: ["总充电量", "充电量", "总电量"],
  orders: ["订单量", "订单数"],
};
const normalize = (value: string) => value.replace(/[\s_（）()【】/\-]/g, "").toLowerCase();
const isoDate = (raw: string) => {
  const value = String(raw || "").trim();
  const serial = /^\d{5}(?:\.\d+)?$/.test(value) ? Number(value) : null;
  if (serial != null) return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
  const m = value.match(/^(20\d{2})[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (!m) throw new Error("必须提供真实统计日期，不能仅填周次或月份");
  return `${m[1]}-${m[2].padStart(2,"0")}-${m[3].padStart(2,"0")}`;
};
const modeOf = (raw: string) => {
  if (/^(快充|直流|fast)$/i.test(raw.trim())) return "fast" as const;
  if (/^(慢充|交流|slow)$/i.test(raw.trim())) return "slow" as const;
  throw new Error(`无法识别充电模式：${raw}`);
};
const optionalNumber = (row: Record<string,string>, col?: string) => col && row[col]?.trim()
  ? parseImportNumber(row[col]) : null;

export type ModeImportPreview = {
  sheet: string;
  fieldMapping: Record<string,string>;
  rows: ModeEnergyFact[];
  sourceRows: Record<string,string>[];
  ignored: string[];
};

export async function parseModeWorkbook(file: File, stationNames: string[], stationAliases: Record<string,string>): Promise<ModeImportPreview> {
  const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const parser = new DOMParser();
  const sharedFile = zip["xl/sharedStrings.xml"];
  const shared = sharedFile
    ? [...parser.parseFromString(strFromU8(sharedFile), "text/xml").querySelectorAll("si")].map((node) => [...node.querySelectorAll("t")].map((t) => t.textContent || "").join(""))
    : [];
  const sheetPaths = Object.keys(zip).filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/.test(path)).sort();
  for (const [sheetIndex,path] of sheetPaths.entries()) {
    const sourceRows: Record<string,string>[] = [];
    parser.parseFromString(strFromU8(zip[path]),"text/xml").querySelectorAll("row").forEach((xmlRow) => {
      const row: Record<string,string> = {};
      xmlRow.querySelectorAll("c").forEach((cell) => {
        const col=(cell.getAttribute("r") || "").match(/[A-Z]+/)?.[0] || "";
        const raw=cell.querySelector("v")?.textContent || "";
        const inline=[...cell.querySelectorAll("is t")].map((node) => node.textContent || "").join("");
        row[col]=cell.getAttribute("t")==="s" ? shared[Number(raw)] || "" : inline || raw;
      });
      sourceRows.push(row);
    });
    const headers=sourceRows.map((row,index) => {
      const mapping: Partial<Record<Column,string>>={};
      Object.entries(row).forEach(([col,label]) => {
        (Object.keys(aliases) as Column[]).forEach((key) => {
          if (!mapping[key] && aliases[key].some((alias) => normalize(alias)===normalize(label))) mapping[key]=col;
        });
      });
      return {index,row,mapping,score:Object.keys(mapping).length};
    }).sort((a,b)=>b.score-a.score)[0];
    if (!headers || headers.score<4) continue;
    const required: Column[]=["station","date","mode","charge"];
    const missing=required.filter((key)=>!headers.mapping[key]);
    if (missing.length) throw new Error(`分类导入缺少字段：${missing.join("、")}`);
    const parsed: ModeEnergyFact[]=[];
    const rawRows=sourceRows.slice(headers.index+1).filter((row)=>Object.values(row).some((v)=>v.trim()));
    const names=[...new Set(rawRows.map((row)=>row[headers.mapping.station!] || ""))];
    const matches=matchStationNames(names,stationNames,stationAliases);
    const unresolved=matches.filter((item)=>item.status!=="matched");
    if (unresolved.length) throw new Error(`站点需先审核匹配：${unresolved.map((x)=>x.excelName).join("、")}`);
    const byName=new Map(matches.map((item)=>[item.excelName,item.status==="matched" ? item.dashboardName : ""]));
    rawRows.forEach((row,index) => {
      try {
        const charge=optionalNumber(row,headers.mapping.charge);
        if (charge==null) throw new Error("总充电量缺失");
        const orders=optionalNumber(row,headers.mapping.orders);
        if (orders!=null && !Number.isInteger(orders)) throw new Error("订单量应为整数");
        parsed.push({
          stationName:byName.get(row[headers.mapping.station!] || "")!,
          date:isoDate(row[headers.mapping.date!] || ""),
          mode:modeOf(row[headers.mapping.mode!] || ""),
          deviceId:row[headers.mapping.device || ""]?.trim() || null,
          charge,peak:optionalNumber(row,headers.mapping.peak),
          high:optionalNumber(row,headers.mapping.high),
          flat:optionalNumber(row,headers.mapping.flat),
          valley:optionalNumber(row,headers.mapping.valley),orders,
        });
      } catch (error) { throw new Error(`工作表${sheetIndex+1}第${headers.index+index+2}行：${error instanceof Error ? error.message : String(error)}`); }
    });
    const groups=new Map<string,Set<boolean>>();
    parsed.forEach((row)=>{
      const key=[row.stationName,row.date,row.mode].join("|");
      const group=groups.get(key) || new Set<boolean>();
      group.add(Boolean(row.deviceId));
      groups.set(key,group);
    });
    if ([...groups.values()].some((group)=>group.size>1)) throw new Error("同一站点、日期、模式不能混用设备明细和模式汇总行");
    if (upsertModeFacts([],parsed).length!==parsed.length) throw new Error("同一文件含重复的站点/日期/模式/设备行，请先核对");
    return {
      sheet:`工作表${sheetIndex+1}`,
      fieldMapping:Object.fromEntries(Object.entries(headers.mapping).map(([key,col])=>[key,`${headers.row[col!] || col}（${col}）`])),
      rows:parsed,sourceRows:rawRows,
      ignored:Object.entries(headers.row).filter(([col])=>!Object.values(headers.mapping).includes(col)).map(([,label])=>label),
    };
  }
  throw new Error("未识别到分类数据表头");
}
