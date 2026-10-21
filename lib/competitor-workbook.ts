import workbook from "@/data/competitors-20261018.json";

export const competitorWorkbookVersion = "111竞站价格-20261018";

type Prices = Record<"peak" | "high" | "flat" | "valley", string>;
type Competitor = { name: string; distance: string; guns: string; electricity: Prices; service: Prices; total: Prices };
type Config = { competitorsJson?: string; [field: string]: unknown };

function readCompetitors(value: string | undefined): Competitor[] {
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}

function distanceMeters(value: string): string {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(km|m|米|公里)?$/i);
  if (!match) return value;
  return `${Number(match[1]) * (/^(km|公里)$/i.test(match[2] || "") ? 1000 : 1)}m`;
}

/** Overlay only in the operator's draft view; no database write takes place. */
export function withCompetitorWorkbook<T extends Config>(configs: Record<string, T>): Record<string, T> {
  if ((configs.__summary__ as Config | undefined)?.competitorWorkbookVersion === competitorWorkbookVersion) return configs;
  let changed = false;
  const next = { ...configs };
  for (const [station, incoming] of Object.entries(workbook) as [string, Competitor[]][]) {
    const old = configs[station];
    if (!old || !incoming.length) continue;
    const prior = readCompetitors(old.competitorsJson);
    const byName = new Map(prior.map((item) => [item.name.trim(), item]));
    const names = new Set(incoming.map((item) => item.name.trim()));
    const merged = incoming.map((item) => {
      const previous = byName.get(item.name.trim());
      const total = Object.fromEntries((['peak', 'high', 'flat', 'valley'] as const).map((key) => [key,
        item.total[key] || (item.electricity[key] && item.service[key]
          ? String(Number(item.electricity[key]) + Number(item.service[key])) : '')])) as Prices;
      return {
        ...previous, ...item,
        distance: distanceMeters(item.distance || previous?.distance || ''),
        guns: item.guns || previous?.guns || '',
        total,
        peak: total.peak, high: total.high, flat: total.flat, valley: total.valley,
      };
    });
    next[station] = { ...old, competitorsJson: JSON.stringify([
      ...merged, ...prior.filter((item) => !names.has(item.name.trim())),
    ]) } as T;
    changed = true;
  }
  if (!changed) return configs;
  next.__summary__ = {
    ...configs.__summary__, competitorWorkbookVersion,
  } as T;
  return next;
}
