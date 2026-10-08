/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { hepanPanel } from "../src/view/bushi/hepanPanel";

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

interface Side {
  birthDate: string;
  birthTime: string;
  gender: string;
}

function side(birthDate: string): Side {
  return { birthDate, birthTime: "10:00", gender: "male" };
}

async function chipsOf(a: Side, b: Side): Promise<{ chips: string[]; verdict: string }> {
  const host = document.createElement("div");
  const cleanup = hepanPanel.render(host, { a, b });
  host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
  await flush();
  const chips = Array.from(host.querySelectorAll(".ad-hp-relations .ad-bp-chip")).map((element) => element.textContent ?? "");
  const verdict = host.querySelector(".ad-ly-line")?.textContent ?? "";
  cleanup();
  return { chips, verdict };
}

describe("八字合盘空态", () => {
  it("首次打开时给出说明,不是整块空白", () => {
    const host = document.createElement("div");
    const cleanup = hepanPanel.render(host, {});
    const notice = host.querySelector(".ad-bp-panel__result .ad-module-state--empty");
    expect(notice).not.toBeNull();
    expect(notice?.textContent).toContain("点「合盘」");
    cleanup();
  });
});

describe("八字合盘关系(R2)", () => {
  it("does not invent 半合 for two identical charts", async () => {
    const { chips, verdict } = await chipsOf(side("1990-01-01"), side("1990-01-01"));
    expect(chips.filter((chip) => chip.includes("半合"))).toHaveLength(0);
    expect(verdict).toContain("没有触发明面");
  });

  it("does not report 半合 when the same-position branches are identical", async () => {
    const { chips } = await chipsOf(side("1990-01-01"), side("1990-01-06"));
    expect(chips.some((chip) => chip.includes("半合"))).toBe(false);
    // 该组合的日柱是 丙/辛:五合优先,不能再报一条相克。
    const dayChips = chips.filter((chip) => chip.startsWith("日柱"));
    expect(dayChips).toHaveLength(1);
    expect(dayChips[0]).toContain("天干五合");
    expect(dayChips[0]).not.toContain("相克");
  });

  it("stays identical when the two sides are swapped", async () => {
    const forward = await chipsOf(side("1990-01-01"), side("1992-03-15"));
    const swapped = await chipsOf(side("1992-03-15"), side("1990-01-01"));
    expect(swapped.chips).toEqual(forward.chips);
    expect(swapped.verdict).toBe(forward.verdict);
    // 修复前正向是「3 合 / 3 冲」,互换是「4 合 / 1 冲」,判语随填表顺序变。
    expect(forward.verdict).toContain("冲克");
    expect(forward.verdict).toContain("生");
  });

  it("reports 乙克甲 direction instead of dropping it", async () => {
    const { chips } = await chipsOf(side("1990-01-01"), side("1992-03-15"));
    // 月柱 丙(火)/癸(水):水克火,是「乙方克甲方」,修复前完全不显示。
    expect(chips.some((chip) => chip === "月柱 天干相克:癸(水)克丙(火)")).toBe(true);
  });
});
