import { ItemView, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../constants";
import type { DashboardState, DashboardTask, RecentNote, TrendingRepo } from "../domain/types";
import type { LocalDashboardData } from "../features/vault/VaultScanner";
import { localDateKey } from "../features/vault/VaultScanner";
import { selectArchivedTaskTexts } from "../features/vault/archiveTasks";
import { findArchiveHeadingIndex } from "../features/vault/taskParser";
import type { AgentDashboardSettings, ColumnWidthKey } from "../settings/settings";
import type {
  FeedStateListener,
  RetryableExternalModule,
} from "../features/feeds/FeedService";
import {
  applyLocalError,
  applyLocalScan,
  createLoadingDashboardState,
} from "./localDashboardState";
import { createDashboardRenderCache, renderDashboard } from "./renderState";
import { createTodayInteractionState } from "./renderToday";
import { runSafely } from "./viewActivation";
import { LocalDashboardController } from "./LocalDashboardController";
import { ExternalDashboardController } from "./ExternalDashboardController";
import {
  applyExternalSnapshot,
  dashboardAutomationStatus,
  latestDashboardUpdate,
} from "./externalDashboardState";
import {
  createXuanxueSessionState,
  type XuanxueSessionState,
} from "../features/divination/bushiTypes";
import type { TarotAssetResolver } from "../features/divination/tarotFace";
import type { DivinationReadingPort } from "../features/divination/divinationReading";
import { AsideDataController } from "./AsideDataController";

const RANKING_PERIOD_STORAGE_KEY = "agent-dashboard:ranking-period";
const NEWS_VIEW_STORAGE_KEY = "agent-dashboard:news-view";
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

/** AI 新闻里「摘要 / 新闻」的页签选择:默认摘要,选择按 Vault 记住。 */
function loadNewsView(): "brief" | "list" {
  try {
    return window.localStorage.getItem(NEWS_VIEW_STORAGE_KEY) === "list" ? "list" : "brief";
  } catch {
    return "brief";
  }
}

function persistNewsView(view: "brief" | "list"): void {
  try {
    window.localStorage.setItem(NEWS_VIEW_STORAGE_KEY, view);
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
  private newsView: "brief" | "list" = loadNewsView();
  /** 卜筮会话:选中方法、各面板表单与结果,跨整页重渲染保留。 */
  private readonly xuanxue: XuanxueSessionState = createXuanxueSessionState();
  /**
   * 头部黄历卡、「今日运势」与今日一牌解牌的取数、缓存键与在途守卫。
   * 视图只读它（almanac / fortune / reading）并调 refresh()，不再自己管这三套状态。
   */
  private readonly aside: AsideDataController;
  /** Local UI choices that must survive the re-render triggered by every state push. */
  private readonly interaction = createTodayInteractionState();
  /**
   * 板块缓存：跨次渲染保留没变的板块（含它们的事件监听与分栏拖拽状态）。
   * 每次状态推送都换新的缓存就等于回到「整页重建」。
   */
  private readonly renderCache = createDashboardRenderCache();
  private archiveTimer: number | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly scanVault: () => Promise<LocalDashboardData>,
    /** File-change refresh: must never reuse a scan that started before the edit. */
    private readonly scanVaultAfterChange: () => Promise<LocalDashboardData>,
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
    private readonly onColumnWidthChange: (
      key: ColumnWidthKey,
      width: number,
    ) => Promise<void> = async () => undefined,
    /** 塔罗牌面素材地址解析(插件内置 assets/tarot);给不出时牌面降级成占位。 */
    private readonly resolveTarotAsset: TarotAssetResolver = () => null,
    /** 大模型解牌;缺省时今日一牌与卜筮塔罗都只出牌面。 */
    private readonly divinationReading: DivinationReadingPort | null = null,
    /**
     * 扫描完成后把待办交给宿主刷新 ribbon 徽标。有了它，文件事件触发的刷新
     * 不必再让宿主自己扫一次全库；没有视图时宿主才需要自己扫。
     */
    private readonly onLocalScan: (tasks: readonly DashboardTask[]) => void = () => undefined,
  ) {
    super(leaf);
    this.aside = new AsideDataController({
      settings: this.getSettings,
      reading: () => this.divinationReading,
      onChanged: () => this.renderCurrent(),
    });
    this.localController = new LocalDashboardController({
      scan: this.scanVault,
      scanAfterChange: this.scanVaultAfterChange,
      toggleTask: this.onToggleTask,
      onReady: (data, updatedAt) => {
        // 徽标先更新：这次扫描的结果无论如何都算数，即使视图正在关闭。
        this.onLocalScan(data.tasks);
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
    this.aside.refresh();
    // onOpen 重复进入时旧句柄会被覆盖，先清掉再排，避免上一次的定时器空跑一次归档。
    if (this.archiveTimer !== null) window.clearTimeout(this.archiveTimer);
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
    this.aside.refresh();
  }

  private renderCurrent(): void {
    if (this.state === null) return;
    this.render(dashboardAutomationStatus(this.state));
  }

  /**
   * 纯重渲染:不重扫 Vault、不重新抓资讯。
   * 供显示类设置变更(例如「启用卜筮」开关)后立刻生效。
   */
  public renderNow(): void {
    // 解牌开关/接口配置刚被改过:这一轮顺便补一次解牌,再重渲染。
    this.aside.refreshReading();
    this.renderCurrent();
  }

  /** Opens a recent note in a new tab so the dashboard itself stays visible. */
  private openRecentNote(note: RecentNote): void {
    const target = this.app.vault.getAbstractFileByPath(note.path);
    if (!(target instanceof TFile)) return;
    runSafely(
      () => this.app.workspace.getLeaf("tab").openFile(target),
      () => undefined,
    );
  }

  private render(status: string): void {
    if (this.state === null) return;
    const scrollTop = this.contentEl.scrollTop;
    const settings = this.getSettings();
    const saveColumnWidth = (key: ColumnWidthKey, width: number): void => {
      runSafely(
        () => this.onColumnWidthChange(key, width),
        () => undefined,
      );
    };
    // 不再整页拆掉重建：板块缓存按数据身份复用没变的板块，重画只发生在真正变了的那块。
    this.cleanupRender = renderDashboard(this.contentEl, this.state, {
      updatedAt: latestDashboardUpdate(this.state),
      status,
      onNewDiary: () => runSafely(this.onNewDiary, this.onNewDiaryError),
      onToggleTask: (task) => this.toggleAndRefresh(task),
      onOpenNote: (note) => this.openRecentNote(note),
      interaction: this.interaction,
      onRetry: (module) => { void this.externalController.retry(module); },
      onOpenSettings: this.onOpenSettings,
      rankingPeriod: this.rankingPeriod,
      onRankingPeriodChange: (period) => {
        this.rankingPeriod = period;
        persistRankingPeriod(period);
      },
      newsView: this.newsView,
      onNewsViewChange: (view) => {
        this.newsView = view;
        persistNewsView(view);
      },
      onCancelDailyBrief: this.onCancelDailyBrief,
      isRepoRelevant: this.isRepoRelevant,
      almanac: this.getSettings().bushiEnabled ? this.aside.almanac : null,
      fortune: this.getSettings().bushiEnabled ? this.aside.fortune ?? undefined : undefined,
      fortuneReading: this.aside.reading,
      resolveTarotAsset: this.resolveTarotAsset,
      divinationReading: this.divinationReading ?? undefined,
      bushi: this.getSettings().bushiEnabled ? { session: this.xuanxue } : undefined,
      onBushiSettled: () => this.renderCurrent(),
      todayNotesWidth: settings.todayNotesWidth,
      onTodayNotesWidthChange: (width) => saveColumnWidth("todayNotesWidth", width),
      discoveryRankingWidth: settings.discoveryRankingWidth,
      onDiscoveryRankingWidthChange: (width) => saveColumnWidth("discoveryRankingWidth", width),
    }, this.renderCache);
    this.contentEl.scrollTop = scrollTop;
  }

  private toggleAndRefresh(task: DashboardTask): void {
    void this.localController.toggle(task);
  }

  /**
   * Appends previously completed tasks from *earlier daily notes* to today's
   * daily note under the "归档" heading. Idempotent: a task whose archived line
   * already exists in the note is skipped, so reopening the dashboard never
   * duplicates, and lines that are already archived are never archived again.
   */
  private async archiveOldCompletedTasks(): Promise<void> {
    const state = this.state;
    if (state === null || state.tasks.status !== "ready") return;
    const today = localDateKey(new Date());
    const folder = this.getSettings().dailyFolder;
    const carryOver = selectArchivedTaskTexts(state.tasks.data, {
      dailyFolder: folder,
      today,
    });
    if (carryOver.length === 0) return;

    const notePath = folder.length > 0 ? `${folder}/${today}.md` : `${today}.md`;
    const target = this.app.vault.getAbstractFileByPath(notePath);
    if (!(target instanceof TFile)) return;

    try {
      await this.app.vault.process(target, (content) => {
        const contentLines = content.split(/\r?\n/);
        // 行级精确比对：子串匹配会让已存在的「- [x] 买牛奶」把
        // 「- [x] 买牛奶和鸡蛋」也判定成已归档，互为前缀的任务就此静默漏归档。
        const additions = carryOver.filter((text) => {
          const wanted = `- [x] ${text}`;
          return !contentLines.some((line) => line.trim() === wanted);
        });
        if (additions.length === 0) return content;
        const lines = additions.map((text) => `- [x] ${text}`);
        const headingIndex = findArchiveHeadingIndex(contentLines);
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
