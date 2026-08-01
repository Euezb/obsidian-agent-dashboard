import { describe, expect, it, vi } from "vitest";
import {
  GITHUB_FALLBACK_LABEL,
  GitHubFeedError,
  GitHubRateLimitError,
  GitHubTrendingService,
  buildGitHubSearchFallbackUrl,
  mapGitHubSearchFallback,
  parseGitHubTrending,
  type RequestPort,
} from "../src/features/feeds/githubTrending";

const article = ({
  href = "/octo/repo",
  description = "A useful repository",
  language = "TypeScript",
  stars = "12,400",
  period = "420 stars today",
}: Partial<Record<"href" | "description" | "language" | "stars" | "period", string>> = {}) => `
  <article class="Box-row">
    <h2><a href="${href}">\n octo / repo \n</a></h2>
    <p>${description}</p>
    <span itemprop="programmingLanguage">${language}</span>
    <a href="${href}/stargazers">${stars}</a>
    <span class="float-sm-right">${period}</span>
  </article>`;

const fallbackItems = {
  items: [{
    full_name: "octo/repo",
    html_url: "https://github.com/octo/repo",
    description: "A useful repository",
    language: "TypeScript",
    stargazers_count: 12_400,
  }],
};

describe("parseGitHubTrending", () => {
  it("parses daily and weekly cards, compact counts, missing optionals, and preserves order", () => {
    const html = [
      article(),
      article({ href: "/acme/weekly", stars: "1.2k", period: "2m stars this week", description: "", language: "" })
        .replace("octo / repo", "acme / weekly"),
    ].join("");

    expect(parseGitHubTrending(html)).toEqual([
      {
        name: "octo/repo",
        url: "https://github.com/octo/repo",
        description: "A useful repository",
        language: "TypeScript",
        stars: 12_400,
        starsInPeriod: 420,
        source: "github-trending",
      },
      {
        name: "acme/weekly",
        url: "https://github.com/acme/weekly",
        description: "",
        stars: 1_200,
        starsInPeriod: 2_000_000,
        source: "github-trending",
      },
    ]);
  });

  it.each([
    ["1,234", 1_234],
    ["12 400", 12_400],
    ["12\u00a0400", 12_400],
    ["12\u202f400", 12_400],
    ["1.2k", 1_200],
    ["2m", 2_000_000],
  ])("parses a strictly formatted star count %s", (stars, expected) => {
    expect(parseGitHubTrending(article({ stars }))[0]?.stars).toBe(expected);
  });

  it("rejects malformed grouped compact counts instead of guessing their value", () => {
    expect(parseGitHubTrending(article({ stars: "1,2k" }))).toEqual([]);
  });

  it("deduplicates by normalized name, rejects dangerous/non-repository hrefs, and caps at five", () => {
    const valid = Array.from({ length: 22 }, (_, index) =>
      article({ href: `/owner/repo-${index}` }).replace("octo / repo", ` owner / repo-${index} `));
    const html = [
      article({ href: "javascript:alert(1)" }),
      article({ href: "/topics/agents" }),
      article({ href: "/owner/repo-0" }).replace("octo / repo", "owner / repo-0"),
      ...valid,
    ].join("");

    const repos = parseGitHubTrending(html);

    expect(repos).toHaveLength(5);
    expect(repos[0]?.name).toBe("owner/repo-0");
    expect(new Set(repos.map((repo) => repo.name)).size).toBe(5);
    expect(repos.every((repo) => repo.url.startsWith("https://github.com/owner/repo-"))).toBe(true);
  });

  it("rejects encoded traversal or encoded separators and deduplicates names case-insensitively", () => {
    const html = [
      article({ href: "/%2e%2e/repo" }),
      article({ href: "/owner%2Frepo/x" }),
      article({ href: "/owner/%2e" }),
      article({ href: "/owner/%2e%2e" }),
      article({ href: "/x/%2e%2e/owner/repo" }),
      article({ href: "/x/%2E%2E/owner/repo" }),
      article({ href: "/x/../owner/repo" }),
      article({ href: "/x/%2e./owner/repo" }),
      article({ href: "/Owner/Repo" }).replace("octo / repo", "Owner / Repo"),
      article({ href: "/owner/repo" }).replace("octo / repo", "owner / repo"),
    ].join("");

    expect(parseGitHubTrending(html).map((repo) => repo.name)).toEqual(["Owner/Repo"]);
  });

  it.each(["", "<main>changed layout</main>", "<article class='Box-row'><h2>broken</h2></article>"])(
    "returns an empty list without throwing for changed or malformed markup %j",
    (html) => expect(parseGitHubTrending(html)).toEqual([]),
  );
});

describe("GitHub fallback URL and mapping", () => {
  it("builds the exact GitHub search request parameters", () => {
    const url = new URL(buildGitHubSearchFallbackUrl("2026-06-28"));

    expect(url.origin + url.pathname).toBe("https://api.github.com/search/repositories");
    expect(url.searchParams.get("q")).toBe("pushed:>=2026-06-28");
    expect(url.searchParams.get("sort")).toBe("stars");
    expect(url.searchParams.get("order")).toBe("desc");
    expect(url.searchParams.get("per_page")).toBe("5");
    expect([...url.searchParams.keys()].sort()).toEqual(["order", "per_page", "q", "sort"]);
  });

  it.each(["2026-6-28", "2026-02-30", "not-a-date", "2026-13-01"])(
    "rejects invalid date %s",
    (date) => expect(() => buildGitHubSearchFallbackUrl(date)).toThrow(),
  );

  it("maps, filters, deduplicates, and caps GitHub search results", () => {
    const items = Array.from({ length: 22 }, (_, index) => ({
      full_name: `owner/repo-${index}`,
      html_url: `https://github.com/owner/repo-${index}`,
      description: index === 0 ? null : `Repo ${index}`,
      language: index === 0 ? null : "TypeScript",
      stargazers_count: index,
    }));
    const mapped = mapGitHubSearchFallback({
      items: [
        { ...items[0], html_url: "https://evil.example/owner/repo-0" },
        items[0],
        items[0],
        { ...items[1], full_name: "topics/agents", html_url: "https://github.com/topics/agents" },
        ...items.slice(1),
      ],
    });

    expect(GITHUB_FALLBACK_LABEL).toBe("活跃高星项目");
    expect(mapped).toHaveLength(5);
    expect(mapped[0]).toEqual({
      name: "owner/repo-0",
      url: "https://github.com/owner/repo-0",
      description: "",
      stars: 0,
      source: "github-search-fallback",
    });
    expect(mapped[1]?.language).toBe("TypeScript");
    expect(new Set(mapped.map((repo) => repo.name)).size).toBe(5);
  });

  it.each([null, {}, { items: "not-an-array" }])("returns empty for malformed JSON %#", (value) => {
    expect(mapGitHubSearchFallback(value)).toEqual([]);
  });

  it("rejects inherited items and inherited repository fields", () => {
    const inheritedResponse = Object.create({ items: fallbackItems.items }) as unknown;
    const inheritedItem = Object.create(fallbackItems.items[0]!) as unknown;

    expect(mapGitHubSearchFallback(inheritedResponse)).toEqual([]);
    expect(mapGitHubSearchFallback({ items: [inheritedItem] })).toEqual([]);
  });

  it("does not read inherited optional description or language fields", () => {
    const item = Object.create({
      description: "inherited description",
      language: "InheritedScript",
    }) as Record<string, unknown>;
    Object.assign(item, {
      full_name: "octo/repo",
      html_url: "https://github.com/octo/repo",
      stargazers_count: 12_400,
    });

    expect(mapGitHubSearchFallback({ items: [item] })).toEqual([{
      name: "octo/repo",
      url: "https://github.com/octo/repo",
      description: "",
      stars: 12_400,
      source: "github-search-fallback",
    }]);
  });
});

describe("GitHubTrendingService", () => {
  it("uses trending directly without authorization or resolving the token", async () => {
    const request = vi.fn<RequestPort>().mockResolvedValue({ status: 200, text: article() });
    const tokenProvider = vi.fn(async () => "secret-token");
    const service = new GitHubTrendingService(request, tokenProvider);

    const result = await service.fetch("daily", new Date("2026-06-29T12:00:00Z"));

    expect(result).toHaveLength(1);
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ url: "https://github.com/trending?since=daily" });
    expect(request.mock.calls[0]?.[0].headers?.Authorization).toBeUndefined();
    expect(tokenProvider).not.toHaveBeenCalled();
  });

  it.each([200, 299])("accepts trending HTTP status %s as success", async (status) => {
    const request = vi.fn<RequestPort>().mockResolvedValue({ status, text: article() });

    await expect(new GitHubTrendingService(request).fetch("daily")).resolves.toHaveLength(1);
    expect(request).toHaveBeenCalledOnce();
  });

  it.each([199, 300])("falls back for trending HTTP status %s", async (status) => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status, text: article() })
      .mockResolvedValueOnce({ status: 200, text: "", json: fallbackItems });

    await expect(new GitHubTrendingService(request).fetch("daily"))
      .resolves.toEqual([expect.objectContaining({ source: "github-search-fallback" })]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([200, 299])("accepts fallback HTTP status %s as success", async (status) => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 300, text: "" })
      .mockResolvedValueOnce({ status, text: "", json: fallbackItems });

    await expect(new GitHubTrendingService(request).fetch("daily"))
      .resolves.toEqual([expect.objectContaining({ source: "github-search-fallback" })]);
  });

  it.each([199, 300])("rejects fallback HTTP status %s", async (status) => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 300, text: "" })
      .mockResolvedValueOnce({ status, text: "", json: fallbackItems });

    await expect(new GitHubTrendingService(request).fetch("daily"))
      .rejects.toBeInstanceOf(GitHubFeedError);
  });

  it("preserves a 429 retry-after time without leaking response details", async () => {
    const now = new Date("2026-06-29T09:00:00.000Z");
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 300, text: "" })
      .mockResolvedValueOnce({ status: 429, text: "private", retryAfter: "120" });

    const error = await new GitHubTrendingService(request).fetch("daily", now)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubRateLimitError);
    expect(error).toMatchObject({ retryAt: now.getTime() + 120_000 });
    expect(JSON.stringify(error)).not.toContain("private");
  });

  it("uses the configured cache TTL when a 429 omits retry-after", async () => {
    const now = new Date("2026-06-29T09:00:00.000Z");
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 300, text: "" })
      .mockResolvedValueOnce({ status: 429, text: "" });

    const error = await new GitHubTrendingService(request, undefined, () => 15 * 60_000)
      .fetch("daily", now)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "GitHubRateLimitError",
      retryAt: now.getTime() + 15 * 60_000,
    });
  });

  it("treats a 403 with retry-after as rate limited", async () => {
    const now = new Date("2026-06-29T09:00:00.000Z");
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 300, text: "" })
      .mockResolvedValueOnce({ status: 403, text: "", retryAfter: "90" });

    const error = await new GitHubTrendingService(request).fetch("daily", now)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "GitHubRateLimitError",
      retryAt: now.getTime() + 90_000,
    });
  });

  it("uses x-ratelimit-reset when a 403 reports zero remaining", async () => {
    const now = new Date("2026-06-29T09:00:00.000Z");
    const resetSeconds = Math.floor(now.getTime() / 1_000) + 300;
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 300, text: "" })
      .mockResolvedValueOnce({
        status: 403,
        text: "",
        rateLimitRemaining: "0",
        rateLimitReset: String(resetSeconds),
      });

    const error = await new GitHubTrendingService(request).fetch("daily", now)
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "GitHubRateLimitError",
      retryAt: resetSeconds * 1_000,
    });
  });

  it("does not misclassify an ordinary 403 as rate limited", async () => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 300, text: "" })
      .mockResolvedValueOnce({ status: 403, text: "forbidden" });

    const error = await new GitHubTrendingService(request).fetch("daily")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubFeedError);
    expect(error).not.toBeInstanceOf(GitHubRateLimitError);
  });

  it.each([
    ["non-2xx", async () => ({ status: 503, text: "unavailable" })],
    ["request error", async () => { throw new Error("trending secret body"); }],
    ["empty parse", async () => ({ status: 200, text: "<main>changed</main>" })],
  ])("falls back after trending %s", async (_case, trendingResponse) => {
    const request = vi.fn<RequestPort>()
      .mockImplementationOnce(trendingResponse)
      .mockResolvedValueOnce({ status: 200, text: "", json: fallbackItems });
    const service = new GitHubTrendingService(request);

    const result = await service.fetch("weekly", new Date("2026-01-03T01:02:03Z"));

    expect(result[0]?.source).toBe("github-search-fallback");
    const fallback = new URL(request.mock.calls[1]?.[0].url ?? "");
    expect(fallback.searchParams.get("q")).toBe("pushed:>=2025-12-27");
  });

  it("uses one-day UTC subtraction across a month boundary", async () => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 404, text: "" })
      .mockResolvedValueOnce({ status: 200, text: "", json: fallbackItems });

    await new GitHubTrendingService(request).fetch("daily", new Date("2026-03-01T00:01:00Z"));

    const fallback = new URL(request.mock.calls[1]?.[0].url ?? "");
    expect(fallback.searchParams.get("q")).toBe("pushed:>=2026-02-28");
  });

  it("adds a trimmed token only to the exact api.github.com fallback request", async () => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 200, text: "changed" })
      .mockResolvedValueOnce({ status: 200, text: "", json: fallbackItems });
    const tokenProvider = vi.fn(async () => "  github-secret  ");

    await new GitHubTrendingService(request, tokenProvider).fetch("daily");

    expect(request.mock.calls[0]?.[0].headers?.Authorization).toBeUndefined();
    expect(request.mock.calls[1]?.[0].headers).toEqual({
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer github-secret",
    });
    expect(new URL(request.mock.calls[1]?.[0].url ?? "").hostname).toBe("api.github.com");
    expect(tokenProvider).toHaveBeenCalledOnce();
  });

  it.each([
    [{ status: 500, text: "secret-token response" }],
    [{ status: 200, text: "", json: { broken: true } }],
    [{ status: 200, text: "", json: { items: [] } }],
  ])("throws a stable typed error when fallback cannot produce data %#", async (fallbackResponse) => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 200, text: "changed layout" })
      .mockResolvedValueOnce(fallbackResponse);

    const error = await new GitHubTrendingService(request, async () => "secret-token")
      .fetch("daily")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GitHubFeedError);
    expect((error as Error).message).toBe("GitHub 项目暂时无法加载，请稍后重试。");
    expect(JSON.stringify(error)).not.toContain("secret-token");
    expect(JSON.stringify(error)).not.toContain("response");
  });

  it("wraps fallback request failures without leaking their message", async () => {
    const request = vi.fn<RequestPort>()
      .mockResolvedValueOnce({ status: 503, text: "" })
      .mockRejectedValueOnce(new Error("secret request failure"));

    await expect(new GitHubTrendingService(request).fetch("daily"))
      .rejects.toEqual(expect.objectContaining({
        name: "GitHubFeedError",
        message: "GitHub 项目暂时无法加载，请稍后重试。",
      }));
  });
});
