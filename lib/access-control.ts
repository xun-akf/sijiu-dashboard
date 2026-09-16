import type { NextRequest } from "next/server";

export type AccessRole = "viewer" | "operator";

export async function getAccessRole(request: NextRequest): Promise<AccessRole | null> {
  const token = request.cookies.get("dashboard_sb_access")?.value;
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1] || ""));
    const role = payload?.app_metadata?.dashboard_role;
    return role === "viewer" || role === "operator" ? role : null;
  } catch {
    return null;
  }
}
