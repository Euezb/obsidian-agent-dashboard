import { describe, expect, it } from "vitest";
import { calculateTarot } from "taibu-core/tarot";
import { calculateXiaoliurenData } from "taibu-core/xiaoliuren";
import {
  dailyFortuneKey,
  dailyTarotSeed,
  loadDailyFortune,
  palmSteps,
  shichenName,
  XIAOLIUREN_PALACES,
} from "../src/features/divination/dailyFortune";

/**
 * 「今日运势」的口径契约(2026-09-30 定):
 * - 单抽:本地日期做种子,同一天里怎么打开都是同一张牌 —— 不能用库默认的 UTC 日期种子;
 * - 小六壬:时课口径,落宫取当前时辰,跨时辰换一课;
 * - 缓存键:日期 + 时辰,任一项变了才重算。
 * 这些是「算得对不对」的底线,用固定时间点锁住。
 */
const MORNING = new Date(2026, 8, 30, 10, 28); // 巳时
const AFTERNOON = new Date(2026, 8, 30, 15, 5); // 申时
const NEXT_DAY = new Date(2026, 9, 1, 10, 28); // 次日巳时

describe("今日运势的口径", () => {
  it("固定时间点的三份算据都落在预期上", async () => {
    const fortune = await loadDailyFortune(MORNING);
    expect(fortune.dateKey).toBe("2026-09-30");
    expect(fortune.shichenIndex).toBe(6);
    expect(fortune.shichen).toBe("巳");
    expect(fortune.lunarText).toBe("二〇二六年八月二十");
    expect(fortune.lunarMonth).toBe(8);
    expect(fortune.lunarDay).toBe(20);
    expect(fortune.tarot.card.nameChinese).toBe("宝剑二");
    expect(fortune.tarot.orientation).toBe("upright");
    expect(fortune.xiaoliuren.monthStatus).toBe("留连");
    expect(fortune.xiaoliuren.dayStatus).toBe("速喜");
    expect(fortune.xiaoliuren.hourStatus).toBe("留连");
    expect(fortune.xiaoliuren.result.name).toBe("留连");
  });

  it("单抽种子是本地日期,不用库默认的 UTC 日期", async () => {
    const fortune = await loadDailyFortune(MORNING);
    const direct = await calculateTarot({
      spreadType: "single",
      seed: dailyTarotSeed("2026-09-30"),
      allowReversed: true,
    });
    expect(fortune.tarot.card.name).toBe(direct.cards[0]?.card.name);
    expect(dailyTarotSeed("2026-09-30")).not.toContain("ad-daily-tarot|2026-09-29");
  });

  it("同一天里换时辰:牌不变,课会变,缓存键也跟着变", async () => {
    const morning = await loadDailyFortune(MORNING);
    const afternoon = await loadDailyFortune(AFTERNOON);
    expect(afternoon.dateKey).toBe(morning.dateKey);
    expect(afternoon.tarot.card.name).toBe(morning.tarot.card.name);
    expect(afternoon.shichen).toBe("申");
    expect(afternoon.xiaoliuren.hourStatus).not.toBe(morning.xiaoliuren.hourStatus);
    expect(dailyFortuneKey(AFTERNOON)).not.toBe(dailyFortuneKey(MORNING));
  });

  it("跨天后缓存键换,且按当天农历重新起课", async () => {
    expect(dailyFortuneKey(NEXT_DAY)).not.toBe(dailyFortuneKey(MORNING));
    const next = await loadDailyFortune(NEXT_DAY);
    expect(next.dateKey).toBe("2026-10-01");
    expect(next.lunarDay).toBe(21);
    const direct = await Promise.resolve(
      calculateXiaoliurenData({
        lunarMonth: next.lunarMonth,
        lunarDay: next.lunarDay,
        hour: next.shichenIndex,
      }),
    );
    expect(next.xiaoliuren.result.name).toBe(direct.result.name);
  });

  it("小时的时辰序号按子=1..亥=12,子时跨夜", () => {
    expect(shichenName(1)).toBe("子");
    expect(shichenName(6)).toBe("巳");
    expect(shichenName(12)).toBe("亥");
    expect(dailyFortuneKey(new Date(2026, 8, 30, 23, 30))).toBe(
      dailyFortuneKey(new Date(2026, 8, 30, 0, 30)),
    );
  });

  it("掌诀走位把月/日/时按时序落到对应宫位上", async () => {
    const fortune = await loadDailyFortune(MORNING);
    const steps = palmSteps(fortune.xiaoliuren);
    expect(steps.map((step) => step.palace)).toEqual([...XIAOLIUREN_PALACES]);
    const byPalace = new Map(steps.map((step) => [step.palace, step.tokens]));
    expect(byPalace.get("留连")).toEqual(["月", "时"]);
    expect(byPalace.get("速喜")).toEqual(["日"]);
    expect(byPalace.get("大安")).toEqual([]);
    // 时宫是最终落宫,一定带「时」。
    expect(steps.find((step) => step.tokens.includes("时"))?.palace).toBe(
      fortune.xiaoliuren.hourStatus,
    );
  });
});
