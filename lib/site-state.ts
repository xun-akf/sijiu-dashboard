import type { AccessRole } from "@/lib/access-control";
import type { AuthenticatedClient } from "@/lib/supabase-server-auth";

export type SharedDashboardState = {
  stationData?: unknown;
  configs?: unknown;
};

const keys = { stationData: "station_data", configs: "configs" } as const;

export async function readSharedState(client: AuthenticatedClient, _role: AccessRole): Promise<SharedDashboardState> {
  const { data: rows, error } = await client
    .from("dashboard_state")
    .select("key,value")
    .in("key", Object.values(keys));
  if (error) throw error;
  const result: SharedDashboardState = {};
  for (const row of rows ?? []) {
    if (row.key === keys.stationData) result.stationData = row.value;
    if (row.key === keys.configs) result.configs = row.value;
  }
  return result;
}

export async function writeSharedState(client: AuthenticatedClient, patch: SharedDashboardState) {
  const cleanPatch = Object.fromEntries(
    Object.entries(patch).filter(([name, value]) => name in keys && value !== undefined),
  ) as SharedDashboardState;
  const rows = Object.entries(cleanPatch).map(([name, value]) => ({
    key: keys[name as keyof typeof keys], value, updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return;
  const { error } = await client.from("dashboard_state").upsert(rows, { onConflict: "key" });
  if (error) throw error;
}
