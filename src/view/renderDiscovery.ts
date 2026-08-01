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

interface DiscoveryCallbacks {
  onRetry?: (module: RetryableExternalModule) => void;
  onOpenSettings?: () => void;
  rankingPeriod?: "daily" | "weekly";
  onRankingPeriodChange?: (period: "daily" | "weekly") => void;
  onCancelDailyBrief?: () => void;
  /** True when the repo name or owner appears in a Vault note title. */
  isRepoRelevant?: (repo: TrendingRepo) => boolean;
}

function issueMessage<T>(state: ModuleState<T>, fallback: string): string {
  const message = state.message ?? fallback;
  if (state.retryAt === undefined || !Number.isFinite(state.retryAt)) return message;
  const date = new Date(state.retryAt);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${message} 下次可更新时间：${time}`;
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
  const meta = createElement(container, "span");
  meta.textContent = `${state.data.length} 条精选`;
  heading.append(title, meta);
  container.append(heading);

  if (state.data.length > 0 && dailyBrief.status === "loading") {
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
    container.append(summaryNotice);
  }

  if (state.data.length > 0 &&
    (dailyBrief.status === "idle" || dailyBrief.status === "error")) {
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
    container.append(summaryNotice);
  }

  if (state.status === "stale" || state.status === "error") {
    const retry = callbacks.onRetry === undefined
      ? undefined
      : (): void => callbacks.onRetry?.("aiNews");
    cleanups.push(renderIssue(
      container,
      issueMessage(state, state.status === "stale" ? "暂时使用缓存" : "AI 新闻暂不可用。"),
      "重试",
      retry,
    ));
    if (state.status === "error" && state.data.length === 0) {
      return () => cleanups.forEach((cleanup) => cleanup());
    }
  }
  const hasVisibleErrorData = state.status === "error" && state.data.length > 0;
  if (!hasVisibleErrorData &&
    renderModuleFallback(container, state, {
      loading: "正在获取今天的 AI 资讯…",
      empty: "还没有资讯缓存，来源正在路上。",
      error: "AI 新闻暂不可用。",
    })
  ) {
    return () => cleanups.forEach((cleanup) => cleanup());
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
  container.append(list);
  return () => cleanups.forEach((cleanup) => cleanup());
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
  const title = createElement(container, "h2");
  title.className = "ad-section__title";
  title.textContent = "今日发现";
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
  container.append(title, layout);

  return () => {
    cleanupNews();
    cleanupRanking();
    dailyButton.removeEventListener("click", selectDaily);
    weeklyButton.removeEventListener("click", selectWeekly);
  };
}
