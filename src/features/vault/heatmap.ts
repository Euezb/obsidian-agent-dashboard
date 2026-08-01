import type { HeatmapDay } from "../../domain/types";

export function buildHeatmap(
  createdAt: number[],
  endDate: Date,
  days = 365,
): HeatmapDay[] {
  const dayCount = Math.floor(days);

  if (!(dayCount > 0) || !Number.isFinite(dayCount)) {
    return [];
  }

  const end = new Date(
    endDate.getFullYear(),
    endDate.getMonth(),
    endDate.getDate(),
  );

  if (Number.isNaN(end.getTime())) {
    return [];
  }

  const start = new Date(end);
  start.setDate(start.getDate() - dayCount + 1);

  const afterEnd = new Date(end);
  afterEnd.setDate(afterEnd.getDate() + 1);

  const counts = new Map<string, number>();
  const startTime = start.getTime();
  const afterEndTime = afterEnd.getTime();

  for (const timestamp of createdAt) {
    if (timestamp < startTime || timestamp >= afterEndTime) {
      continue;
    }

    const key = formatLocalDate(new Date(timestamp));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const heatmap: HeatmapDay[] = [];
  const current = new Date(start);

  for (let index = 0; index < dayCount; index += 1) {
    const date = formatLocalDate(current);
    heatmap.push({ date, count: counts.get(date) ?? 0 });
    current.setDate(current.getDate() + 1);
  }

  return heatmap;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}
