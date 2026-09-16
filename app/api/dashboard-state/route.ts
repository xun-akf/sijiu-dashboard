import { NextRequest, NextResponse } from "next/server";
import { readSharedState, writeSharedState } from "@/lib/site-state";
import { requestSession, setSessionCookies } from "@/lib/supabase-server-auth";

export async function GET(request: NextRequest) {
  const auth = await requestSession(request);
  if (!auth)
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  try {
    const response = NextResponse.json(await readSharedState(auth.client, auth.role));
    setSessionCookies(response, auth.session);
    return response;
  } catch (error) {
    console.error("读取共享看板数据失败", error);
    return NextResponse.json({ error: "共享数据暂时不可用" }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requestSession(request);
  if (!auth || auth.role !== "operator")
    return NextResponse.json({ error: "仅运营管理端可保存" }, { status: 403 });
  try {
    const body = (await request.json()) as { stationData?: unknown; configs?: unknown };
    if (body.stationData === undefined && body.configs === undefined)
      return NextResponse.json({ error: "没有可保存的数据" }, { status: 400 });
    await writeSharedState(auth.client, { stationData: body.stationData, configs: body.configs });
    const response = NextResponse.json({ ok: true });
    setSessionCookies(response, auth.session);
    return response;
  } catch (error) {
    console.error("保存共享看板数据失败", error);
    return NextResponse.json({ error: "保存失败，请稍后重试" }, { status: 500 });
  }
}
