import type {
  DailyBrief,
  ModuleState,
  NewsItem,
  TrendingRepo,
} from "../domain/types";
import type { RetryableExternalModule } from "../features/feeds/FeedService";
import { MAX_GITHUB_REPOSITORIES } from "../features/feeds/githubTrending";
import {
  createElement,
  createSafeExternalLink,
  renderModuleFallback,
} from "./domHelpers";
import { renderSectionHead } from "./renderSectionHead";
import { renderSplitHandle } from "./splitHandle";

/** Width limits for the 今日发现 split: GitHub rankings right, AI news left. */
const RANKING_COLUMN_MIN_WIDTH = 260;
const NEWS_COLUMN_MIN_WIDTH = 420;

/** Which of the two AI-news views is on screen. */
type NewsView = "brief" | "list";

/** Gives each mounted panel its own tab/panel ids: two leaves may be open at once. */
let newsInstanceSeq = 0;

/** 摘要页签旁的计数:摘要是按天生成的整体概括,所以报「覆盖条数 · 日期」。 */
function briefMeta(state: ModuleState<DailyBrief | null>): string {
  if (state.data === null) return "尚未生成";
  return `${state.data.items.length} 条 · ${state.data.date}`;
}

interface DiscoveryCallbacks {
  onRetry?: (module: RetryableExternalModule) => void;
  onOpenSettings?: () => void;
  rankingPeriod?: "daily" | "weekly";
  onRankingPeriodChange?: (period: "daily" | "weekly") => void;
  /** 摘要在上、新闻在下的堆叠已改成同一条标题行里的两个页签。 */
  newsView?: NewsView;
  onNewsViewChange?: (view: NewsView) => void;
  onCancelDailyBrief?: () => void;
  /** True when the repo name or owner appears in a Vault note title. */
  isRepoRelevant?: (repo: TrendingRepo) => boolean;
  /** Persisted GitHub-column width in px; 0 or missing keeps the responsive default. */
  rankingWidth?: number;
  onRankingWidthChange?: (width: number) => void;
}

function issueMessage<T>(state: ModuleState<T>, fallback: string): string {
  const message = state.message ?? fallback;
  if (state.retryAt === undefined || !Number.isFinite(state.retryAt)) return message;
  const date = new Date(state.retryAt);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${message} 下次可更新时间：${time}`;
}

/**
 * One card holding the day's whole-news digest in prose.
 * Per-item lines stay in the news list, so nothing is repeated here.
 * The card carries no title of its own: the tab names it and the panel meta
 * carries the coverage count, so the same fact is never labelled twice.
 * Every element is attached here: createElement only creates, never mounts.
 */
function renderBriefCard(
  container: HTMLElement,
  brief: DailyBrief,
): () => void {
  const card = createElement(container, "div");
  card.className = "ad-brief";
  const overview = createElement(card, "div");
  overview.className = "ad-brief__overview";
  for (const section of parseOverviewSections(brief.overview)) {
    if (section.heading !== undefined) {
      const heading = createElement(overview, "p");
      heading.className = "ad-brief__section-title";
      heading.textContent = section.heading;
      overview.append(heading);
    }
    if (section.body !== "") {
      const block = createElement(overview, "p");
      block.className = "ad-brief__paragraph";
      block.textContent = section.body;
      overview.append(block);
    }
  }
  card.append(overview);
  container.append(card);
  return () => {
    card.remove();
  };
}

interface BriefSection {
  heading?: string;
  body: string;
}

const BRACKET_HEADING = /^【([^】\n]{1,24})】[ \t]*([\s\S]*)$/;
const HASH_HEADING = /^#{1,6}[ \t]+([^\n]{1,30})[ \t]*\n?([\s\S]*)$/;
const BOLD_HEADING = /^\*\*([^*\n]{1,30})\*\*[ \t]*\n?([\s\S]*)$/;
const LABEL_LINE = /^([^\n：:]{1,20})[：:][ \t]*\n([\s\S]*)$/;

/**
 * Headings are rendered on their own line whatever shape the model chose:
 * the requested 【…】 form, or the Markdown/bold/colon variants it may fall back
 * to. Blocks without any marker stay plain paragraphs, so a heading-free
 * answer still renders as readable paragraphs instead of one wall of text.
 */
function parseOverviewSections(overview: string): BriefSection[] {
  return overview
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter((block) => block !== "")
    .map((block): BriefSection => {
      const bracket = BRACKET_HEADING.exec(block);
      if (bracket !== null) {
        return { heading: `【${bracket[1]}】`, body: (bracket[2] ?? "").trim() };
      }
      const hash = HASH_HEADING.exec(block);
      if (hash !== null) return { heading: (hash[1] ?? "").trim(), body: (hash[2] ?? "").trim() };
      const bold = BOLD_HEADING.exec(block);
      if (bold !== null) return { heading: (bold[1] ?? "").trim(), body: (bold[2] ?? "").trim() };
      const label = LABEL_LINE.exec(block);
      if (label !== null) {
        return { heading: `${(label[1] ?? "").trim()}：`, body: (label[2] ?? "").trim() };
      }
      return { body: block };
    });
}

function renderIssue(
  container: HTMLElement,
  message: string,
  actionLabel: string,
  onAction: (() => void) | undefined,
): () => void {
  const issue = createElement(container, "div");
  issue.className = "ad-module-issue";
  issue.setAttribute("role", "status");
  issue.setAttribute("aria-live", "polite");
  const copy = createElement(container, "span");
  copy.textContent = message;
  issue.append(copy);
  let action: HTMLButtonElement | undefined;
  if (onAction !== undefined) {
    action = createElement(container, "button");
    action.type = "button";
    action.className = "ad-inline-action";
    action.textContent = actionLabel;
    action.addEventListener("click", onAction);
    issue.append(action);
  }
  container.append(issue);
  return () => {
    if (action !== undefined && onAction !== undefined) {
      action.removeEventListener("click", onAction);
    }
  };
}

function renderNews(
  container: HTMLElement,
  state: ModuleState<NewsItem[]>,
  dailyBrief: ModuleState<DailyBrief | null>,
  callbacks: DiscoveryCallbacks,
): () => void {
  const cleanups: Array<() => void> = [];
  const heading = createElement(container, "div");
  heading.className = "ad-panel-heading";
  const title = createElement(container, "h3");
  title.textContent = "AI 新闻";
  const toolbar = createElement(container, "div");
  toolbar.className = "ad-panel-toolbar";
  const meta = createElement(container, "span");

  const tablist = createElement(container, "div");
  tablist.className = "ad-segmented ad-news__views";
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "AI 新闻视图");
  newsInstanceSeq += 1;
  const instanceId = `ad-news-view-${newsInstanceSeq}`;

  const createTab = (view: NewsView, label: string): HTMLButtonElement => {
    const button = createElement(container, "button");
    button.type = "button";
    button.className = "ad-news__view";
    button.setAttribute("role", "tab");
    button.dataset.newsView = view;
    button.id = `${instanceId}-tab-${view}`;
    button.setAttribute("aria-controls", `${instanceId}-pane-${view}`);
    const text = createElement(container, "span");
    text.textContent = label;
    button.append(text);
    return button;
  };
  const briefTab = createTab("brief", "摘要");
  const listTab = createTab("list", "新闻");
  const briefData = dailyBrief.data;
  // 有缓存就当可用(stale 也照常展示);否则页签上必须把状态透出来。
  const briefReady = briefData !== null;
  // 摘要的生成中/缺失状态原本就摆在版面上,收进页签后必须透出来,否则会被悄悄藏住。
  if (!briefReady) {
    const dot = createElement(container, "span");
    dot.className = dailyBrief.status === "loading"
      ? "ad-news__tab-dot ad-news__tab-dot--busy"
      : "ad-news__tab-dot";
    dot.setAttribute("aria-hidden", "true");
    briefTab.append(dot);
  }
  tablist.append(briefTab, listTab);
  toolbar.append(meta, tablist);
  heading.append(title, toolbar);

  const createPane = (view: NewsView): HTMLElement => {
    const pane = createElement(container, "div");
    pane.className = "ad-news__pane";
    pane.dataset.newsPane = view;
    pane.setAttribute("role", "tabpanel");
    pane.id = `${instanceId}-pane-${view}`;
    pane.setAttribute("aria-labelledby", `${instanceId}-tab-${view}`);
    return pane;
  };
  const briefPane = createPane("brief");
  const listPane = createPane("list");
  container.append(heading, briefPane, listPane);

  const tabs: Record<NewsView, HTMLButtonElement> = { brief: briefTab, list: listTab };
  const panes: Record<NewsView, HTMLElement> = { brief: briefPane, list: listPane };
  let currentView: NewsView | undefined;

  const selectView = (view: NewsView, animate = false): void => {
    if (currentView === view) return;
    currentView = view;
    const isBrief = view === "brief";
    tabs.brief.setAttribute("aria-selected", String(isBrief));
    tabs.list.setAttribute("aria-selected", String(!isBrief));
    tabs.brief.tabIndex = isBrief ? 0 : -1;
    tabs.list.tabIndex = isBrief ? -1 : 0;
    panes.brief.hidden = !isBrief;
    panes.list.hidden = isBrief;
    meta.textContent = isBrief ? briefMeta(dailyBrief) : `${state.data.length} 条精选`;
    if (!animate) return;
    const shown = panes[view];
    shown.classList.remove("ad-news__pane--switching");
    void shown.offsetWidth;
    shown.classList.add("ad-news__pane--switching");
    callbacks.onNewsViewChange?.(view);
  };

  const onBriefClick = (): void => selectView("brief", true);
  const onListClick = (): void => selectView("list", true);
  briefTab.addEventListener("click", onBriefClick);
  listTab.addEventListener("click", onListClick);
  const onKeydown = (event: KeyboardEvent): void => {
    const order: NewsView[] = ["brief", "list"];
    const index = order.indexOf(currentView ?? "brief");
    let next: NewsView;
    if (event.key === "Home") next = "brief";
    else if (event.key === "End") next = "list";
    else if (event.key === "ArrowRight") next = order[(index + 1) % order.length] ?? "brief";
    else if (event.key === "ArrowLeft") next = order[(index - 1 + order.length) % order.length] ?? "brief";
    else return;
    event.preventDefault();
    selectView(next, true);
    tabs[next].focus();
  };
  tablist.addEventListener("keydown", onKeydown);
  const dispose = (): void => {
    cleanups.forEach((cleanup) => cleanup());
    briefTab.removeEventListener("click", onBriefClick);
    listTab.removeEventListener("click", onListClick);
    tablist.removeEventListener("keydown", onKeydown);
  };
  selectView(callbacks.newsView ?? "brief");

  // The daily brief sits in its own pane: one card, one line per item, source kept.
  if (briefData !== null) {
    cleanups.push(renderBriefCard(briefPane, briefData));
  }

  // 提示只挂在摘要自己的状态上:摘要现在独占一屏,没有数据就必须说明原因。
  if (briefData === null && dailyBrief.status === "loading") {
    const summaryNotice = createElement(container, "div");
    summaryNotice.className = "ad-summary-notice";
    summaryNotice.setAttribute("role", "status");
    summaryNotice.setAttribute("aria-live", "polite");
    const message = createElement(container, "span");
    message.textContent = dailyBrief.message ?? "正在生成今日摘要…";
    summaryNotice.append(message);
    if (callbacks.onCancelDailyBrief !== undefined) {
      const cancel = callbacks.onCancelDailyBrief;
      const cancelButton = createElement(container, "button");
      cancelButton.type = "button";
      cancelButton.className = "ad-inline-action";
      cancelButton.textContent = "取消";
      cancelButton.addEventListener("click", cancel);
      cleanups.push(() => cancelButton.removeEventListener("click", cancel));
      summaryNotice.append(cancelButton);
    }
    briefPane.append(summaryNotice);
  }

  if (briefData === null && dailyBrief.status !== "loading") {
    const summaryNotice = createElement(container, "div");
    summaryNotice.className = "ad-summary-notice";
    summaryNotice.setAttribute("role", "status");
    summaryNotice.setAttribute("aria-live", "polite");
    const message = createElement(container, "span");
    message.textContent = "今日摘要尚未生成";
    summaryNotice.append(message);
    if (dailyBrief.status === "error" && callbacks.onRetry !== undefined) {
      const retrySummary = createElement(container, "button");
      retrySummary.type = "button";
      retrySummary.className = "ad-inline-action";
      retrySummary.textContent = "重试摘要";
      const retry = (): void => callbacks.onRetry?.("dailyBrief");
      retrySummary.addEventListener("click", retry);
      cleanups.push(() => retrySummary.removeEventListener("click", retry));
      summaryNotice.append(retrySummary);
    }
    if (callbacks.onOpenSettings !== undefined) {
      const openSettings = callbacks.onOpenSettings;
      const settings = createElement(container, "button");
      settings.type = "button";
      settings.className = "ad-inline-action";
      settings.textContent = "打开设置";
      settings.addEventListener("click", openSettings);
      cleanups.push(() => settings.removeEventListener("click", openSettings));
      summaryNotice.append(settings);
    }
    briefPane.append(summaryNotice);
  }

  if (state.status === "stale" || state.status === "error") {
    const retry = callbacks.onRetry === undefined
      ? undefined
      : (): void => callbacks.onRetry?.("aiNews");
    cleanups.push(renderIssue(
      listPane,
      issueMessage(state, state.status === "stale" ? "暂时使用缓存" : "AI 新闻暂不可用。"),
      "重试",
      retry,
    ));
    if (state.status === "error" && state.data.length === 0) return dispose;
  }
  const hasVisibleErrorData = state.status === "error" && state.data.length > 0;
  if (!hasVisibleErrorData &&
    renderModuleFallback(listPane, state, {
      loading: "正在获取今天的 AI 资讯…",
      empty: "还没有资讯缓存，来源正在路上。",
      error: "AI 新闻暂不可用。",
    })
  ) {
    return dispose;
  }

  const list = createElement(container, "ol");
  list.className = "ad-news__list ad-stagger-list";
  for (const item of state.data) {
    const listItem = createElement(container, "li");
    listItem.className = "ad-news__item";
    const link = createSafeExternalLink(container, item.url, item.title);
    link.classList.add("ad-news__title");
    const metadata = createElement(container, "p");
    metadata.className = "ad-news__meta";
    metadata.textContent = item.source;
    listItem.append(link);
    if (item.summary !== undefined && item.summary !== "") {
      const summary = createElement(container, "p");
      summary.className = "ad-news__summary";
      summary.textContent = item.summary;
      listItem.append(summary);
    }
    listItem.append(metadata);
    list.append(listItem);
  }
  listPane.append(list);
  return dispose;
}

function renderRankingList(
  container: HTMLElement,
  state: ModuleState<TrendingRepo[]>,
  period: "daily" | "weekly",
  onRetry?: (module: RetryableExternalModule) => void,
  isRepoRelevant?: (repo: TrendingRepo) => boolean,
): () => void {
  container.replaceChildren();
  const module = period === "daily" ? "githubDaily" : "githubWeekly";
  let cleanupIssue = (): void => undefined;
  if (state.status === "stale" || state.status === "error") {
    const retry = onRetry === undefined ? undefined : (): void => onRetry(module);
    cleanupIssue = renderIssue(
      container,
      issueMessage(state, state.status === "stale" ? "暂时使用缓存" : "GitHub 榜单暂不可用。"),
      "重试",
      retry,
    );
    if (state.status === "error" && state.data.length === 0) return cleanupIssue;
  }
  const hasVisibleErrorData = state.status === "error" && state.data.length > 0;
  if (!hasVisibleErrorData &&
    renderModuleFallback(container, state, {
      loading: "正在整理 GitHub 榜单…",
      empty: "榜单还没有可显示的项目。",
      error: "GitHub 榜单暂不可用。",
    })
  ) {
    return cleanupIssue;
  }

  const list = createElement(container, "ol");
  list.className = "ad-ranking__items ad-stagger-list";
  state.data.slice(0, MAX_GITHUB_REPOSITORIES).forEach((repo, index) => {
    const item = createElement(container, "li");
    item.className = "ad-ranking__item";
    const rank = createElement(container, "span");
    rank.className = "ad-ranking__rank";
    rank.textContent = String(index + 1).padStart(2, "0");
    const content = createElement(container, "div");
    const link = createSafeExternalLink(container, repo.url, repo.name);
    link.classList.add("ad-ranking__name");
    content.append(link);
    if (isRepoRelevant?.(repo) === true) {
      const badge = createElement(container, "span");
      badge.className = "ad-ranking__badge";
      badge.textContent = "与你相关";
      badge.title = "该项目的名称出现在你的 Vault 笔记标题中"; // eslint-disable-line obsidianmd/ui/sentence-case -- Vault is a product name.
      content.append(badge);
    }
    const description = createElement(container, "p");
    description.textContent = repo.description;
    const metadata = createElement(container, "p");
    metadata.className = "ad-ranking__meta";
    const periodStars = repo.starsInPeriod ?? 0;
    const language = repo.language ?? "Other";
    metadata.textContent = `${language} · ★ ${repo.stars.toLocaleString()} · +${periodStars.toLocaleString()} ${period === "daily" ? "今日" : "本周"}`;
    content.append(description, metadata);
    item.append(rank, content);
    list.append(item);
  });
  container.append(list);
  return cleanupIssue;
}

export function renderDiscovery(
  container: HTMLElement,
  news: ModuleState<NewsItem[]>,
  daily: ModuleState<TrendingRepo[]>,
  weekly: ModuleState<TrendingRepo[]>,
  dailyBrief: ModuleState<DailyBrief | null>,
  callbacks: DiscoveryCallbacks = {},
): () => void {
  container.replaceChildren();
  container.className = "ad-section";
  container.dataset.region = "discovery";
  // 批注:这个板块当天有多少条资讯可看。
  renderSectionHead(container, "今日发现", { meta: `${news.data.length} 条资讯` });
  const layout = createElement(container, "div");
  layout.className = "ad-discovery";

  const newsPanel = createElement(container, "div");
  newsPanel.className = "ad-news";
  newsPanel.dataset.discoveryColumn = "news";
  const cleanupNews = renderNews(newsPanel, news, dailyBrief, callbacks);

  const rankingPanel = createElement(container, "div");
  rankingPanel.className = "ad-ranking";
  rankingPanel.dataset.discoveryColumn = "ranking";
  const heading = createElement(container, "div");
  heading.className = "ad-ranking__heading";
  const headingTitle = createElement(container, "h3");
  headingTitle.textContent = "GitHub 榜单";
  const switcher = createElement(container, "div");
  switcher.className = "ad-segmented";
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "GitHub 榜单周期");
  const dailyButton = createElement(container, "button");
  dailyButton.type = "button";
  dailyButton.dataset.rankingPeriod = "daily";
  dailyButton.textContent = "日榜";
  const weeklyButton = createElement(container, "button");
  weeklyButton.type = "button";
  weeklyButton.dataset.rankingPeriod = "weekly";
  weeklyButton.textContent = "周榜";
  switcher.append(dailyButton, weeklyButton);
  heading.append(headingTitle, switcher);
  const rankingList = createElement(container, "div");
  rankingList.className = "ad-ranking__list";
  rankingList.setAttribute("aria-live", "polite");
  rankingPanel.append(heading, rankingList);
  const cleanupSplit = renderSplitHandle(layout, rankingPanel, {
    trackProperty: "--ad-ranking-track",
    minWidth: RANKING_COLUMN_MIN_WIDTH,
    siblingMinWidth: NEWS_COLUMN_MIN_WIDTH,
    width: callbacks.rankingWidth,
    onWidthChange: callbacks.onRankingWidthChange,
    ariaLabel: "拖动调整 AI 新闻与 GitHub 榜单的栏宽",
  });

  let cleanupRanking = (): void => undefined;
  let currentPeriod: "daily" | "weekly" | undefined;
  const selectPeriod = (period: "daily" | "weekly", animate = false): void => {
    if (currentPeriod === period) return;
    currentPeriod = period;
    const isDaily = period === "daily";
    dailyButton.setAttribute("aria-pressed", String(isDaily));
    weeklyButton.setAttribute("aria-pressed", String(!isDaily));
    cleanupRanking();
    cleanupRanking = renderRankingList(
      rankingList,
      isDaily ? daily : weekly,
      period,
      callbacks.onRetry,
      callbacks.isRepoRelevant,
    );
    if (animate) {
      rankingList.classList.remove("ad-ranking__list--switching");
      void rankingList.offsetWidth;
      rankingList.classList.add("ad-ranking__list--switching");
      callbacks.onRankingPeriodChange?.(period);
    }
  };
  const selectDaily = (): void => selectPeriod("daily", true);
  const selectWeekly = (): void => selectPeriod("weekly", true);
  dailyButton.addEventListener("click", selectDaily);
  weeklyButton.addEventListener("click", selectWeekly);
  selectPeriod(callbacks.rankingPeriod ?? "daily");

  layout.append(newsPanel, rankingPanel);
  container.append(layout);

  return () => {
    cleanupNews();
    cleanupRanking();
    cleanupSplit();
    dailyButton.removeEventListener("click", selectDaily);
    weeklyButton.removeEventListener("click", selectWeekly);
  };
}
