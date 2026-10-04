/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { fortunePanel } from "../src/view/bushi/fortunePanel";

/**
 * R4 端到端:月运的「流月」必须是月柱干支(2026-09-15 落在白露月 → 丁酉),
 * 而不是当月 1 号的日干支(2026-09-01 = 戊寅,那是流日口径)。
 * 出生盘日主 丙,丁酉月的月干 丁 与日主同五行 → 评语应是「与日主同五行」。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

interface MonthDay {
  date: string;
  ganZhi: string;
  tenGod: string;
}

describe("日运月运流月口径(R4)", () => {
  it("uses the 节气 month pillar for the 流月 headline", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      dayDate: "2026-09-15",
      monthKey: "2026-09",
      isMonth: true,
    };
    const host = document.createElement("div");
    const cleanup = fortunePanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(storage.error).toBeUndefined();
    expect(storage.monthSummary).toMatchObject({ ganZhi: "丁酉", tenGod: "劫财", jieQi: "白露" });

    const text = host.textContent ?? "";
    expect(text).toContain("流月 丁酉");
    expect(text).toContain("白露");
    expect(text).toContain("劫财");
    expect(text).toContain("山下火");
    // 评语用流月月干(丁 与 丙 同五行),而不是初一那天的日干(戊)。
    expect(text).toContain("与日主同五行");
    expect(text).not.toContain("付出月");
    expect(text).toContain("流月");
    cleanup();
  });

  it("keeps the month grid on the 流日 source with the 黄历 干支", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      dayDate: "2026-09-15",
      monthKey: "2026-09",
      isMonth: true,
    };
    const host = document.createElement("div");
    const cleanup = fortunePanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    const days = storage.monthDays as MonthDay[] | undefined;
    expect(days).toHaveLength(30);
    expect(days?.[0]).toMatchObject({ date: "2026-09-01", ganZhi: "戊寅", tenGod: "食神" });
    expect(host.querySelectorAll(".ad-fo-grid__day")).toHaveLength(30);
    cleanup();
  });

  it("falls back to mid-month when the 查询日期 is outside the 查询月份", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      dayDate: "2026-09-15",
      monthKey: "2026-01",
      isMonth: true,
    };
    const host = document.createElement("div");
    const cleanup = fortunePanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    // 2026-01-15 落在小寒月(己丑);跨年查表必须能取到上一年表里的小寒段。
    expect(storage.monthSummary).toMatchObject({ ganZhi: "己丑", jieQi: "小寒" });
    expect(host.textContent).toContain("流月 己丑");
    cleanup();
  });

  it("keeps the 日运 view on the 黄历 relation wording", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      dayDate: "2026-09-29",
      isMonth: false,
    };
    const host = document.createElement("div");
    const cleanup = fortunePanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(storage.dayMaster).toBe("丙");
    expect(host.textContent).toContain("当日十神");
    expect(host.textContent).toContain("宜");
    cleanup();
  });
});
