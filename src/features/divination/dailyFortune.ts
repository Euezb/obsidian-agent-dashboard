import { calculateTarot } from "taibu-core/tarot";
import type { TarotCardResult } from "taibu-core/tarot";
import { calculateXiaoliurenData } from "taibu-core/xiaoliuren";
import type { XiaoliurenOutput, XiaoliurenStatus } from "taibu-core/xiaoliuren";
import { Solar } from "lunar-javascript";
import { localDateKey } from "./almanacCard";
import { clockHourToShichen } from "./shichen";

/**
 * 「今日运势」的两份算据:每天一张的塔罗单抽 + 按当下一刻起的小六壬时课。
 *
 * 口径(2026-09-30 定):
 * - 取时用**时课**:落宫取当前时辰,跨时辰(每 2 小时)会换一课,和资讯板块同一节奏复查;
 * - 每日单抽用**本地日期**做种子,同一天里反复打开插件都是同一张牌。
 *   不能用库里那个默认种子 —— 它取的是 UTC 日期,东八区 0–8 点会被算成前一天;
 * - 全部本地计算,不联网、不落盘。
 */

export interface DailyFortune {
  /** 本地日期 YYYY-MM-DD。 */
  dateKey: string;
  /** 1–12 的时辰序号(子=1)。 */
  shichenIndex: number;
  /** 巳 */
  shichen: string;
  /** 二〇二六年八月二十 */
  lunarText: string;
  lunarMonth: number;
  lunarDay: number;
  /** 每日单抽(牌阵固定为单牌)。 */
  tarot: TarotCardResult;
  xiaoliuren: XiaoliurenOutput;
}

/** 小六壬六宫,按起课顺序(数宫就是这个次序)。 */
export const XIAOLIUREN_PALACES: readonly XiaoliurenStatus[] = [
  "大安",
  "留连",
  "速喜",
  "赤口",
  "小吉",
  "空亡",
];

const SHICHEN_NAMES: readonly string[] = [
  "子",
  "丑",
  "寅",
  "卯",
  "辰",
  "巳",
  "午",
  "未",
  "申",
  "酉",
  "戌",
  "亥",
];

/** 1–12 的时辰序号 → 子/丑/…/亥。 */
export function shichenName(index: number): string {
  const name = SHICHEN_NAMES[index - 1];
  return name === undefined ? "" : name;
}

/**
 * 缓存键:日期 + 时辰。
 * 时课口径下,跨时辰就该重算;只有日期变才重算会把落宫留在上一个时辰,那是错的。
 */
export function dailyFortuneKey(now: Date): string {
  return `${localDateKey(now)}#${clockHourToShichen(now.getHours())}`;
}

/** 每日单抽的种子:本地日期,不用库的 UTC 默认种子。 */
export function dailyTarotSeed(dateKey: string): string {
  return `ad-daily-tarot|${dateKey}`;
}

export interface PalmStep {
  palace: XiaoliurenStatus;
  /** 这一步落在这一宫;时宫是最终落宫。 */
  tokens: Array<"月" | "日" | "时">;
}

/** 把「月 → 日 → 时」三步折算成六宫上的标记;同一宫可能被多步踩到。 */
export function palmSteps(output: XiaoliurenOutput): PalmStep[] {
  const marks = new Map<XiaoliurenStatus, PalmStep["tokens"]>();
  const add = (palace: XiaoliurenStatus, token: PalmStep["tokens"][number]): void => {
    const existing = marks.get(palace);
    if (existing === undefined) marks.set(palace, [token]);
    else existing.push(token);
  };
  add(output.monthStatus, "月");
  add(output.dayStatus, "日");
  add(output.hourStatus, "时");

  return XIAOLIUREN_PALACES.map((palace) => ({
    palace,
    tokens: marks.get(palace) ?? [],
  }));
}

function lunarTextOf(now: Date): string {
  try {
    const lunar = Solar.fromDate(now).getLunar();
    return `${lunar.getYearInChinese()}年${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`;
  } catch {
    return "";
  }
}

/**
 * 农历月日。闰月在该库里用负数表示,而小六壬只接受 1–12,
 * 故取绝对值(闰月落到同名平月)—— 与卜筮面板的默认值同一口径。
 */
function lunarMonthDay(now: Date): { month: number; day: number } {
  try {
    const lunar = Solar.fromDate(now).getLunar();
    return { month: Math.abs(lunar.getMonth()), day: lunar.getDay() };
  } catch {
    return { month: 1, day: 1 };
  }
}

export async function loadDailyFortune(now: Date): Promise<DailyFortune> {
  const dateKey = localDateKey(now);
  const shichenIndex = clockHourToShichen(now.getHours());
  const { month, day } = lunarMonthDay(now);

  const drawn = await calculateTarot({
    spreadType: "single",
    seed: dailyTarotSeed(dateKey),
    allowReversed: true,
  });
  const card = drawn.cards[0];
  if (card === undefined) {
    throw new Error("每日单抽没有出牌");
  }

  // 库的声明写的是同步返回,实现却是 async;跟卜筮面板同一写法兜住两种口径。
  const xiaoliuren = await Promise.resolve(
    calculateXiaoliurenData({
      lunarMonth: month,
      lunarDay: day,
      hour: shichenIndex,
    }),
  );

  return {
    dateKey,
    shichenIndex,
    shichen: shichenName(shichenIndex),
    lunarText: lunarTextOf(now),
    lunarMonth: month,
    lunarDay: day,
    tarot: card,
    xiaoliuren,
  };
}
