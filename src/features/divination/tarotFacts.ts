import type { TarotCardResult } from "taibu-core/tarot";
import type { DivinationReadingFact } from "./divinationReading";

/**
 * 塔罗的「事实行」:把抽到的牌折成解卦请求里的标签 + 值。
 *
 * 放在这里而不是 divinationReading.ts,是因为后者对任何一种术数都保持不认识;
 * 塔罗自己的牌名、正逆位、元素、关键词只有塔罗这一侧知道。
 */

function keywordsOf(drawn: TarotCardResult): readonly string[] {
  const reversed = drawn.orientation === "reversed";
  const reversedKeywords = drawn.reversedKeywords ?? [];
  return reversed && reversedKeywords.length > 0 ? reversedKeywords : drawn.card.keywords;
}

function describeCard(drawn: TarotCardResult): string {
  const parts = [
    `${drawn.card.nameChinese}（${drawn.card.name}）`,
    drawn.orientation === "reversed" ? "逆位" : "正位",
  ];
  if (drawn.element !== undefined && drawn.element !== "") parts.push(`${drawn.element}元素`);
  const keywords = keywordsOf(drawn);
  if (keywords.length > 0) parts.push(`关键词：${keywords.join("、")}`);
  return parts.join(" · ");
}

/** 今日一牌:一张牌拆成四行,模型按段写散文。 */
export function dailyTarotFacts(drawn: TarotCardResult): DivinationReadingFact[] {
  const facts: DivinationReadingFact[] = [
    { label: "牌名", value: `${drawn.card.nameChinese}（${drawn.card.name}）` },
    { label: "正逆", value: drawn.orientation === "reversed" ? "逆位" : "正位" },
  ];
  if (drawn.element !== undefined && drawn.element !== "") {
    facts.push({ label: "元素", value: drawn.element });
  }
  const keywords = keywordsOf(drawn);
  if (keywords.length > 0) {
    facts.push({ label: "关键词", value: keywords.join("、") });
  }
  return facts;
}

/** 牌阵:一张牌一行,标签即牌位,【逐条】直接照着写。 */
export function spreadTarotFacts(cards: readonly TarotCardResult[]): DivinationReadingFact[] {
  return cards.map((drawn, index) => ({
    label: `${index + 1} ${drawn.position}`,
    value: describeCard(drawn),
  }));
}
