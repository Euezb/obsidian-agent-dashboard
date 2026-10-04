import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TAROT_CARDS } from "taibu-core/tarot";
import type { TarotCardDefinition, TarotCardResult } from "taibu-core/tarot";
import {
  describeTarotFace,
  tarotAssetPath,
  TAROT_ASSET_DIR,
  TAROT_BACK_FILE,
} from "../src/features/divination/tarotFace";

/**
 * 牌面模型的契约:78 张牌一张都不能漏。
 *
 * 牌面靠的是牌名 → 素材文件名的推导,推错一张就是一张空白牌(用户只会看到一块纸)。
 * 所以这里不是抽查几张,而是把 taibu-core 的整副牌走一遍,
 * 并且真的去 assets/tarot/ 里确认文件在位。
 */
const assetDir = resolve(import.meta.dirname, "..", TAROT_ASSET_DIR);

function drawnOf(card: TarotCardDefinition): Pick<TarotCardResult, "card" | "orientation" | "number"> {
  return {
    card: { name: card.name, nameChinese: card.nameChinese, keywords: card.keywords },
    orientation: "upright",
    number: card.number,
  };
}

describe("塔罗牌面模型", () => {
  it("78 张牌都能推出素材文件", () => {
    expect(TAROT_CARDS.length).toBe(78);
    const missing = TAROT_CARDS.filter((card) => describeTarotFace(drawnOf(card)) === null);
    expect(missing.map((card) => card.name)).toEqual([]);
  });

  it("推出来的文件在 assets/tarot/ 里真实存在", () => {
    const missing = TAROT_CARDS.map((card) => describeTarotFace(drawnOf(card)))
      .filter((face) => face !== null)
      .map((face) => tarotAssetPath(face?.file ?? ""))
      .filter((path) => !existsSync(resolve(import.meta.dirname, "..", path)));
    expect(missing).toEqual([]);
  });

  it("78 张牌各对应一个互不相同的文件,没有重叠", () => {
    const files = TAROT_CARDS.map((card) => describeTarotFace(drawnOf(card))?.file);
    expect(new Set(files).size).toBe(78);
  });

  it("素材目录里没有多余或遗漏的文件(除牌背)", () => {
    const onDisk = readdirSync(assetDir).filter((name) => name.endsWith(".jpg"));
    const used = new Set(TAROT_CARDS.map((card) => describeTarotFace(drawnOf(card))?.file));
    const unused = onDisk.filter((name) => name !== TAROT_BACK_FILE && !used.has(name));
    expect(unused).toEqual([]);
    expect(existsSync(resolve(assetDir, TAROT_BACK_FILE))).toBe(true);
  });

  it("大阿卡纳按牌号取素材,角标走罗马数字", () => {
    const fool = describeTarotFace({
      card: { name: "The Fool", nameChinese: "愚者", keywords: [] },
      orientation: "upright",
      number: 0,
    });
    expect(fool?.file).toBe("00_Fool.jpg");
    expect(fool?.isMajor).toBe(true);
    expect(fool?.rank).toBe(0);

    const world = describeTarotFace({
      card: { name: "The World", nameChinese: "世界", keywords: [] },
      orientation: "upright",
      number: 21,
    });
    expect(world?.file).toBe("21_World.jpg");
  });

  it("小阿卡纳按「序号 + 花色」取素材,宫廷牌单列", () => {
    const threeOfCups = describeTarotFace({
      card: { name: "Three of Cups", nameChinese: "圣杯三", keywords: [] },
      orientation: "upright",
    });
    expect(threeOfCups?.file).toBe("Cups03.jpg");
    expect(threeOfCups?.suit).toBe("cups");
    expect(threeOfCups?.rank).toBe(3);
    expect(threeOfCups?.isCourt).toBe(false);

    const pageOfCups = describeTarotFace({
      card: { name: "Page of Cups", nameChinese: "圣杯侍从", keywords: [] },
      orientation: "upright",
    });
    expect(pageOfCups?.file).toBe("Cups11.jpg");
    expect(pageOfCups?.isCourt).toBe(true);

    const kingOfPentacles = describeTarotFace({
      card: { name: "King of Pentacles", nameChinese: "星币国王", keywords: [] },
      orientation: "upright",
    });
    expect(kingOfPentacles?.file).toBe("Pents14.jpg");
    expect(kingOfPentacles?.suit).toBe("pentacles");
  });

  it("逆位只改朝向,不改素材", () => {
    const upright = describeTarotFace({
      card: { name: "Ten of Swords", nameChinese: "宝剑十", keywords: [] },
      orientation: "upright",
    });
    const reversed = describeTarotFace({
      card: { name: "Ten of Swords", nameChinese: "宝剑十", keywords: [] },
      orientation: "reversed",
    });
    expect(upright?.isReversed).toBe(false);
    expect(reversed?.isReversed).toBe(true);
    expect(reversed?.file).toBe(upright?.file);
  });

  it("牌名对不上时返回 null,交给调用方降级", () => {
    expect(
      describeTarotFace({
        card: { name: "Nine of Comets", nameChinese: "彗星九", keywords: [] },
        orientation: "upright",
      }),
    ).toBeNull();
  });
});
