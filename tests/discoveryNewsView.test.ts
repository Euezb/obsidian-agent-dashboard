/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it, vi } from "vitest";
import type { DailyBrief, ModuleState, NewsItem, TrendingRepo } from "../src/domain/types";
import { renderDiscovery } from "../src/view/renderDiscovery";

/**
 * 今日摘要与新闻列表原来是上下堆叠的,面板被拉得很长。
 * 契约:两者放进同一条标题行里的分段页签,一次只看一个;
 * 页签用标准 tab 语义(aria-selected / 方向键),选择可持久化。
 */
const news: ModuleState<NewsItem[]> = {
  status: "ready",
  data: [
    { id: "1", title: "标题一", url: "https://example.com/1", source: "示例源", publishedAt: "2026-09-29T09:00:00Z", summary: "摘要一" },
    { id: "2", title: "标题二", url: "https://example.com/2", source: "示例源", publishedAt: "2026-09-29T08:00:00Z", summary: "摘要二" },
  ],
};

const brief: ModuleState<DailyBrief | null> = {
  status: "ready",
  data: {
    date: "2026-09-29",
    generatedAt: 1759100000000,
    overview: "【要闻】今天发生了值得注意的事。\n\n【趋势】模型发布节奏加快。",
    items: [
      { title: "标题一", url: "https://example.com/1", source: "示例源", summary: "摘要一" },
      { title: "标题二", url: "https://example.com/2", source: "示例源", summary: "摘要二" },
    ],
  },
};

const ranking: ModuleState<TrendingRepo[]> = { status: "ready", data: [] };

interface Mounted {
  container: HTMLElement;
  cleanup: () => void;
  onNewsViewChange: ReturnType<typeof vi.fn>;
}

function mount(
  overrides: { newsView?: "brief" | "list"; briefState?: ModuleState<DailyBrief | null> } = {},
): Mounted {
  const container = document.createElement("div");
  // 挂到文档上才有真实的焦点行为(方向键用例要断言 activeElement)。
  document.body.append(container);
  const onNewsViewChange = vi.fn();
  const cleanupRender = renderDiscovery(
    container,
    news,
    ranking,
    ranking,
    overrides.briefState ?? brief,
    { newsView: overrides.newsView, onNewsViewChange },
  );
  return {
    container,
    onNewsViewChange,
    cleanup: () => {
      cleanupRender();
      container.remove();
    },
  };
}

function tab(container: HTMLElement, view: "brief" | "list"): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(`[role="tab"][data-news-view="${view}"]`);
  if (button === null) throw new Error(`缺少 ${view} 页签`);
  return button;
}

function pane(container: HTMLElement, view: "brief" | "list"): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-news-pane="${view}"]`);
  if (element === null) throw new Error(`缺少 ${view} 面板`);
  return element;
}

describe("AI 新闻的摘要/新闻切换", () => {
  it("默认只显示摘要,新闻列表收在另一个页签里", () => {
    const { container, cleanup } = mount();

    const tabs = container.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(2);
    expect(tab(container, "brief").getAttribute("aria-selected")).toBe("true");
    expect(tab(container, "list").getAttribute("aria-selected")).toBe("false");

    expect(pane(container, "brief").hidden).toBe(false);
    expect(pane(container, "list").hidden).toBe(true);

    // 摘要在,且标题行不再重复写一遍「今日摘要」(标签已由页签承担)。
    expect(container.querySelectorAll(".ad-brief__paragraph").length).toBeGreaterThan(0);
    expect(container.querySelector(".ad-brief__heading")).toBeNull();

    cleanup();
  });

  it("标题旁的计数随页签切换口径", () => {
    const { container, cleanup } = mount();
    const meta = container.querySelector(".ad-panel-toolbar > span");
    expect(meta?.textContent).toContain("2 条");
    expect(meta?.textContent).toContain("2026-09-29");

    tab(container, "list").click();
    expect(container.querySelector(".ad-panel-toolbar > span")?.textContent).toContain("2 条精选");
    cleanup();
  });

  it("点击页签切换视图并回报选择", () => {
    const { container, cleanup, onNewsViewChange } = mount();

    tab(container, "list").click();
    expect(pane(container, "list").hidden).toBe(false);
    expect(pane(container, "brief").hidden).toBe(true);
    expect(tab(container, "list").getAttribute("aria-selected")).toBe("true");
    expect(onNewsViewChange).toHaveBeenCalledWith("list");

    tab(container, "brief").click();
    expect(pane(container, "brief").hidden).toBe(false);
    expect(pane(container, "list").hidden).toBe(true);
    expect(onNewsViewChange).toHaveBeenLastCalledWith("brief");
    cleanup();
  });

  it("初始视图可以来自持久化状态", () => {
    const { container, cleanup } = mount({ newsView: "list" });
    expect(pane(container, "list").hidden).toBe(false);
    expect(pane(container, "brief").hidden).toBe(true);
    expect(tab(container, "list").getAttribute("aria-selected")).toBe("true");
    cleanup();
  });

  it("方向键可以在页签间移动", () => {
    const { container, cleanup, onNewsViewChange } = mount();
    const briefTab = tab(container, "brief");
    briefTab.focus();
    briefTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(tab(container, "list").getAttribute("aria-selected")).toBe("true");
    expect(onNewsViewChange).toHaveBeenCalledWith("list");
    expect(document.activeElement).toBe(tab(container, "list"));

    tab(container, "brief").click();
    // 左键从「新闻」回到「摘要」(选择态决定方向,不是焦点态)。
    tab(container, "list").click();
    const listTab = tab(container, "list");
    listTab.focus();
    listTab.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(tab(container, "brief").getAttribute("aria-selected")).toBe("true");
    cleanup();
  });

  it("摘要未就绪时页签上带状态点,生成中会标注忙碌", () => {
    const idle = mount({ briefState: { status: "idle", data: null } });
    expect(tab(idle.container, "brief").querySelector(".ad-news__tab-dot")).not.toBeNull();
    idle.cleanup();

    const loading = mount({ briefState: { status: "loading", data: null, message: "正在生成今日摘要…" } });
    expect(loading.container.querySelector(".ad-news__tab-dot--busy")).not.toBeNull();
    // 生成提示在被切走的页签里也要能看见(切到新闻后摘要页签仍在提示)。
    tab(loading.container, "list").click();
    expect(tab(loading.container, "brief").querySelector(".ad-news__tab-dot--busy")).not.toBeNull();
    loading.cleanup();

    const ready = mount();
    expect(tab(ready.container, "brief").querySelector(".ad-news__tab-dot")).toBeNull();
    ready.cleanup();
  });

  it("新闻列表本身仍在,并保留条目与来源", () => {
    const { container, cleanup } = mount({ newsView: "list" });
    const items = container.querySelectorAll(".ad-news__item");
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("标题一");
    expect(items[0]?.textContent).toContain("示例源");
    cleanup();
  });

  it("摘要页签永远有内容可说,不会留一片空白", () => {
    // 资讯还没抓下来 + 摘要待生成:旧实现把提示挂在「新闻有数据」这个条件上,
    // 收进页签后默认视图就会空白。
    const empty = document.createElement("div");
    document.body.append(empty);
    const cleanupEmpty = renderDiscovery(
      empty,
      { status: "loading", data: [] },
      ranking,
      ranking,
      { status: "idle", data: null },
      {},
    );
    const briefPane = empty.querySelector<HTMLElement>('[data-news-pane="brief"]');
    expect(briefPane?.textContent).toContain("尚未生成");
    cleanupEmpty();
    empty.remove();

    // 缓存里的旧摘要(stale)也应照常展示,不能因为不是 ready 就变成「尚未生成」。
    const cached = mount({ briefState: { status: "stale", data: brief.data } });
    expect(cached.container.querySelector(".ad-brief")).not.toBeNull();
    cached.cleanup();
  });
});
