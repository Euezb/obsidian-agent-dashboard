import { describe, expect, it, vi } from "vitest";
import type { DailyBrief, NewsItem, TrendingRepo } from "../src/domain/types";
import type { ExternalDashboardState } from "../src/features/feeds/FeedService";
import { FeedService, MAX_AUTO_SUMMARY_ATTEMPTS } from "../src/features/feeds/FeedService";
import { CACHE_SCHEMA_VERSION } from "../src/constants";
import { CacheRepository, type CacheStoragePort } from "../src/infrastructure/CacheRepository";
import { RefreshCoordinator } from "../src/infrastructure/RefreshCoordinator";

class MemoryStorage implements CacheStoragePort {
  readonly files = new Map<string, string>();
  failWrite = false;
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    const value = this.files.get(path); if (value === undefined) throw new Error("missing"); return value;
  }
  async write(path: string, content: string): Promise<void> {
    if (this.failWrite) throw new Error("write failed");
    this.files.set(path, content);
  }
  async rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from); if (value === undefined) throw new Error("missing");
    this.files.set(to, value); this.files.delete(from);
  }
  async replace(from: string, to: string): Promise<void> { await this.rename(from, to); }
  async remove(path: string): Promise<void> { this.files.delete(path); }
}

const repo: TrendingRepo = {
  name: "openai/codex", url: "https://github.com/openai/codex", description: "Agent",
  stars: 1, source: "github-trending",
};
const news: NewsItem = {
  id: "hn:1", title: "Headline", url: "https://example.com/news", source: "HN",
  publishedAt: "2026-06-29T00:00:00.000Z",
};

function setup(options: {
  now?: number;
  auto?: boolean;
  attempt?: string;
  fail?: boolean;
  noSource?: boolean;
  newsFails?: boolean;
  cacheWriteFail?: boolean;
  briefPromise?: Promise<DailyBrief>;
  storage?: MemoryStorage;
} = {}) {
  let now = options.now ?? new Date(2026, 5, 29, 9).getTime();
  let attempt = options.attempt;
  const events: string[] = [];
  const storage = options.storage ?? new MemoryStorage();
  storage.failWrite = options.cacheWriteFail ?? false;
  const cache = new CacheRepository(storage, 3_600_000, () => now, "Dashboard/cache", () => "nonce");
  let serviceRef: FeedService | undefined;
  const runDailyBrief = vi.fn(async (date: string): Promise<DailyBrief> => {
    events.push("summary");
    if (options.fail) throw new Error("quota exceeded: secret detail");
    // Mirrors the real wiring: the summarizer reads the news this service already holds.
    await serviceRef?.latestNews();
    if (options.briefPromise !== undefined) return options.briefPromise;
    return { date, generatedAt: now, overview: "综述", items: [{
      title: "摘要", url: news.url, source: news.source, summary: "中文总结",
    }] };
  });
  const mark = vi.fn(async (date: string) => { events.push("mark"); attempt = date; });
  const service = new FeedService(
    cache, new RefreshCoordinator(),
    { fetch: async () => [repo] },
    { fetch: async () => {
      events.push("source");
      if (options.newsFails) throw new Error("hacker news offline");
      return options.noSource ? [] : [news];
    } },
    async () => [], () => [], () => now,
    {
      runner: { runDailyBrief },
      attemptStore: { get: async () => attempt, mark },
      autoSummaryEnabled: () => options.auto ?? true,
    },
  );
  serviceRef = service;
  return { service, runDailyBrief, mark, events, storage, setNow: (value: number) => { now = value; } };
}

describe("FeedService daily summary gating", () => {
  it("refreshes source news, runs the summary, then records the day on two opens", async () => {
    const context = setup();
    const snapshots: ExternalDashboardState[] = [];
    await context.service.open((state) => snapshots.push(state));
    await context.service.open((state) => snapshots.push(state));
    expect(context.events).toEqual(["source", "summary", "mark"]);
    expect(context.runDailyBrief).toHaveBeenCalledOnce();
    expect(context.mark).toHaveBeenCalledWith("2026-06-29");
    expect(snapshots.at(-1)?.dailyBrief).toMatchObject({ status: "ready", data: { date: "2026-06-29" } });
  });

  it("keeps a failed summary retryable and never records the day as done", async () => {
    const context = setup({ fail: true });
    const first: ExternalDashboardState[] = [];
    await context.service.open((state) => first.push(state));
    const failed = first.at(-1)?.dailyBrief;
    expect(failed?.status).toBe("error");
    expect(failed?.message).toContain("今日摘要生成失败");
    expect(failed?.message).toContain("quota exceeded");
    expect(JSON.stringify(first)).not.toContain("secret");
    expect(context.mark).not.toHaveBeenCalled();

    const second: ExternalDashboardState[] = [];
    await context.service.open((state) => second.push(state));
    expect(context.runDailyBrief).toHaveBeenCalledTimes(2);
    expect(second.at(-1)?.dailyBrief?.status).toBe("error");
  });

  it("stops automatic attempts after the session's daily retry budget", async () => {
    const context = setup({ fail: true });
    for (let open = 0; open < MAX_AUTO_SUMMARY_ATTEMPTS + 3; open += 1) {
      await context.service.open(() => undefined);
    }
    expect(context.runDailyBrief).toHaveBeenCalledTimes(MAX_AUTO_SUMMARY_ATTEMPTS);
    expect(context.mark).not.toHaveBeenCalled();
  });

  it("allows one new attempt on the next local calendar day", async () => {
    const context = setup({ fail: true });
    await context.service.open(() => undefined);
    context.setNow(new Date(2026, 5, 30, 0, 1).getTime());
    await context.service.open(() => undefined);
    expect(context.runDailyBrief).toHaveBeenCalledTimes(2);
  });

  it("does not run when disabled or when no source data exists", async () => {
    const disabled = setup({ auto: false });
    const empty = setup({ noSource: true });
    await disabled.service.open(() => undefined);
    await empty.service.open(() => undefined);
    expect(disabled.runDailyBrief).not.toHaveBeenCalled();
    expect(empty.runDailyBrief).not.toHaveBeenCalled();
  });

  it("still summarizes today's usable headlines when the news cache write fails", async () => {
    const context = setup({ cacheWriteFail: true });
    const snapshots: ExternalDashboardState[] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(context.runDailyBrief).toHaveBeenCalledOnce();
    expect(context.mark).toHaveBeenCalledWith("2026-06-29");
    expect(context.events.filter((event) => event === "source")).toHaveLength(1);
    expect(snapshots.at(-1)?.aiNews).toMatchObject({
      status: "error",
      data: [news],
      message: "资讯已更新，但缓存写入失败。",
    });
  });

  it("never presents yesterday's headlines as today's summary", async () => {
    const yesterday = new Date(2026, 5, 29, 9).getTime();
    const storage = new MemoryStorage();
    const seeder = new CacheRepository(
      storage, 3_600_000, () => yesterday, "Dashboard/cache", () => "seed",
    );
    await seeder.write("ai-news-sources", {
      schemaVersion: CACHE_SCHEMA_VERSION,
      generatedAt: yesterday,
      source: "hacker-news+rss",
      data: [news],
    });
    const context = setup({ newsFails: true, storage, now: new Date(2026, 5, 30, 9).getTime() });
    const snapshots: ExternalDashboardState[] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(context.runDailyBrief).not.toHaveBeenCalled();
    expect(context.mark).not.toHaveBeenCalled();
    expect(snapshots.at(-1)?.aiNews).toMatchObject({ status: "stale", data: [news] });
    expect(snapshots.at(-1)?.dailyBrief).toMatchObject({ status: "idle", data: null });
  });

  it("summarizes today's cached headlines when the refresh fails", async () => {
    const earlierToday = new Date(2026, 5, 29, 6).getTime();
    const storage = new MemoryStorage();
    const seeder = new CacheRepository(
      storage, 3_600_000, () => earlierToday, "Dashboard/cache", () => "seed-today",
    );
    await seeder.write("ai-news-sources", {
      schemaVersion: CACHE_SCHEMA_VERSION,
      generatedAt: earlierToday,
      source: "hacker-news+rss",
      data: [news],
    });
    const context = setup({ newsFails: true, storage });
    const snapshots: ExternalDashboardState[] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(context.runDailyBrief).toHaveBeenCalledOnce();
    expect(context.mark).toHaveBeenCalledWith("2026-06-29");
    expect(snapshots.at(-1)?.aiNews).toMatchObject({
      status: "stale",
      data: [news],
      updatedAt: earlierToday,
    });
  });

  it("generates the summary from the headlines the panel already holds, without a second crawl", async () => {
    const context = setup();
    await context.service.open(() => undefined);
    expect(context.events.filter((event) => event === "source")).toHaveLength(1);

    await expect(context.service.latestNews()).resolves.toEqual([news]);

    expect(context.events.filter((event) => event === "source")).toHaveLength(1);
  });

  it("falls back to the persisted news cache before crawling the network again", async () => {
    const seeded = setup();
    await seeded.service.open(() => undefined);
    const reopened = setup({ storage: seeded.storage });

    await expect(reopened.service.latestNews()).resolves.toEqual([news]);

    expect(reopened.events.filter((event) => event === "source")).toHaveLength(0);
  });

  it("crawls the network only when no headlines are available at all", async () => {
    const context = setup();

    await expect(context.service.latestNews()).resolves.toEqual([news]);

    expect(context.events.filter((event) => event === "source")).toHaveLength(1);
  });

  it("runs today's summary right after a manual news retry succeeds", async () => {
    const context = setup();
    const snapshots: ExternalDashboardState[] = [];

    await context.service.retry("aiNews", (state) => snapshots.push(state));

    expect(context.runDailyBrief).toHaveBeenCalledOnce();
    expect(context.mark).toHaveBeenCalledWith("2026-06-29");
    expect(snapshots.at(-1)?.dailyBrief).toMatchObject({ status: "ready", data: { date: "2026-06-29" } });
  });

  it("publishes a loading daily brief while the Codex summary is running", async () => {
    let release!: (brief: DailyBrief) => void;
    const briefPromise = new Promise<DailyBrief>((resolve) => { release = resolve; });
    const context = setup({ briefPromise });
    const snapshots: ExternalDashboardState[] = [];

    const opening = context.service.open((state) => snapshots.push(state));
    await vi.waitFor(() => expect(context.runDailyBrief).toHaveBeenCalledOnce());
    expect(snapshots.at(-1)?.dailyBrief).toEqual({
      status: "loading",
      data: null,
      message: "正在生成今日摘要",
    });
    release({ date: "2026-06-29", generatedAt: new Date(2026, 5, 29, 9).getTime(), overview: "综述", items: [{
      title: "摘要", url: news.url, source: news.source, summary: "中文总结",
    }] });
    await opening;
    expect(snapshots.at(-1)?.dailyBrief.status).toBe("ready");
  });

  it("does not publish loading when today's automatic attempt was already consumed", async () => {
    const context = setup({ attempt: "2026-06-29" });
    const snapshots: ExternalDashboardState[] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(context.runDailyBrief).not.toHaveBeenCalled();
    expect(snapshots.map((state) => state.dailyBrief.status)).not.toContain("loading");
    expect(snapshots.at(-1)?.dailyBrief).toEqual({
      status: "error",
      data: null,
      message: "今日摘要尚未生成",
    });
  });

  it("joins an in-flight summary after close and reopen instead of failing the daily gate", async () => {
    let attempt: string | undefined;
    let release!: (brief: DailyBrief) => void;
    const pendingBrief = new Promise<DailyBrief>((resolve) => { release = resolve; });
    const storage = new MemoryStorage();
    const now = new Date(2026, 5, 29, 9).getTime();
    const cache = new CacheRepository(storage, 3_600_000, () => now, "Dashboard/cache", () => "join");
    const coordinator = new RefreshCoordinator();
    const runDailyBrief = vi.fn(async () => pendingBrief);
    const makeService = (): FeedService => new FeedService(
      cache,
      coordinator,
      { fetch: async () => [repo] },
      { fetch: async () => [news] },
      async () => [],
      () => [],
      () => now,
      {
        runner: { runDailyBrief },
        attemptStore: {
          get: async () => attempt,
          mark: async (date) => { attempt = date; },
        },
        autoSummaryEnabled: () => true,
      },
    );
    const firstSnapshots: ExternalDashboardState[] = [];
    const firstOpen = makeService().open((state) => firstSnapshots.push(state));
    await vi.waitFor(() => expect(runDailyBrief).toHaveBeenCalledOnce());

    const reopenedSnapshots: ExternalDashboardState[] = [];
    let reopenedSettled = false;
    const reopened = makeService().open((state) => reopenedSnapshots.push(state))
      .then(() => { reopenedSettled = true; });
    await vi.waitFor(() => expect(reopenedSnapshots.length).toBeGreaterThan(0));
    expect(reopenedSnapshots.at(-1)?.dailyBrief.status).toBe("loading");
    expect(reopenedSettled).toBe(false);

    release({ date: "2026-06-29", generatedAt: now, overview: "综述", items: [{
      title: "摘要", url: news.url, source: news.source, summary: "中文总结",
    }] });
    await Promise.all([firstOpen, reopened]);
    expect(reopenedSnapshots.at(-1)?.dailyBrief).toMatchObject({
      status: "ready",
      data: { date: "2026-06-29" },
    });
    expect(runDailyBrief).toHaveBeenCalledOnce();
  });

  it("revalidates a joined brief across local midnight and runs today's summary once", async () => {
    let now = new Date(2026, 5, 29, 23, 59).getTime();
    let attempt: string | undefined;
    let releaseYesterday!: (brief: DailyBrief) => void;
    const yesterdayPending = new Promise<DailyBrief>((resolve) => { releaseYesterday = resolve; });
    const storage = new MemoryStorage();
    const cache = new CacheRepository(storage, 3_600_000, () => now, "Dashboard/cache", () => "midnight");
    const coordinator = new RefreshCoordinator();
    const marks: string[] = [];
    const runDailyBrief = vi.fn(async (date: string): Promise<DailyBrief> => {
      if (date === "2026-06-29") return yesterdayPending;
      return { date, generatedAt: now, overview: "综述", items: [{
        title: "今日摘要", url: news.url, source: news.source, summary: "今日中文总结",
      }] };
    });
    const makeService = (): FeedService => new FeedService(
      cache,
      coordinator,
      { fetch: async () => [repo] },
      { fetch: async () => [news] },
      async () => [],
      () => [],
      () => now,
      {
        runner: { runDailyBrief },
        attemptStore: {
          get: async () => attempt,
          mark: async (date) => { attempt = date; marks.push(date); },
        },
        autoSummaryEnabled: () => true,
      },
    );
    const firstOpen = makeService().open(() => undefined);
    await vi.waitFor(() => expect(runDailyBrief).toHaveBeenCalledWith("2026-06-29"));

    now = new Date(2026, 5, 30, 0, 1).getTime();
    const reopenedSnapshots: ExternalDashboardState[] = [];
    const reopened = makeService().open((state) => reopenedSnapshots.push(state));
    await vi.waitFor(() => expect(reopenedSnapshots.at(-1)?.dailyBrief.status).toBe("loading"));
    releaseYesterday({
      date: "2026-06-29",
      generatedAt: new Date(2026, 5, 29, 23, 59).getTime(),
      overview: "昨日综述",
      items: [{ title: "昨日摘要", url: news.url, source: news.source, summary: "昨日中文总结" }],
    });

    await Promise.all([firstOpen, reopened]);
    expect(runDailyBrief.mock.calls.map(([date]) => date)).toEqual(["2026-06-29", "2026-06-30"]);
    expect(marks).toEqual(["2026-06-29", "2026-06-30"]);
    expect(reopenedSnapshots.some((state) =>
      state.dailyBrief.status === "ready" && state.dailyBrief.data?.date === "2026-06-29",
    )).toBe(false);
    expect(reopenedSnapshots.at(-1)?.dailyBrief).toMatchObject({
      status: "ready",
      data: { date: "2026-06-30" },
    });
    expect(reopenedSnapshots.at(-1)?.aiNews.data).toEqual([news]);
  });

  it("rechecks the local date when the attempt lookup itself crosses midnight", async () => {
    let now = new Date(2026, 5, 29, 23, 59).getTime();
    let attempt: string | undefined;
    let releaseFirstGet!: (value: string | undefined) => void;
    const firstGet = new Promise<string | undefined>((resolve) => { releaseFirstGet = resolve; });
    let getCalls = 0;
    const get = vi.fn(async () => {
      getCalls += 1;
      return getCalls === 1 ? firstGet : attempt;
    });
    const marks: string[] = [];
    const runDailyBrief = vi.fn(async (date: string): Promise<DailyBrief> => ({
      date,
      generatedAt: now,
      overview: "综述",
      items: [{ title: "今日摘要", url: news.url, source: news.source, summary: "中文总结" }],
    }));
    const storage = new MemoryStorage();
    const cache = new CacheRepository(storage, 3_600_000, () => now, "Dashboard/cache", () => "gate");
    const service = new FeedService(
      cache,
      new RefreshCoordinator(),
      { fetch: async () => [repo] },
      { fetch: async () => [news] },
      async () => [],
      () => [],
      () => now,
      {
        runner: { runDailyBrief },
        attemptStore: {
          get,
          mark: async (date) => { attempt = date; marks.push(date); },
        },
        autoSummaryEnabled: () => true,
      },
    );

    const opening = service.open(() => undefined);
    await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
    now = new Date(2026, 5, 30, 0, 1).getTime();
    releaseFirstGet(undefined);
    await opening;

    expect(marks).toEqual(["2026-06-30"]);
    expect(runDailyBrief).toHaveBeenCalledOnce();
    expect(runDailyBrief).toHaveBeenCalledWith("2026-06-30");
  });

  it("manual retry bypasses the daily gate and remains coordinator-deduplicated", async () => {
    const context = setup({ attempt: "2026-06-29" });
    await Promise.all([
      context.service.retry("dailyBrief", () => undefined),
      context.service.retry("dailyBrief", () => undefined),
    ]);
    expect(context.runDailyBrief).toHaveBeenCalledOnce();
  });
});
