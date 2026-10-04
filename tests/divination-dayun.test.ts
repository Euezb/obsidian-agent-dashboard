import { describe, expect, it } from "vitest";
import { calculateBaziDayun } from "taibu-core/bazi-dayun";
import { currentDayunIndex } from "../src/features/divination/dayun";

/** 1990-01-01 10:00 生人的大运起始年(实测:1998 起运,9 虚岁起运)。 */
const START_YEARS = [1998, 2008, 2018, 2028];

describe("currentDayunIndex", () => {
  it("picks the step whose startYear window contains the year", () => {
    expect(currentDayunIndex(START_YEARS, 1998)).toBe(0);
    expect(currentDayunIndex(START_YEARS, 2007)).toBe(0);
    expect(currentDayunIndex(START_YEARS, 2008)).toBe(1);
    expect(currentDayunIndex(START_YEARS, 2017)).toBe(1);
    expect(currentDayunIndex(START_YEARS, 2018)).toBe(2);
    expect(currentDayunIndex(START_YEARS, 2027)).toBe(2);
  });

  it("returns -1 before 起运 and after the last step", () => {
    expect(currentDayunIndex(START_YEARS, 1990)).toBe(-1);
    expect(currentDayunIndex(START_YEARS, 1997)).toBe(-1);
    expect(currentDayunIndex(START_YEARS, 2038)).toBe(-1);
  });

  it("returns -1 for an empty list", () => {
    expect(currentDayunIndex([], 2026)).toBe(-1);
  });

  it("agrees with the library's own startYear for every real step", () => {
    const dayun = calculateBaziDayun({
      birthYear: 1990,
      birthMonth: 1,
      birthDay: 1,
      birthHour: 10,
      birthMinute: 0,
      gender: "male",
    });
    const startYears = dayun.list.map((step) => step.startYear);
    for (const [index, step] of dayun.list.entries()) {
      expect(currentDayunIndex(startYears, step.startYear), `step ${index} startYear`).toBe(index);
      expect(currentDayunIndex(startYears, step.startYear + 9), `step ${index} last year`).toBe(index);
      expect(currentDayunIndex(startYears, step.startYear - 1)).toBe(index - 1);
    }
    // startAge 是虚岁:首步 startYear = 出生年 + startAge - 1 —— 这正是旧
    // 「年份差 ∈ [startAge, startAge+10)」判断晚一年的原因。
    expect(startYears[0]! - 1990 + 1).toBe(dayun.list[0]!.startAge);
  });
});
