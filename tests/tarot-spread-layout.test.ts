import { describe, expect, it } from "vitest";
import { TAROT_SPREADS } from "taibu-core/tarot";
import {
  SHAPED_SPREAD_CLASS,
  slotArea,
  spreadLayoutOf,
  spreadSlots,
} from "../src/features/divination/spreadLayout";

/**
 * 牌阵几何的契约:
 * - 只有需要空间表意的阵才铺几何(单牌 / 是否沿用单牌排版);
 * - 凯尔特十字的 1、2 张折成一摞,其余按十字 + 权杖各就各位;
 * - 棋子(格子)数量与牌数对得上 —— 多一格空着、少一格丢牌,都是版面 bug。
 */
function spreadIds(): string[] {
  return TAROT_SPREADS.map((spread) => spread.id);
}

describe("牌阵几何", () => {
  it("覆盖 taibu-core 的全部牌阵,该铺几何的一个不落", () => {
    const shaped = spreadIds().filter((id) => spreadLayoutOf(id) !== null);
    expect(shaped.sort()).toEqual([
      "celtic-cross",
      "decision",
      "horseshoe",
      "love",
      "mind-body-spirit",
      "situation",
      "three-card",
    ]);
    // 单牌与「是否」都是一张牌,沿用单牌排版,不该被算成真阵。
    expect(spreadLayoutOf("single")).toBeNull();
    expect(spreadLayoutOf("yes-no")).toBeNull();
    // 库以后新增的牌阵:没有几何也不该崩,退回等宽格子。
    expect(spreadLayoutOf("not-a-spread")).toBeNull();
  });

  it("真阵都带 shaped 标记与自己的类名", () => {
    for (const id of spreadIds()) {
      const layout = spreadLayoutOf(id);
      if (layout === null) continue;
      expect(layout.shaped, id).toBe(true);
      expect(layout.className.startsWith("ad-spread--"), id).toBe(true);
    }
    expect(SHAPED_SPREAD_CLASS).toBe("ad-spread--shaped");
  });

  it("凯尔特十字:10 张折成 9 格,第 2 张横压在中心牌上", () => {
    const layout = spreadLayoutOf("celtic-cross");
    expect(layout).not.toBeNull();
    if (layout === null) return;
    expect(layout.areas).toHaveLength(10);
    expect(layout.pile).toEqual({ slots: [0, 1], crossing: 1 });

    const slots = spreadSlots(10, layout);
    expect(slots).toHaveLength(9);
    expect(slots[0]).toEqual([0, 1]);
    // 读序不能乱:第 3 张起依次是 3、4、5…10。
    expect(slots.slice(1)).toEqual([[2], [3], [4], [5], [6], [7], [8], [9]]);

    expect(slotArea(layout, [0, 1])).toBe("core");
    expect(slotArea(layout, [2])).toBe("three");
    expect(slotArea(layout, [3])).toBe("four");
    expect(slotArea(layout, [4])).toBe("five");
    expect(slotArea(layout, [5])).toBe("six");
    expect(slotArea(layout, [6])).toBe("staff-7");
    expect(slotArea(layout, [9])).toBe("staff-10");
  });

  it("抉择:处境 + 两条路 + 两个结果各自一格", () => {
    const layout = spreadLayoutOf("decision");
    if (layout === null) throw new Error("decision 应有几何");
    expect(spreadSlots(5, layout)).toEqual([[0], [1], [2], [3], [4]]);
    expect(["sit", "opt-a", "opt-b", "res-a", "res-b"].map((_, index) =>
      slotArea(layout, [index]))).toEqual(["sit", "opt-a", "opt-b", "res-a", "res-b"]);
  });

  it("马蹄形:七张一列排开,没有叠牌,牌宽比常规小一档", () => {
    const layout = spreadLayoutOf("horseshoe");
    if (layout === null) throw new Error("horseshoe 应有几何");
    expect(spreadSlots(7, layout)).toHaveLength(7);
    expect(layout.areas).toBeUndefined();
    expect(layout.cardWidth).toBe(118);
    expect(slotArea(layout, [0])).toBeNull();
  });

  it("三牌阵这类同权横排:有类名、没叠牌、没格子", () => {
    const layout = spreadLayoutOf("three-card");
    if (layout === null) throw new Error("three-card 应有类名");
    expect(layout.className).toBe("ad-spread--three-card");
    expect(spreadSlots(3, layout)).toEqual([[0], [1], [2]]);
  });

  it("牌数与牌阵对不上时按实际牌数折格,不丢牌", () => {
    const layout = spreadLayoutOf("celtic-cross");
    expect(spreadSlots(3, layout)).toEqual([[0, 1], [2]]);
    expect(spreadSlots(0, layout)).toEqual([]);
  });
});
