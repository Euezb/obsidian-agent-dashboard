import type { NewsItem } from "../../domain/types";
import type { RequestPort, RequestResult } from "./githubTrending";

const API_ORIGIN = "https://hacker-news.firebaseio.com/v0";
const DISCUSSION_ORIGIN = "https://news.ycombinator.com/item";
const ERROR_MESSAGE = "Hacker News 暂时无法加载，请稍后重试。";
const MAX_STORY_IDS = 50;
const MAX_RESULTS = 12;
const REQUEST_CONCURRENCY = 8;

const AI_TERMS = [
  /(?<![\p{L}\p{M}\p{N}])ai(?![\p{L}\p{M}\p{N}])/iu,
  /(?<![\p{L}\p{M}\p{N}])agents?(?![\p{L}\p{M}\p{N}])/iu,
  /(?<![\p{L}\p{M}\p{N}])llm(?![\p{L}\p{M}\p{N}])/iu,
  /(?<![\p{L}\p{M}\p{N}])model(?![\p{L}\p{M}\p{N}])/iu,
  /(?<![\p{L}\p{M}\p{N}])openai(?![\p{L}\p{M}\p{N}])/iu,
  /(?<![\p{L}\p{M}\p{N}])anthropic(?![\p{L}\p{M}\p{N}])/iu,
  /(?<![\p{L}\p{M}\p{N}])mcp(?![\p{L}\p{M}\p{N}])/iu,
  /(?<![\p{L}\p{M}\p{N}])machine\s+learning(?![\p{L}\p{M}\p{N}])/iu,
];

type HackerNewsStory = {
  id: number;
  title: string;
  time: number;
  score: number;
  url?: string;
};

export class HackerNewsError extends Error {
  constructor() {
    super(ERROR_MESSAGE);
    this.name = "HackerNewsError";
  }
}

export const isAiRelevant = (title: string): boolean => AI_TERMS.some((term) => term.test(title));

const hasOwn = (value: object, key: PropertyKey): boolean => Object.prototype.hasOwnProperty.call(value, key);

const responseJson = (response: RequestResult): unknown => {
  if (hasOwn(response, "json") && response.json !== undefined) return response.json;
  return JSON.parse(response.text) as unknown;
};

const isSuccessful = (status: number): boolean => status >= 200 && status < 300;

const isOwnNumber = (value: object, key: string): boolean =>
  hasOwn(value, key) && typeof (value as Record<string, unknown>)[key] === "number"
  && Number.isFinite((value as Record<string, unknown>)[key]);

const isOwnString = (value: object, key: string): boolean =>
  hasOwn(value, key) && typeof (value as Record<string, unknown>)[key] === "string";

const parseStory = (value: unknown, requestedId: number): HackerNewsStory | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  if (!isOwnNumber(value, "id") || !isOwnString(value, "type") || !isOwnString(value, "title")
    || !isOwnNumber(value, "time") || !isOwnNumber(value, "score")) return undefined;

  const record = value as Record<string, unknown>;
  if (record.id !== requestedId || record.type !== "story"
    || (hasOwn(value, "dead") && record.dead === true)
    || (hasOwn(value, "deleted") && record.deleted === true)) return undefined;
  if (!isAiRelevant(record.title as string)) return undefined;
  const publishedMilliseconds = (record.time as number) * 1_000;
  if (!Number.isFinite(publishedMilliseconds)
    || !Number.isFinite(new Date(publishedMilliseconds).getTime())) return undefined;

  const story: HackerNewsStory = {
    id: record.id,
    title: record.title as string,
    time: record.time as number,
    score: record.score as number,
  };
  if (isOwnString(value, "url")) story.url = record.url as string;
  return story;
};

const safeStoryUrl = (url: string | undefined, id: number): string => {
  if (url) {
    try {
      const parsed = new URL(url);
      if ((parsed.protocol === "http:" || parsed.protocol === "https:")
        && parsed.username === "" && parsed.password === "") return parsed.href;
    } catch {
      // Fall through to the public discussion page.
    }
  }
  return `${DISCUSSION_ORIGIN}?id=${id}`;
};

const mapWithConcurrency = async <T, R>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      const value = values[index];
      if (value !== undefined) results[index] = await operation(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
};

const parseTopIds = (value: unknown): number[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  const ids: unknown[] = value.slice(0, MAX_STORY_IDS) as unknown[];
  if (!ids.every((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0)) return undefined;
  return [...new Set(ids)];
};

const dedupeStoriesById = (stories: readonly HackerNewsStory[]): HackerNewsStory[] => {
  const seen = new Set<number>();
  return stories.filter((story) => {
    if (seen.has(story.id)) return false;
    seen.add(story.id);
    return true;
  });
};

const toNewsItem = (story: HackerNewsStory): NewsItem => ({
  id: `hn:${story.id}`,
  title: story.title,
  url: safeStoryUrl(story.url, story.id),
  source: "Hacker News",
  publishedAt: new Date(story.time * 1_000).toISOString(),
  score: story.score,
});

export class HackerNewsService {
  constructor(private readonly request: RequestPort) {}

  async fetch(): Promise<NewsItem[]> {
    let ids: number[];
    try {
      const response = await this.request({ url: `${API_ORIGIN}/topstories.json` });
      if (!isSuccessful(response.status)) throw new HackerNewsError();
      const parsed = parseTopIds(responseJson(response));
      if (!parsed) throw new HackerNewsError();
      ids = parsed;
    } catch {
      throw new HackerNewsError();
    }

    const stories = await mapWithConcurrency(ids, REQUEST_CONCURRENCY, async (id) => {
      try {
        const response = await this.request({ url: `${API_ORIGIN}/item/${id}.json` });
        if (!isSuccessful(response.status)) return undefined;
        return parseStory(responseJson(response), id);
      } catch {
        return undefined;
      }
    });

    return dedupeStoriesById(stories.filter((story): story is HackerNewsStory => story !== undefined))
      .sort((left, right) => right.score - left.score || right.time - left.time || right.id - left.id)
      .slice(0, MAX_RESULTS)
      .map(toNewsItem);
  }
}
