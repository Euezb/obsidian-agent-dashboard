/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MOCK_DASHBOARD_STATE } from "../src/data/mockDashboard";
import { createXuanxueSessionState } from "../src/features/divination/bushiTypes";
import { loadDailyFortune } from "../src/features/divination/dailyFortune";
import { renderDashboard } from "../src/view/renderState";

/**
 * C5「批注 · 轴线」骨架契约(2026-09-29 定稿)。
 *
 * 问题:旧版每个板块都是「大标题 + 一堆卡片」,四块等重、彼此没有边界,
 * 首屏看不出板块从哪开始到哪结束;中文标题用 Georgia,回退不可控。
 * 契约:四个板块共用同一骨架 —— 批注栏 · 楷体标题 · 内容列起点一致的分隔线,
 * 加上一条贯穿全篇的轴线与每个板块的圆点;轴线用 section 自身的 background 画,
 * 因此不再新增包裹层,inner 的直接子元素仍是 header + 各 section。
 */
const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

/** 骨架测试只看版式,算据用固定时间点即可(口径另有 dailyFortune.test.ts 守着)。 */
const SAMPLE_FORTUNE = await loadDailyFortune(new Date(2026, 8, 30, 10, 28));

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  return css.slice(start, css.indexOf("}", start));
}

function mount(): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  const cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
    status: "自动更新完成",
    onNewDiary: () => undefined,
    fortune: SAMPLE_FORTUNE,
    bushi: { session: createXuanxueSessionState() },
  });
  return { container, cleanup };
}

describe("板块骨架 · DOM(C5)", () => {
  it("每个板块都有统一的头:批注 · 标题", () => {
    const { container, cleanup } = mount();
    const sections = Array.from(container.querySelectorAll<HTMLElement>(".ad-section"));
    expect(sections.length).toBeGreaterThanOrEqual(4);

    for (const section of sections) {
      const head = section.querySelector(".ad-section__head");
      expect(head, `${section.dataset.region} 缺板块头`).not.toBeNull();
      // 头必须是板块的第一个孩子,骨架才对得齐。
      expect(section.firstElementChild?.className).toBe("ad-section__head");
      const title = head?.querySelector(".ad-section__title");
      expect(title?.textContent).toBeTruthy();
      const meta = head?.querySelector(".ad-section__meta");
      expect(meta, `${section.dataset.region} 缺批注`).not.toBeNull();
      expect(meta?.textContent?.trim()).not.toBe("");
      // 批注在标题之前(批注栏在左)。
      expect(head?.textContent?.indexOf(meta?.textContent ?? "")).toBe(0);
    }
    cleanup();
  });

  it("批注写的是这个板块的口径,而不是装饰", () => {
    const { container, cleanup } = mount();
    const metaOf = (region: string): string =>
      container.querySelector<HTMLElement>(`[data-region="${region}"] .ad-section__meta`)?.textContent ?? "";

    // 今日:完成 / 总数
    expect(metaOf("today")).toMatch(/^\d+\s*\/\s*\d+$/);
    // 脉搏:热力图覆盖天数
    expect(metaOf("pulse")).toContain("天");
    // 今日发现:资讯条数
    expect(metaOf("discovery")).toContain("条资讯");
    // 卜筮:方法数
    expect(metaOf("bushi")).toContain("法");
    // 今日运势:一天一牌一课
    expect(metaOf("fortune")).toBe("每日一占");
    cleanup();
  });

  it("不再新增包裹层:inner 的直接子元素仍是 header + 各 section", () => {
    const { container, cleanup } = mount();
    const inner = container.querySelector(".agent-dashboard__inner");
    expect(
      Array.from(inner?.children ?? []).map((child) => child.getAttribute("data-region")),
    ).toEqual(["header", "fortune", "today", "pulse", "discovery", "bushi"]);
    cleanup();
  });
});

describe("板块骨架 · 样式(C5)", () => {
  it("定义了 C5 的纸墨配色与两套字体栈", () => {
    const tokens = rule(".agent-dashboard");
    expect(tokens).toContain("--ad-primary: #a8482b");
    expect(tokens).toContain("--ad-bg: #f2ebdc");
    expect(tokens).toContain("--ad-font-title:");
    expect(tokens).toContain("--ad-font-body:");
    expect(tokens).toContain("--ad-note-col:");
    // 标题走楷/宋,不再用 Georgia 兜中文
    expect(tokens).not.toContain("Georgia");
  });

  it("轴线画在 section 自身的背景上,不引入包裹层", () => {
    const section = rule(".ad-section");
    expect(section).toContain("background-image");
    expect(section).toContain("linear-gradient");
    expect(section).toContain("background-repeat: no-repeat");
    // 旧版靠 border-top 分块,已由「内容列起点」的分隔线取代
    expect(section).not.toContain("border-top");
  });

  it("每个板块有圆点与从内容列起的分隔线", () => {
    expect(rule(".ad-section::before")).toContain("border-radius: 50%");
    expect(rule(".ad-section::after")).toContain("left: var(--ad-body-indent)");
  });

  it("板块头是四列栅格,批注在左、标题其次", () => {
    const head = rule(".ad-section__head");
    expect(head).toContain("grid-template-columns: var(--ad-note-col)");
    expect(head).toContain("display: grid");
    expect(rule(".ad-section__meta")).toContain("grid-column: 1");
    expect(rule(".ad-section__title")).toContain("grid-column: 2");
    expect(rule(".ad-section__title")).toContain("var(--ad-font-title)");
    // 板块体与标题同一起点
    expect(css).toMatch(/\.ad-section\s*>\s*\*:not\(\.ad-section__head\)\s*\{[^}]*margin-left:\s*var\(--ad-body-indent\)/s);
  });

  it("窄屏放下批注栏:批注整行独立、内容不再缩进", () => {
    const narrow = css.slice(css.indexOf("@media (max-width: 820px)"));
    const block = narrow.slice(0, narrow.indexOf("@media", 10) === -1 ? narrow.length : narrow.indexOf("@media", 10));
    expect(block).toContain(".ad-section__meta");
    expect(block).toContain("grid-column: 1 / -1");
    expect(block).toMatch(/\.ad-section\s*>\s*\*:not\(\.ad-section__head\)\s*\{[^}]*margin-left:\s*0/s);
  });

  it("深色主题映射到暖墨纸,而不是直接反色", () => {
    const dark = css.slice(css.indexOf("body.theme-dark .agent-dashboard"));
    const block = dark.slice(0, dark.indexOf("}", dark.indexOf("{")) + 1);
    expect(block).toContain("--ad-bg:");
    expect(block).toContain("--ad-primary:");
  });
});
