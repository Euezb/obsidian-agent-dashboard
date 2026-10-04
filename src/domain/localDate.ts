/**
 * 本地日历日与日期校验的唯一实现。
 *
 * 审查 D6：这两类工具原先各有 3–5 份拷贝（VaultScanner / almanacCard / fortunePanel /
 * externalDashboardState / FeedService / settings / ApiSummarizerService / githubTrending），
 * 任何一处的口径改动都不会传导到其它副本。
 *
 * 口径：日期键一律取「本地时区」的日历日 —— Vault 扫描、资讯缓存、黄历判定跨天
 * 用的是同一套东西；isCalendarDate 只认 YYYY-MM-DD，且必须是真实存在的日期
 * （`2026-02-30` 不通过）。
 */
export function localDateKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 时间戳版本的本地日历日键。 */
export function localCalendarDate(timestamp: number): string {
  return localDateKey(new Date(timestamp));
}

/** 真实存在的日历日校验。 */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day ?? 0));
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 0) - 1 &&
    date.getUTCDate() === day;
}
