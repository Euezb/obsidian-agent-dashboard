/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it, vi } from "vitest";
import { MOCK_DASHBOARD_STATE } from "../src/data/mockDashboard";
import { renderDashboard } from "../src/view/renderState";

describe("renderDashboard", () => {
  it("renders the four approved regions in reading order", () => {
    const container = document.createElement("div");

    const cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      updatedAt: MOCK_DASHBOARD_STATE.tasks.updatedAt,
      status: "刚刚更新",
      onNewDiary: vi.fn(),
    });

    const inner = container.querySelector(".agent-dashboard__inner");
    expect(inner).not.toBeNull();
    expect(
      Array.from(inner?.children ?? []).map((region) =>
        region.getAttribute("data-region"),
      ),
    ).toEqual(["header", "today", "pulse", "discovery"]);
    expect(container.querySelector(".ad-eyebrow")?.textContent).toBe(
      "Agent Dashboard",
    );

    cleanup();
  });

  it("keeps healthy automation quiet and invokes the diary callback", () => {
    const container = document.createElement("div");
    const onNewDiary = vi.fn();
    const cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "自动更新完成",
      onNewDiary,
    });

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).not.toContain("刷新资讯");
    expect(buttons.map((button) => button.textContent)).not.toContain("运行研究");
    expect(buttons.map((button) => button.textContent)).not.toContain("检查 Vault");
    expect(container.textContent).toContain("自动更新完成");

    const diaryButton = buttons.find(
      (button) => button.textContent === "新建日记",
    );
    expect(diaryButton).toBeDefined();
    diaryButton?.click();
    expect(onNewDiary).toHaveBeenCalledOnce();

    cleanup();
    diaryButton?.click();
    expect(onNewDiary).toHaveBeenCalledOnce();
  });

  it("shows a subtle missing-summary action and contextual retry only on failure", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    const onOpenSettings = vi.fn();
    const cleanup = renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      dailyBrief: { status: "error", data: null, message: "今日摘要尚未生成" },
      aiNews: { ...MOCK_DASHBOARD_STATE.aiNews, status: "stale", message: "暂时使用缓存" },
    }, {
      status: "自动更新完成",
      onNewDiary: vi.fn(),
      onRetry,
      onOpenSettings,
    });

    expect(container.textContent).toContain("今日摘要尚未生成");
    expect(container.textContent).toContain("暂时使用缓存");
    const retryBrief = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "重试摘要");
    const retryNews = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "重试");
    const settings = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "打开设置");
    retryBrief?.click(); retryNews?.click(); settings?.click();
    expect(onRetry).toHaveBeenCalledWith("dailyBrief");
    expect(onRetry).toHaveBeenCalledWith("aiNews");
    expect(onOpenSettings).toHaveBeenCalledOnce();
    expect(container.querySelector("[aria-live='polite']")).not.toBeNull();
    cleanup();
  });

  it("switching rankings performs no refresh until the selected failed module retries", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      dailyBrief: { status: "ready", data: null },
      githubWeekly: { status: "error", data: [], message: "GitHub 榜单暂不可用。" },
    }, { status: "自动更新完成", onNewDiary: vi.fn(), onRetry });
    container.querySelector<HTMLButtonElement>('[data-ranking-period="weekly"]')?.click();
    expect(onRetry).not.toHaveBeenCalled();
    const retry = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "重试");
    retry?.click();
    expect(onRetry).toHaveBeenCalledWith("githubWeekly");
  });

  it("persists the selected ranking period across complete dashboard renders", () => {
    const container = document.createElement("div");
    const selection: { current: "daily" | "weekly" } = { current: "daily" };
    const onRankingPeriodChange = vi.fn((period: "daily" | "weekly") => {
      selection.current = period;
    });
    let cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "自动更新完成",
      onNewDiary: vi.fn(),
      rankingPeriod: selection.current,
      onRankingPeriodChange,
    });

    container.querySelector<HTMLButtonElement>('[data-ranking-period="weekly"]')?.click();
    expect(selection.current).toBe("weekly");
    cleanup();
    cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "自动更新完成",
      onNewDiary: vi.fn(),
      rankingPeriod: selection.current,
      onRankingPeriodChange,
    });

    expect(container.querySelector('[data-ranking-period="weekly"]')?.getAttribute("aria-pressed"))
      .toBe("true");
    expect(onRankingPeriodChange).toHaveBeenCalledOnce();
    cleanup();
  });

  it("restarts the 180ms crossfade and exposes the period switch as a group", () => {
    const container = document.createElement("div");
    renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "自动更新完成",
      onNewDiary: vi.fn(),
    });
    const switcher = container.querySelector(".ad-segmented");
    expect(switcher?.getAttribute("role")).toBe("group");
    expect(switcher?.getAttribute("aria-label")).toBe("GitHub 榜单周期");

    container.querySelector<HTMLButtonElement>('[data-ranking-period="weekly"]')?.click();
    expect(container.querySelector(".ad-ranking__list")?.classList)
      .toContain("ad-ranking__list--switching");
  });

  it("shows the exact next update time for a rate-limited ranking", () => {
    const container = document.createElement("div");
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      githubWeekly: {
        status: "error",
        data: [],
        message: "GitHub 请求过于频繁。",
        retryAt: new Date(2025, 11, 31, 10, 45).getTime(),
      },
    }, { status: "部分资讯暂不可用", onNewDiary: vi.fn() });

    container.querySelector<HTMLButtonElement>('[data-ranking-period="weekly"]')?.click();
    expect(container.textContent).toContain("下次可更新时间：10:45");
  });

  it("keeps non-empty error data visible beside its issue and retry action", () => {
    const container = document.createElement("div");
    const onRetry = vi.fn();
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      aiNews: {
        ...MOCK_DASHBOARD_STATE.aiNews,
        status: "error",
        message: "AI 新闻缓存写入失败。",
      },
      githubWeekly: {
        ...MOCK_DASHBOARD_STATE.githubWeekly,
        status: "error",
        message: "GitHub 榜单暂不可用。",
      },
    }, { status: "部分资讯暂不可用", onNewDiary: vi.fn(), onRetry });

    expect(container.textContent).toContain("AI 新闻缓存写入失败。");
    expect(container.textContent).toContain(MOCK_DASHBOARD_STATE.aiNews.data[0]?.title);
    container.querySelector<HTMLButtonElement>('[data-ranking-period="weekly"]')?.click();
    expect(container.textContent).toContain("GitHub 榜单暂不可用。");
    expect(container.textContent).toContain(MOCK_DASHBOARD_STATE.githubWeekly.data[0]?.name);
    expect(Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent === "重试")).toHaveLength(2);
  });

  it("does not fabricate a list for an empty error module", () => {
    const container = document.createElement("div");
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      aiNews: { status: "error", data: [], message: "AI 新闻暂不可用。" },
    }, { status: "部分资讯暂不可用", onNewDiary: vi.fn() });

    expect(container.textContent).toContain("AI 新闻暂不可用。");
    expect(container.querySelector(".ad-news__list")).toBeNull();
  });

  it("routes task interaction without leaving the checkbox in an unbacked DOM state", () => {
    const container = document.createElement("div");
    const onToggleTask = vi.fn();
    const cleanup = renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
      onToggleTask,
    });
    const checkbox = container.querySelector<HTMLInputElement>(".ad-task input");
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.disabled).toBe(false);

    checkbox?.click();

    expect(onToggleTask).toHaveBeenCalledWith(MOCK_DASHBOARD_STATE.tasks.data[0]);
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.disabled).toBe(true);

    cleanup();
    checkbox?.click();
    expect(onToggleTask).toHaveBeenCalledOnce();
  });

  it("puts AI news left of rankings and switches daily and weekly lists", () => {
    const container = document.createElement("div");
    renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
    });

    const discovery = container.querySelector(".ad-discovery");
    expect(
      Array.from(discovery?.children ?? []).map((element) =>
        element.getAttribute("data-discovery-column"),
      ),
    ).toEqual(["news", "ranking"]);

    const daily = container.querySelector<HTMLButtonElement>(
      '[data-ranking-period="daily"]',
    );
    const weekly = container.querySelector<HTMLButtonElement>(
      '[data-ranking-period="weekly"]',
    );
    const rankingList = container.querySelector(".ad-ranking__list");

    expect(daily?.getAttribute("aria-pressed")).toBe("true");
    expect(weekly?.getAttribute("aria-pressed")).toBe("false");
    expect(rankingList?.textContent).toContain("sample-org/agent-kit");
    expect(rankingList?.textContent).not.toContain("sample-labs/context-engine");

    weekly?.click();

    expect(daily?.getAttribute("aria-pressed")).toBe("false");
    expect(weekly?.getAttribute("aria-pressed")).toBe("true");
    expect(rankingList?.textContent).toContain("sample-labs/context-engine");
    expect(rankingList?.textContent).not.toContain("sample-org/agent-kit");
  });

  it("shows only the first five repositories from legacy oversized caches", () => {
    const container = document.createElement("div");
    const repositories = Array.from({ length: 7 }, (_, index) => ({
      ...MOCK_DASHBOARD_STATE.githubDaily.data[0]!,
      name: `owner/repo-${index}`,
      url: `https://github.com/owner/repo-${index}`,
    }));
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      githubDaily: { status: "ready", data: repositories },
      githubWeekly: { status: "ready", data: repositories },
    }, { status: "自动更新完成", onNewDiary: vi.fn() });

    expect(container.querySelectorAll(".ad-ranking__item")).toHaveLength(5);
    expect(container.textContent).toContain("owner/repo-4");
    expect(container.textContent).not.toContain("owner/repo-5");
    container.querySelector<HTMLButtonElement>('[data-ranking-period="weekly"]')?.click();
    expect(container.querySelectorAll(".ad-ranking__item")).toHaveLength(5);
    expect(container.textContent).not.toContain("owner/repo-5");
  });

  it("opens every external news and repository link safely", () => {
    const container = document.createElement("div");
    renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
    });

    const links = Array.from(
      container.querySelectorAll<HTMLAnchorElement>(
        ".ad-news a, .ad-ranking a",
      ),
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.target).toBe("_blank");
      expect(link.rel.split(" ")).toEqual(
        expect.arrayContaining(["noopener", "noreferrer"]),
      );
    }
  });

  it("renders hostile URLs and markup-looking titles as inert text", () => {
    const container = document.createElement("div");
    const hostileTitle = '<img src=x onerror="globalThis.pwned=true">';
    renderDashboard(
      container,
      {
        ...MOCK_DASHBOARD_STATE,
        aiNews: {
          status: "ready",
          data: [
            {
              id: "hostile-news",
              title: hostileTitle,
              url: "javascript:alert(1)",
              source: "Unsafe source",
              publishedAt: "2025-12-31T06:00:00.000Z",
            },
            {
              id: "data-news",
              title: "Data URL",
              url: "data:text/html,unsafe",
              source: "Unsafe source",
              publishedAt: "2025-12-31T06:00:00.000Z",
            },
          ],
        },
        githubDaily: {
          status: "ready",
          data: [
            {
              name: "invalid/repo",
              url: "not a url",
              description: "Unsafe URL fixture",
              stars: 1,
              source: "github-trending",
            },
          ],
        },
      },
      { status: "刚刚更新", onNewDiary: vi.fn() },
    );

    expect(container.querySelectorAll(".ad-news a, .ad-ranking a")).toHaveLength(0);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain(hostileTitle);
  });

  it("lays out the weekly heatmap in weekday-aligned columns inside its own keyboard-scrollable region", () => {
    const container = document.createElement("div");
    renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
    });

    const scroller = container.querySelector<HTMLElement>(".ad-heatmap__scroller");
    expect(scroller).not.toBeNull();
    expect(scroller?.tabIndex).toBe(0);
    expect(scroller?.getAttribute("aria-label")).toContain("热力图");
    const grid = scroller?.querySelector(".ad-heatmap__grid") ?? null;
    const cells = grid ? Array.from(grid.children) : [];
    const blanks = cells.filter((cell) => (cell as HTMLElement).classList.contains("ad-heatmap__day--blank"));
    // 365 real days plus a few leading blanks aligning the first day to its weekday row.
    expect(cells.length - blanks.length).toBe(365);
    expect(blanks.length).toBeLessThan(7);
    expect(scroller?.querySelector(".ad-heatmap__months")).not.toBeNull();
  });

  it("groups today's and earlier incomplete tasks with labels", () => {
    const container = document.createElement("div");
    const state = JSON.parse(JSON.stringify(MOCK_DASHBOARD_STATE)) as typeof MOCK_DASHBOARD_STATE;
    // Two tasks: one from today, one from an earlier date, one completed.
    state.tasks = {
      status: "ready",
      data: [
        { id: "a:0", path: "a.md", line: 0, text: "Today task", completed: false, date: "2026-08-01" },
        { id: "b:0", path: "b.md", line: 0, text: "Earlier task", completed: false, date: "2026-07-31" },
        { id: "c:0", path: "c.md", line: 0, text: "Done task", completed: true, date: "2026-07-30" },
      ],
      updatedAt: Date.now(),
    };
    renderDashboard(container, state, {
      status: "test",
      onNewDiary: vi.fn(),
    });
    expect(container.textContent).toContain("本日待办");
    expect(container.textContent).toContain("之前未完成");
    expect(container.textContent).toContain("Today task");
    expect(container.textContent).toContain("Earlier task");
    // Completed tasks are hidden from the task list.
    expect(container.textContent).not.toContain("Done task");
  });

  it("renders health categories as rounded completion percentages", () => {
    const container = document.createElement("div");
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      health: {
        status: "ready",
        data: {
          score: 55,
          breakdown: {
            frontmatter: 20 / 14,
            links: 12.5,
            tags: 15 / 14,
            activity: 20,
            inbox: 20,
          },
          suggestions: ["为更多笔记添加 frontmatter（元数据）。"],
          insufficientData: false,
        },
      },
    }, { status: "自动更新完成", onNewDiary: vi.fn() });

    const values = Array.from(
      container.querySelectorAll(".ad-health__breakdown > div"),
      (item) => [
        item.querySelector("dt")?.textContent,
        item.querySelector("dd")?.textContent,
      ],
    );
    expect(values).toEqual([
      ["Frontmatter", "7%"],
      ["链接结构", "50%"],
      ["标签组织", "7%"],
      ["近期活跃", "100%"],
      ["Inbox", "100%"],
    ]);
    expect(container.textContent).not.toContain("1.4285714285714284%");
  });

  it("renders loading, error, and empty module states without heavy actions", () => {
    const container = document.createElement("div");
    renderDashboard(
      container,
      {
        ...MOCK_DASHBOARD_STATE,
        tasks: { status: "loading", data: [] },
        recentNotes: { status: "ready", data: [] },
        health: { status: "error", data: null, message: "健康度暂不可用" },
      },
      { status: "正在更新资讯", onNewDiary: vi.fn() },
    );

    expect(container.textContent).toContain("正在整理今日任务");
    expect(container.textContent).toContain("还没有最近笔记");
    expect(container.textContent).toContain("健康度暂不可用");
    expect(container.querySelector('[data-state="error"] button')).toBeNull();
  });
});
