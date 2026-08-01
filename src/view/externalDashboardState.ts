import type { DashboardState, ModuleState, NewsItem } from "../domain/types";
import type { ExternalDashboardState } from "../features/feeds/FeedService";

export function applyExternalSnapshot(
  state: DashboardState,
  external: ExternalDashboardState,
  now: number = Date.now(),
): DashboardState {
  return {
    ...state,
    aiNews: visibleNews(external, now),
    githubDaily: external.githubDaily,
    githubWeekly: external.githubWeekly,
    dailyBrief: external.dailyBrief,
  };
}

export function latestDashboardUpdate(state: DashboardState): number | undefined {
  let latest: number | undefined;
  const modules: ModuleState<unknown>[] = [
    state.tasks,
    state.recentNotes,
    state.heatmap,
    state.health,
    state.aiNews,
    state.githubDaily,
    state.githubWeekly,
    state.dailyBrief,
  ];
  for (const module of modules) {
    const updatedAt = module.updatedAt;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) continue;
    latest = latest === undefined ? updatedAt : Math.max(latest, updatedAt);
  }
  return latest;
}

export function dashboardAutomationStatus(state: DashboardState): string {
  if (state.dailyBrief.status === "loading") return "正在生成今日摘要";
  const statuses = [state.aiNews.status, state.githubDaily.status, state.githubWeekly.status];
  if (statuses.some((status) => status === "loading" || status === "idle")) {
    return "正在更新资讯";
  }
  if (statuses.some((status) => status === "stale" || status === "error")) {
    return "部分资讯暂不可用";
  }
  return "自动更新完成";
}

function visibleNews(external: ExternalDashboardState, now: number): ModuleState<NewsItem[]> {
  const brief = external.dailyBrief.data;
  if (external.dailyBrief.status !== "ready" || brief === null || brief.items.length === 0 ||
    brief.date !== localCalendarDate(now) || localCalendarDate(brief.generatedAt) !== brief.date) {
    return external.aiNews;
  }

  return {
    status: "ready",
    updatedAt: brief.generatedAt,
    data: brief.items.map((item, index) => ({
      id: `brief:${brief.date}:${index}`,
      title: item.title,
      url: item.url,
      source: item.source,
      summary: item.summary,
      publishedAt: new Date(brief.generatedAt).toISOString(),
    })),
  };
}

export function localCalendarDate(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
