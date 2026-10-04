import type { TarotCardResult } from "taibu-core/tarot";

/**
 * 塔罗牌面模型。
 *
 * taibu-core 只给牌名与正逆位,牌面要用的花色、序号、素材文件名都在这里推出来,
 * 是纯数据、不碰 DOM,因此可以对全部 78 张牌逐一断言(见 tests/tarotFace.test.ts)。
 *
 * 素材是 Rider-Waite(Smith,1909)公共领域扫描件,缩到 400×667 存在 assets/tarot/ 下,
 * 由 work/build-tarot-assets.ps1 生成。运行时只读本地文件,不走网络。
 */

/** 素材目录(相对插件根目录)。 */
export const TAROT_ASSET_DIR = "assets/tarot";

/** 牌背。 */
export const TAROT_BACK_FILE = "Cover.jpg";

/**
 * 大阿卡纳素材文件名(下标即牌号 0–21)。
 * 名字里有 "The"、有空格,靠字符串拼不出来,所以直接列表。
 */
const MAJOR_FILES: readonly string[] = [
  "00_Fool",
  "01_Magician",
  "02_High_Priestess",
  "03_Empress",
  "04_Emperor",
  "05_Hierophant",
  "06_Lovers",
  "07_Chariot",
  "08_Strength",
  "09_Hermit",
  "10_Wheel_of_Fortune",
  "11_Justice",
  "12_Hanged_Man",
  "13_Death",
  "14_Temperance",
  "15_Devil",
  "16_Tower",
  "17_Star",
  "18_Moon",
  "19_Sun",
  "20_Judgement",
  "21_World",
];

/** 小阿卡纳序号词 → 1–14。11 侍从 / 12 骑士 / 13 王后 / 14 国王。 */
const RANK_WORDS: Readonly<Record<string, number>> = {
  Ace: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
  Ten: 10,
  Page: 11,
  Knight: 12,
  Queen: 13,
  King: 14,
};

/** 花色名 → 素材文件前缀(素材沿用扫描件的 Pents 写法,不是 Pentacles)。 */
const SUIT_PREFIXES: Readonly<Record<string, string>> = {
  Wands: "Wands",
  Cups: "Cups",
  Swords: "Swords",
  Pentacles: "Pents",
};

/** "Three of Cups" → ["Three", "Cups"]。 */
const CARD_NAME_PATTERN = /^(Ace|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten|Page|Knight|Queen|King) of (Wands|Cups|Swords|Pentacles)$/;

export type TarotSuit = "major" | "wands" | "cups" | "swords" | "pentacles";

/** 相对路径 → 可放进 <img src> 的地址;拿不到返回 null(非文件系统 Vault 等)。 */
export type TarotAssetResolver = (relativePath: string) => string | null;

export interface TarotFace {
  /** 素材文件名(assets/tarot/ 下)。 */
  file: string;
  suit: TarotSuit;
  /** 大阿卡纳 0–21;小阿卡纳 1–14;取不到为 null。 */
  rank: number | null;
  /** 大阿卡纳用罗马数字角标。 */
  isMajor: boolean;
  /** 侍从/骑士/王后/国王。 */
  isCourt: boolean;
  isReversed: boolean;
}

function suitOf(prefix: string): TarotSuit {
  switch (prefix) {
    case "Wands":
      return "wands";
    case "Cups":
      return "cups";
    case "Swords":
      return "swords";
    default:
      return "pentacles";
  }
}

/**
 * 从 taibu-core 的抽牌结果推牌面。
 * 名字对不上(库改过牌名、或外部传入的脏数据)时返回 null,调用方降级成占位牌面。
 */
export function describeTarotFace(
  drawn: Pick<TarotCardResult, "card" | "orientation" | "number">,
): TarotFace | null {
  const reversed = drawn.orientation === "reversed";
  const number = drawn.number;
  if (typeof number === "number" && number >= 0 && number < MAJOR_FILES.length) {
    const file = MAJOR_FILES[number];
    if (file === undefined) return null;
    return {
      file: `${file}.jpg`,
      suit: "major",
      rank: number,
      isMajor: true,
      isCourt: false,
      isReversed: reversed,
    };
  }

  const match = CARD_NAME_PATTERN.exec(drawn.card.name);
  if (match === null) return null;
  const rankWord = match[1];
  const suitWord = match[2];
  if (rankWord === undefined || suitWord === undefined) return null;
  const rank = RANK_WORDS[rankWord];
  const prefix = SUIT_PREFIXES[suitWord];
  if (rank === undefined || prefix === undefined) return null;

  return {
    file: `${prefix}${String(rank).padStart(2, "0")}.jpg`,
    suit: suitOf(prefix),
    rank,
    isMajor: false,
    isCourt: rank >= 11,
    isReversed: reversed,
  };
}

/** 牌面对应的素材相对路径(插件根目录下);牌背用绝对常量。 */
export function tarotAssetPath(file: string): string {
  return `${TAROT_ASSET_DIR}/${file}`;
}
