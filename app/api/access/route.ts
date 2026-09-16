import { NextRequest, NextResponse } from "next/server";
import { getAccessRole } from "@/lib/access-control";
import { setSessionCookies, signInWithDashboardPassword } from "@/lib/supabase-server-auth";

export async function GET(request: NextRequest) {
  return NextResponse.json({ role: await getAccessRole(request) });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const login = await signInWithDashboardPassword(password);
  if (!login) {
    return NextResponse.redirect(new URL("/access?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/", request.url), 303);
  setSessionCookies(response, login.session);
  return response;
}
