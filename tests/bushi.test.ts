/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { loadAlmanacCard, localDateKey } from "../src/features/divination/almanacCard";
import { createXuanxueSessionState, panelStorage } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";
import { renderDashboard } from "../src/view/renderState";
import { MOCK_DASHBOARD_STATE } from "../src/data/mockDashboard";

/** flush 掉面板里 Promise 化后的同步计算(taibu-core 计算是同步/微任务级)。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("almanacCard", () => {
  it("maps a fixed date to card fields", async () => {
    const card = await loadAlmanacCard(new Date(2026, 8, 29));
    expect(card.dateKey).toBe("2026-09-29");
    expect(card.solarText).toBe("2026-09-29 星期二");
    expect(card.ganZhi).toBe("丙午");
    expect(card.zodiac).toBe("马");
    expect(card.lunarText).toBe("二〇二六年八月十九");
    expect(card.yi).toContain("祭祀");
    expect(card.ji).toContain("开市");
    expect(card.chongSha).toContain("煞北");
    expect(card.directions).toContain("财神西南");
    expect(card.meta).toContain("纳音天河水");
    expect(card.tianShen).toContain("值神金匮");
  });

  it("pads the local date key", () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("renderBushi", () => {
  it("renders the switcher with 小六壬 active by default", () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });

    // renderBushi 把 data-region 写在传入容器自身上(真实宿主是 inner 的 section)。
    expect(container.dataset.region).toBe("bushi");
    expect(container.classList.contains("ad-section")).toBe(true);
    const buttons = Array.from(container.querySelectorAll(".ad-bushi__switcher button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "小六壬", "塔罗", "六爻", "太乙", "大六壬", "八字", "紫微", "八字合盘", "日运月运",
    ]);
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".ad-bushi__note")?.textContent).toContain("本地计算");
    // 默认面板:小六壬表单已渲染。
    expect(container.querySelector("button.ad-bp-submit")?.textContent).toBe("起课");
    cleanup();
  });

  it("computes 小六壬 and keeps the result across re-renders", async () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });

    const submit = container.querySelector<HTMLButtonElement>("button.ad-bp-submit");
    expect(submit).not.toBeNull();
    submit?.click();
    await flush();
    expect(container.textContent).toContain("宫");
    const first = container.querySelector(".ad-bp-result");
    expect(first).not.toBeNull();

    // 整页重渲染(模拟资讯到达)后结果仍在。
    const storage = panelStorage(session, "xiaoliuren");
    expect(storage.lunarMonth).toBeTypeOf("number");
    expect(storage.result).toBeDefined();

    cleanup();
    const second = document.createElement("div");
    renderBushi(second, { session });
    expect(second.textContent).toContain("宫");
  });

  it("switches to 塔罗 and draws cards with a stable seed", async () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });

    const tarotButton = Array.from(
      container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"),
    ).find((button) => button.textContent === "塔罗");
    expect(tarotButton).toBeDefined();
    tarotButton?.click();
    expect(session.activeMethod).toBe("tarot");
    expect(tarotButton?.getAttribute("aria-pressed")).toBe("true");
    expect(
      Array.from(container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"))
        .find((button) => button.textContent === "小六壬")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");

    const submit = container.querySelector<HTMLButtonElement>("button.ad-bp-submit");
    submit?.click();
    await flush();
    expect(container.textContent).toContain("单牌");
    // 结果画成真牌面:单牌阵是一张加大了档位的牌,不再是文字格。
    expect(container.querySelectorAll(".ad-card").length).toBe(1);
    expect(container.querySelector(".ad-card--xl")).not.toBeNull();
    expect(container.querySelector(".ad-spread--single")).not.toBeNull();

    cleanup();
    container.querySelector(".ad-bushi__switcher button"); // 已卸载,不再有计算副作用
    cleanup();
  });

  it("preserves per-panel isolation when switching back", async () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });

    // 先真算一次小六壬(点提交,而不是点已激活的切换按钮)。
    const submit = container.querySelector<HTMLButtonElement>("button.ad-bp-submit");
    submit?.click();
    await flush();
    const stored = panelStorage(session, "xiaoliuren").result;
    expect(stored).toBeDefined();

    const buttons = Array.from(
      container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"),
    );
    buttons[1]?.click(); // 切到塔罗
    expect(session.activeMethod).toBe("tarot");
    buttons[0]?.click(); // 切回小六壬,结果没丢
    expect(session.activeMethod).toBe("xiaoliuren");
    expect(panelStorage(session, "xiaoliuren").result).toBe(stored);
    expect(container.textContent).toContain("宫");
    cleanup();
  });
});

describe("renderDashboard with 卜筮", () => {
  it("appends the bushi region after discovery", () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "自动更新完成",
      onNewDiary: () => undefined,
      bushi: { session },
    });

    const inner = container.querySelector(".agent-dashboard__inner");
    expect(
      Array.from(inner?.children ?? []).map((region) => region.getAttribute("data-region")),
    ).toEqual(["header", "today", "pulse", "discovery", "bushi"]);
    cleanup();
  });

  it("renders the almanac card when provided and skips it when null", () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const build = (almanac: Parameters<typeof renderDashboard>[2]["almanac"]) =>
      renderDashboard(container, MOCK_DASHBOARD_STATE, {
        status: "自动更新完成",
        onNewDiary: () => undefined,
        bushi: { session },
        almanac,
      });

    build(null);
    expect(container.querySelector(".ad-almanac")).toBeNull();

    const card = {
      dateKey: "2026-09-29",
      solarText: "2026-09-29 星期二",
      lunarText: "二〇二六年八月十九",
      ganZhi: "丙午",
      zodiac: "马",
      tianShen: "值神金匮(黄道·吉)",
      yi: ["祭祀"],
      ji: ["开市"],
      chongSha: "冲(庚子)鼠 煞北",
      directions: "财神西南",
      meta: "纳音天河水",
    };
    const cleanup = build(card);
    const almanac = container.querySelector(".ad-almanac");
    expect(almanac).not.toBeNull();
    expect(almanac?.textContent).toContain("今日黄历");
    expect(almanac?.textContent).toContain("丙午");
    expect(almanac?.textContent).toContain("宜");
    expect(almanac?.textContent).toContain("忌");
    cleanup();
  });
});
