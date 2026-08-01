import type { DashboardState, DashboardTask, TrendingRepo } from "../domain/types";
import type { RetryableExternalModule } from "../features/feeds/FeedService";
import { createElement } from "./domHelpers";
import { renderDiscovery } from "./renderDiscovery";
import { renderHeader } from "./renderHeader";
import { renderToday } from "./renderToday";
import { renderVaultPulse } from "./renderVaultPulse";

export interface DashboardRenderCallbacks {
  updatedAt?: number;
  status: string;
  onNewDiary: () => void;
  onToggleTask?: (task: DashboardTask) => void;
  onRetry?: (module: RetryableExternalModule) => void;
  onOpenSettings?: () => void;
  rankingPeriod?: "daily" | "weekly";
  onRankingPeriodChange?: (period: "daily" | "weekly") => void;
  onCancelDailyBrief?: () => void;
  isRepoRelevant?: (repo: TrendingRepo) => boolean;
}

export function renderDashboard(
  container: HTMLElement,
  state: DashboardState,
  callbacks: DashboardRenderCallbacks,
): () => void {
  container.replaceChildren();
  container.classList.add("agent-dashboard");
  const inner = createElement(container, "div");
  inner.className = "agent-dashboard__inner";

  const header = createElement(container, "header");
  const today = createElement(container, "section");
  const pulse = createElement(container, "section");
  const discovery = createElement(container, "section");
  const cleanupHeader = renderHeader(
    header,
    callbacks.updatedAt,
    callbacks.status,
    callbacks.onNewDiary,
  );
  const cleanupToday = renderToday(
    today,
    state.tasks,
    state.recentNotes,
    callbacks.onToggleTask,
  );
  renderVaultPulse(pulse, state.health, state.heatmap);
  const cleanupDiscovery = renderDiscovery(
    discovery,
    state.aiNews,
    state.githubDaily,
    state.githubWeekly,
    state.dailyBrief,
    {
      onRetry: callbacks.onRetry,
      onOpenSettings: callbacks.onOpenSettings,
      rankingPeriod: callbacks.rankingPeriod,
      onRankingPeriodChange: callbacks.onRankingPeriodChange,
      onCancelDailyBrief: callbacks.onCancelDailyBrief,
      isRepoRelevant: callbacks.isRepoRelevant,
    },
  );
  inner.append(header, today, pulse, discovery);
  container.append(inner);

  return () => {
    cleanupHeader();
    cleanupToday();
    cleanupDiscovery();
  };
}
