import type { CompetitorPrice, CompetitorHistory, PeriodPrices } from "./competitor-history.ts";
import { competitorTotal, pricePeriods } from "./competitor-history.ts";

export type WorkbookRows = { name: string; rows: Record<string, string>[] };
export type ImportedCompetitorSite = { name: string; competitors: CompetitorPrice[]; warnings: string[] };
const clean = (value: unknown) => String(value ?? "").trim();
export const competitorIdentity = (value: string) => clean(value).toLowerCase().replace(/[\s\-—_（）()【】\[\]·]/g, "");
const column = (index: number) => {
  let result = "";
  for (let n = index; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
};
const numeric = (value: string) => value === "" ? null : Number(value);
const price = (value: string, label: string, warnings: string[]) => {
  const raw = clean(value);
  if (!raw) return "";
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 10) {
    warnings.push(`${label}价格异常：${raw}`);
    return "";
  }
  return raw;
};
const distance = (value: string, label: string, warnings: string[]) => {
  const raw = clean(value);
  if (!raw) return "";
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*(m|米|km|公里)?$/i);
  if (!match) { warnings.push(`${label}距离无法识别：${raw}`); return ""; }
  return `${Number(match[1]) * (/^(km|公里)$/i.test(match[2] || "") ? 1000 : 1)}m`;
};
const existingDistanceMeters = (value: string) => {
  const match = clean(value).match(/^(\d+(?:\.\d+)?)\s*(m|米|km|公里)?$/i);
  return match ? `${Number(match[1]) * (/^(km|公里)$/i.test(match[2] || "") ? 1000 : 1)}m` : value;
};
export function weekFromCompetitorFilename(filename: string): string {
  const match = filename.replace(/\s/g, "").match(/(?:(20\d{2})年?)?(\d{1,2})月(?:第)?(\d+)周/);
  return match ? `${match[1] || 2026}年${Number(match[2])}月${Number(match[3])}周` : "";
}
/** Read the existing station-block workbook: D is own station, E/G/I... are competitors. */
export function parseCompetitorRows(sheets: WorkbookRows[]): ImportedCompetitorSite[] {
  const sites = new Map<string, ImportedCompetitorSite>();
  for (const sheet of sheets) for (let start = 0; start < sheet.rows.length; start++) {
    const heading = sheet.rows[start];
    if (!clean(heading.A) || !clean(heading.B).includes("周边竞站数据")) continue;
    const name = clean(heading.A);
    const warnings: string[] = [];
    const end = sheet.rows.findIndex((row, i) => i > start && clean(row.A) && clean(row.B).includes("周边竞站数据"));
    const block = sheet.rows.slice(start, end < 0 ? undefined : end);
    const find = (label: string) => block.findIndex((row) => clean(row.B) === label);
    const energy = find("电费"), service = find("服务费"), combined = find("综合价");
    const guns = find("直流设备数量"), meters = find("距离（m）");
    if (energy < 0 || service < 0) { warnings.push("缺少电费或服务费分时行"); sites.set(name, { name, competitors: [], warnings }); continue; }
    const competitors: CompetitorPrice[] = [];
    for (let index = 5; index <= 18; index += 2) {
      const col = column(index), competitorName = clean(heading[col]);
      if (!competitorName || competitorName === "竞站ID" || competitorName.toLowerCase() === "s") continue;
      const e = {} as PeriodPrices, s = {} as PeriodPrices, total = {} as PeriodPrices;
      for (const [offset, period] of pricePeriods.entries()) {
        const label = `${competitorName}·${period}`;
        e[period] = price(block[energy + offset]?.[col] || "", label + "电费", warnings);
        s[period] = price(block[service + offset]?.[col] || "", label + "服务费", warnings);
        total[period] = e[period] !== "" && s[period] !== ""
          ? String(Number((Number(e[period]) + Number(s[period])).toFixed(8))) : "";
        const shown = combined < 0 ? "" : clean(block[combined + offset]?.[col]);
        if (shown !== "" && total[period] !== "" && Number.isFinite(Number(shown)) &&
          Math.abs(Number(shown) - Number(total[period])) > 0.01)
          warnings.push(`${label}综合价与电费、服务费之和不一致（表中 ${shown}，计算 ${total[period]}）`);
      }
      if (!pricePeriods.some((period) => total[period] !== "")) {
        warnings.push(`${competitorName}缺少有效价格，已跳过`);
        continue;
      }
      const count = clean(block[guns]?.[col]);
      if (count && (!/^\d+$/.test(count) || Number(count) > 1000)) warnings.push(`${competitorName}枪数异常：${count}`);
      const rowDistance = meters < 0 ? "" : distance(block[meters]?.[col] || "", competitorName, warnings);
      competitors.push({ name: competitorName, distance: rowDistance, guns: /^\d+$/.test(count) ? count : "",
        ...total, electricity: e, service: s, total });
    }
    const existing = sites.get(name);
    sites.set(name, { name, competitors: [...(existing?.competitors || []), ...competitors], warnings: [...(existing?.warnings || []), ...warnings] });
  }
  if (!sites.size) throw new Error("没有识别到竞站数据；请使用含“周边竞站数据”和电费、服务费分时行的表格");
  return [...sites.values()];
}

export type ImportDecision = { site: string; source: CompetitorPrice; targetName: string; kind: "matched" | "new" | "pending"; note?: string };
export function proposeCompetitorMatches(site: string, incoming: CompetitorPrice[], current: CompetitorPrice[]): ImportDecision[] {
  const byName = new Map(current.map((row) => [competitorIdentity(row.name), row.name]));
  const core = (name: string) => competitorIdentity(name).replace(/(超充站|快充站|慢充站|充电站)$/, "");
  return incoming.map((source) => {
    const exact = byName.get(competitorIdentity(source.name));
    if (exact) return { site, source, targetName: exact, kind: "matched" };
    const prefix = current.filter((row) => {
      const a = core(source.name), b = core(row.name);
      return Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a));
    });
    if (prefix.length === 1) return { site, source, targetName: prefix[0].name, kind: "pending", note: "名称相近，需确认是否同一竞站" };
    return { site, source, targetName: source.name, kind: "new" };
  });
}
const fillPrices = (incoming: PeriodPrices | undefined, previous: PeriodPrices | undefined): PeriodPrices =>
  Object.fromEntries(pricePeriods.map((period) => [period, incoming?.[period] !== "" && incoming?.[period] != null
    ? incoming[period] : previous?.[period] || ""])) as PeriodPrices;
export function mergeCompetitorWeek(
  history: CompetitorHistory, week: string, decisions: ImportDecision[], clearBlanks = false, metadataFallback: CompetitorPrice[] = [],
): CompetitorHistory {
  const existing = history[week] || [];
  const rows = existing.map((row) => ({ ...row }));
  for (const { source, targetName, kind } of decisions) {
    if (kind === "pending") continue;
    const index = rows.findIndex((row) => competitorIdentity(row.name) === competitorIdentity(targetName));
    const prior = index >= 0 ? rows[index] : undefined;
    const metadata = prior || metadataFallback.find((row) => competitorIdentity(row.name) === competitorIdentity(targetName));
    const next: CompetitorPrice = {
      ...prior, ...source, name: prior?.name || targetName,
      distance: source.distance || (clearBlanks ? "" : existingDistanceMeters(metadata?.distance || "")),
      guns: source.guns || (clearBlanks ? "" : metadata?.guns || ""),
      electricity: clearBlanks ? source.electricity : fillPrices(source.electricity, prior?.electricity),
      service: clearBlanks ? source.service : fillPrices(source.service, prior?.service),
      total: {} as PeriodPrices,
      peak: "", high: "", flat: "", valley: "",
    };
    for (const period of pricePeriods) {
      const e = next.electricity?.[period], s = next.service?.[period];
      const incomingTotal = competitorTotal(source, period);
      const previousTotal = prior ? competitorTotal(prior, period) : null;
      next.total![period] = e !== "" && s !== "" && e != null && s != null
        ? String(Number((Number(e) + Number(s)).toFixed(8)))
        : incomingTotal != null && source.total?.[period] !== "" ? String(incomingTotal)
        : !clearBlanks && previousTotal != null ? String(previousTotal) : "";
      next[period] = next.total![period];
    }
    if (index < 0) rows.push(next); else rows[index] = next;
  }
  return { ...history, [week]: rows };
}
