/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { MOCK_DASHBOARD_STATE } from "../src/data/mockDashboard";
import { createXuanxueSessionState } from "../src/features/divination/bushiTypes";
import {
  loadDailyFortune,
  type DailyFortune,
} from "../src/features/divination/dailyFortune";
import { renderFortune } from "../src/view/renderFortune";
import { renderDashboard } from "../src/view/renderState";

/**
 * 「今日运势」板块的渲染契约:
 * - 骨架跟其余板块一致(批注 · 标题),用同一个 renderSectionHead;
 * - 右侧掌诀六格一排,被踩到的宫位标出月/日/时,不是只给一个落宫名;
 * - 牌面是牌面:素材拿得到就出图,拿不到就出写着牌名的占位牌,绝不退回文字表;
 * - 与卜筮同一个开关:不传 fortune 就整块不渲染。
 */
const MORNING = new Date(2026, 8, 30, 10, 28);
const assetUrl = (path: string): string => `app://local/plugin/${path}`;

async function fortuneOf(): Promise<DailyFortune> {
  return loadDailyFortune(MORNING);
}

describe("今日运势板块", () => {
  it("板块头与其余板块同骨架,批注写口径", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf());

    expect(container.dataset.region).toBe("fortune");
    expect(container.classList.contains("ad-section")).toBe(true);
    expect(container.querySelector(".ad-section__meta")?.textContent).toBe("每日一占");
    expect(container.querySelector(".ad-section__title")?.textContent).toBe("今日运势");
    cleanup();
  });

  it("掌诀六格按起课顺序排开,月/日/时落在对应宫位上", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf());

    const cells = Array.from(container.querySelectorAll<HTMLElement>(".ad-palm__cell"));
    expect(cells.map((cell) => cell.querySelector(".ad-palm__name")?.textContent)).toEqual([
      "大安", "留连", "速喜", "赤口", "小吉", "空亡",
    ]);
    expect(cells.map((cell) => cell.dataset.hit)).toEqual(["false", "true", "true", "false", "false", "false"]);

    const tokensOf = (palace: string): string[] => {
      const cell = cells.find((item) => item.querySelector(".ad-palm__name")?.textContent === palace);
      return Array.from(cell?.querySelectorAll(".ad-palm__token") ?? []).map(
        (token) => token.textContent ?? "",
      );
    };
    expect(tokensOf("留连")).toEqual(["月", "时"]);
    expect(tokensOf("速喜")).toEqual(["日"]);
    // 时宫即最终落宫,用填色 token 标出来。
    const hourToken = container.querySelector(".ad-palm__token--hour");
    expect(hourToken?.textContent).toBe("时");
    cleanup();
  });

  it("页脚把日期、时辰与三步落宫串成一行", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf());

    const foot = container.querySelector(".ad-fortune__foot")?.textContent ?? "";
    expect(foot).toContain("二〇二六年八月二十");
    expect(foot).toContain("巳时课");
    expect(foot).toContain("月宫留连");
    expect(foot).toContain("时宫留连");
    cleanup();
  });

  it("素材拿得到时出真牌面,alt 写明牌名与正逆", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf(), { resolveAsset: assetUrl });

    const image = container.querySelector<HTMLImageElement>(".ad-card__face--front img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("src")).toBe("app://local/plugin/assets/tarot/Swords02.jpg");
    expect(image?.getAttribute("alt")).toBe("宝剑二 · 正位");
    expect(container.querySelector(".ad-card__face--pending")).toBeNull();
    cleanup();
  });

  it("素材拿不到时出占位牌面,尺寸不变、不退回文字表", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf());

    const card = container.querySelector(".ad-card");
    expect(card?.classList.contains("ad-card--xl")).toBe(true);
    expect(container.querySelector(".ad-card__face--front img")).toBeNull();
    expect(container.querySelector(".ad-card__face--pending")?.textContent).toBe("宝剑二");
    // 读牌文字照样在:即使没有图,牌名与关键词也不该消失。
    expect(container.querySelector(".ad-reading__name")?.textContent).toContain("宝剑二");
    cleanup();
  });

  it("逆位:牌面转 180°、角标标「逆」、关键词换成逆位牌义", async () => {
    const base = await fortuneOf();
    const reversed: DailyFortune = {
      ...base,
      tarot: {
        ...base.tarot,
        orientation: "reversed",
        reversedKeywords: ["逃避决定", "优柔寡断", "信息过载"],
      },
    };
    const container = document.createElement("div");
    const cleanup = renderFortune(container, reversed, { resolveAsset: assetUrl });

    expect(container.querySelector(".ad-card")?.classList.contains("ad-card--reversed")).toBe(true);
    expect(container.querySelector(".ad-card__rev")?.textContent).toBe("逆");
    expect(container.querySelector(".ad-reading__name small")?.textContent).toBe("逆位");
    const chips = Array.from(container.querySelectorAll(".ad-bp-chip")).map((chip) => chip.textContent);
    expect(chips).toContain("逃避决定");
    expect(chips).not.toContain("抉择");
    cleanup();
  });

  it("解牌走「题签」,收在牌右侧那一栏里", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf(), {
      reading: {
        status: "ready",
        text: "宝剑二是一张「不动」的牌。\n\n给自己一个明确的截止点。",
        meta: "glm-5.3-flash · 10:28 生成",
        onRetry: () => undefined,
      },
    });

    const note = container.querySelector(".ad-note");
    expect(note).not.toBeNull();
    expect(note?.classList.contains("ad-note--inline")).toBe(true);
    expect(note?.getAttribute("data-status")).toBe("ready");
    expect(container.querySelector(".ad-note__tab")?.textContent).toBe("解牌");
    // 题签挂在读牌那一栏里,不是另起一块:牌右边那片空白正是它的位置。
    expect(container.querySelector(".ad-reading .ad-note")).not.toBeNull();
    // 正文多了一层 .ad-note__text(折叠只压这一层,页脚留在外面),所以按正文层取段落。
    expect(
      container.querySelectorAll(".ad-note__text p:not(.ad-note__section):not(.ad-note__foot)"),
    ).toHaveLength(2);
    expect(container.querySelector(".ad-note__foot")?.textContent).toContain("glm-5.3-flash");
    expect(container.querySelector(".ad-note__foot button")?.textContent).toBe("重新解牌");
    cleanup();
  });

  it("解牌生成中与失败都有交代,页脚口径跟着改", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf(), {
      reading: { status: "loading" },
    });
    expect(container.querySelector(".ad-note__pending")?.textContent).toBe("正在解牌…");
    expect(container.querySelector(".ad-fortune__foot")?.textContent)
      .toContain("解牌由大模型生成");
    cleanup();

    const failed = document.createElement("div");
    const cleanupFailed = renderFortune(failed, await fortuneOf(), {
      reading: { status: "error", message: "环境变量 OPENCODE_API_KEY 未设置", onRetry: () => undefined },
    });
    expect(failed.querySelector(".ad-note__pending")?.textContent).toContain("环境变量");
    expect(failed.querySelector(".ad-note__foot button")?.textContent).toBe("重试");
    cleanupFailed();
  });

  it("没有解牌时不出现空块,页脚保持本地口径", async () => {
    const container = document.createElement("div");
    const cleanup = renderFortune(container, await fortuneOf(), {
      reading: { status: "idle" },
    });

    expect(container.querySelector(".ad-note")).toBeNull();
    expect(container.querySelector(".ad-fortune__foot")?.textContent).toContain("本地计算，不联网");
    cleanup();
  });
});

describe("今日运势在整页里的位置", () => {
  const regions = (container: HTMLElement): Array<string | null> =>
    Array.from(container.querySelectorAll(".agent-dashboard__inner > *")).map((child) =>
      child.getAttribute("data-region"),
    );

  it("插在头部与「今天」之间", async () => {
    const container = document.createElement("div");
    const cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "自动更新完成",
      onNewDiary: () => undefined,
      fortune: await fortuneOf(),
      bushi: { session: createXuanxueSessionState() },
    });

    expect(regions(container)).toEqual(["header", "fortune", "today", "pulse", "discovery", "bushi"]);
    cleanup();
  });

  it("不给算据时整块不渲染(与卜筮同一个开关)", () => {
    const container = document.createElement("div");
    const cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "自动更新完成",
      onNewDiary: () => undefined,
    });

    expect(regions(container)).toEqual(["header", "today", "pulse", "discovery"]);
    cleanup();
  });
});
