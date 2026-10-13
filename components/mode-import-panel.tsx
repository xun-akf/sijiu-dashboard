"use client";
import { useEffect, useState } from "react";
import { loadModeData, saveModeImport, type StationProfile } from "@/lib/mode-data";
import { parseModeWorkbook, type ModeImportPreview } from "@/lib/mode-import";
import { siteUrl } from "@/lib/dashboard-browser";

export function ModeImportPanel() {
  const [profiles,setProfiles]=useState<StationProfile[]>([]);
  const [preview,setPreview]=useState<ModeImportPreview | null>(null);
  const [file,setFile]=useState<File | null>(null);
  const [status,setStatus]=useState("");
  const [saving,setSaving]=useState(false);
  useEffect(()=>{void loadModeData("2026-01-01","2026-01-01").then((x)=>setProfiles(x.profiles)).catch(()=>setStatus("场站资料暂不可用"));},[]);
  const read=async (selected:File) => {
    setStatus("正在识别字段与站点…");setPreview(null);setFile(selected);
    try {
      const aliases=Object.fromEntries(profiles.filter((x)=>x.source_name).map((x)=>[x.source_name!,x.station_name]));
      const result=await parseModeWorkbook(selected,profiles.map((x)=>x.station_name),aliases);
      setPreview(result);setStatus(`识别到${result.rows.length}行；请核对日期、模式、站点和电量后导入`);
    } catch (error) {setStatus(error instanceof Error ? error.message : "无法读取文件");}
  };
  const save=async()=>{
    if (!preview || !file) return;
    setSaving(true);setStatus("正在保存分类原始记录…");
    try {
      await saveModeImport(file,preview);
      setStatus(`已保存${preview.rows.length}行分类数据草稿；发布后只读端可见。重复导入按站点＋日期＋模式＋设备编号覆盖。`);
      setPreview(null);setFile(null);
    } catch (error) {setStatus(error instanceof Error ? error.message : "保存失败");}
    finally {setSaving(false);}
  };
  return <section className="mode-panel" id="mode-import">
    <div className="section-head"><div><h3>充电模式数据导入</h3>
      <p>只接收真实日期的快充/慢充数据；原周报导入继续使用上方原入口。</p></div>
      <div className="mode-import-actions"><a href={siteUrl("/charging-mode-import-template.xlsx")} download>下载空白模板</a>
      <label className="upload-button">选择分类 Excel<input type="file" accept=".xlsx" onChange={(e)=>{const selected=e.target.files?.[0];if(selected)void read(selected);e.target.value="";}} /></label></div>
    </div>
    {status && <p className="empty-note">{status}</p>}
    {preview && <><p className="mode-mapping">工作表：{preview.sheet} · 字段：{Object.entries(preview.fieldMapping).map(([key,val])=>`${key}→${val}`).join("；")} · 忽略列：{preview.ignored.join("、") || "无"}</p>
      <div className="mode-table-wrap"><table><thead><tr><th>站点</th><th>日期</th><th>模式</th><th>设备</th><th>尖</th><th>峰</th><th>平</th><th>谷</th><th>总量</th></tr></thead>
        <tbody>{preview.rows.slice(0,20).map((x,i)=><tr key={i}><td>{x.stationName}</td><td>{x.date}</td><td>{x.mode==="fast"?"快充":"慢充"}</td><td>{x.deviceId || "模式汇总"}</td><td>{x.peak ?? "—"}</td><td>{x.high ?? "—"}</td><td>{x.flat ?? "—"}</td><td>{x.valley ?? "—"}</td><td>{x.charge}</td></tr>)}</tbody></table></div>
      {preview.rows.length>20 && <p className="empty-note">预览前20行，共{preview.rows.length}行。</p>}
      <button className="save-button" disabled={saving} onClick={()=>void save()}>{saving?"保存中…":"确认导入分类草稿"}</button>
    </>}
  </section>;
}
