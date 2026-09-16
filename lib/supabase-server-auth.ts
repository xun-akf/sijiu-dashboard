import "server-only";

import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";
import type { AccessRole } from "@/lib/access-control";

const SUPABASE_URL = "https://bmyqujzflznbdareryud.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_QMwlz__JSf6sW1-hIvqxnQ_K6rz0f3g";
export const ACCESS_TOKEN_COOKIE = "dashboard_sb_access";
export const REFRESH_TOKEN_COOKIE = "dashboard_sb_refresh";

function client() {
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signInWithDashboardPassword(password: string) {
  for (const email of [
    "3513819186+dashboard-viewer@qq.com",
    "3513819186+dashboard-operator@qq.com",
  ]) {
    const supabase = client();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) continue;
    const role = data.user.app_metadata.dashboard_role as AccessRole | undefined;
    if (role === "viewer" || role === "operator") return { role, session: data.session };
  }
  return null;
}

export async function requestSession(request: NextRequest) {
  const access_token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;
  const refresh_token = request.cookies.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!access_token || !refresh_token) return null;
  const supabase = client();
  const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error || !data.session || !data.user) return null;
  const role = data.user.app_metadata.dashboard_role as AccessRole | undefined;
  if (role !== "viewer" && role !== "operator") return null;
  return { client: supabase, role, session: data.session };
}

export function setSessionCookies(response: NextResponse, session: Session) {
  const options = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 12 };
  response.cookies.set(ACCESS_TOKEN_COOKIE, session.access_token, options);
  response.cookies.set(REFRESH_TOKEN_COOKIE, session.refresh_token, options);
}

export type AuthenticatedClient = SupabaseClient;
