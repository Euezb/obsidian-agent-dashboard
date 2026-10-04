import { describe, expect, it } from "vitest";
import {
  pillarRelations,
  summarizeRelations,
  type RelationChart,
  type RelationHit,
} from "../src/features/divination/relations";

/** 四柱 fixture:每个参数是 2 字干支,例如 "己巳"。 */
function chart(year: string, month: string, day: string, hour: string): RelationChart {
  const pillar = (value: string) => ({ stem: value.slice(0, 1), branch: value.slice(1, 2) });
  return { fourPillars: { year: pillar(year), month: pillar(month), day: pillar(day), hour: pillar(hour) } };
}

function kinds(hits: readonly RelationHit[]): string[] {
  return hits.map((hit) => `${hit.position}${hit.kind}`).sort();
}

const A = chart("己巳", "丙子", "丙寅", "癸巳"); // 1990-01-01 10:00
const B = chart("壬申", "癸卯", "庚寅", "辛巳"); // 1992-03-15 08:30

describe("pillarRelations", () => {
  it("does not treat two identical branches as 半合", () => {
    const same = chart("甲子", "甲子", "甲子", "甲子");
    const hits = pillarRelations(same, same);
    expect(hits.filter((hit) => hit.kind === "地支半合")).toHaveLength(0);
    expect(hits).toHaveLength(0);
    expect(summarizeRelations(hits).verdict).toContain("没有触发明面");
  });

  it("counts 半合 only when the two branches differ", () => {
    const hits = pillarRelations(chart("甲子", "甲子", "甲子", "甲子"), chart("甲辰", "甲辰", "甲辰", "甲辰"));
    const banHe = hits.filter((hit) => hit.kind === "地支半合");
    expect(banHe).toHaveLength(4);
    expect(banHe[0]?.detail).toContain("水局");
  });

  it("reports 六合 and 相冲 for the branch pairs that have them", () => {
    const liuHe = pillarRelations(chart("甲子", "甲子", "甲子", "甲子"), chart("甲丑", "甲丑", "甲丑", "甲丑"));
    expect(new Set(kinds(liuHe))).toEqual(
      new Set(["年柱地支六合", "月柱地支六合", "日柱地支六合", "时柱地支六合"]),
    );
    const chong = pillarRelations(chart("甲子", "甲子", "甲子", "甲子"), chart("甲午", "甲午", "甲午", "甲午"));
    expect(chong.every((hit) => hit.kind === "地支相冲" && hit.tone === "warn")).toBe(true);
  });

  it("keeps 五合 and 相克 mutually exclusive on the same pillar", () => {
    const hits = pillarRelations(chart("甲子", "甲子", "丙子", "甲子"), chart("甲子", "甲子", "辛子", "甲子"));
    const dayStem = hits.filter((hit) => hit.position === "日柱" && hit.kind.startsWith("天干"));
    expect(dayStem).toHaveLength(1);
    expect(dayStem[0]?.kind).toBe("天干五合");
    expect(dayStem[0]?.detail).toContain("合化水");
    expect(hits.some((hit) => hit.kind === "天干相克")).toBe(false);
  });

  it("detects 相生 in both directions with the direction written out", () => {
    const forward = pillarRelations(chart("甲子", "甲子", "甲子", "甲子"), chart("甲子", "甲子", "丙子", "甲子"));
    expect(forward.map((hit) => hit.detail)).toEqual(["甲(木)生丙(火)"]);
    const backward = pillarRelations(chart("甲子", "甲子", "丙子", "甲子"), chart("甲子", "甲子", "甲子", "甲子"));
    expect(backward.map((hit) => hit.detail)).toEqual(["甲(木)生丙(火)"]);
  });

  it("detects 相克 when the second chart is the one that controls", () => {
    const hits = pillarRelations(chart("甲子", "甲子", "丙子", "甲子"), chart("甲子", "甲子", "壬子", "甲子"));
    expect(hits.map((hit) => hit.kind)).toEqual(["天干相克"]);
    expect(hits[0]?.detail).toBe("壬(水)克丙(火)");
    expect(hits[0]?.tone).toBe("warn");
  });

  it("stays identical when 甲/乙 互换 (direction shown, set mirrored)", () => {
    const forward = pillarRelations(A, B);
    const backward = pillarRelations(B, A);
    expect(kinds(backward)).toEqual(kinds(forward));
    expect(summarizeRelations(backward)).toEqual(summarizeRelations(forward));
    expect(forward.map((hit) => hit.detail).sort()).toEqual(backward.map((hit) => hit.detail).sort());
  });

  it("reports the 日主 relation once (via the 日柱 stems), not three times", () => {
    const hits = pillarRelations(A, B);
    const dayPillar = hits.filter((hit) => hit.position === "日柱");
    expect(dayPillar).toHaveLength(1);
    expect(dayPillar[0]?.detail).toBe("丙(火)克庚(金)");
    expect(hits.some((hit) => hit.position === "日主")).toBe(false);
  });
});

describe("summarizeRelations", () => {
  it("splits 合 / 生 / 冲克 and counts the real chart pair", () => {
    const summary = summarizeRelations(pillarRelations(A, B));
    expect(summary).toMatchObject({ he: 1, sheng: 1, chongKe: 3, total: 5 });
    expect(summary.verdict).toContain("冲克");
    expect(summary.verdict).toContain("合 1");
  });

  it("says 无冲克 when only favourable relations exist", () => {
    const summary = summarizeRelations(pillarRelations(chart("甲子", "甲子", "甲子", "甲子"), chart("甲丑", "甲丑", "甲丑", "甲丑")));
    expect(summary.chongKe).toBe(0);
    expect(summary.verdict).toContain("无冲克");
  });
});
