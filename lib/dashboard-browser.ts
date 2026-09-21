"use client";

import { createClient } from "@supabase/supabase-js";
import type { AccessRole } from "@/lib/access-control";
import { validateDashboardData } from "@/lib/import-validation";
import { recalculateLatestDashboardWeek } from "@/lib/operating-metrics";
import { publishSharedState, readSharedState, writeSharedState } from "@/lib/site-state";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/supabase-config";

export const SITE_BASE_PATH = "/sijiu-dashboard";
export const siteUrl = (path = "/") => `${SITE_BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;

export const dashboardClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "sijiu-dashboard-auth" },
});

const accountEmails: Record<string, string> = {
  "sijiu-admin": "dashboard-operator@users.invalid",
  "sijiu-viewer": "dashboard-viewer@users.invalid",
  "sichuan-feifan": "dashboard-sichuan-feifan@users.invalid",
};

const roleOf = (user: { app_metadata?: Record<string, unknown> } | null | undefined): AccessRole | null => {
  const role = user?.app_metadata?.dashboard_role;
  return role === "operator" || role === "viewer" || role === "partner" ? role : null;
};

export async function signInDashboard(account: string, password: string) {
  const loginAccount = account.trim().toLowerCase();
  let email = accountEmails[loginAccount];
  if (!email && loginAccount) {
    const { data } = await dashboardClient.rpc("resolve_dashboard_partner_login", { p_login_account: loginAccount });
    if (typeof data === "string") email = data;
  }
  if (!email) throw new Error("账号或密码不正确");
  const { data, error } = await dashboardClient.auth.signInWithPassword({ email, password });
  const role = roleOf(data.user);
  if (error || !data.session || !role) {
    await dashboardClient.auth.signOut().catch(() => undefined);
    throw new Error("账号或密码不正确");
  }
  return role;
}

async function identity() {
  const { data, error } = await dashboardClient.auth.getUser();
  if (error || !data.user) return { role: null as AccessRole | null, operator: null as string | null };
  return { role: roleOf(data.user), operator: typeof data.user.app_metadata.operator_slug === "string" ? data.user.app_metadata.operator_slug : null };
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8" },
});

export async function dashboardFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
  const method = (init?.method || "GET").toUpperCase();
  const auth = await identity();

  if (url.includes("/api/access/logout")) {
    await dashboardClient.auth.signOut();
    return jsonResponse({ ok: true });
  }
  if (url.includes("/api/access")) return jsonResponse(auth);
  if (!auth.role) return jsonResponse({ error: "未授权" }, 401);

  if (url.includes("/api/operators")) {
    if (auth.role !== "operator") return jsonResponse({ error: "仅主管理员可管理账号权限" }, 403);
    if (method === "GET") {
      const { data, error } = await dashboardClient.rpc("list_dashboard_operators");
      return error ? jsonResponse({ error: "账号权限读取失败" }, 500) : jsonResponse({ operators: data ?? [] });
    }
    const body = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    const { error } = await dashboardClient.rpc("save_dashboard_operator", {
      p_slug: body.slug, p_operator_name: body.operatorName, p_report_name: body.reportName,
      p_login_account: body.loginAccount, p_password: body.password || null,
      p_enabled: body.enabled !== false, p_station_names: body.stations,
    });
    return error ? jsonResponse({ error: error.message.includes("password too short") ? "新增账号必须设置至少12位密码" : "账号权限保存失败" }, 400) : jsonResponse({ ok: true });
  }

  if (!url.includes("/api/dashboard-state")) return fetch(input, init);
  if (method === "GET") {
    try { return jsonResponse(await readSharedState(dashboardClient, auth.role)); }
    catch { return jsonResponse({ error: "共享数据暂时不可用" }, 503); }
  }
  if (auth.role !== "operator") return jsonResponse({ error: "仅主管理员可保存或发布" }, 403);
  if (method === "PUT") {
    try {
      const body = JSON.parse(String(init?.body || "{}"));
      await writeSharedState(dashboardClient, body);
      return jsonResponse({ ok: true });
    } catch (error) {
      return jsonResponse({ error: `保存失败：${error instanceof Error ? error.message : String(error)}` }, 500);
    }
  }
  if (method === "POST") {
    try {
      const body = JSON.parse(String(init?.body || "{}")) as { confirmWarnings?: boolean };
      const [draft, published] = await Promise.all([
        readSharedState(dashboardClient, "operator"),
        readSharedState(dashboardClient, "viewer"),
      ]);
      const recalculated = recalculateLatestDashboardWeek(draft.stationData, draft.configs);
      const report = validateDashboardData(recalculated, published.stationData, { configs: draft.configs, allowPublishedHistory: true });
      if (report.status === "error") return jsonResponse({ error: "草稿存在严重数据错误，已禁止发布", report }, 422);
      if (report.status === "warning" && !body.confirmWarnings) return jsonResponse({ error: "草稿存在校验警告，请确认后继续", report }, 409);
      await writeSharedState(dashboardClient, { stationData: recalculated, configs: draft.configs });
      await publishSharedState(dashboardClient);
      return jsonResponse({ ok: true, report });
    } catch (error) {
      return jsonResponse({ error: `发布失败：${error instanceof Error ? error.message : String(error)}` }, 500);
    }
  }
  return jsonResponse({ error: "不支持的请求" }, 405);
}

