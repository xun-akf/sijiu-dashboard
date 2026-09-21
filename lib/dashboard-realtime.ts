"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { dashboardClient } from "@/lib/dashboard-browser";

type RealtimeStatus = "connecting" | "connected" | "disconnected";

export function subscribeToDashboardChanges(onChange: () => void, onStatus: (status: RealtimeStatus) => void) {
  let channel: RealtimeChannel | null = null;
  let stopped = false;
  const start = async () => {
    onStatus("connecting");
    const { data } = await dashboardClient.auth.getSession();
    if (!data.session || stopped) {
      onStatus("disconnected");
      return;
    }
    await dashboardClient.realtime.setAuth(data.session.access_token);
    channel = dashboardClient
      .channel("dashboard-state-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "dashboard_state" }, onChange)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "dashboard_publish_events" }, onChange)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") onStatus("connected");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") onStatus("disconnected");
      });
  };
  void start();
  return () => {
    stopped = true;
    if (channel) void dashboardClient.removeChannel(channel);
  };
}

