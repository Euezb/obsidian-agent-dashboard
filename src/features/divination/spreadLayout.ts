/**
 * 牌阵几何。
 *
 * taibu-core 的每个牌阵都带固定的 positions —— 牌位就是牌义的一部分:
 * 同一张宝剑二落在「现状」和落在「结果」是两种读法。
 * 所以牌阵不能一律按等宽格子铺:凯尔特十字要摆成「十字 + 权杖」(2 横压在 1 上)、
 * 马蹄形要成一条弧线、抉择要上下分叉 —— 现在这些关系在版面上完全看不见。
 *
 * 这张表只说「怎么摆」,不碰 DOM,因此可以对每个牌阵逐一断言
 * (见 tests/tarot-spread-layout.test.ts)。
 *
 * 注意:三牌阵、身心灵、处境/障碍/建议 这类**同权横排**的阵不需要几何 ——
 * 从左到右本来就是正确的读序,给它们类名只是让列宽跟着面板走。
 */

export interface SpreadLayout {
  /** 覆盖在 .ad-spread 上的牌阵类名,决定用哪一套几何。 */
  className: string;
  /** 真阵:每张牌下面只留紧凑读牌(牌位名 + 牌名 + 至多两个关键词)。 */
  shaped: boolean;
  /** 牌宽(px);缺省由样式表里的 --ad-card-w 给。 */
  cardWidth?: number;
  /** 每张牌落在哪个 grid-area(下标 = 牌的下标,从 0 起);缺省按 DOM 顺序。 */
  areas?: readonly string[];
  /**
   * 叠成一摞的牌(下标从 0 起)。凯尔特十字的第 1、2 张是一摞:
   * 2 横过来压在 1 上,两张的牌位文字排在摞下面而不是叠着写。
   */
  pile?: { readonly slots: readonly number[]; readonly crossing: number };
}

/** 真阵共用的标记类:grid 铺开、牌宽由格子给、窄栏降级也认它。 */
export const SHAPED_SPREAD_CLASS = "ad-spread--shaped";

/**
 * 需要几何的牌阵。键与 taibu-core 的 TAROT_SPREADS[].id 一一对应;
 * 不在表里的(单牌 / 是否)沿用既有的单牌排版。
 */
const LAYOUTS: Readonly<Record<string, SpreadLayout>> = Object.freeze({
  "three-card": { className: "ad-spread--three-card", shaped: true },
  love: { className: "ad-spread--love", shaped: true },
  "mind-body-spirit": { className: "ad-spread--mind-body-spirit", shaped: true },
  situation: { className: "ad-spread--situation", shaped: true },

  // 弧线即时间轴:中央最高、两端落地。
  horseshoe: { className: "ad-spread--horseshoe", shaped: true, cardWidth: 118 },

  // 处境在左,两条路上下分叉,各自的落点在右。
  decision: {
    className: "ad-spread--decision",
    shaped: true,
    areas: ["sit", "opt-a", "opt-b", "res-a", "res-b"],
  },

  // 十字(4 左 · 1 中 · 6 右 · 5 上 · 3 下)+ 右侧权杖 7→10;1、2 叠成一摞。
  "celtic-cross": {
    className: "ad-spread--celtic-cross",
    shaped: true,
    areas: [
      "core", "core",
      "three", "four", "five", "six",
      "staff-7", "staff-8", "staff-9", "staff-10",
    ],
    pile: { slots: [0, 1], crossing: 1 },
  },
});

/** 取牌阵几何;不需要几何的牌阵返回 null(调用方按原有排版走)。 */
export function spreadLayoutOf(spreadId: string): SpreadLayout | null {
  const layout = LAYOUTS[spreadId];
  return layout === undefined ? null : layout;
}

/**
 * 把 N 张牌折成 DOM 里的落位:每个元素是一格,叠牌时一格覆盖多张。
 * 例:凯尔特十字 10 张 → [[0,1],[2],[3],…,[9]];
 * 其余牌阵每格一张,顺序不变 —— 抽牌动画(按 DOM 顺序错开翻牌)因此仍是读序。
 */
export function spreadSlots(
  cardCount: number,
  layout: SpreadLayout | null,
): ReadonlyArray<ReadonlyArray<number>> {
  const pile = layout?.pile;
  const piling = new Set(pile?.slots ?? []);
  const slots: number[][] = [];
  for (let index = 0; index < cardCount; index += 1) {
    if (piling.has(index)) {
      // 一摞只在它的第一张处开一格,后续成员并进去。
      if (pile !== undefined && index === pile.slots[0]) slots.push([...pile.slots]);
      continue;
    }
    slots.push([index]);
  }
  return slots;
}

/** 一格落在哪个 grid-area:叠牌用第一张的牌位,其余按牌自己的下标。 */
export function slotArea(
  layout: SpreadLayout | null,
  slot: ReadonlyArray<number>,
): string | null {
  const first = slot[0];
  if (layout?.areas === undefined || first === undefined) return null;
  return layout.areas[first] ?? null;
}
