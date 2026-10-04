/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { createXuanxueSessionState, panelStorage } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";
import { hepanPanel } from "../src/view/bushi/hepanPanel";
import { fortunePanel } from "../src/view/bushi/fortunePanel";

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe("hepanPanel", () => {
  it("renders both birth sides", () => {
    const host = document.createElement("div");
    const cleanup = hepanPanel.render(host, {});
    expect(host.textContent).toContain("甲方");
    expect(host.textContent).toContain("乙方");
    expect(host.textContent).toContain("合盘");
    cleanup();
  });

  it("computes both charts and the relation chips", async () => {
    const storage: Record<string, unknown> = {
      a: { birthDate: "1990-01-01", birthTime: "10:00", gender: "male" },
      b: { birthDate: "1992-03-15", birthTime: "08:30", gender: "female" },
    };
    const host = document.createElement("div");
    const cleanup = hepanPanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(storage.error).toBeUndefined();
    expect(storage.resultA).toBeDefined();
    expect(storage.resultB).toBeDefined();
    expect(host.querySelectorAll(".ad-hp-side")).toHaveLength(2);
    expect(host.querySelectorAll(".ad-hp-pillar")).toHaveLength(8);
    expect(host.querySelectorAll(".ad-hp-stats__row")).toHaveLength(5);
    expect(host.textContent).toContain("柱间关系");
    expect(host.textContent).toContain("五行互补");
    cleanup();
  });
});

describe("fortunePanel", () => {
  it("renders the base form with day/month views", () => {
    const host = document.createElement("div");
    const cleanup = fortunePanel.render(host, {});
    const views = Array.from(host.querySelectorAll<HTMLElement>(".ad-bp-segmented button"))
      .filter((button) => button.textContent === "日运" || button.textContent === "月运");
    expect(views).toHaveLength(2);
    expect(host.textContent).toContain("排运");
    cleanup();
  });

  it("computes a day fortune with ten-god relation", async () => {
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

    expect(storage.error).toBeUndefined();
    expect(storage.dayMaster).toBe("丙");
    expect(storage.day).toBeDefined();
    expect(host.textContent).toContain("当日十神");
    expect(host.textContent).toContain("宜");
    cleanup();
  });

  it("computes a month grid with one cell per day", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      dayDate: "2026-09-29",
      monthKey: "2026-09",
      isMonth: true,
    };
    const host = document.createElement("div");
    const cleanup = fortunePanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(storage.error).toBeUndefined();
    expect(storage.monthDays).toBeDefined();
    // 2026 年 9 月有 30 天。
    expect(host.querySelectorAll(".ad-fo-grid__day")).toHaveLength(30);
    expect(host.textContent).toContain("流月");
    cleanup();
  });
});

describe("renderBushi registry", () => {
  it("exposes all nine methods in the switcher", () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });
    const labels = Array.from(container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"))
      .map((button) => button.textContent);
    expect(labels).toEqual([
      "小六壬", "塔罗", "六爻", "太乙", "大六壬", "八字", "紫微", "八字合盘", "日运月运",
    ]);
    cleanup();
  });

  it("keeps fortune results through re-render", async () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });
    const jump = (id: string): void => {
      const button = Array.from(container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"))
        .find((entry) => entry.dataset.method === id);
      button?.click();
    };
    jump("fortune");
    // 面板默认生年是当前年,先固定成与其它测试一致的生日。
    const dateInput = container.querySelector<HTMLInputElement>('input[aria-label="出生日期"]');
    const timeInput = container.querySelector<HTMLInputElement>('input[aria-label="出生时间"]');
    if (dateInput !== null) dateInput.value = "1990-01-01";
    if (timeInput !== null) timeInput.value = "10:00";
    const dayInput = container.querySelector<HTMLInputElement>('input[aria-label="查询日期"]');
    if (dayInput !== null) dayInput.value = "2026-09-29";
    container.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();
    expect(panelStorage(session, "fortune").dayMaster).toBe("丙");
    cleanup();
  });
});
