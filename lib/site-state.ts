import type { AccessRole } from "@/lib/access-control";
import type { SupabaseClient } from "@supabase/supabase-js";

type AuthenticatedClient = SupabaseClient;

export type SharedDashboardState = {
  stationData?: unknown;
  configs?: unknown;
  operator?: string;
  operatorName?: string;
  reportName?: string;
  meta?: {
    lastModifiedAt: string | null;
    lastPublishedAt: string | null;
    publishStatus: "published" | "draft";
  };
};

const legacyKeys = { stationData: "station_data", configs: "configs" } as const;
const draftKeys = { stationData: "station_data_draft", configs: "configs_draft" } as const;
const publishedKeys = { stationData: "station_data_published", configs: "configs_published" } as const;

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const meaningfulFieldCount = (value: unknown) => isObject(value)
  ? Object.values(value).reduce<number>((total, item) => total + (isObject(item)
    ? Object.values(item).filter((field) => field !== "" && field !== null && field !== undefined).length
    : 0), 0)
  : 0;
const mergeRecoveredConfigs = (fallback: unknown, draft: unknown) => {
  if (!isObject(fallback) || !isObject(draft)) return draft ?? fallback;
  const fallbackCount = meaningfulFieldCount(fallback);
  const draftCount = meaningfulFieldCount(draft);
  const draftMissingMonthly = !isObject(draft.__monthly__);
  if (!draftMissingMonthly || !fallbackCount || draftCount >= fallbackCount * 0.35) return draft;
  return Object.fromEntries([...new Set([...Object.keys(fallback), ...Object.keys(draft)])].map((key) => {
    const base = isObject(fallback[key]) ? fallback[key] : {};
    const next = isObject(draft[key]) ? draft[key] : {};
    return [key, Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(next)])].map((field) => [
      field,
      next[field] !== "" && next[field] !== null && next[field] !== undefined ? next[field] : base[field],
    ]))];
  }));
};

export async function readSharedState(client: AuthenticatedClient, role: AccessRole): Promise<SharedDashboardState> {
  if (role === "partner") {
    const { data, error } = await client.rpc("read_partner_dashboard_state");
    if (error) throw error;
    return (data ?? {}) as SharedDashboardState;
  }
  const preferred = role === "operator" ? draftKeys : publishedKeys;
  const recoveryKeys = role === "operator" ? Object.values(publishedKeys) : [];
  const { data: rows, error } = await client
    .from("dashboard_state")
    .select("key,value,updated_at")
    .in("key", [...Object.values(preferred), ...recoveryKeys, ...Object.values(legacyKeys)]);
  if (error) throw error;
  const result: SharedDashboardState = {};
  for (const row of rows ?? []) {
    if (row.key === preferred.stationData) result.stationData = row.value;
    if (row.key === preferred.configs) result.configs = row.value;
    if (row.key === legacyKeys.stationData && result.stationData === undefined) result.stationData = row.value;
    if (row.key === legacyKeys.configs && result.configs === undefined) result.configs = row.value;
  }
  if (role === "operator") {
    const publishedConfigs = (rows ?? []).find((row) => row.key === publishedKeys.configs)?.value;
    const legacyConfigs = (rows ?? []).find((row) => row.key === legacyKeys.configs)?.value;
    result.configs = mergeRecoveredConfigs(publishedConfigs ?? legacyConfigs, result.configs);
  }
  if (role === "operator") {
    const draftTimes = (rows ?? []).filter((row) => Object.values(draftKeys).includes(row.key as never)).map((row) => row.updated_at).filter(Boolean);
    const publishedTimes = (rows ?? []).filter((row) => Object.values(publishedKeys).includes(row.key as never)).map((row) => row.updated_at).filter(Boolean);
    const lastModifiedAt = draftTimes.sort().at(-1) ?? null;
    const lastPublishedAt = publishedTimes.sort().at(-1) ?? null;
    result.meta = {
      lastModifiedAt,
      lastPublishedAt,
      publishStatus: lastModifiedAt && (!lastPublishedAt || lastModifiedAt > lastPublishedAt) ? "draft" : "published",
    };
  }
  return result;
}

export async function writeSharedState(client: AuthenticatedClient, patch: SharedDashboardState) {
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([name, value]) => name in draftKeys && value !== undefined),
  ) as SharedDashboardState;
  const rows = Object.entries(cleanPatch).map(([name, value]) => ({
    key: draftKeys[name as keyof typeof draftKeys], value, updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return;
  const { error } = await client.from("dashboard_state").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}

export async function publishSharedState(client: AuthenticatedClient) {
  const { error } = await client.rpc("publish_dashboard_state");
  if (error) throw error;
}
