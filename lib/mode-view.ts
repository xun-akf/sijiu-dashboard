import type { ChargingMode } from "@/lib/charging-mode";

export type ModeScope = "all" | ChargingMode;
export type AvailableValue = { value: number; available: boolean };

export function modeKeys(mode: ModeScope): ChargingMode[] {
  return mode === "all" ? ["fast", "slow"] : [mode];
}

export function selectModeNumber(mode: ModeScope, fast: number, slow: number): number {
  return mode === "fast" ? fast : mode === "slow" ? slow : fast + slow;
}

export function scopedModeSummary(mode: ModeScope, fast: AvailableValue, slow: AvailableValue): { value: number | null; available: boolean } {
  const selected = modeKeys(mode).map((key) => key === "fast" ? fast : slow).filter((item) => item.available);
  return selected.length ? { value: selected.reduce((sum, item) => sum + item.value, 0), available: true } : { value: null, available: false };
}
