import type { NewsItem } from "../../domain/types";
import type { RequestPort } from "../../infrastructure/requestPort";

const EPOCH_ISO = new Date(0).toISOString();
const MAX_RESULTS = 20;
const REQUEST_CONCURRENCY = 4;

const elementChildren = (parent: ParentNode, localName: string): Element[] =>
  Array.from(parent.querySelectorAll("*")).filter((element) => element.localName.toLowerCase() === localName);

const directChild = (parent: Element, localName: string): Element | undefined =>
  Array.from(parent.children).find((element) => element.localName.toLowerCase() === localName);

const textOf = (parent: Element, localName: string): string =>
  directChild(parent, localName)?.textContent?.replace(/\s+/g, " ").trim() ?? "";

const normalizePercentEncoding = (value: string): string => value.replace(/%([0-9a-f]{2})/gi, (match, hex: string) => {
  const character = String.fromCharCode(Number.parseInt(hex, 16));
  return /^[A-Za-z0-9._~-]$/.test(character) ? character : match.toUpperCase();
});

const normalizeHttpUrl = (value: string, base?: string): string | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  try {
    const url = base ? new URL(trimmed, base) : new URL(trimmed);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username !== "" || url.password !== "") {
      return undefined;
    }
    url.hash = "";
    return normalizePercentEncoding(url.href);
  } catch {
    return undefined;
  }
};

const dateIso = (value: string): string => {
  if (value === "") return EPOCH_ISO;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : EPOCH_ISO;
};

const atomLink = (entry: Element): string => {
  const links = Array.from(entry.children).filter((element) => element.localName.toLowerCase() === "link");
  const alternate = links.find((element) => (element.getAttribute("rel") ?? "alternate").toLowerCase() === "alternate");
  return alternate?.getAttribute("href")?.trim() ?? "";
};

const compareNewest = (left: NewsItem, right: NewsItem): number =>
  Date.parse(right.publishedAt) - Date.parse(left.publishedAt)
  || left.url.localeCompare(right.url)
  || left.title.localeCompare(right.title)
  || left.source.localeCompare(right.source);

const newestByUrl = (items: readonly NewsItem[]): NewsItem[] => {
  const byUrl = new Map<string, NewsItem>();
  for (const item of items) {
    const current = byUrl.get(item.url);
    if (!current || compareNewest(item, current) < 0) byUrl.set(item.url, item);
  }
  return [...byUrl.values()].sort(compareNewest);
};

export const parseRssFeed = (xml: string, feedUrl: string): NewsItem[] => {
  const normalizedFeedUrl = normalizeHttpUrl(feedUrl);
  if (!normalizedFeedUrl) return [];

  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) return [];
  const root = document.documentElement;
  if (!root) return [];

  const rootName = root.localName.toLowerCase();
  let source = "";
  let entries: Element[] = [];
  let isAtom = false;
  if (rootName === "rss") {
    const channel = elementChildren(root, "channel")[0];
    if (!channel) return [];
    source = textOf(channel, "title");
    entries = Array.from(channel.children).filter((element) => element.localName.toLowerCase() === "item");
  } else if (rootName === "feed") {
    isAtom = true;
    source = textOf(root, "title");
    entries = Array.from(root.children).filter((element) => element.localName.toLowerCase() === "entry");
  } else {
    return [];
  }

  if (source === "") source = new URL(normalizedFeedUrl).hostname;
  const items: NewsItem[] = [];
  for (const entry of entries) {
    const title = textOf(entry, "title");
    const rawLink = isAtom ? atomLink(entry) : textOf(entry, "link");
    const url = normalizeHttpUrl(rawLink, normalizedFeedUrl);
    if (title === "" || !url) continue;
    const rawDate = isAtom
      ? textOf(entry, "updated") || textOf(entry, "published")
      : textOf(entry, "pubdate") || textOf(entry, "date");
    items.push({
      id: `rss:${url}`,
      title,
      url,
      source,
      publishedAt: dateIso(rawDate),
    });
  }
  return newestByUrl(items);
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

export const collectRssNews = async (feeds: readonly string[], request: RequestPort): Promise<NewsItem[]> => {
  const normalizedFeeds = [...new Set(feeds.map((feed) => normalizeHttpUrl(feed)).filter((feed): feed is string => feed !== undefined))];
  const batches = await mapWithConcurrency(normalizedFeeds, REQUEST_CONCURRENCY, async (feedUrl) => {
    try {
      const response = await request({ url: feedUrl });
      if (response.status < 200 || response.status >= 300) return [];
      return parseRssFeed(response.text, feedUrl);
    } catch {
      return [];
    }
  });
  return newestByUrl(batches.flat()).slice(0, MAX_RESULTS);
};
