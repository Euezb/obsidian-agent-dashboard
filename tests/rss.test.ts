import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { collectRssNews, parseRssFeed } from "../src/features/feeds/rss";
import type { RequestPort } from "../src/features/feeds/githubTrending";

const rss = `<?xml version="1.0"?>
<rss version="2.0"><channel><title>AI &amp; Today</title>
  <item><title>First &amp; best</title><link>/posts/one#fragment</link><pubDate>Sat, 28 Jun 2026 10:00:00 GMT</pubDate></item>
  <item><title>Undated</title><link>https://example.com/undated</link></item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom Source</title>
  <entry><title>Atom entry</title><link rel="self" href="/self"/><link rel="alternate" href="../article#top"/><updated>2026-06-28T11:00:00Z</updated></entry>
</feed>`;

describe("parseRssFeed", () => {
  it("parses RSS 2 entities, relative links, source and epoch for a missing date", () => {
    expect(parseRssFeed(rss, "https://example.com/feed/index.xml")).toEqual([
      {
        id: "rss:https://example.com/posts/one",
        title: "First & best",
        url: "https://example.com/posts/one",
        source: "AI & Today",
        publishedAt: "2026-06-28T10:00:00.000Z",
      },
      {
        id: "rss:https://example.com/undated",
        title: "Undated",
        url: "https://example.com/undated",
        source: "AI & Today",
        publishedAt: "1970-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("parses Atom and prefers its alternate link", () => {
    expect(parseRssFeed(atom, "https://example.com/feeds/main.xml")).toEqual([{
      id: "rss:https://example.com/article",
      title: "Atom entry",
      url: "https://example.com/article",
      source: "Atom Source",
      publishedAt: "2026-06-28T11:00:00.000Z",
    }]);
  });

  it("rejects credentials and non-http links, ignores markup text, and keeps the newest duplicate URL", () => {
    const xml = `<rss><channel><title>Safe</title>
      <item><title><b>Newest</b> headline</title><link>https://user:pass@example.com/a</link><pubDate>2026-06-28</pubDate></item>
      <item><title>Old</title><link>https://example.com/a#old</link><pubDate>2026-06-27</pubDate></item>
      <item><title>New</title><link>https://example.com/a#new</link><pubDate>2026-06-29</pubDate></item>
      <item><title>Script</title><link>javascript:alert(1)</link><pubDate>2026-06-30</pubDate></item>
    </channel></rss>`;
    expect(parseRssFeed(xml, "https://example.com/feed.xml")).toEqual([{
      id: "rss:https://example.com/a",
      title: "New",
      url: "https://example.com/a",
      source: "Safe",
      publishedAt: "2026-06-29T00:00:00.000Z",
    }]);
  });

  it("rejects empty RSS links and Atom entries without a usable href", () => {
    const linklessRss = `<rss><channel><title>RSS</title><item><title>No link</title><link>   </link></item></channel></rss>`;
    const linklessAtom = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><title>No href</title><link rel="alternate"/></entry></feed>`;

    expect(parseRssFeed(linklessRss, "https://example.com/feed.xml")).toEqual([]);
    expect(parseRssFeed(linklessAtom, "https://example.com/feed.xml")).toEqual([]);
  });

  it("canonicalizes percent-encoded unreserved characters but preserves encoded reserved characters", () => {
    const xml = `<rss><channel><title>Canonical</title>
      <item><title>Old encoded</title><link>https://example.com/%7euser/%41%2fdoc</link><pubDate>2026-06-27</pubDate></item>
      <item><title>New plain</title><link>https://example.com/~user/A%2Fdoc</link><pubDate>2026-06-29</pubDate></item>
    </channel></rss>`;

    expect(parseRssFeed(xml, "https://example.com/feed.xml")).toEqual([{
      id: "rss:https://example.com/~user/A%2Fdoc",
      title: "New plain",
      url: "https://example.com/~user/A%2Fdoc",
      source: "Canonical",
      publishedAt: "2026-06-29T00:00:00.000Z",
    }]);
  });

  it.each(["not xml", "<html><body>page</body></html>", "<rss><channel>"])(
    "returns an empty list for malformed or non-feed input",
    (xml) => expect(parseRssFeed(xml, "https://example.com/feed.xml")).toEqual([]),
  );
});

describe("collectRssNews", () => {
  it("normalizes and deduplicates feed URLs, limits concurrency to four and skips failed feeds", async () => {
    let active = 0;
    let maximum = 0;
    const request = vi.fn<RequestPort>(async ({ url }) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolveRequest) => window.setTimeout(resolveRequest, 0));
      active -= 1;
      if (url.endsWith("/5")) throw new Error("feed secret");
      if (url.endsWith("/6")) return { status: 503, text: "feed secret" };
      return { status: 200, text: `<rss><channel><title>Feed</title><item><title>${url}</title><link>${url}/item</link><pubDate>2026-06-28</pubDate></item></channel></rss>` };
    });
    const feeds = [
      ...Array.from({ length: 6 }, (_, index) => `https://example.com/${index + 1}`),
      "https://example.com/1#duplicate",
      "ftp://example.com/7",
      "https://user:pass@example.com/8",
      "invalid",
    ];

    const items = await collectRssNews(feeds, request);

    expect(request).toHaveBeenCalledTimes(6);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(items).toHaveLength(4);
  });

  it("combines feeds, keeps the newest duplicate and returns a deterministic newest twenty", async () => {
    const items = Array.from({ length: 22 }, (_, index) => `<item><title>Item ${index}</title><link>https://example.com/${index}</link><pubDate>${new Date(Date.UTC(2026, 5, index + 1)).toUTCString()}</pubDate></item>`).join("");
    const first = `<rss><channel><title>First</title>${items}<item><title>Old duplicate</title><link>https://example.com/shared#old</link><pubDate>2026-06-01</pubDate></item></channel></rss>`;
    const second = `<rss><channel><title>Second</title><item><title>New duplicate</title><link>https://example.com/shared#new</link><pubDate>2026-06-29</pubDate></item></channel></rss>`;
    const request: RequestPort = async ({ url }) => ({ status: 200, text: url.endsWith("one") ? first : second });

    const result = await collectRssNews(["https://feeds.example/one", "https://feeds.example/two"], request);

    expect(result).toHaveLength(20);
    expect(result[0]).toMatchObject({ title: "New duplicate", url: "https://example.com/shared", source: "Second" });
    expect(result.filter((item) => item.url === "https://example.com/shared")).toHaveLength(1);
    expect(result.map((item) => item.publishedAt)).toEqual([...result.map((item) => item.publishedAt)].sort().reverse());
  });

  it("deduplicates canonical-equivalent URLs across feeds and keeps the newest item", async () => {
    const first = `<rss><channel><title>First</title><item><title>Old encoded</title><link>https://example.com/%7eagent</link><pubDate>2026-06-01</pubDate></item></channel></rss>`;
    const second = `<rss><channel><title>Second</title><item><title>New plain</title><link>https://example.com/~agent</link><pubDate>2026-06-29</pubDate></item></channel></rss>`;
    const request: RequestPort = async ({ url }) => ({ status: 200, text: url.endsWith("one") ? first : second });

    await expect(collectRssNews(["https://feeds.example/one", "https://feeds.example/two"], request)).resolves.toEqual([{
      id: "rss:https://example.com/~agent",
      title: "New plain",
      url: "https://example.com/~agent",
      source: "Second",
      publishedAt: "2026-06-29T00:00:00.000Z",
    }]);
  });

  it("does not add a runtime XML parser dependency", () => {
    const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    expect(packageJson.dependencies ?? {}).toEqual({});
  });
});
