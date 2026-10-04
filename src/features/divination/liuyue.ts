import { calculateBaziLiuRiData, calculateBaziLiuYueData } from "taibu-core/bazi";

/**
 * 流月 / 流日的取数口径(纯函数)。
 *
 * 库的 `calculateBaziLiuYueData` 按**节气**切月(立春→惊蛰→…→小寒),
 * 干支是真正的月柱(例如 2026-09-15 落在白露月 → 丁酉),
 * 与「当月 1 号的日干支」(那是流日口径)不是一回事。
 */
export type LiuYueInfo = ReturnType<typeof calculateBaziLiuYueData>[number];
export type LiuRiInfo = ReturnType<typeof calculateBaziLiuRiData>[number];

/**
 * 查询月份对应的参考日:优先用用户填的查询日期(必须落在该月内),
 * 否则退回该月 15 日 —— 一个公历月可能跨两个节气月,取月中做代表最不容易误导。
 */
export function liuYueReferenceDate(monthKey: string, dayDate?: string): string {
  if (dayDate !== undefined && dayDate.startsWith(`${monthKey}-`)) return dayDate;
  return `${monthKey}-15`;
}

/**
 * 取出覆盖 dateKey 的那一段流月。
 * 调用方要把「上一年 + 本年」两张表合并传入:1 月的日期落在上一年表的小寒段里。
 */
export function findLiuYue(list: readonly LiuYueInfo[], dateKey: string): LiuYueInfo | undefined {
  return list.find((entry) => dateKey >= entry.startDate && dateKey <= entry.endDate);
}
