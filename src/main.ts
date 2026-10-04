import { FileSystemAdapter, getAllTags, Notice, Plugin, requestUrl } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "./constants";

/** Long-generation budget for the direct-HTTP summarizer and report commands. */
const SUMMARY_REQUEST_TIMEOUT_MS = 180_000;
import type { DashboardTask, NewsItem, TrendingRepo, VaultHealth } from "./domain/types";
import { AgentDashboardSettingTab } from "./settings/AgentDashboardSettingTab";
import { mergeSettings } from "./settings/settings";
import type { AgentDashboardSettings } from "./settings/settings";
import { missingVaultFolders } from "./settings/settingsValidation";
import {
  CacheMaintenance,
  NodeCacheMaintenanceFilePort,
} from "./settings/CacheMaintenance";

import { SettingsPersistenceQueue } from "./settings/SettingsPersistenceQueue";
import { normalizePanelWidth } from "./settings/settingsValidation";
import { StaleTaskError, VaultActions } from "./features/vault/VaultActions";
import { VaultScanner } from "./features/vault/VaultScanner";
import {
  ensureRibbonGradient,
  incompleteTaskCount,
  RIBBON_BADGE_CLASS,
  RIBBON_CLASS,
  RIBBON_ICON,
  setRibbonActive,
  updateRibbonBadge,
} from "./view/ribbon";
import { GitHubTrendingService } from "./features/feeds/githubTrending";
import { HackerNewsService } from "./features/feeds/hackerNews";
import { collectRssNews } from "./features/feeds/rss";
import { FEED_CACHE_NAMES, FeedService, VAULT_ROUTED_CACHE_NAMES } from "./features/feeds/FeedService";
import { ApiSummarizerService } from "./features/feeds/ApiSummarizerService";
import { DivinationReadingService } from "./features/divination/DivinationReadingService";
import { TopicPromptModal } from "./features/report/TopicPromptModal";
import { CacheRepository } from "./infrastructure/CacheRepository";
import { RefreshCoordinator } from "./infrastructure/RefreshCoordinator";
import { ObsidianCacheStorage } from "./infrastructure/ObsidianCacheStorage";
import { RoutedFeedCache } from "./infrastructure/RoutedFeedCache";
import { createObsidianRequestPort } from "./infrastructure/ObsidianRequestPort";
import { describeFailure } from "./infrastructure/errorDetail";

import {
  isMarkdownVaultEvent,
  shouldRefreshForRename,
  VaultRefreshDebouncer,
} from "./infrastructure/VaultRefreshDebouncer";
import { AgentDashboardView } from "./view/AgentDashboardView";
import { createTarotAssetResolver } from "./view/tarotAssetUrl";
import {
  runSafely,
  ViewActivationCoordinator,
} from "./view/viewActivation";

export default class AgentDashboardPlugin extends Plugin {
  settings!: AgentDashboardSettings;
  private viewActivation!: ViewActivationCoordinator<WorkspaceLeaf>;
  private localRefreshDebouncer: VaultRefreshDebouncer | null = null;
  private apiSummarizer: ApiSummarizerService | null = null;
  private cacheMaintenance: CacheMaintenance | null = null;
  private dataCacheMaintenance: CacheMaintenance | null = null;
  private settingsPersistence: SettingsPersistenceQueue<AgentDashboardSettings> | null = null;
  private vaultActions: VaultActions | null = null;
  private vaultScanner: VaultScanner | null = null;
  private ribbonBadge: HTMLElement | null = null;
  private repoRelevanceIndex: { builtAt: number; titles: Set<string> } = {
    builtAt: 0,
    titles: new Set(),
  };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new AgentDashboardSettingTab(this.app, this));
    const scanner = new VaultScanner(
      this.app.vault,
      this.app.metadataCache,
      () => this.settings,
      () => new Date(),
      getAllTags,
    );
    this.vaultScanner = scanner;
    const actions = new VaultActions(
      this.app.vault,
      this.app.workspace,
      () => this.settings,
      () => new Date(),
    );
    this.vaultActions = actions;
    const request = createObsidianRequestPort((options) => requestUrl(options));
    // Summaries and reports are long generations: the default 15s port timeout is far too short.
    const summaryRequest = createObsidianRequestPort(
      (options) => requestUrl(options),
      SUMMARY_REQUEST_TIMEOUT_MS,
    );

    // Feed caches live in the plugin data folder, out of sync and search.
    const adapterStorage = new ObsidianCacheStorage(this.app.vault.adapter);
    const dataCacheFolder = `${this.manifest.dir}/cache`;
    const vaultCache = new CacheRepository(
      adapterStorage,
      () => this.settings.externalCacheTtlMinutes * 60_000,
      Date.now,
      this.settings.cacheFolder,
    );
    const dataCache = new CacheRepository(
      adapterStorage,
      () => this.settings.externalCacheTtlMinutes * 60_000,
      Date.now,
      dataCacheFolder,
    );
    await this.migrateFeedCaches(dataCacheFolder);
    const feedCache = new RoutedFeedCache(vaultCache, dataCache, VAULT_ROUTED_CACHE_NAMES);
    // Late-bound so the summarizer reuses the headlines the panel already has
    // instead of repeating the slow Hacker News crawl.
    let feedServiceRef: { latestNews(): Promise<NewsItem[]> } | null = null;
    const apiSummarizer = new ApiSummarizerService({
      request: summaryRequest,
      settings: () => this.settings,
      fetchNews: async () => feedServiceRef?.latestNews() ?? [],
      readEnvironment: (name) => process.env[name],
    });
    this.apiSummarizer = apiSummarizer;
    // 解牌复用同一套接口配置(地址 / 模型 / 密钥环境变量),不新增第二份。
    const divinationReading = new DivinationReadingService({
      generator: apiSummarizer,
      settings: () => this.settings,
    });

    const github = new GitHubTrendingService(request, async () => {
      const secretName = this.settings.githubSecretName.trim();
      if (secretName === "") return undefined;
      try {
        // Runtime optional access keeps Obsidian 1.8–1.11.3 compatible; SecretStorage is public from 1.11.4.
        // eslint-disable-next-line obsidianmd/no-unsupported-api -- Guarded public API with an unauthenticated fallback.
        return this.app.secretStorage?.getSecret(secretName) ?? undefined;
      } catch {
        return undefined;
      }
    }, () => this.settings.externalCacheTtlMinutes * 60_000);
    const adapter = this.app.vault.adapter;
    if (adapter instanceof FileSystemAdapter) {
      const vaultRoot = adapter.getBasePath();
      this.cacheMaintenance = new CacheMaintenance(
        new NodeCacheMaintenanceFilePort(),
        vaultRoot,
        () => this.settings.cacheFolder,
      );
      this.dataCacheMaintenance = new CacheMaintenance(
        new NodeCacheMaintenanceFilePort(),
        vaultRoot,
        () => dataCacheFolder,
      );

    }
    const feedService = new FeedService(
      feedCache,
      new RefreshCoordinator(),
      github,
      new HackerNewsService(request),
      (feeds) => collectRssNews(feeds, request),
      () => [...this.settings.rssFeeds],
      Date.now,
      {
        runner: apiSummarizer,
        attemptStore: {
          get: () => Promise.resolve(
            this.settings.lastSummaryAttemptDate === ""
              ? undefined
              : this.settings.lastSummaryAttemptDate,
          ),
          mark: async (date) => {
            await this.updateSetting("lastSummaryAttemptDate", date);
          },
        },
        autoSummaryEnabled: () => this.settings.autoDailySummary,
        briefPersisted: (brief) => actions.upsertDailyBrief(brief),
      },
    );
    feedServiceRef = feedService;

    this.viewActivation = new ViewActivationCoordinator({
      getExistingLeaf: () => this.app.workspace.getLeavesOfType(VIEW_TYPE)[0],
      createLeaf: () => this.app.workspace.getLeaf("tab"),
      revealLeaf: (leaf) => this.app.workspace.revealLeaf(leaf),
    });

    this.registerView(
      VIEW_TYPE,
      (leaf) =>
        new AgentDashboardView(
          leaf,
          () => scanner.scan(),
          () => scanner.scanFresh(),
          () => actions.createOrOpenDailyNote(),
          () => {
            new Notice("无法创建或打开今日日记");
          },
          (task) => actions.toggleTask(task),
           (error) => {
            new Notice(
              error instanceof StaleTaskError
                ? error.message
                : "无法更新任务，请稍后重试",
             );
           },
           (listener) => feedService.open(listener),
           (module, listener) => feedService.retry(module, listener),
           () => {
             // eslint-disable-next-line obsidianmd/ui/sentence-case -- Product name uses title case.
             new Notice("请打开设置 → 第三方插件 → Agent Dashboard");
           },
           () => this.settings,
           () => feedService.cancelDailyBrief(),
           (repo) => this.isRepoRelevant(repo),
           (key, width) => this.updateSetting(key, normalizePanelWidth(width) ?? 0),
           // 塔罗牌面读插件目录下的 assets/tarot,不联网、也不进 main.js。
           createTarotAssetResolver(this.app, this.manifest.dir),
           divinationReading,
           // 徽标跟着视图那次扫描的结果走，宿主不再重复扫一次全库。
           (tasks) => this.applyRibbonBadge(tasks),
         ),
    );

    this.localRefreshDebouncer = new VaultRefreshDebouncer(() => {
      let hasOpenView = false;
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof AgentDashboardView) {
          leaf.view.refreshLocal();
          hasOpenView = true;
        }
      }
      // 有面板时徽标跟着面板那次扫描走（onLocalScan），否则同一次编辑会触发
      // 两次全库扫描。没有面板可跟时才自己扫一次，保证徽标数字不算旧。
      if (!hasOpenView) void this.refreshRibbonBadge();
    });
    const scheduleLocalRefresh = (file: { path: string; extension?: string }): void => {
      if (isMarkdownVaultEvent(file)) this.localRefreshDebouncer?.trigger();
    };
    this.registerEvent(this.app.vault.on("create", scheduleLocalRefresh));
    this.registerEvent(this.app.vault.on("modify", scheduleLocalRefresh));
    this.registerEvent(this.app.vault.on("delete", scheduleLocalRefresh));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (shouldRefreshForRename(file, oldPath)) this.localRefreshDebouncer?.trigger();
    }));

    // While the dashboard is open, silently refresh external modules whose TTL expired.
    this.registerInterval(window.setInterval(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof AgentDashboardView) leaf.view.refreshExternal();
      }
    }, 5 * 60 * 1000));

    const ribbon = this.addRibbonIcon(RIBBON_ICON, "Open agent dashboard", () => {
      this.openDashboard();
    });
    ribbon.addClass(RIBBON_CLASS);
    this.ribbonBadge = ribbon.createSpan({ cls: RIBBON_BADGE_CLASS });
    ensureRibbonGradient(activeDocument);
    const syncRibbonActive = (): void => {
      setRibbonActive(ribbon, this.app.workspace.getLeavesOfType(VIEW_TYPE).length > 0);
    };
    syncRibbonActive();
    this.registerEvent(this.app.workspace.on("active-leaf-change", syncRibbonActive));
    this.registerEvent(this.app.workspace.on("layout-change", syncRibbonActive));
    this.app.workspace.onLayoutReady(() => {
      void this.refreshRibbonBadge();
      this.warnMissingTaskFolders();
    });

    this.addCommand({
      id: "open-dashboard",
      // eslint-disable-next-line obsidianmd/commands/no-plugin-name-in-command-name, obsidianmd/ui/sentence-case -- Required command name.
      name: "Open Agent Dashboard",
      callback: () => this.openDashboard(),
    });

    this.addCommand({
      id: "deep-research-report",
      name: "Generate deep research report",
      callback: () => {
        runSafely(async () => {
          const activeFile = this.app.workspace.getActiveFile();
          const topic = await TopicPromptModal.ask(this.app, activeFile?.basename ?? "");
          if (topic === null) return;
          await this.runDeepResearch(topic);
        }, (error) => {
          console.error("[agent-dashboard] Deep research report failed:", error);
          new Notice(describeFailure("无法开始深度研究，请稍后重试", error), 10_000);
        });
      },
    });

    this.addCommand({
      id: "vault-health-report",
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- Vault is a product name.
      name: "Generate Vault health report",
      callback: () => {
        runSafely(() => this.runVaultHealthReport(), (error) => {
          console.error("[agent-dashboard] Vault health report failed:", error);
          new Notice(
            describeFailure("Vault 体检报告生成失败，请检查直连 API 配置", error),
            10_000,
          );
        });
      },
    });
  }

  onunload(): void {

    this.ribbonBadge = null;
    this.cacheMaintenance = null;
    this.dataCacheMaintenance = null;
    this.localRefreshDebouncer?.cancel();
    this.localRefreshDebouncer = null;
    // Leaves are intentionally kept: detaching them on unload would destroy the
    // user's workspace layout on every plugin reload (Obsidian guideline).
  }

  async loadSettings(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.settingsPersistence = new SettingsPersistenceQueue(
      this.settings,
      (snapshot) => this.saveData(snapshot),
    );
  }

  async saveSettings(): Promise<void> {
    if (this.settingsPersistence === null) throw new Error("Settings persistence is unavailable.");
    await this.settingsPersistence.saveCurrent();
  }

  async updateSetting<K extends keyof AgentDashboardSettings>(
    key: K,
    value: AgentDashboardSettings[K],
  ): Promise<void> {
    if (this.settingsPersistence === null) throw new Error("Settings persistence is unavailable.");
    await this.settingsPersistence.update(key, value);
  }



  /**
   * Re-runs the local scan for every open dashboard view (used after a scan-scope setting changes).
   */
  /**
   * Mirrors the panel's incomplete-task count onto the ribbon, for the case where
   * no dashboard view is open to hand us its scan result.
   *
   * 必须用 scanFresh()：scan() 会复用编辑前启动的那次扫描（VaultScanner 的注释
   * 明写这一点），徽标就会一直落在面板后面一次编辑，而且没有后续事件纠正它。
   */
  async refreshRibbonBadge(): Promise<void> {
    const scanner = this.vaultScanner;
    if (this.ribbonBadge === null || scanner === null) return;
    try {
      const state = await scanner.scanFresh();
      this.applyRibbonBadge(state.tasks);
    } catch {
      // Keep the previous count: a background scan failure must stay invisible.
    }
  }

  /** 视图扫描完成后的徽标更新：这次扫描已经做过，不再重复扫 Vault。 */
  private applyRibbonBadge(tasks: readonly DashboardTask[]): void {
    const badge = this.ribbonBadge;
    if (badge === null) return;
    updateRibbonBadge(badge, incompleteTaskCount(tasks));
  }

  refreshLocalViews(): void {
    this.localRefreshDebouncer?.trigger();
  }

  /**
   * Re-renders every open dashboard view in place, without re-scanning the Vault
   * or re-fetching feeds. Used after display-scope settings change (e.g. 卜筮).
   */
  refreshOpenViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof AgentDashboardView) leaf.view.renderNow();
    }
  }

  /**
   * A task folder that does not exist collects nothing at all, so the panel
   * looks broken with no explanation. Report it once per load instead.
   */
  private warnMissingTaskFolders(): void {
    const missing = missingVaultFolders(this.settings.taskIncludeFolders, (path) => {
      const target = this.app.vault.getAbstractFileByPath(path);
      return target !== null && "children" in target;
    });
    if (missing.length === 0) return;
    new Notice(`任务来源文件夹不存在：${missing.join("、")}，待办列表会为空。`, 10_000);
  }

  async regenerateCaches(): Promise<number> {
    if (this.cacheMaintenance === null) throw new Error("Cache maintenance is unavailable.");
    const vaultCount = await this.cacheMaintenance.regenerate();
    const dataCount = this.dataCacheMaintenance === null
      ? 0
      : await this.dataCacheMaintenance.regenerate();
    return vaultCount + dataCount;
  }

  async quarantineCorruptCaches(): Promise<number> {
    if (this.cacheMaintenance === null) throw new Error("Cache maintenance is unavailable.");
    const vaultCount = await this.cacheMaintenance.quarantineCorrupt();
    const dataCount = this.dataCacheMaintenance === null
      ? 0
      : await this.dataCacheMaintenance.quarantineCorrupt();
    return vaultCount + dataCount;
  }

  /** One-time best-effort copy of feed caches from the legacy Vault folder
   * into the plugin data folder. Existing destination files win. */
  private async migrateFeedCaches(dataCacheFolder: string): Promise<void> {
    const adapter = this.app.vault.adapter;
    const storage = new ObsidianCacheStorage(adapter);
    const names = [
      FEED_CACHE_NAMES.githubDaily,
      FEED_CACHE_NAMES.githubWeekly,
      FEED_CACHE_NAMES.dailyBrief,
    ];
    for (const name of names) {
      for (const suffix of [".json", ".backup.json"]) {
        const from = `${this.settings.cacheFolder}/${name}${suffix}`;
        const to = `${dataCacheFolder}/${name}${suffix}`;
        try {
          if ((await adapter.exists(from)) && !(await adapter.exists(to))) {
            await storage.write(to, await adapter.read(from));
          }
        } catch {
          // Best-effort migration; a missing entry simply re-fetches.
        }
      }
    }
  }

  private isRepoRelevant(repo: TrendingRepo): boolean {
    const now = Date.now();
    if (now - this.repoRelevanceIndex.builtAt > 60_000) {
      this.repoRelevanceIndex.titles = new Set(
        this.app.vault.getMarkdownFiles().map((file) => file.basename.toLowerCase()),
      );
      this.repoRelevanceIndex.builtAt = now;
    }
    const tokens = repo.name.toLowerCase().split("/")
      .filter((token) => token.length >= 3);
    return tokens.some((token) => this.repoRelevanceIndex.titles.has(token));
  }

  private requireSummarizer(): ApiSummarizerService {
    if (this.apiSummarizer === null) throw new Error("API 摘要服务不可用。");
    return this.apiSummarizer;
  }

  private async runDeepResearch(topic: string): Promise<void> {
    const summarizer = this.requireSummarizer();
    const actions = this.vaultActions;
    if (actions === null) throw new Error("Vault actions are unavailable.");
    const prompt = "请对以下主题进行深度研究，并用简体中文输出结构完整的 Markdown 研究报告" +
      "（包含：标题、摘要、关键要点、趋势与争议、延伸阅读建议）。\n" +
      `直接把报告作为最终回复。\n\n主题：${topic}\n`;
    new Notice("正在生成研究报告，可能需要几分钟…");
    const report = await summarizer.runText(prompt);
    const file = await actions.writeReport(topic, report);
    await this.openReportFile(file, "研究报告已保存");
  }

  private async runVaultHealthReport(): Promise<void> {
    const summarizer = this.requireSummarizer();
    const actions = this.vaultActions;
    const scanner = this.vaultScanner;
    if (actions === null || scanner === null) throw new Error("Vault actions are unavailable.");
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Vault is a product name.
    new Notice("正在扫描 Vault 并生成体检报告，可能需要几分钟…");
    const scan = await scanner.scan();
    const prompt = "请根据以下 Obsidian Vault 健康数据撰写 Markdown 体检报告" +
      "（现状评估、主要问题、按优先级排序的具体改进建议）。\n" +
      `不要写入任何文件，直接把报告作为最终回复。\n\n${describeHealth(scan.health)}\n`;
    const report = await summarizer.runText(prompt);
    const file = await actions.writeReport("vault-lint", report);
    await this.openReportFile(file, "Vault 体检报告已保存");
  }

  private async openReportFile(file: TFile, message: string): Promise<void> {
    new Notice(`${message}：${file.path}`);
    await this.app.workspace.getLeaf("tab").openFile(file);
  }



  private activateView(): Promise<void> {
    return this.viewActivation.activate();
  }

  private openDashboard(): void {
    runSafely(
      () => this.activateView(),
      () => {
        new Notice("Unable to open agent dashboard");
      },
    );
  }
}

function describeHealth(health: VaultHealth): string {
  if (health.score === null) return "健康数据不足（Vault 中还没有足够的笔记）。";
  const breakdown = Object.keys(health.breakdown)
    .map((key) => `${key}: ${Math.round(health.breakdown[key as keyof typeof health.breakdown])}/20`)
    .join("；");
  return `健康分数：${health.score}/100；分项得分：${breakdown}；现有建议：${health.suggestions.join("；") || "无"}`;
}
