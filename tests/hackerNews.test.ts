import { describe, expect, it, vi } from "vitest";

import {
  HackerNewsError,
  HackerNewsService,
  isAiRelevant,
} from "../src/features/feeds/hackerNews";
import type { RequestPort } from "../src/features/feeds/githubTrending";

const topUrl = "https://hacker-news.firebaseio.com/v0/topstories.json";
const itemUrl = (id: number): string => `https://hacker-news.firebaseio.com/v0/item/${id}.json`;

const response = (json: unknown, status = 200) => ({ status, text: JSON.stringify(json), json });

describe("isAiRelevant", () => {
  it.each([
    "AI changes software",
    "An agent for notes",
    "Multiple AGENTS cooperate",
    "New LLM inference engine",
    "A new LLM MODEL on laptops",
    "OpenAI releases a tool",
    "Anthropic research",
    "MCP server patterns",
    "Machine Learning systems",
  ])("accepts whole AI terms case-insensitively: %s", (title) => {
    expect(isAiRelevant(title)).toBe(true);
  });

  it.each([
    "painting tips",
    "email client",
    "retail trends",
    "she said hello",
    "wooden chair",
    // 单独的 "model" 不算 AI：它会把这类标题也放进来。
    // 真要讲模型，标题里几乎总同时出现 ai/llm 等词（见上面 "A new LLM MODEL"）。
    "A small MODEL on laptops",
    "Model T restoration",
  ])(
    "rejects keyword substrings: %s",
    (title) => expect(isAiRelevant(title)).toBe(false),
  );

  it.each([
    ["人工AI智能", false],
    ["painting_ai", true],
    ["AI研究", false],
    ["研究AI", false],
    ["ai\u0308", false],
    ["AI\u0301", false],
    ["\u0301AI", false],
    ["(AI): a field guide", true],
  ])("uses Unicode letter and number boundaries for %s", (title, expected) => {
    expect(isAiRelevant(title)).toBe(expected);
  });
});

describe("HackerNewsService", () => {
  it("reads only the first 50 ids with at most eight item requests in flight", async () => {
    const ids = Array.from({ length: 60 }, (_, index) => index + 1);
    let active = 0;
    let maximum = 0;
    const request = vi.fn<RequestPort>(async ({ url }) => {
      if (url === topUrl) return response(ids);
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      active -= 1;
      const id = Number(/\/item\/(\d+)/.exec(url)?.[1]);
      return response({ id, type: "story", title: `AI story ${id}`, time: id, score: id, url: `https://example.com/${id}` });
    });

    await new HackerNewsService(request).fetch();

    const requestedItems = request.mock.calls.map(([options]) => options.url).filter((url) => url.includes("/item/"));
    expect(requestedItems).toHaveLength(50);
    expect(requestedItems).not.toContain(itemUrl(51));
    expect(maximum).toBeLessThanOrEqual(8);
  });

  it("filters invalid stories and returns twelve relevant items sorted by score, then time and id", async () => {
    const ids = Array.from({ length: 19 }, (_, index) => index + 1);
    const stories: Record<number, unknown> = {};
    ids.forEach((id) => {
      stories[id] = { id, type: "story", title: `AI item ${id}`, time: 100 + id, score: 100 + id, url: `https://example.com/${id}` };
    });
    stories[1] = { id: 1, type: "comment", title: "AI comment", time: 999, score: 999 };
    stories[2] = { id: 2, type: "story", title: "Painting", time: 999, score: 999 };
    stories[3] = { id: 3, type: "story", title: "AI dead", time: 999, score: 999, dead: true };
    stories[4] = { id: 4, type: "story", title: "AI deleted", time: 999, score: 999, deleted: true };
    stories[17] = { id: 17, type: "story", title: "AI first tie", time: 400, score: 500, url: "https://example.com/17" };
    stories[18] = { id: 18, type: "story", title: "AI second tie", time: 401, score: 500, url: "https://example.com/18" };
    stories[19] = { id: 19, type: "story", title: "AI id tie", time: 401, score: 500, url: "https://example.com/19" };
    const request: RequestPort = async ({ url }) => url === topUrl
      ? response(ids)
      : response(stories[Number(/\/item\/(\d+)/.exec(url)?.[1])]);

    const items = await new HackerNewsService(request).fetch();

    expect(items).toHaveLength(12);
    expect(items.slice(0, 3).map((item) => item.id)).toEqual(["hn:19", "hn:18", "hn:17"]);
    expect(items.every((item) => item.source === "Hacker News")).toBe(true);
    expect(items.every((item) => Number.isFinite(Date.parse(item.publishedAt)))).toBe(true);
  });

  it("deduplicates top ids before fetching and rejects an item whose own id mismatches the request", async () => {
    const request = vi.fn<RequestPort>(async ({ url }) => {
      if (url === topUrl) return response([1, 1, 2]);
      if (url === itemUrl(1)) {
        return response({ id: 2, type: "story", title: "AI mismatched", time: 10, score: 20 });
      }
      return response({ id: 2, type: "story", title: "AI valid", time: 11, score: 10 });
    });

    const items = await new HackerNewsService(request).fetch();

    expect(request.mock.calls.filter(([options]) => options.url === itemUrl(1))).toHaveLength(1);
    expect(request.mock.calls.filter(([options]) => options.url === itemUrl(2))).toHaveLength(1);
    expect(items.map((item) => item.id)).toEqual(["hn:2"]);
  });

  it("ignores inherited dead and deleted flags when all required fields are own properties", async () => {
    const inheritedFlags = Object.create({ dead: true, deleted: true }) as Record<string, unknown>;
    Object.assign(inheritedFlags, {
      id: 1,
      type: "story",
      title: "AI remains visible",
      time: 10,
      score: 20,
      url: "https://example.com/visible",
    });
    const request: RequestPort = async ({ url }) => url === topUrl ? response([1]) : response(inheritedFlags);

    await expect(new HackerNewsService(request).fetch()).resolves.toMatchObject([{
      id: "hn:1",
      title: "AI remains visible",
    }]);
  });

  it("skips individual item failures and falls back to the HN discussion for unsafe or missing URLs", async () => {
    const request = vi.fn<RequestPort>(async ({ url }) => {
      if (url === topUrl) return response([1, 2, 3, 4]);
      if (url === itemUrl(1)) throw new Error("private item error");
      if (url === itemUrl(2)) return { status: 503, text: "secret body" };
      if (url === itemUrl(3)) return response({ id: 3, type: "story", title: "AI unsafe", time: 1, score: 3, url: "javascript:alert(1)" });
      return response({ id: 4, type: "story", title: "AI no link", time: 2, score: 4 });
    });

    const items = await new HackerNewsService(request).fetch();

    expect(items.map((item) => item.url)).toEqual([
      "https://news.ycombinator.com/item?id=4",
      "https://news.ycombinator.com/item?id=3",
    ]);
  });

  it("skips a story whose timestamp is outside the JavaScript Date range", async () => {
    const request: RequestPort = async ({ url }) => {
      if (url === topUrl) return response([1, 2]);
      if (url === itemUrl(1)) {
        return response({
          id: 1,
          type: "story",
          title: "AI from an impossible date",
          time: 8_640_000_000_001,
          score: 100,
          url: "https://example.com/invalid-date",
        });
      }
      return response({
        id: 2,
        type: "story",
        title: "AI from a valid date",
        time: 1_750_000_000,
        score: 50,
        url: "https://example.com/valid-date",
      });
    };

    await expect(new HackerNewsService(request).fetch()).resolves.toEqual([{
      id: "hn:2",
      title: "AI from a valid date",
      url: "https://example.com/valid-date",
      source: "Hacker News",
      publishedAt: "2025-06-15T15:06:40.000Z",
      score: 50,
    }]);
  });

  it.each([
    ["request failure", async () => { throw new Error("private body"); }],
    ["non-2xx", async () => ({ status: 500, text: "private body" })],
    ["malformed", async () => ({ status: 200, text: "not json" })],
  ])("uses a stable typed error for topstories %s without leaking response details", async (_case, implementation) => {
    const error = await new HackerNewsService(implementation).fetch().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HackerNewsError);
    expect(error).toMatchObject({ name: "HackerNewsError", message: "Hacker News 暂时无法加载，请稍后重试。" });
    expect(String(error)).not.toContain("private");
    expect(String(error)).not.toContain("not json");
  });

  it("rejects inherited JSON fields instead of reading through the prototype", async () => {
    const inherited: unknown = Object.create({ id: 1, type: "story", title: "AI inherited", time: 1, score: 1 }) as unknown;
    const request: RequestPort = async ({ url }) => url === topUrl ? response([1]) : response(inherited);
    await expect(new HackerNewsService(request).fetch()).resolves.toEqual([]);
  });
});
