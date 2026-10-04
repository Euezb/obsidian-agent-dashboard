import { describe, expect, it } from "vitest";
import { currentLunarYear, lunarMonthDayCount } from "../src/features/divination/lunarMonth";

/**
 * R8 回归:小六壬面板没有年份输入,农历日上限按「当前农历年」的同名月天数校验。
 * 2026 农历年的天数取自 lunar-javascript。
 */
describe("lunarMonthDayCount", () => {
  it("returns the real day count of a lunar month", () => {
    expect(lunarMonthDayCount(2026, 1)).toBe(30);
    expect(lunarMonthDayCount(2026, 2)).toBe(29);
    expect(lunarMonthDayCount(2026, 6)).toBe(30);
    expect(lunarMonthDayCount(2026, 12)).toBe(29);
  });

  it("uses the absolute month so a leap-month selection still resolves", () => {
    expect(lunarMonthDayCount(2026, -2)).toBe(29);
  });

  it("returns null for months that do not exist", () => {
    expect(lunarMonthDayCount(2026, 0)).toBeNull();
    expect(lunarMonthDayCount(2026, 13)).toBeNull();
  });

  it("returns null instead of a nonsense count for absurd years", () => {
    expect(lunarMonthDayCount(99999, 1)).toBeNull();
  });
});

describe("currentLunarYear", () => {
  it("reads the lunar year of a solar date", () => {
    expect(currentLunarYear(new Date(2026, 8, 29))).toBe(2026);
    expect(currentLunarYear(new Date(2026, 0, 5))).toBe(2025);
  });
});
