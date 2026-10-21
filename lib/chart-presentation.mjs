export function chartScale(values, intervals = 4) {
  const maximum = Math.max(0, ...values.filter((value) => Number.isFinite(value)));
  if (maximum === 0) return { max: intervals, step: 1, ticks: Array.from({ length: intervals + 1 }, (_, i) => i) };
  const rough = maximum / intervals;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).find((n) => n >= rough) ?? 10 * magnitude;
  const max = step * intervals;
  return { max, step, ticks: Array.from({ length: intervals + 1 }, (_, i) => i * step) };
}

export function visibleTrendCount(values, mode = 'week', end = values.length - 1) {
  if (mode !== 'week') return Math.min(8, end + 1);
  const latest = values.slice(Math.max(0, end - 7), end + 1).filter(Number.isFinite);
  if (end < 7) return end + 1;
  if (latest.length < 8) return 8;
  const max = Math.max(...latest);
  const range = max - Math.min(...latest);
  if (max <= 0 || range / max >= 0.12) return 8;
  let count = Math.min(10, end + 1);
  if (count < 10) return count;
  const extended = values.slice(end - 9, end + 1).filter(Number.isFinite);
  if (extended.length === 10 && Math.max(...extended) > 0 &&
      (Math.max(...extended) - Math.min(...extended)) / Math.max(...extended) < 0.12)
    count = Math.min(12, end + 1);
  return count;
}
