export type StationMatch =
  | { status: "matched"; excelName: string; dashboardName: string; method: "exact" | "alias" }
  | { status: "pending"; excelName: string; dashboardName: string; score: number }
  | { status: "ignored"; excelName: string };

const compact = (value: string) => value.toLowerCase().replace(/[\s\-—_（）()【】\[\]·]/g, "");
const phase = (value: string) => compact(value).match(/(?:第?[一二三四五六七八九十123456789]+期)/)?.[0] || "";
const generic = /(充电站|超充站|快充站|慢充站|重卡站|停车场)$/g;
const brands = /^(蔚景云|飞凡|麦电|阳充|大电锤)/;
const core = (value: string) => compact(value).replace(brands, "").replace(generic, "");

const similarity = (left: string, right: string) => {
  const a = core(left), b = core(right);
  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
};

export function matchStationNames(
  excelNames: string[],
  dashboardNames: string[],
  aliases: Record<string, string> = {},
): StationMatch[] {
  const dashboardByExact = new Map(dashboardNames.map((name) => [compact(name), name]));
  const aliasByExact = new Map(Object.entries(aliases).map(([alias, name]) => [compact(alias), name]));
  const claimed = new Set<string>();
  const resolved = new Map<string, StationMatch>();
  excelNames.forEach((excelName) => {
    const exact = dashboardByExact.get(compact(excelName));
    if (exact && !claimed.has(exact)) { claimed.add(exact); resolved.set(excelName, { status: "matched", excelName, dashboardName: exact, method: "exact" }); return; }
    const alias = aliasByExact.get(compact(excelName));
    if (alias && dashboardNames.includes(alias) && !claimed.has(alias)) { claimed.add(alias); resolved.set(excelName, { status: "matched", excelName, dashboardName: alias, method: "alias" }); }
  });
  return excelNames.map((excelName) => {
    const automatic = resolved.get(excelName);
    if (automatic) return automatic;
    const sourcePhase = phase(excelName);
    const candidates = dashboardNames
      .filter((name) => !claimed.has(name) && (!sourcePhase || phase(name) === sourcePhase) && (!phase(name) || phase(name) === sourcePhase))
      .map((name) => ({ name, score: similarity(excelName, name) }))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0], second = candidates[1];
    if (best && best.score >= 0.72 && (!second || best.score - second.score >= 0.12))
      return { status: "pending", excelName, dashboardName: best.name, score: best.score };
    return { status: "ignored", excelName };
  });
}

