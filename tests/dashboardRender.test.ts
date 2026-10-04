/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it, vi } from "vitest";
import { MOCK_DASHBOARD_STATE } from "../src/data/mockDashboard";
import { localDateKey } from "../src/features/vault/VaultScanner";
import { renderDashboard } from "../src/view/renderState";
import { createTodayInteractionState } from "../src/view/renderToday";

/** happy-dom may not ship PointerEvent; the handler only reads clientX and button. */
function pointerEvent(type: string, clientX: number): Event {
  const ctor = (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent;
  if (typeof ctor === "function") return new ctor(type, { clientX, button: 0, bubbles: true });
  return new MouseEvent(type, { clientX, button: 0, bubbles: true });
}
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
    // 未开启卜筮时,头部不渲染黄历卡,也没有卜筮板块。
    expect(container.querySelector(".ad-almanac")).toBeNull();
    expect(
      Array.from(container.querySelectorAll("[data-region]")),
    ).toHaveLength(4);

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
    // 今日发现里现在有两个分段控件(新闻页签 + 榜单周期),这里只针对榜单那个。
    const switcher = container.querySelector('[data-discovery-column="ranking"] .ad-segmented');
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
    const item = container.querySelector<HTMLElement>('.ad-task[data-completed="false"]');
    const expected = MOCK_DASHBOARD_STATE.tasks.data.find(
      (task) => item?.textContent?.includes(task.text) ?? false,
    );
    const checkbox = item?.querySelector<HTMLInputElement>("input") ?? null;
    expect(expected).toBeDefined();
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.disabled).toBe(false);

    checkbox?.click();

    expect(onToggleTask).toHaveBeenCalledWith(expected);
    expect(checkbox?.checked).toBe(false);
    expect(checkbox?.disabled).toBe(true);

    cleanup();
    checkbox?.click();
    expect(onToggleTask).toHaveBeenCalledOnce();
  });

  it("mounts the ready daily brief into its own tab beside the news list", () => {
    const container = document.createElement("div");
    const brief = {
      date: "2025-12-31",
      generatedAt: MOCK_DASHBOARD_STATE.dailyBrief.updatedAt ?? Date.now(),
      overview: "【今日主线】智能体对战平台走红，OpenAI 暂停训练引发安全讨论。\n\n" +
        "【关键进展】\n1. TinyAIArena 上线：把智能体对战做成可围观的产品。\n2. 训练暂停：安全与合规压力上桌。\n\n" +
        "【值得关注】评测方式正在改变。",
      items: [
        { title: "Summary one", url: "https://example.com/1", source: "AI Daily", summary: "概括一" },
        { title: "Summary two", url: "https://example.com/2", source: "Tooling Weekly", summary: "概括二" },
      ],
    };
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      dailyBrief: { status: "ready", data: brief, updatedAt: brief.generatedAt },
    }, { status: "刚刚更新", onNewDiary: vi.fn() });

    const card = container.querySelector(".ad-brief");
    expect(card).not.toBeNull();
    // 标签与覆盖条数改由页签和标题行承担,卡片里不再重复写一遍「今日摘要」。
    const newsPanel = card?.parentElement?.parentElement ?? null;
    expect(newsPanel?.className).toBe("ad-news");
    expect(newsPanel?.querySelector('[role="tab"][data-news-view="brief"]')?.textContent).toContain("摘要");
    expect(newsPanel?.querySelector(".ad-panel-toolbar > span")?.textContent).toContain("2 条 · 2025-12-31");
    // Every 【…】 heading occupies its own line, even when the model glued it to its body.
    const sectionTitles = Array.from(card?.querySelectorAll(".ad-brief__section-title") ?? [])
      .map((element) => element.textContent);
    expect(sectionTitles).toEqual(["【今日主线】", "【关键进展】", "【值得关注】"]);
    const paragraphs = Array.from(card?.querySelectorAll(".ad-brief__paragraph") ?? []);
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.textContent).toBe("智能体对战平台走红，OpenAI 暂停训练引发安全讨论。");
    // Line breaks inside a block survive, so numbered items keep their own rows.
    expect(paragraphs[1]?.textContent).toContain("1. TinyAIArena 上线：把智能体对战做成可围观的产品。\n2. 训练暂停");
    expect(paragraphs[2]?.textContent).toBe("评测方式正在改变。");
    // No per-item rows in the card: those belong to the news list below (no duplication).
    expect(card?.querySelectorAll("li")).toHaveLength(0);
    expect(card?.textContent).not.toContain("概括一");
    // 摘要与新闻列表各占一个页签:摘要在自己那一栏里,列表在另一栏,不再上下堆叠。
    const briefPane = card?.parentElement ?? null;
    expect(briefPane?.className).toBe("ad-news__pane");
    expect(briefPane?.querySelector(".ad-news__list")).toBeNull();
    expect((newsPanel?.querySelector('[data-news-pane="list"] .ad-news__list') ?? null) !== null).toBe(true);
  });

  it("keeps headings on their own line for the fallback shapes a model may emit", () => {
    const cases = [
      {
        overview: "## 今日主线\n正文甲。\n\n**关键进展**\n1. 乙。\n\n今日要闻：\n丙。",
        titles: ["今日主线", "关键进展", "今日要闻："],
        bodies: ["正文甲。", "1. 乙。", "丙。"],
      },
      {
        overview: "没有任何标记的一段。\n\n第二段。",
        titles: [],
        bodies: ["没有任何标记的一段。", "第二段。"],
      },
    ];
    for (const testCase of cases) {
      const container = document.createElement("div");
      const generatedAt = Date.now();
      renderDashboard(container, {
        ...MOCK_DASHBOARD_STATE,
        dailyBrief: {
          status: "ready",
          updatedAt: generatedAt,
          data: {
            date: "2025-12-31",
            generatedAt,
            overview: testCase.overview,
            items: [{ title: "T", url: "https://example.com/1", source: "S", summary: "s" }],
          },
        },
      }, { status: "test", onNewDiary: vi.fn() });

      const card = container.querySelector(".ad-brief");
      const titles = Array.from(card?.querySelectorAll(".ad-brief__section-title") ?? [])
        .map((element) => element.textContent);
      const bodies = Array.from(card?.querySelectorAll(".ad-brief__paragraph") ?? [])
        .map((element) => element.textContent);
      expect(titles).toEqual(testCase.titles);
      expect(bodies).toEqual(testCase.bodies);
      // Markdown markers must never leak into the rendered card.
      expect(card?.textContent).not.toContain("##");
      expect(card?.textContent).not.toContain("*");
      // A heading-free answer still renders as separate paragraphs, not one block.
      expect(bodies.every((body) => body !== "")).toBe(true);
    }
  });
  it("resizes the 今天 columns from the divider handle and persists the final width", () => {
    const container = document.createElement("div");
    const onTodayNotesWidthChange = vi.fn();
    renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
      todayNotesWidth: 400,
      onTodayNotesWidthChange,
    });

    const layout = container.querySelector<HTMLElement>(".ad-today");
    const handle = container.querySelector<HTMLElement>(".ad-today .ad-splitter");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("role")).toBe("separator");
    expect(handle?.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle?.getAttribute("aria-valuemin")).toBe("240");
    expect(handle?.tabIndex).toBe(0);
    // A stored width becomes the notes track; the responsive default stays when unset.
    expect(layout?.style.getPropertyValue("--ad-notes-track")).toBe("400px");

    handle?.dispatchEvent(pointerEvent("pointerdown", 600));
    window.dispatchEvent(pointerEvent("pointermove", 560));
    // Dragging left widens the notes column, and the track follows the pointer live.
    expect(layout?.style.getPropertyValue("--ad-notes-track")).toBe("440px");
    window.dispatchEvent(pointerEvent("pointerup", 560));
    expect(onTodayNotesWidthChange).toHaveBeenCalledWith(440);
    expect(layout?.classList.contains("ad-split-host--dragging")).toBe(false);

    // Keyboard nudges are committed immediately: ArrowLeft moves the divider left.
    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(onTodayNotesWidthChange).toHaveBeenLastCalledWith(464);
    handle?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onTodayNotesWidthChange).toHaveBeenLastCalledWith(440);
    expect(layout?.style.getPropertyValue("--ad-notes-track")).toBe("440px");
  });
  it("resizes the 今日发现 columns from its own divider and persists that width", () => {
    const container = document.createElement("div");
    const onDiscoveryRankingWidthChange = vi.fn();
    renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
      discoveryRankingWidth: 380,
      onDiscoveryRankingWidthChange,
    });

    const layout = container.querySelector<HTMLElement>(".ad-discovery");
    const handle = container.querySelector<HTMLElement>(".ad-discovery .ad-splitter");
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("role")).toBe("separator");
    expect(handle?.getAttribute("aria-label")).toContain("GitHub");
    // Each split owns its own track, so the two columns stay independent.
    expect(layout?.style.getPropertyValue("--ad-ranking-track")).toBe("380px");
    expect(container.querySelector<HTMLElement>(".ad-today")?.style.getPropertyValue("--ad-notes-track"))
      .toBe("");

    handle?.dispatchEvent(pointerEvent("pointerdown", 900));
    window.dispatchEvent(pointerEvent("pointermove", 960));
    // Dragging right narrows the GitHub column down to its 260px floor.
    expect(layout?.style.getPropertyValue("--ad-ranking-track")).toBe("320px");
    window.dispatchEvent(pointerEvent("pointerup", 960));
    expect(onDiscoveryRankingWidthChange).toHaveBeenCalledWith(320);
    expect(onDiscoveryRankingWidthChange).toHaveBeenCalledOnce();
  });
  it("opens a recent note from its row and disables the row without a handler", () => {
    const container = document.createElement("div");
    const onOpenNote = vi.fn();
    renderDashboard(container, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
      onOpenNote,
    });

    const rows = Array.from(container.querySelectorAll<HTMLButtonElement>(".ad-note__open"));
    expect(rows).toHaveLength(MOCK_DASHBOARD_STATE.recentNotes.data.length);
    expect(rows[0]?.disabled).toBe(false);
    expect(rows[0]?.getAttribute("aria-label")).toContain("打开笔记");
    rows[0]?.click();
    expect(onOpenNote).toHaveBeenCalledWith(MOCK_DASHBOARD_STATE.recentNotes.data[0]);
    expect(onOpenNote).toHaveBeenCalledOnce();

    const withoutHandler = document.createElement("div");
    renderDashboard(withoutHandler, MOCK_DASHBOARD_STATE, {
      status: "刚刚更新",
      onNewDiary: vi.fn(),
    });
    expect(withoutHandler.querySelector<HTMLButtonElement>(".ad-note__open")?.disabled).toBe(true);
  });
  it("hides the summary card when the brief is not ready and keeps the retry affordance", () => {
    const container = document.createElement("div");
    renderDashboard(container, {
      ...MOCK_DASHBOARD_STATE,
      dailyBrief: { status: "error", data: null, message: "今日摘要生成失败（原因：HTTP 401）" },
    }, { status: "部分资讯暂不可用", onNewDiary: vi.fn(), onRetry: vi.fn() });

    expect(container.querySelector(".ad-brief")).toBeNull();
    // The retry path renders the generic issue line; my custom message is covered
    // by the FeedService contract, the panel only guarantees the retry affordance.
    expect(container.textContent).toContain("今日摘要尚未生成");
    expect(Array.from(container.querySelectorAll("button"))
      .some((button) => button.textContent === "重试摘要")).toBe(true);
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

  it("groups tasks by source note, today first, and labels each group with its day", () => {
    const container = document.createElement("div");
    const today = localDateKey(new Date());
    const state = JSON.parse(JSON.stringify(MOCK_DASHBOARD_STATE)) as typeof MOCK_DASHBOARD_STATE;
    state.tasks = {
      status: "ready",
      data: [
        { id: "a:0", path: "Plans/2026-07-31-plan.md", line: 0, text: "Old step", completed: false, date: "2026-07-31" },
        { id: "b:0", path: "Daily/today.md", line: 0, text: "Today task", completed: false, date: today },
        { id: "c:0", path: "Inbox/scratch.md", line: 0, text: "Undated task", completed: false },
      ],
      updatedAt: Date.now(),
    };
    renderDashboard(container, state, {
      status: "test",
      onNewDiary: vi.fn(),
    });

    const groups = Array.from(container.querySelectorAll(".ad-task-group"));
    expect(
      groups.map((group) => group.querySelector(".ad-task-group__title")?.textContent),
    ).toEqual(["today", "2026-07-31-plan", "scratch"]);
    expect(container.querySelector(".ad-task-group__badge")?.textContent).toBe("今日");
    expect(container.textContent).toContain("无日期 · 1 项");
    expect(container.textContent).toContain(`${today} · 1 项`);
  });

  it("keeps completed tasks in the DOM behind a purely local reveal toggle", () => {
    const container = document.createElement("div");
    const onToggleTask = vi.fn();
    const state = JSON.parse(JSON.stringify(MOCK_DASHBOARD_STATE)) as typeof MOCK_DASHBOARD_STATE;
    state.tasks = {
      status: "ready",
      data: [
        { id: "a:0", path: "Today.md", line: 0, text: "Open task", completed: false },
        { id: "a:1", path: "Today.md", line: 1, text: "Done task", completed: true },
      ],
      updatedAt: Date.now(),
    };
    renderDashboard(container, state, {
      status: "test",
      onNewDiary: vi.fn(),
      onToggleTask,
    });

    const list = container.querySelector(".ad-task-list");
    // The stylesheet hides completed rows; the contract here is the reveal class.
    expect(list?.classList).not.toContain("ad-task-list--show-completed");
    expect(container.querySelectorAll('.ad-task[data-completed="true"]')).toHaveLength(1);
    expect(container.textContent).toContain("1 项未完成");

    const toggle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "显示已完成（1）");
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    toggle?.click();
    expect(list?.classList).toContain("ad-task-list--show-completed");
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(onToggleTask).not.toHaveBeenCalled();
  });

  it("keeps the local reveal choice and collapsed groups across a re-render", () => {
    const container = document.createElement("div");
    const state = JSON.parse(JSON.stringify(MOCK_DASHBOARD_STATE)) as typeof MOCK_DASHBOARD_STATE;
    state.tasks = {
      status: "ready",
      data: [
        { id: "a:0", path: "Today.md", line: 0, text: "Open task", completed: false },
        { id: "a:1", path: "Today.md", line: 1, text: "Done task", completed: true },
        { id: "b:0", path: "Inbox/scratch.md", line: 0, text: "Later", completed: false },
      ],
      updatedAt: Date.now(),
    };
    const interaction = createTodayInteractionState();
    const callbacks = { status: "test", onNewDiary: vi.fn(), interaction };
    const render = (): (() => void) => renderDashboard(container, state, callbacks);
    const group = (path: string): HTMLDetailsElement | undefined =>
      Array.from(container.querySelectorAll(".ad-task-group__details"))
        .find((item) =>
          item.querySelector(".ad-task-group__meta")?.getAttribute("title") === path) as
        | HTMLDetailsElement
        | undefined;

    const first = render();
    const list = (): Element | null => container.querySelector(".ad-task-list");
    expect(list()?.classList).not.toContain("ad-task-list--show-completed");
    const toggle = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "显示已完成（1）");
    toggle?.click();
    expect(list()?.classList).toContain("ad-task-list--show-completed");

    const collapsed = group("Inbox/scratch.md");
    expect(collapsed).toBeDefined();
    if (collapsed !== undefined) {
      collapsed.open = false;
      collapsed.dispatchEvent(new Event("toggle"));
    }
    expect(interaction.collapsedTaskGroups.has("Inbox/scratch.md")).toBe(true);

    // Every state push rebuilds the panel; the user's local choices must survive it.
    first();
    render();

    expect(list()?.classList).toContain("ad-task-list--show-completed");
    expect(group("Inbox/scratch.md")?.open).toBe(false);
    expect(group("Today.md")?.open).toBe(true);
  });

  it("reveals completed rows up front when nothing is left to do", () => {
    const container = document.createElement("div");
    const state = JSON.parse(JSON.stringify(MOCK_DASHBOARD_STATE)) as typeof MOCK_DASHBOARD_STATE;
    state.tasks = {
      status: "ready",
      data: [{ id: "a:0", path: "Today.md", line: 0, text: "Done task", completed: true }],
      updatedAt: Date.now(),
    };
    renderDashboard(container, state, { status: "test", onNewDiary: vi.fn() });

    expect(container.querySelector(".ad-task-list")?.classList)
      .toContain("ad-task-list--show-completed");
    expect(container.textContent).toContain("0 项未完成");
    expect(container.textContent).toContain("Done task");
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
