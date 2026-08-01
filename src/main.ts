import { FileSystemAdapter, getAllTags, Notice, Plugin, requestUrl } from "obsidian";
import type { TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "./constants";
import type { TrendingRepo, VaultHealth } from "./domain/types";
import { AgentDashboardSettingTab } from "./settings/AgentDashboardSettingTab";
import { mergeSettings } from "./settings/settings";
import type { AgentDashboardSettings } from "./settings/settings";
import {
  CacheMaintenance,
  NodeCacheMaintenanceFilePort,
} from "./settings/CacheMaintenance";
import { CodexDetector } from "./settings/CodexDetector";
import { SettingsPersistenceQueue } from "./settings/SettingsPersistenceQueue";
import { StaleTaskError, VaultActions } from "./features/vault/VaultActions";
import { VaultScanner } from "./features/vault/VaultScanner";
import { GitHubTrendingService } from "./features/feeds/githubTrending";
import { HackerNewsService } from "./features/feeds/hackerNews";
import { collectRssNews } from "./features/feeds/rss";
import { FEED_CACHE_NAMES, FeedService } from "./features/feeds/FeedService";
import {
  CodexRunner,
  NodeRunnerFilePort,
  TaskAlreadyRunningError,
} from "./features/codex/CodexRunner";
import { TopicPromptModal } from "./features/codex/TopicPromptModal";
import { CacheRepository } from "./infrastructure/CacheRepository";
import { RefreshCoordinator } from "./infrastructure/RefreshCoordinator";
import { ObsidianCacheStorage } from "./infrastructure/ObsidianCacheStorage";
import { RoutedFeedCache } from "./infrastructure/RoutedFeedCache";
import { createObsidianRequestPort } from "./infrastructure/ObsidianRequestPort";
import {
  NodeProcessAdapter,
  resolveCodexExecutable,
} from "./infrastructure/ProcessAdapter";
import {
  isMarkdownVaultEvent,
  shouldRefreshForRename,
  VaultRefreshDebouncer,
} from "./infrastructure/VaultRefreshDebouncer";
import { AgentDashboardView } from "./view/AgentDashboardView";
import {
  runSafely,
  ViewActivationCoordinator,
} from "./view/viewActivation";

export default class AgentDashboardPlugin extends Plugin {
  settings!: AgentDashboardSettings;
  private viewActivation!: ViewActivationCoordinator<WorkspaceLeaf>;
  private localRefreshDebouncer: VaultRefreshDebouncer | null = null;
  private codexRunner: CodexRunner | null = null;
  private codexDetector: CodexDetector | null = null;
  private cacheMaintenance: CacheMaintenance | null = null;
  private dataCacheMaintenance: CacheMaintenance | null = null;
  private settingsPersistence: SettingsPersistenceQueue<AgentDashboardSettings> | null = null;
  private vaultActions: VaultActions | null = null;
  private vaultScanner: VaultScanner | null = null;
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

    // Codex inputs stay inside the Vault (the sandboxed CLI must read them);
    // everything else lives in the plugin data folder, out of sync and search.
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
    const feedCache = new RoutedFeedCache(
      vaultCache,
      dataCache,
      new Set([FEED_CACHE_NAMES.aiNews]),
    );

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
      this.codexRunner = new CodexRunner({
        process: new NodeProcessAdapter(),
        files: new NodeRunnerFilePort(),
        cache: dataCache,
        vaultRoot,
        cacheFolder: this.settings.cacheFolder,
        resolveExecutable: () => resolveCodexExecutable(this.settings.codexExecutable),
      });
      this.codexDetector = new CodexDetector(
        new NodeProcessAdapter(),
        vaultRoot,
        (configured) => resolveCodexExecutable(configured),
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
        runner: this.codexRunner ?? undefined,
        attemptStore: {
          get: () => Promise.resolve(
            this.settings.lastCodexSummaryAttemptDate === ""
              ? undefined
              : this.settings.lastCodexSummaryAttemptDate,
          ),
          mark: async (date) => {
            await this.updateSetting("lastCodexSummaryAttemptDate", date);
          },
        },
        autoSummaryEnabled: () => this.settings.autoDailyCodexSummary,
        briefPersisted: (brief) => actions.upsertDailyBrief(brief),
      },
    );

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
         ),
    );

    this.localRefreshDebouncer = new VaultRefreshDebouncer(() => {
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
        if (leaf.view instanceof AgentDashboardView) leaf.view.refreshLocal();
      }
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

    this.addRibbonIcon("layout-dashboard", "Open agent dashboard", () => {
      this.openDashboard();
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
        }, () => {
          new Notice("无法开始深度研究，请稍后重试");
        });
      },
    });

    this.addCommand({
      id: "vault-health-report",
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- Vault is a product name.
      name: "Generate Vault health report",
      callback: () => {
        runSafely(() => this.runVaultHealthReport(), () => {
          // eslint-disable-next-line obsidianmd/ui/sentence-case -- Vault and Codex CLI are product names.
          new Notice("Vault 体检报告生成失败，请检查 Codex CLI（详见控制台）");
        });
      },
    });
  }

  onunload(): void {
    this.codexRunner?.terminateAll();
    this.codexRunner = null;
    this.codexDetector?.terminateAll();
    this.codexDetector = null;
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

  async detectCodex(): Promise<string> {
    if (this.codexDetector === null) throw new Error("Codex detection is unavailable.");
    return this.codexDetector.detect(this.settings.codexExecutable);
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

  private requireRunner(): CodexRunner {
    if (this.codexRunner === null) throw new Error("Codex is unavailable in this environment.");
    return this.codexRunner;
  }

  private async runDeepResearch(topic: string): Promise<void> {
    const runner = this.requireRunner();
    const actions = this.vaultActions;
    if (actions === null) throw new Error("Vault actions are unavailable.");
    const prompt = "请对以下主题进行深度研究，并用简体中文输出结构完整的 Markdown 研究报告" +
      "（包含：标题、摘要、关键要点、趋势与争议、延伸阅读建议）。\n" +
      `不要写入任何文件，直接把报告作为最终回复。\n\n主题：${topic}\n`;
    new Notice("正在生成研究报告，可能需要几分钟…");
    try {
      const report = await runner.runResearch("deep-research", prompt);
      const file = await actions.writeReport(topic, report);
      await this.openReportFile(file, "研究报告已保存");
    } catch (error) {
      this.reportResearchFailure(error);
    }
  }

  private async runVaultHealthReport(): Promise<void> {
    const runner = this.requireRunner();
    const actions = this.vaultActions;
    const scanner = this.vaultScanner;
    if (actions === null || scanner === null) throw new Error("Vault actions are unavailable.");
    // eslint-disable-next-line obsidianmd/ui/sentence-case -- Vault is a product name.
    new Notice("正在扫描 Vault 并生成体检报告，可能需要几分钟…");
    const scan = await scanner.scan();
    const prompt = "请根据以下 Obsidian Vault 健康数据撰写 Markdown 体检报告" +
      "（现状评估、主要问题、按优先级排序的具体改进建议）。\n" +
      `不要写入任何文件，直接把报告作为最终回复。\n\n${describeHealth(scan.health)}\n`;
    try {
      const report = await runner.runResearch("vault-lint-explanation", prompt);
      const file = await actions.writeReport("vault-lint", report);
      await this.openReportFile(file, "Vault 体检报告已保存");
    } catch (error) {
      this.reportResearchFailure(error);
    }
  }

  private async openReportFile(file: TFile, message: string): Promise<void> {
    new Notice(`${message}：${file.path}`);
    await this.app.workspace.getLeaf("tab").openFile(file);
  }

  private reportResearchFailure(error: unknown): void {
    if (error instanceof TaskAlreadyRunningError) {
      // eslint-disable-next-line obsidianmd/ui/sentence-case -- Codex is a product name.
      new Notice("已有 Codex 任务进行中，请等它完成后再试");
      return;
    }
    throw error;
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
