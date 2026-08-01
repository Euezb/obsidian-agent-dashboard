import { CACHE_SCHEMA_VERSION } from "../../constants";
import type { CacheEnvelope, DataGuard } from "../../domain/cacheSchemas";
import type { CacheReadResult } from "../../domain/cacheSchemas";
import type {
  DailyBrief,
  ModuleState,
  NewsItem,
  TrendingRepo,
} from "../../domain/types";
import {
  createRefreshKey,
  type RefreshCoordinator,
} from "../../infrastructure/RefreshCoordinator";
import type { GitHubPeriod } from "./githubTrending";
import { GitHubRateLimitError, MAX_GITHUB_REPOSITORIES } from "./githubTrending";

/** Minimal cache surface the feed service needs; allows routing different
 * cache names to different physical locations. */
export interface FeedCachePort {
  read<T>(name: string, guard: DataGuard<T>): Promise<CacheReadResult<T>>;
  write<T>(name: string, envelope: CacheEnvelope<T>): Promise<void>;
}

export const FEED_CACHE_NAMES = Object.freeze({
  githubDaily: "github-daily",
  githubWeekly: "github-weekly",
  aiNews: "ai-news-sources",
  dailyBrief: "ai-news-summary",
});

const STALE_MESSAGE = "暂时使用缓存";
const MAX_NEWS_ITEMS = 20;

interface RefreshResult<T> {
  data: T;
  generatedAt: number;
  persisted?: boolean;
}

const githubDailyKey = createRefreshKey<RefreshResult<TrendingRepo[]>>("github-daily");
const githubWeeklyKey = createRefreshKey<RefreshResult<TrendingRepo[]>>("github-weekly");
const aiNewsKey = createRefreshKey<RefreshResult<NewsItem[]>>("ai-news-sources");
const dailyBriefKey = createRefreshKey<DailyBrief | undefined>("daily-ai-brief");

export interface ExternalDashboardState {
  githubDaily: ModuleState<TrendingRepo[]>;
  githubWeekly: ModuleState<TrendingRepo[]>;
  aiNews: ModuleState<NewsItem[]>;
  dailyBrief: ModuleState<DailyBrief | null>;
}

export type FeedStateListener = (state: ExternalDashboardState) => void;
export type RetryableExternalModule = "githubDaily" | "githubWeekly" | "aiNews" | "dailyBrief";

export interface DailyBriefRunner {
  runDailyBrief(date: string): Promise<DailyBrief>;
  cancel?(taskId: "daily-ai-brief"): void;
}

export interface SummaryAttemptStore {
  get(): Promise<string | undefined>;
  mark(date: string): Promise<void>;
}

export interface FeedSummaryOptions {
  runner?: DailyBriefRunner;
  attemptStore?: SummaryAttemptStore;
  autoSummaryEnabled?: () => boolean;
  /** Best-effort hook invoked after a brief is generated (e.g. persist into the daily note). */
  briefPersisted?: (brief: DailyBrief) => void | Promise<void>;
}

interface GitHubFeedPort {
  fetch(period: GitHubPeriod, now?: Date): Promise<TrendingRepo[]>;
}

interface NewsFeedPort {
  fetch(): Promise<NewsItem[]>;
}

type RssCollector = (feeds: readonly string[]) => Promise<NewsItem[]>;

export class FeedRefreshError extends Error {
  constructor(module: "github" | "ai-news") {
    super(module === "github" ? "GitHub 榜单暂不可用。" : "AI 新闻暂不可用。");
    this.name = "FeedRefreshError";
  }
}

type RefreshableModule = "githubDaily" | "githubWeekly" | "aiNews";
type CacheRead<T> = CacheReadResult<T> | { status: "io-error" };

export class FeedService {
  private authoritativeState: ExternalDashboardState | undefined;

  constructor(
    private readonly cache: FeedCachePort,
    private readonly coordinator: RefreshCoordinator,
    private readonly github: GitHubFeedPort,
    private readonly hackerNews: NewsFeedPort,
    private readonly collectRss: RssCollector,
    private readonly rssFeeds: () => readonly string[],
    private readonly now: () => number = Date.now,
    private readonly summary: FeedSummaryOptions = {},
  ) {}

  async open(onState: FeedStateListener): Promise<void> {
    const [dailyRead, weeklyRead, newsRead, briefRead] = await Promise.all([
      this.safeRead(FEED_CACHE_NAMES.githubDaily, isTrendingRepoArray),
      this.safeRead(FEED_CACHE_NAMES.githubWeekly, isTrendingRepoArray),
      this.safeRead(FEED_CACHE_NAMES.aiNews, isNewsItemArray),
      this.safeRead(FEED_CACHE_NAMES.dailyBrief, isDailyBrief),
    ]);

    let state = this.adoptInitialState({
      githubDaily: initialListState(dailyRead),
      githubWeekly: initialListState(weeklyRead),
      aiNews: initialListState(newsRead),
      dailyBrief: initialBriefState(briefRead),
    });
    safeEmit(onState, state);

    const update = <K extends RefreshableModule>(
      module: K,
      value: ExternalDashboardState[K],
    ): void => {
      state = this.updateModule(module, value);
      safeEmit(onState, state);
    };

    await Promise.all([
      this.refreshIfNeeded(
        "githubDaily",
        dailyRead,
        () => this.coordinator.runOnce(
          githubDailyKey,
          () => this.refreshGitHub("daily", FEED_CACHE_NAMES.githubDaily),
        ),
        update,
      ),
      this.refreshIfNeeded(
        "githubWeekly",
        weeklyRead,
        () => this.coordinator.runOnce(
          githubWeeklyKey,
          () => this.refreshGitHub("weekly", FEED_CACHE_NAMES.githubWeekly),
        ),
        update,
      ),
      this.refreshIfNeeded(
        "aiNews",
        newsRead,
        () => this.coordinator.runOnce(aiNewsKey, () => this.refreshAiNewsAndCache()),
        update,
      ),
    ]);
    await this.maybeAutoSummary(this.authoritativeState ?? state, (value) => {
      state = this.updateModule("dailyBrief", value);
      safeEmit(onState, state);
    });
  }

  async retry(module: RetryableExternalModule, onState: FeedStateListener): Promise<void> {
    const [dailyRead, weeklyRead, newsRead, briefRead] = await Promise.all([
      this.safeRead(FEED_CACHE_NAMES.githubDaily, isTrendingRepoArray),
      this.safeRead(FEED_CACHE_NAMES.githubWeekly, isTrendingRepoArray),
      this.safeRead(FEED_CACHE_NAMES.aiNews, isNewsItemArray),
      this.safeRead(FEED_CACHE_NAMES.dailyBrief, isDailyBrief),
    ]);
    let state = this.adoptInitialState({
      githubDaily: initialListState(dailyRead),
      githubWeekly: initialListState(weeklyRead),
      aiNews: initialListState(newsRead),
      dailyBrief: initialBriefState(briefRead),
    });
    const existing = state[module];
    state = this.updateModule(module, {
      ...existing,
      status: "loading",
      message: undefined,
    });
    safeEmit(onState, state);
    try {
      if (module === "dailyBrief") {
        const runner = this.summary.runner;
        if (runner === undefined) throw new Error("unavailable");
        const brief = await this.coordinator.runOnce(dailyBriefKey, () =>
          this.runAndCacheDailyBrief(runner, localCalendarDate(this.now())));
        if (brief === undefined) throw new Error("unavailable");
        state = this.updateModule("dailyBrief", briefState(brief));
      } else if (module === "aiNews") {
        const result = await this.coordinator.runOnce(
          aiNewsKey,
          () => this.refreshAiNewsAndCache(),
        );
        state = this.updateModule(module, refreshedModuleState(module, result));
      } else if (module === "githubDaily") {
        const result = await this.coordinator.runOnce(
          githubDailyKey,
          () => this.refreshGitHub("daily", FEED_CACHE_NAMES.githubDaily),
        );
        state = this.updateModule(module, refreshedModuleState(module, result));
      } else {
        const result = await this.coordinator.runOnce(
          githubWeeklyKey,
          () => this.refreshGitHub("weekly", FEED_CACHE_NAMES.githubWeekly),
        );
        state = this.updateModule(module, refreshedModuleState(module, result));
      }
    } catch (error) {
      const current = this.authoritativeState ?? state;
      if (module === "dailyBrief") {
        state = this.updateModule(module, retryFailureState(module, current.dailyBrief, error));
      } else if (module === "aiNews") {
        state = this.updateModule(module, retryFailureState(module, current.aiNews, error));
      } else if (module === "githubDaily") {
        state = this.updateModule(module, retryFailureState(module, current.githubDaily, error));
      } else {
        state = this.updateModule(module, retryFailureState(module, current.githubWeekly, error));
      }
    }
    safeEmit(onState, state);
  }

  async refreshAiNews(): Promise<NewsItem[]> {
    return (await this.refreshAiNewsAndCache()).data;
  }

  private adoptInitialState(candidate: ExternalDashboardState): ExternalDashboardState {
    if (this.authoritativeState === undefined) {
      this.authoritativeState = candidate;
      return candidate;
    }
    this.authoritativeState = {
      githubDaily: mergeInitialModule(this.authoritativeState.githubDaily, candidate.githubDaily),
      githubWeekly: mergeInitialModule(this.authoritativeState.githubWeekly, candidate.githubWeekly),
      aiNews: mergeInitialModule(this.authoritativeState.aiNews, candidate.aiNews),
      dailyBrief: mergeInitialModule(this.authoritativeState.dailyBrief, candidate.dailyBrief),
    };
    return this.authoritativeState;
  }

  private updateModule<K extends keyof ExternalDashboardState>(
    module: K,
    value: ExternalDashboardState[K],
  ): ExternalDashboardState {
    if (this.authoritativeState === undefined) {
      throw new Error("Feed state is not initialized.");
    }
    this.authoritativeState = { ...this.authoritativeState, [module]: value };
    return this.authoritativeState;
  }

  private async refreshAiNewsAndCache(): Promise<RefreshResult<NewsItem[]>> {
    const settled = await Promise.allSettled([
      this.hackerNews.fetch(),
      this.collectRss([...this.rssFeeds()]),
    ]);
    const usable = settled.flatMap((result) =>
      result.status === "fulfilled" && isNewsItemArray(result.value)
        ? result.value
        : [],
    );
    const news = combineNews(usable);
    if (news.length === 0) throw new FeedRefreshError("ai-news");
    const generatedAt = this.now();
    const persisted = await this.writeBestEffort(FEED_CACHE_NAMES.aiNews, {
      schemaVersion: CACHE_SCHEMA_VERSION,
      generatedAt,
      source: "hacker-news+rss",
      data: news,
    });
    return { data: news, generatedAt, persisted };
  }

  private async maybeAutoSummary(
    state: ExternalDashboardState,
    update: (value: ModuleState<DailyBrief | null>) => void,
  ): Promise<void> {
    let timestamp = this.now();
    let fallbackBrief = state.dailyBrief.data;
    if (isCurrentBrief(state.dailyBrief.data, timestamp)) return;
    try {
      const joined = this.coordinator.join(dailyBriefKey);
      if (joined !== undefined) {
        update({ status: "loading", data: fallbackBrief, message: "正在生成今日摘要" });
        const brief = await joined;
        timestamp = this.now();
        if (brief !== undefined && isCurrentBrief(brief, timestamp)) {
          update(briefState(brief));
          return;
        }
        if (brief !== undefined) {
          fallbackBrief = brief;
          update({
            status: "stale",
            data: fallbackBrief,
            updatedAt: brief.generatedAt,
            message: "今日摘要尚未生成",
          });
        }
      }
      const runner = this.summary.runner;
      const attemptStore = this.summary.attemptStore;
      if (runner === undefined || attemptStore === undefined ||
        this.summary.autoSummaryEnabled?.() === false || state.aiNews.status !== "ready" ||
        state.aiNews.data.length === 0) return;
      const initialGate = await readStableAttemptGate(attemptStore, this.now);
      if (initialGate === undefined || initialGate.alreadyAttempted) {
        update({ status: "error", data: fallbackBrief, message: "今日摘要尚未生成" });
        return;
      }
      update({ status: "loading", data: fallbackBrief, message: "正在生成今日摘要" });
      const brief = await this.coordinator.runOnce(dailyBriefKey, async () => {
        const finalGate = await readStableAttemptGate(attemptStore, this.now);
        if (finalGate === undefined || finalGate.alreadyAttempted) return undefined;
        await attemptStore.mark(finalGate.date);
        return this.runAndCacheDailyBrief(runner, finalGate.date);
      });
      if (brief === undefined) {
        const current = this.authoritativeState?.dailyBrief;
        if (current !== undefined && isCurrentBrief(current.data, timestamp)) return;
        update({ status: "error", data: fallbackBrief, message: "今日摘要尚未生成" });
      } else {
        update(briefState(brief));
      }
    } catch {
      update({ status: "error", data: fallbackBrief, message: "今日摘要尚未生成" });
    }
  }

  private async runAndCacheDailyBrief(
    runner: DailyBriefRunner,
    date: string,
  ): Promise<DailyBrief> {
    const brief = await runner.runDailyBrief(date);
    await this.writeBestEffort(FEED_CACHE_NAMES.dailyBrief, {
      schemaVersion: CACHE_SCHEMA_VERSION,
      generatedAt: brief.generatedAt,
      source: "codex-daily-ai-brief",
      data: brief,
    });
    try {
      await this.summary.briefPersisted?.(brief);
    } catch (error) {
      console.warn("[agent-dashboard] Persisting the daily brief into the daily note failed:", error);
    }
    return brief;
  }

  /** Cancels an in-flight daily brief generation without unloading the runner. */
  cancelDailyBrief(): void {
    this.summary.runner?.cancel?.("daily-ai-brief");
  }

  private async safeRead<T>(
    name: string,
    guard: (value: unknown) => value is T,
  ): Promise<CacheRead<T>> {
    try {
      return await this.cache.read(name, guard);
    } catch {
      return { status: "io-error" };
    }
  }

  private async refreshGitHub(
    period: GitHubPeriod,
    cacheName: string,
  ): Promise<RefreshResult<TrendingRepo[]>> {
    const repositories = (await this.github.fetch(period, new Date(this.now())))
      .slice(0, MAX_GITHUB_REPOSITORIES);
    if (!isTrendingRepoArray(repositories) || repositories.length === 0) {
      throw new FeedRefreshError("github");
    }
    const generatedAt = this.now();
    await this.writeBestEffort(cacheName, {
      schemaVersion: CACHE_SCHEMA_VERSION,
      generatedAt,
      source: `github-${period}`,
      data: repositories,
    });
    return { data: repositories, generatedAt };
  }

  private async writeBestEffort<T>(name: string, envelope: CacheEnvelope<T>): Promise<boolean> {
    try {
      await this.cache.write(name, envelope);
      return true;
    } catch {
      // Fresh network data remains usable; a later open will retry persistence.
      return false;
    }
  }

  private async refreshIfNeeded<K extends RefreshableModule, T extends NewsItem[] | TrendingRepo[]>(
    module: K,
    read: CacheRead<T>,
    refresh: () => Promise<RefreshResult<T>>,
    update: (module: K, value: ExternalDashboardState[K]) => void,
  ): Promise<void> {
    if (read.status === "fresh") return;
    try {
      const result = await refresh();
      update(module, refreshedModuleState(module, result) as ExternalDashboardState[K]);
    } catch (error) {
      const retryAt = error instanceof GitHubRateLimitError ? error.retryAt : undefined;
      if (read.status === "stale") {
        update(module, {
          status: "stale",
          data: read.envelope.data,
          updatedAt: read.envelope.generatedAt,
          message: STALE_MESSAGE,
          retryAt,
        } as ExternalDashboardState[K]);
      } else if (read.status !== "io-error") {
        update(module, {
          status: "error",
          data: [],
          message: retryAt === undefined
            ? module === "aiNews" ? "AI 新闻暂不可用。" : "GitHub 榜单暂不可用。"
            : "GitHub 请求过于频繁。",
          retryAt,
        });
      }
    }
  }
}

interface StableAttemptGate {
  date: string;
  alreadyAttempted: boolean;
}

const MAX_STABLE_DATE_READS = 3;

async function readStableAttemptGate(
  store: SummaryAttemptStore,
  now: () => number,
): Promise<StableAttemptGate | undefined> {
  for (let attempt = 0; attempt < MAX_STABLE_DATE_READS; attempt += 1) {
    const before = localCalendarDate(now());
    const lastAttempt = await store.get();
    const after = localCalendarDate(now());
    if (before === after) {
      return { date: after, alreadyAttempted: lastAttempt === after };
    }
  }
  return undefined;
}

function refreshedModuleState<T extends NewsItem[] | TrendingRepo[]>(
  module: RefreshableModule,
  result: RefreshResult<T>,
): ModuleState<T> {
  if (module === "aiNews" && result.persisted === false) {
    return {
      status: "error",
      data: result.data,
      updatedAt: result.generatedAt,
      message: "资讯已更新，但缓存写入失败；今日摘要未生成。",
    };
  }
  return { status: "ready", data: result.data, updatedAt: result.generatedAt };
}

function mergeInitialModule<T>(
  current: ModuleState<T>,
  candidate: ModuleState<T>,
): ModuleState<T> {
  if (current.status === "loading") return current;
  if (candidate.status === "loading" || candidate.status === "idle") return current;
  const currentTime = current.updatedAt;
  const candidateTime = candidate.updatedAt;
  if (currentTime !== undefined && candidateTime !== undefined) {
    if (candidateTime < currentTime) return current;
    if (candidateTime > currentTime && candidate.status !== "error") return candidate;
  }
  if (candidate.status === "error") return current.status === "idle" ? candidate : current;
  if (current.status === "error" || current.status === "idle") return candidate;
  if (currentTime === undefined && candidateTime !== undefined) return candidate;
  return current;
}

function retryFailureState<T>(
  module: RetryableExternalModule,
  current: ModuleState<T>,
  error: unknown,
): ModuleState<T> {
  const retryAt = error instanceof GitHubRateLimitError ? error.retryAt : undefined;
  if (module !== "dailyBrief" && Array.isArray(current.data) && current.data.length > 0) {
    return { ...current, status: "stale", message: STALE_MESSAGE, retryAt };
  }
  return {
    status: "error",
    data: current.data,
    message: module === "dailyBrief" ? "今日摘要尚未生成" :
      retryAt !== undefined ? "GitHub 请求过于频繁。" :
        module === "aiNews" ? "AI 新闻暂不可用。" : "GitHub 榜单暂不可用。",
    retryAt,
  };
}

function briefState(brief: DailyBrief): ModuleState<DailyBrief> {
  return { status: "ready", data: brief, updatedAt: brief.generatedAt };
}

function isCurrentBrief(brief: DailyBrief | null, now: number): boolean {
  if (brief === null || brief.items.length === 0) return false;
  const date = localCalendarDate(now);
  return brief.date === date && localCalendarDate(brief.generatedAt) === date;
}

export function localCalendarDate(timestamp: number): string {
  const date = new Date(timestamp);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function initialListState<T>(read: CacheRead<T[]>): ModuleState<T[]> {
  if (read.status === "fresh") {
    return { status: "ready", data: read.envelope.data, updatedAt: read.envelope.generatedAt };
  }
  if (read.status === "stale") {
    return { status: "ready", data: read.envelope.data, updatedAt: read.envelope.generatedAt };
  }
  if (read.status === "io-error") {
    return { status: "error", data: [], message: "缓存读取失败。" };
  }
  return { status: "loading", data: [] };
}

function safeEmit(listener: FeedStateListener, state: ExternalDashboardState): void {
  try {
    listener(state);
  } catch {
    // Rendering is an observer concern and must not cancel cache/network work.
  }
}

function initialBriefState(read: CacheRead<DailyBrief>): ModuleState<DailyBrief | null> {
  if (read.status === "fresh" || read.status === "stale") {
    return {
      status: "ready",
      data: read.envelope.data,
      updatedAt: read.envelope.generatedAt,
    };
  }
  if (read.status === "io-error") {
    return { status: "error", data: null, message: "缓存读取失败。" };
  }
  return { status: "idle", data: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isOwnString(value: Record<string, unknown>, key: string, allowEmpty = false): boolean {
  return hasOwn(value, key) && typeof value[key] === "string" &&
    (allowEmpty || value[key].trim().length > 0);
}

function isOwnFiniteNumber(value: Record<string, unknown>, key: string): boolean {
  return hasOwn(value, key) && typeof value[key] === "number" && Number.isFinite(value[key]);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function isIsoDateTime(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

export function isTrendingRepoArray(value: unknown): value is TrendingRepo[] {
  if (!Array.isArray(value)) return false;
  return value.every((candidate) => {
    if (!isRecord(candidate) ||
      !isOwnString(candidate, "name") ||
      !isOwnString(candidate, "url") ||
      !isOwnString(candidate, "description", true) ||
      !isOwnFiniteNumber(candidate, "stars") ||
      !isOwnString(candidate, "source") ||
      !isHttpUrl(candidate.url as string) ||
      !Number.isInteger(candidate.stars) || (candidate.stars as number) < 0 ||
      (candidate.source !== "github-trending" && candidate.source !== "github-search-fallback")) {
      return false;
    }
    if (hasOwn(candidate, "language") && typeof candidate.language !== "string") return false;
    if (hasOwn(candidate, "starsInPeriod") &&
      (typeof candidate.starsInPeriod !== "number" ||
        !Number.isInteger(candidate.starsInPeriod) || candidate.starsInPeriod < 0)) return false;
    return true;
  });
}

export function isNewsItemArray(value: unknown): value is NewsItem[] {
  if (!Array.isArray(value)) return false;
  return value.every((candidate) => {
    if (!isRecord(candidate) ||
      !isOwnString(candidate, "id") ||
      !isOwnString(candidate, "title") ||
      !isOwnString(candidate, "url") ||
      !isOwnString(candidate, "source") ||
      !isOwnString(candidate, "publishedAt") ||
      !isHttpUrl(candidate.url as string) ||
      !isIsoDateTime(candidate.publishedAt as string)) return false;
    return (!hasOwn(candidate, "summary") || typeof candidate.summary === "string") &&
      (!hasOwn(candidate, "score") ||
        (typeof candidate.score === "number" && Number.isFinite(candidate.score) && candidate.score >= 0));
  });
}

export function isDailyBrief(value: unknown): value is DailyBrief {
  if (!isRecord(value) ||
    !isOwnString(value, "date") ||
    !isCalendarDate(value.date as string) ||
    !isOwnFiniteNumber(value, "generatedAt") ||
    !Number.isInteger(value.generatedAt) || (value.generatedAt as number) < 0 ||
    !Number.isFinite(new Date(value.generatedAt as number).getTime()) ||
    !hasOwn(value, "items") || !Array.isArray(value.items)) return false;
  return value.items.every((item) => isRecord(item) &&
    isOwnString(item, "title") &&
    isOwnString(item, "url") && isHttpUrl(item.url as string) &&
    isOwnString(item, "source") &&
    isOwnString(item, "summary"));
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function canonicalNewsUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if ((url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username !== "" || url.password !== "") return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function combineNews(items: readonly NewsItem[]): NewsItem[] {
  const byUrl = new Map<string, NewsItem>();
  for (const item of items) {
    if (!isNewsItemArray([item])) continue;
    const url = canonicalNewsUrl(item.url);
    if (!url) continue;
    const normalized = { ...item, url };
    const existing = byUrl.get(url);
    if (!existing || Date.parse(normalized.publishedAt) > Date.parse(existing.publishedAt)) {
      byUrl.set(url, normalized);
    }
  }
  return [...byUrl.values()]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt) ||
      left.url.localeCompare(right.url) || left.title.localeCompare(right.title))
    .slice(0, MAX_NEWS_ITEMS);
}
