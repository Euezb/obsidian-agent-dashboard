import { calculateDailyAlmanac } from "taibu-core/almanac";
import type { AlmanacOutput } from "taibu-core/almanac";
import { localDateKey } from "../../domain/localDate";

/** 头部黄历卡所需的全部展示字段;映射后与 taibu-core 输出结构解耦。 */
export interface AlmanacCard {
  /** YYYY-MM-DD */
  dateKey: string;
  /** 2026-09-29 星期二 */
  solarText: string;
  /** 二〇二六年八月十九 */
  lunarText: string;
  /** 丙午 */
  ganZhi: string;
  zodiac: string;
  /** 金匮(黄道·吉) */
  tianShen: string;
  /** 宜做之事 */
  yi: string[];
  /** 忌讳之事 */
  ji: string[];
  /** 冲(庚子)鼠 煞北 */
  chongSha: string;
  /** 财神西南 · 喜神西南 · 福神西北 */
  directions: string;
  /** 纳音天河水 · 室宿(吉) */
  meta: string;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function directionsSummary(value: unknown): string {
  if (typeof value !== "object" || value === null) return "";
  const record = value as Record<string, unknown>;
  const parts: Array<[string, unknown]> = [
    ["财神", record.caiShen],
    ["喜神", record.xiShen],
    ["福神", record.fuShen],
  ];
  const rendered = parts
    .filter(([, direction]) => text(direction) !== "")
    .map(([label, direction]) => `${label}${text(direction)}`);
  return rendered.join(" · ");
}

/**
 * 将 taibu-core 的黄历输出收敛为卡片字段。
 * 计算是纯本地的(毫秒级),跨天由调用方负责触发重取。
 */
export function mapAlmanacCard(
  output: AlmanacOutput,
  dateKey: string,
  weekday: string,
): AlmanacCard {
  const detail = (typeof output.almanac === "object" && output.almanac !== null
    ? output.almanac
    : {}) as Record<string, unknown>;
  const lunarDate = text(detail.lunarDate);
  const mansion = text(detail.lunarMansion);
  const mansionLuck = text(detail.lunarMansionLuck);
  const nayin = text(detail.nayin);
  const metaParts = [nayin !== "" ? `纳音${nayin}` : ""];
  if (mansion !== "") metaParts.push(`${mansion}宿(${mansionLuck})`);
  const tianShen = text(detail.tianShen);
  const tianShenType = text(detail.tianShenType);
  const tianShenLuck = text(detail.tianShenLuck);
  const tianShenDetail =
    tianShen === ""
      ? ""
      : `值神${tianShen}${tianShenType === "" ? "" : `(${tianShenType}${tianShenLuck === "" ? "" : `·${tianShenLuck}`})`}`;

  return {
    dateKey,
    solarText: `${dateKey} 星期${weekday}`,
    lunarText: lunarDate === "" ? dateKey : lunarDate,
    ganZhi: text(output.dayInfo?.ganZhi) || text(output.date),
    zodiac: text(detail.zodiac),
    tianShen: tianShenDetail,
    yi: textArray(detail.suitable),
    ji: textArray(detail.avoid),
    chongSha: text(detail.chongSha),
    directions: directionsSummary(detail.directions),
    meta: metaParts.filter((part) => part !== "").join(" · "),
  };
}

// 日期键的唯一实现在 domain/localDate（审查 D6）；这里转出一次，
// dailyFortune 与既有测试的 import 路径保持有效。
export { localDateKey };

export async function loadAlmanacCard(now: Date): Promise<AlmanacCard> {
  const dateKey = localDateKey(now);
  const output = await calculateDailyAlmanac({ date: dateKey });
  const weekday = WEEKDAYS[now.getDay()] ?? "";
  return mapAlmanacCard(output, dateKey, weekday);
}
