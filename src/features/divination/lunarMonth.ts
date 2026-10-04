import { LunarMonth, Solar } from "lunar-javascript";

/**
 * 农历月天数。
 *
 * 小六壬面板只有「农历月 / 农历日」两个输入、没有年份(默认值取当天),
 * 所以校验口径是「当前农历年 + 输入的月份」:
 * 例如 2026 农历年二月只有 29 天,填 30 就该被拦下,而不是照样起课。
 * 取不到天数(不存在的月、异常年份)时返回 null —— 调用方不阻断,只是不校验。
 */
export function lunarMonthDayCount(lunarYear: number, month: number): number | null {
  try {
    // 闰月在该库里用负数表示,而面板口径只接受 1–12(与默认值同样取绝对值),
    // 因此这里也取绝对值,校验同名平月的天数。
    const info = LunarMonth.fromYm(lunarYear, Math.abs(month));
    const count = info?.getDayCount();
    return count === 29 || count === 30 ? count : null;
  } catch {
    return null;
  }
}

/** 某个公历日期所处的农历年;取不到返回 null。 */
export function currentLunarYear(now: Date): number | null {
  try {
    const year = Solar.fromDate(now).getLunar().getYear();
    return Number.isInteger(year) ? year : null;
  } catch {
    return null;
  }
}
