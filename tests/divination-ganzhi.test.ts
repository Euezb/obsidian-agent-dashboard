import { describe, expect, it } from "vitest";
import { elementRelationNote, tenGodOf } from "../src/features/divination/ganzhi";

/**
 * R4 回归:十神映射从面板里抽出来锁死。
 * 命理口径:同我(比肩/劫财)、我生(食神/伤官)、生我(偏印/正印)、我克(偏财/正财)、克我(七杀/正官),
 * 每组内按阴阳同性/异性分开。
 */
describe("tenGodOf", () => {
  it("maps 甲日主 to the whole stem cycle", () => {
    const expected: Record<string, string> = {
      甲: "比肩", 乙: "劫财", 丙: "食神", 丁: "伤官", 戊: "偏财",
      己: "正财", 庚: "七杀", 辛: "正官", 壬: "偏印", 癸: "正印",
    };
    for (const [gan, god] of Object.entries(expected)) {
      expect(tenGodOf("甲", gan), `甲 → ${gan}`).toBe(god);
    }
  });

  it("maps 丙日主 to the whole stem cycle", () => {
    const expected: Record<string, string> = {
      丙: "比肩", 丁: "劫财", 戊: "食神", 己: "伤官", 庚: "偏财",
      辛: "正财", 壬: "七杀", 癸: "正官", 甲: "偏印", 乙: "正印",
    };
    for (const [gan, god] of Object.entries(expected)) {
      expect(tenGodOf("丙", gan), `丙 → ${gan}`).toBe(god);
    }
  });

  it("returns an empty string for unknown stems", () => {
    expect(tenGodOf("甲", "")).toBe("");
    expect(tenGodOf("", "甲")).toBe("");
    expect(tenGodOf("甲", "子")).toBe("");
  });
});

describe("elementRelationNote", () => {
  it("switches the unit word between 日运 and 月运", () => {
    expect(elementRelationNote("丙", "戊", "日")).toContain("付出日");
    expect(elementRelationNote("丙", "戊", "月")).toContain("付出月");
    expect(elementRelationNote("丙", "戊", "月")).not.toContain("付出日");
  });

  it("covers same / 生我 / 我克 / 克我 branches", () => {
    expect(elementRelationNote("丙", "丁")).toContain("同五行");
    expect(elementRelationNote("丙", "甲")).toContain("补给");
    expect(elementRelationNote("丙", "庚")).toContain("掌控");
    expect(elementRelationNote("丙", "壬")).toContain("压力");
  });

  it("defaults to the 日 unit and stays empty for unknown stems", () => {
    expect(elementRelationNote("丙", "戊")).toContain("付出日");
    expect(elementRelationNote("丙", "子")).toBe("");
  });
});
