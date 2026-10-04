import { describe, expect, it, vi } from "vitest";
import type { CacheEnvelope } from "../src/domain/cacheSchemas";
import type { DailyBrief, NewsItem, TrendingRepo } from "../src/domain/types";
import { FeedRefreshError, FeedService } from "../src/features/feeds/FeedService";
import { CacheRepository, type CacheStoragePort } from "../src/infrastructure/CacheRepository";
import { RefreshCoordinator } from "../src/infrastructure/RefreshCoordinator";

class MemoryStorage implements CacheStoragePort {
  readonly files = new Map<string, string>();
  failReadPath: string | null = null;
  failWrite = false;

  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    if (path === this.failReadPath) throw new Error("read failed");
    const value = this.files.get(path);
    if (value === undefined) throw new Error("missing");
    return value;
  }
  async write(path: string, content: string): Promise<void> {
    if (this.failWrite) throw new Error("write failed");
    this.files.set(path, content);
  }
  async rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value === undefined) throw new Error("missing source");
    this.files.set(to, value);
    this.files.delete(from);
  }
  async replace(from: string, to: string, _backup: string): Promise<void> {
    return this.rename(from, to);
  }
  async remove(path: string): Promise<void> { this.files.delete(path); }
}

const dailyRepo: TrendingRepo = {
  name: "openai/codex",
  url: "https://github.com/openai/codex",
  description: "Coding agent",
  language: "Rust",
  stars: 50_000,
  starsInPeriod: 500,
  source: "github-trending",
};
const weeklyRepo: TrendingRepo = { ...dailyRepo, name: "openai/gpt", url: "https://github.com/openai/gpt" };
const hnItem: NewsItem = {
  id: "hn:1",
  title: "AI agents",
  url: "https://example.com/story#tracking",
  source: "Hacker News",
  publishedAt: "2026-06-29T02:00:00.000Z",
};
const rssItem: NewsItem = {
  id: "rss:1",
  title: "Newer copy",
  url: "https://example.com/story",
  source: "Example",
  publishedAt: "2026-06-29T03:00:00.000Z",
};
const brief: DailyBrief = {
  date: "2026-06-29",
  generatedAt: 2_000,
  overview: "Overview",
  items: [{ title: "Brief", url: "https://example.com/brief", source: "Example", summary: "Summary" }],
};

function envelope<T>(data: T, generatedAt: number, source = "test"): CacheEnvelope<T> {
  return { schemaVersion: 1, generatedAt, source, data };
}

function seed<T>(storage: MemoryStorage, name: string, value: CacheEnvelope<T>): void {
  storage.files.set(`Dashboard/cache/${name}.json`, JSON.stringify(value));
}

function setup(options: {
  now?: number;
  ttl?: number;
  githubFetch?: (period: "daily" | "weekly") => Promise<TrendingRepo[]>;
  hnFetch?: () => Promise<NewsItem[]>;
  rssFetch?: (feeds: readonly string[]) => Promise<NewsItem[]>;
} = {}) {
  let now = options.now ?? 2_000;
  const storage = new MemoryStorage();
  const cache = new CacheRepository(storage, options.ttl ?? 1_000, () => now, "Dashboard/cache", () => "nonce");
  const githubFetch = vi.fn(options.githubFetch ?? (async (period) => period === "daily" ? [dailyRepo] : [weeklyRepo]));
  const hnFetch = vi.fn(options.hnFetch ?? (async () => [hnItem]));
  const rssFetch = vi.fn(options.rssFetch ?? (async () => [rssItem]));
  const service = new FeedService(
    cache,
    new RefreshCoordinator(),
    { fetch: githubFetch },
    { fetch: hnFetch },
    rssFetch,
    () => ["https://example.com/feed.xml"],
    () => now,
  );
  return { storage, service, githubFetch, hnFetch, rssFetch, setNow: (value: number) => { now = value; } };
}

describe("FeedService cache-first composition", () => {
  it("caches and emits only the first five GitHub results for both periods", async () => {
    const repositories = Array.from({ length: 7 }, (_, index): TrendingRepo => ({
      ...dailyRepo,
      name: `owner/repo-${index}`,
      url: `https://github.com/owner/repo-${index}`,
    }));
    const context = setup({
      now: 5_000,
      githubFetch: async () => repositories,
      hnFetch: async () => [],
      rssFetch: async () => [],
    });
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots.at(-1)?.githubDaily.data).toEqual(repositories.slice(0, 5));
    expect(snapshots.at(-1)?.githubWeekly.data).toEqual(repositories.slice(0, 5));
    for (const name of ["github-daily", "github-weekly"]) {
      const raw = context.storage.files.get(`Dashboard/cache/${name}.json`);
      expect(raw).toBeDefined();
      expect((JSON.parse(raw ?? "") as CacheEnvelope<TrendingRepo[]>).data)
        .toEqual(repositories.slice(0, 5));
    }
  });

  it("emits all fresh caches before returning and performs no network work", async () => {
    const context = setup();
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_500));
    seed(context.storage, "github-weekly", envelope([weeklyRepo], 1_500));
    seed(context.storage, "ai-news-sources", envelope([hnItem], 1_500));
    seed(context.storage, "ai-news-summary", envelope(brief, 1_500));
    const snapshots: unknown[] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      githubDaily: { status: "ready", data: [dailyRepo], updatedAt: 1_500 },
      githubWeekly: { status: "ready", data: [weeklyRepo], updatedAt: 1_500 },
      aiNews: { status: "ready", data: [hnItem], updatedAt: 1_500 },
      dailyBrief: { status: "ready", data: brief, updatedAt: 1_500 },
    });
    expect(context.githubFetch).not.toHaveBeenCalled();
    expect(context.hnFetch).not.toHaveBeenCalled();
    expect(context.rssFetch).not.toHaveBeenCalled();
  });

  it("does not re-fetch on a second open while successful cache remains fresh", async () => {
    const context = setup({ now: 2_000, ttl: 3_600_000 });
    await context.service.open(() => undefined);
    context.setNow(3_000);

    await context.service.open(() => undefined);

    expect(context.githubFetch).toHaveBeenCalledTimes(2);
    expect(context.hnFetch).toHaveBeenCalledOnce();
    expect(context.rssFetch).toHaveBeenCalledOnce();
  });

  it("treats a guard-valid TTL-stale daily brief as ready because Task 13 never refreshes it", async () => {
    const context = setup({ now: 5_000, ttl: 1_000 });
    seed(context.storage, "github-daily", envelope([dailyRepo], 4_500));
    seed(context.storage, "github-weekly", envelope([weeklyRepo], 4_500));
    seed(context.storage, "ai-news-sources", envelope([hnItem], 4_500));
    seed(context.storage, "ai-news-summary", envelope(brief, 1_000));
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.dailyBrief).toEqual({
      status: "ready",
      data: brief,
      updatedAt: 1_000,
    });
  });

  it("shows stale data immediately, then replaces each module after successful refresh", async () => {
    const context = setup({ now: 5_000, ttl: 1_000 });
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_000));
    seed(context.storage, "github-weekly", envelope([dailyRepo], 1_000));
    seed(context.storage, "ai-news-sources", envelope([hnItem], 1_000));
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots[0]).toMatchObject({
      githubDaily: { status: "ready", data: [dailyRepo], updatedAt: 1_000 },
      aiNews: { status: "ready", data: [hnItem], updatedAt: 1_000 },
    });
    expect(snapshots[0]?.githubDaily).not.toHaveProperty("message");
    expect(snapshots[0]?.aiNews).not.toHaveProperty("message");
    expect(snapshots.at(-1)).toMatchObject({
      githubDaily: { status: "ready", data: [dailyRepo], updatedAt: 5_000 },
      githubWeekly: { status: "ready", data: [weeklyRepo], updatedAt: 5_000 },
      aiNews: { status: "ready", data: [rssItem], updatedAt: 5_000 },
    });
  });

  it("keeps stale data with the exact fallback message when refresh fails", async () => {
    const context = setup({
      now: 5_000,
      githubFetch: async () => { throw new Error("offline"); },
      hnFetch: async () => { throw new Error("offline"); },
      rssFetch: async () => { throw new Error("offline"); },
    });
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_000));
    seed(context.storage, "github-weekly", envelope([weeklyRepo], 1_000));
    seed(context.storage, "ai-news-sources", envelope([hnItem], 1_000));
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots.at(-1)).toMatchObject({
      githubDaily: { status: "stale", data: [dailyRepo], message: "暂时使用缓存" },
      githubWeekly: { status: "stale", data: [weeklyRepo], message: "暂时使用缓存" },
      aiNews: { status: "stale", data: [hnItem], message: "暂时使用缓存" },
    });
  });

  it("turns missing or corrupt entries into independent errors when refresh fails", async () => {
    const context = setup({
      now: 5_000,
      githubFetch: async (period) => {
        if (period === "daily") throw new Error("offline");
        return [weeklyRepo];
      },
      hnFetch: async () => [],
      rssFetch: async () => [],
    });
    context.storage.files.set("Dashboard/cache/ai-news-sources.json", "not json");
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots.at(-1)).toMatchObject({
      githubDaily: { status: "error", data: [] },
      githubWeekly: { status: "ready", data: [weeklyRepo] },
      aiNews: { status: "error", data: [] },
    });
    expect(context.storage.files.has("Dashboard/cache/ai-news-sources.json")).toBe(false);
    expect([...context.storage.files.keys()].some((path) => path.includes("ai-news-sources.corrupt"))).toBe(true);
  });

  it("refreshes a module after its cache read has an I/O error", async () => {
    const context = setup();
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_500));
    seed(context.storage, "github-weekly", envelope([weeklyRepo], 1_500));
    seed(context.storage, "ai-news-sources", envelope([hnItem], 1_500));
    context.storage.failReadPath = "Dashboard/cache/github-daily.json";
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots[0]).toMatchObject({
      githubDaily: { status: "error", data: [], message: "缓存读取失败。" },
    });
    expect(snapshots.at(-1)).toMatchObject({
      githubDaily: { status: "ready", data: [dailyRepo], updatedAt: 2_000 },
      githubWeekly: { status: "ready", data: [weeklyRepo] },
      aiNews: { status: "ready", data: [hnItem] },
    });
    expect(context.githubFetch).toHaveBeenCalledWith("daily", expect.any(Date));
  });

  it("recovers authoritative state from a later fresh disk read without refetching", async () => {
    const context = setup({
      githubFetch: async (period) => {
        if (period === "daily") throw new Error("offline");
        return [weeklyRepo];
      },
    });
    context.storage.failReadPath = "Dashboard/cache/github-daily.json";
    const firstSnapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];
    await context.service.open((state) => firstSnapshots.push(state));
    expect(firstSnapshots.at(-1)?.githubDaily.status).toBe("error");
    const callsAfterFirstOpen = context.githubFetch.mock.calls.length;

    context.storage.failReadPath = null;
    seed(context.storage, "github-daily", envelope([dailyRepo], 2_000));
    const secondSnapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];
    await context.service.open((state) => secondSnapshots.push(state));

    expect(secondSnapshots[0]?.githubDaily).toEqual({
      status: "ready",
      data: [dailyRepo],
      updatedAt: 2_000,
    });
    expect(context.githubFetch).toHaveBeenCalledTimes(callsAfterFirstOpen);
  });

  it("keeps the cache I/O error visible when its network refresh also fails", async () => {
    const context = setup({
      githubFetch: async (period) => {
        if (period === "daily") throw new Error("offline");
        return [weeklyRepo];
      },
    });
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_500));
    context.storage.failReadPath = "Dashboard/cache/github-daily.json";
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots.at(-1)?.githubDaily).toEqual({
      status: "error",
      data: [],
      message: "缓存读取失败。",
    });
    expect(context.githubFetch).toHaveBeenCalledWith("daily", expect.any(Date));
  });

  it("keeps fresh network data visible and reports a failed cache write for every module", async () => {
    const context = setup();
    context.storage.failWrite = true;
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots.at(-1)).toMatchObject({
      githubDaily: {
        status: "error",
        data: [dailyRepo],
        updatedAt: 2_000,
        message: "榜单已更新，但缓存写入失败。",
      },
      githubWeekly: {
        status: "error",
        data: [weeklyRepo],
        updatedAt: 2_000,
        message: "榜单已更新，但缓存写入失败。",
      },
      aiNews: {
        status: "error",
        data: [rssItem],
        updatedAt: 2_000,
        message: "资讯已更新，但缓存写入失败。",
      },
    });
  });

  it("continues network refresh and cache writes when the initial listener emission throws", async () => {
    const context = setup();

    await expect(context.service.open(() => { throw new Error("render failed"); }))
      .resolves.toBeUndefined();

    expect(context.githubFetch).toHaveBeenCalledTimes(2);
    expect(context.hnFetch).toHaveBeenCalledOnce();
    expect(context.storage.files.has("Dashboard/cache/github-daily.json")).toBe(true);
    expect(context.storage.files.has("Dashboard/cache/ai-news-sources.json")).toBe(true);
  });

  it("resolves when a listener throws on refresh emissions", async () => {
    const context = setup();
    let emissions = 0;

    await expect(context.service.open(() => {
      emissions += 1;
      if (emissions > 1) throw new Error("render failed");
    })).resolves.toBeUndefined();

    expect(emissions).toBeGreaterThan(1);
    expect(context.githubFetch).toHaveBeenCalledTimes(2);
  });

  it("shares simultaneous expired refresh work across opens", async () => {
    let release!: (value: TrendingRepo[]) => void;
    const daily = new Promise<TrendingRepo[]>((resolve) => { release = resolve; });
    const context = setup({ githubFetch: async (period) => period === "daily" ? daily : [weeklyRepo] });
    const first = context.service.open(() => undefined);
    const second = context.service.open(() => undefined);
    await vi.waitFor(() => expect(context.githubFetch).toHaveBeenCalledTimes(2));
    release([dailyRepo]);

    await Promise.all([first, second]);

    expect(context.githubFetch).toHaveBeenCalledTimes(2);
    expect(context.hnFetch).toHaveBeenCalledOnce();
    expect(context.rssFetch).toHaveBeenCalledOnce();
  });

  it("merges concurrent module retries without rolling back the first fresh result", async () => {
    let releaseDaily!: (value: TrendingRepo[]) => void;
    let releaseWeekly!: (value: TrendingRepo[]) => void;
    const daily = new Promise<TrendingRepo[]>((resolve) => { releaseDaily = resolve; });
    const weekly = new Promise<TrendingRepo[]>((resolve) => { releaseWeekly = resolve; });
    const context = setup({
      githubFetch: async (period) => period === "daily" ? daily : weekly,
    });
    const snapshots: Parameters<Parameters<typeof context.service.retry>[1]>[0][] = [];

    const retryDaily = context.service.retry("githubDaily", (state) => snapshots.push(state));
    const retryWeekly = context.service.retry("githubWeekly", (state) => snapshots.push(state));
    await vi.waitFor(() => expect(context.githubFetch).toHaveBeenCalledTimes(2));
    releaseWeekly([weeklyRepo]);
    await retryWeekly;
    releaseDaily([dailyRepo]);
    await retryDaily;

    expect(snapshots.at(-1)).toMatchObject({
      githubDaily: { status: "ready", data: [dailyRepo] },
      githubWeekly: { status: "ready", data: [weeklyRepo] },
    });
  });

  it("does not let a late open emission roll back a newer retry result", async () => {
    let releaseDaily!: (value: TrendingRepo[]) => void;
    const daily = new Promise<TrendingRepo[]>((resolve) => { releaseDaily = resolve; });
    const newerWeekly: TrendingRepo = {
      ...weeklyRepo,
      name: "openai/newer-weekly",
      url: "https://github.com/openai/newer-weekly",
    };
    let weeklyCalls = 0;
    const context = setup({
      githubFetch: async (period) => {
        if (period === "daily") return daily;
        weeklyCalls += 1;
        return weeklyCalls === 1 ? [weeklyRepo] : [newerWeekly];
      },
    });
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];
    const listener = (state: (typeof snapshots)[number]): void => { snapshots.push(state); };

    const opening = context.service.open(listener);
    await vi.waitFor(() => expect(weeklyCalls).toBe(1));
    await context.service.retry("githubWeekly", listener);
    expect(snapshots.at(-1)?.githubWeekly.data).toEqual([newerWeekly]);
    releaseDaily([dailyRepo]);
    await opening;

    expect(snapshots.at(-1)?.githubWeekly).toMatchObject({
      status: "ready",
      data: [newerWeekly],
    });
  });

  it("keeps cached data stale and visible when a contextual retry fails", async () => {
    const context = setup({
      githubFetch: async () => { throw new Error("offline"); },
    });
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_500));
    const snapshots: Parameters<Parameters<typeof context.service.retry>[1]>[0][] = [];

    await context.service.retry("githubDaily", (state) => snapshots.push(state));

    expect(snapshots.at(-1)?.githubDaily).toEqual({
      status: "stale",
      data: [dailyRepo],
      updatedAt: 1_500,
      message: "暂时使用缓存",
    });
  });

  it("combines partial AI success, canonicalizes URLs, deduplicates, and keeps newest 20", async () => {
    const baseTime = Date.parse("2026-06-29T02:30:00.000Z");
    const many = Array.from({ length: 21 }, (_, index): NewsItem => ({
      id: `rss:${index}`,
      title: `Item ${index}`,
      url: `https://example.com/${index}`,
      source: "RSS",
      publishedAt: new Date(baseTime + index * 1_000).toISOString(),
    }));
    const context = setup({
      hnFetch: async () => { throw new Error("HN offline"); },
      rssFetch: async () => [hnItem, rssItem, ...many],
    });
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    const news = snapshots.at(-1)?.aiNews.data ?? [];
    expect(news).toHaveLength(20);
    expect(news.filter((item) => item.url === "https://example.com/story")).toEqual([rssItem]);
    expect(news[0]?.title).toBe("Newer copy");
    expect(news.some((item) => item.title === "Item 20")).toBe(true);
  });

  it("throws a typed FeedRefreshError when both AI sources fail or are empty", async () => {
    const context = setup({ hnFetch: async () => [], rssFetch: async () => [] });

    await expect(context.service.refreshAiNews()).rejects.toBeInstanceOf(FeedRefreshError);
  });

  it("rejects cache objects with inherited or malformed fields and refreshes them", async () => {
    const context = setup();
    const hostile = Object.create({ name: "openai/codex" }) as Record<string, unknown>;
    Object.assign(hostile, { url: "javascript:alert(1)", description: "x", stars: 1, source: "github-trending" });
    seed(context.storage, "github-daily", envelope([hostile], 1_500));

    await context.service.open(() => undefined);

    expect(context.githubFetch).toHaveBeenCalledWith("daily", expect.any(Date));
  });

  it("rejects an impossible calendar date in the daily brief cache", async () => {
    const context = setup();
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_500));
    seed(context.storage, "github-weekly", envelope([weeklyRepo], 1_500));
    seed(context.storage, "ai-news-sources", envelope([hnItem], 1_500));
    seed(context.storage, "ai-news-summary", envelope({ ...brief, date: "2026-02-30" }, 1_500));
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots[0]?.dailyBrief).toEqual({ status: "idle", data: null });
    expect([...context.storage.files.keys()].some((path) => path.includes("ai-news-summary.corrupt"))).toBe(true);
  });

  it("rejects a daily brief timestamp outside the JavaScript Date range", async () => {
    const context = setup();
    seed(context.storage, "github-daily", envelope([dailyRepo], 1_500));
    seed(context.storage, "github-weekly", envelope([weeklyRepo], 1_500));
    seed(context.storage, "ai-news-sources", envelope([hnItem], 1_500));
    seed(context.storage, "ai-news-summary", envelope({
      ...brief,
      generatedAt: 9_000_000_000_000_000,
    }, 1_500));
    const snapshots: Parameters<Parameters<typeof context.service.open>[0]>[0][] = [];

    await context.service.open((state) => snapshots.push(state));

    expect(snapshots[0]?.dailyBrief).toEqual({ status: "idle", data: null });
    expect([...context.storage.files.keys()].some((path) =>
      path.includes("ai-news-summary.corrupt"),
    )).toBe(true);
  });
});
