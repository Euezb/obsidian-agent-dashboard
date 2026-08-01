import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../constants";
import type { DashboardState, DashboardTask, TrendingRepo } from "../domain/types";
import type { LocalDashboardData } from "../features/vault/VaultScanner";
import { localDateKey } from "../features/vault/VaultScanner";
import type { AgentDashboardSettings } from "../settings/settings";
import type {
  FeedStateListener,
  RetryableExternalModule,
} from "../features/feeds/FeedService";
import {
  applyLocalError,
  applyLocalScan,
  createLoadingDashboardState,
} from "./localDashboardState";
import { renderDashboard } from "./renderState";
import { runSafely } from "./viewActivation";
import { LocalDashboardController } from "./LocalDashboardController";
import { ExternalDashboardController } from "./ExternalDashboardController";
import {
  applyExternalSnapshot,
  dashboardAutomationStatus,
  latestDashboardUpdate,
} from "./externalDashboardState";

const RANKING_PERIOD_STORAGE_KEY = "agent-dashboard:ranking-period";
const ARCHIVE_DELAY_MS = 500;

function loadRankingPeriod(): "daily" | "weekly" {
  try {
    return window.localStorage.getItem(RANKING_PERIOD_STORAGE_KEY) === "weekly" ? "weekly" : "daily";
  } catch {
    return "daily";
  }
}

function persistRankingPeriod(period: "daily" | "weekly"): void {
  try {
    window.localStorage.setItem(RANKING_PERIOD_STORAGE_KEY, period);
  } catch {
    // Persistence is best-effort; the in-memory value still applies for this session.
  }
}

export class AgentDashboardView extends ItemView {
  private cleanupRender: (() => void) | null = null;
  private state: DashboardState | null = null;
  private readonly localController: LocalDashboardController;
  private readonly externalController: ExternalDashboardController;
  private rankingPeriod: "daily" | "weekly" = loadRankingPeriod();
  private archiveTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly scanVault: () => Promise<LocalDashboardData>,
    private readonly onNewDiary: () => Promise<void>,
    private readonly onNewDiaryError: (error: unknown) => void,
    private readonly onToggleTask: (task: DashboardTask) => Promise<void>,
    private readonly onToggleTaskError: (error: unknown) => void,
    openFeeds: (listener: FeedStateListener) => Promise<void>,
    retryFeeds: (
      module: RetryableExternalModule,
      listener: FeedStateListener,
    ) => Promise<void>,
    private readonly onOpenSettings: () => void,
    private readonly getSettings: () => AgentDashboardSettings,
    private readonly onCancelDailyBrief: () => void = () => undefined,
    private readonly isRepoRelevant: (repo: TrendingRepo) => boolean = () => false,
  ) {
    super(leaf);
    this.localController = new LocalDashboardController({
      scan: this.scanVault,
      toggleTask: this.onToggleTask,
      onReady: (data, updatedAt) => {
        if (this.state === null) return;
        this.state = applyLocalScan(this.state, data, updatedAt);
        this.render(dashboardAutomationStatus(this.state));
      },
      onScanError: () => {
        if (this.state === null) return;
        this.state = applyLocalError(this.state);
        this.render("本地数据读取失败");
      },
      onToggleError: (error) => {
        if (this.state !== null) this.render("任务更新失败");
        this.onToggleTaskError(error);
      },
      now: Date.now,
    });
    this.externalController = new ExternalDashboardController(
      openFeeds,
      (external) => {
        if (this.state === null) return;
        this.state = applyExternalSnapshot(this.state, external);
        this.render(dashboardAutomationStatus(this.state));
      },
      () => {
        if (this.state !== null) this.render("部分资讯暂不可用");
      },
      retryFeeds,
    );
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Required view display name.
    return "Agent Dashboard";
  }

  getIcon(): string {
    return "layout-dashboard";
  }

  async onOpen(): Promise<void> {
    this.cleanupRender?.();
    this.cleanupRender = null;
    this.state = createLoadingDashboardState();
    this.render("正在读取 Vault…");

    void this.externalController.open();
    await this.localController.open();
    this.archiveTimer = window.setTimeout(() => {
      this.archiveTimer = null;
      void this.archiveOldCompletedTasks();
    }, ARCHIVE_DELAY_MS);
  }

  onClose(): Promise<void> {
    if (this.archiveTimer !== null) {
      window.clearTimeout(this.archiveTimer);
      this.archiveTimer = null;
    }
    this.localController.close();
    this.externalController.close();
    this.cleanupRender?.();
    this.cleanupRender = null;
    this.state = null;
    this.contentEl.empty();

    return Promise.resolve();
  }

  public refreshLocal(): void {
    if (this.state !== null) void this.localController.refresh();
  }

  /** Re-runs the external feed pipeline; stale modules refresh per TTL. */
  public refreshExternal(): void {
    if (this.state !== null) void this.externalController.open();
  }

  private render(status: string): void {
    if (this.state === null) return;
    const scrollTop = this.contentEl.scrollTop;
    this.cleanupRender?.();
    this.contentEl.empty();
    this.cleanupRender = renderDashboard(this.contentEl, this.state, {
      updatedAt: latestDashboardUpdate(this.state),
      status,
      onNewDiary: () => runSafely(this.onNewDiary, this.onNewDiaryError),
      onToggleTask: (task) => this.toggleAndRefresh(task),
      onRetry: (module) => { void this.externalController.retry(module); },
      onOpenSettings: this.onOpenSettings,
      rankingPeriod: this.rankingPeriod,
      onRankingPeriodChange: (period) => {
        this.rankingPeriod = period;
        persistRankingPeriod(period);
      },
      onCancelDailyBrief: this.onCancelDailyBrief,
      isRepoRelevant: this.isRepoRelevant,
    });
    this.contentEl.scrollTop = scrollTop;
  }

  private toggleAndRefresh(task: DashboardTask): void {
    void this.localController.toggle(task);
  }

  /**
   * Appends previously completed tasks (from earlier daily notes) to today's
   * daily note under "## 归档". Idempotent: a task whose archived line already
   * exists in the note is skipped, so reopening the dashboard never duplicates.
   */
  private async archiveOldCompletedTasks(): Promise<void> {
    const state = this.state;
    if (state === null || state.tasks.status !== "ready") return;
    const today = localDateKey(new Date());
    const completed = state.tasks.data.filter(
      (task) => task.completed && task.date !== undefined && task.date < today,
    );
    if (completed.length === 0) return;

    const folder = this.getSettings().dailyFolder;
    const notePath = folder.length > 0 ? `${folder}/${today}.md` : `${today}.md`;
    const target = this.app.vault.getAbstractFileByPath(notePath);
    if (!(target instanceof TFile)) return;

    try {
      await this.app.vault.process(target, (content) => {
        const additions = completed
          .map((task) => task.text.trim())
          .filter((text) => text !== "" && !content.includes(`- [x] ${text}`));
        if (additions.length === 0) return content;
        const lines = additions.map((text) => `- [x] ${text}`);
        const contentLines = content.split(/\r?\n/);
        const headingIndex = contentLines.findIndex((line) => line.trim() === "## 归档");
        if (headingIndex === -1) {
          return `${content}\n\n## 归档\n${lines.join("\n")}\n`;
        }
        contentLines.splice(headingIndex + 1, 0, ...lines);
        return contentLines.join("\n");
      });
    } catch (error) {
      console.warn("Archive write failed:", error);
    }
  }
}
