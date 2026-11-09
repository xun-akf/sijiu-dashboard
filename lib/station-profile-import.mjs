// Parse the existing "充电站明细" export without treating missing prices as zero.
const value = (row, header, key) => String(row[header[key]] ?? "").trim();
const numeric = (text) => {
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const periods = ["尖", "峰", "平", "谷"];
function tariff(text) {
  const result = {};
  for (const period of periods) {
    const matches = [...text.matchAll(new RegExp(period + "\\s*[：:]\\s*(\\d+(?:\\.\\d+)?)\\s*元\\s*[/／]\\s*度", "g"))];
    if (matches.length > 1) return null;
    if (matches.length) result[period] = matches[0][1];
  }
  if (Object.keys(result).length) return result;
  const uniform = [...text.matchAll(/(?:^|[,，{])\s*(\d+(?:\.\d+)?)\s*元\s*[/／]\s*度/g)];
  return uniform.length === 1 ? Object.fromEntries(periods.map((p) => [p, uniform[0][1]])) : null;
}
export function parseStationDetailRows(sheets, week) {
  const found = [];
  for (const sheet of sheets) {
    const rows = sheet.rows || [];
    const index = rows.findIndex((row) => Object.values(row).includes("站点ID") && Object.values(row).includes("充电站名称"));
    if (index < 0) continue;
    const header = Object.fromEntries(Object.entries(rows[index]).map(([col, title]) => [String(title).trim(), col]));
    const warnings = [];
    for (const row of rows.slice(index + 1)) {
      const name = value(row, header, "充电站名称");
      if (!name) continue;
      const id = value(row, header, "站点ID");
      if (!id) { warnings.push(name + "：缺少站点ID"); continue; }
      const address = value(row, header, "充电站地址");
      const operator = value(row, header, "所属运营商");
      const electric = tariff(value(row, header, "峰平谷电费明细"));
      const service = tariff(value(row, header, "峰平谷服务费明细"));
      const notice = [];
      if (!electric || !service) notice.push("计费规则无法唯一识别，价格留空，建站后可手动补充");
      for (const key of ["充电位总数量", "快充电位数量", "慢充电位数量"]) {
        const raw = value(row, header, key);
        if (raw && numeric(raw) === null) notice.push(key + "异常");
      }
      const price = (set) => ({ peak: set?.尖 || "", high: set?.峰 || "", flat: set?.平 || "", valley: set?.谷 || "" });
      const total = electric && service ? Object.fromEntries(periods.map((p) => [p, electric[p] && service[p] ? (Number(electric[p]) + Number(service[p])).toFixed(4) : ""])) : {};
      const config = {
        operator, guns: value(row, header, "充电位总数量"), location: address,
        customers: value(row, header, "服务对像") || value(row, header, "服务对象"),
        billingType: "大工业电价", purchaseCostType: "",
        costRegion: address.includes("四川") ? "四川" : address.includes("广东") ? "广东" : "",
        competitorsJson: "[]", competitorsByWeekJson: "{}",
        stationAliasesJson: JSON.stringify([name]),
        electricityPricesJson: electric ? JSON.stringify({[week]:price(electric)}) : "",
        servicePricesJson: service ? JSON.stringify({[week]:price(service)}) : "",
        externalPricesJson: electric && service ? JSON.stringify({[week]:price(total)}) : "",
      };
      const opened = value(row, header, "投运时间");
      found.push({ name, profile: {
        source_station_id:id, source_name:name, province: address.match(/^(.*?(?:省|自治区|直辖市))/)?.[1] || "",
        city: address.match(/(?:省|自治区)(.*?市)/)?.[1] || "",
        region:value(row, header, "区域"), address, operator_name:operator,
        operation_type:value(row,header,"运营类型"), operation_status:value(row,header,"运营状态"),
        opened_at: /^\\d{4}-\\d{2}-\\d{2}/.test(opened) ? opened.replace(" ","T") + (/[+-]\\d\\d:?\\d\\d|Z$/.test(opened) ? "" : "+08:00") : "",
        power_kw:numeric(value(row,header,"充电站总功率KW")),
        fast_power_kw:numeric(value(row,header,"快充总功率KW")),
        slow_power_kw:numeric(value(row,header,"慢充总功率KW")),
        guns:numeric(value(row,header,"充电位总数量")),
        fast_guns:numeric(value(row,header,"快充电位数量")),
        slow_guns:numeric(value(row,header,"慢充电位数量")),
      }, config, warnings:notice });
    }
    if (found.length) return { stations:found, warnings, sheet:sheet.name };
  }
  throw new Error("未找到“站点ID / 充电站名称”的场站明细表头");
}
