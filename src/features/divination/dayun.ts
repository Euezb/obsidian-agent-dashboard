/**
 * 大运「当前步」的判定。
 *
 * DayunOutput.list[].startAge 是**虚岁**(首步 startYear = 出生年 + startAge − 1),
 * 所以拿「当前年 − 出生年」(≈周岁)去套 `age ∈ [startAge, startAge+10)` 会整体晚一年:
 * 起运年一步都匹配不上,之后每个换运年都高亮前一步。
 * 库已经给出了每一步的 startYear,直接用它判区间最稳。
 *
 * @returns 命中步的下标;起运前或超出列表返回 -1。
 */
export function currentDayunIndex(startYears: readonly number[], year: number): number {
  return startYears.findIndex((start) => year >= start && year < start + 10);
}
