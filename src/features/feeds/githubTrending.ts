import type { TrendingRepo } from "../../domain/types";

export type GitHubPeriod = "daily" | "weekly";

export interface RequestResult {
  status: number;
  text: string;
  json?: unknown;
  retryAfter?: string;
  rateLimitRemaining?: string;
  rateLimitReset?: string;
}

export type RequestPort = (options: {
  url: string;
  headers?: Record<string, string>;
}) => Promise<RequestResult>;

export type TokenProvider = () => Promise<string | undefined>;

export const GITHUB_FALLBACK_LABEL = "活跃高星项目";

const TRENDING_URL = "https://github.com/trending";
const GITHUB_ORIGIN = "https://github.com";
const FALLBACK_ERROR_MESSAGE = "GitHub 项目暂时无法加载，请稍后重试。";
export const MAX_GITHUB_REPOSITORIES = 5;
const NON_REPOSITORY_ROOTS = new Set([
  "about",
  "apps",
  "collections",
  "contact",
  "customer-stories",
  "enterprise",
  "events",
  "explore",
  "features",
  "issues",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "site",
  "sponsors",
  "team",
  "topics",
  "trending",
]);

export class GitHubFeedError extends Error {
  constructor(message = FALLBACK_ERROR_MESSAGE) {
    super(message);
    this.name = "GitHubFeedError";
  }
}

export class GitHubRateLimitError extends GitHubFeedError {
  constructor(readonly retryAt: number) {
    super("GitHub 请求过于频繁。");
    this.name = "GitHubRateLimitError";
  }
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const parseCount = (value: string): number | undefined => {
  const normalized = value.trim().toLowerCase();
  const compact = /^(\d+(?:\.\d+)?)([km])$/.exec(normalized);
  if (compact?.[1] && compact[2]) {
    const numeric = Number(compact[1]);
    if (!Number.isFinite(numeric)) return undefined;
    return Math.round(numeric * (compact[2] === "k" ? 1_000 : 1_000_000));
  }

  const isPlainInteger = /^\d+$/.test(normalized);
  const isGroupedInteger = /^\d{1,3}([, \u00a0\u202f])\d{3}(?:\1\d{3})*$/.test(normalized);
  if (!isPlainInteger && !isGroupedInteger) return undefined;

  const numeric = Number(normalized.replace(/[, \u00a0\u202f]/g, ""));
  if (!Number.isFinite(numeric)) return undefined;
  return numeric;
};

const normalizeRepositoryName = (value: string): string | undefined => {
  const compact = value.split("/").map((part) => part.trim()).join("/");
  const match = /^([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)$/.exec(compact);
  if (!match || !match[1] || !match[2]) return undefined;
  if (NON_REPOSITORY_ROOTS.has(match[1].toLowerCase())) return undefined;
  return `${match[1]}/${match[2]}`;
};

const decodeRawRepositoryPath = (href: string): string | undefined => {
  const rawTarget = href.split(/[?#]/, 1)[0];
  if (!rawTarget) return undefined;

  let rawPath: string;
  if (rawTarget.startsWith("/")) {
    rawPath = rawTarget;
  } else {
    const origin = /^https:\/\/github\.com(?=\/)/i.exec(rawTarget)?.[0];
    if (!origin) return undefined;
    rawPath = rawTarget.slice(origin.length);
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return undefined;
  }

  const match = /^\/([^/\\]+)\/([^/\\]+)$/.exec(decoded);
  if (!match?.[1] || !match[2]) return undefined;
  if (match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") {
    return undefined;
  }
  return normalizeRepositoryName(`${match[1]}/${match[2]}`);
};

const repositoryFromUrl = (href: string): { name: string; url: string } | undefined => {
  const name = decodeRawRepositoryPath(href);
  if (!name) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(href, GITHUB_ORIGIN);
  } catch {
    return undefined;
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== "github.com" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) return undefined;

  return { name, url: `${GITHUB_ORIGIN}/${name}` };
};

const findPeriodStars = (article: Element): number | undefined => {
  const match = /(\d[\d,. \u00a0\u202f]*(?:[km])?)\s+stars?\s+(?:today|this\s+week)\b/i.exec(
    article.textContent ?? "",
  );
  return match?.[1] ? parseCount(match[1]) : undefined;
};

export const parseGitHubTrending = (html: string): TrendingRepo[] => {
  if (typeof DOMParser === "undefined" || html.trim() === "") return [];

  let document: Document;
  try {
    document = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [];
  }

  const repositories: TrendingRepo[] = [];
  const names = new Set<string>();
  for (const article of Array.from(document.querySelectorAll("article.Box-row"))) {
    const href = article.querySelector("h2 a")?.getAttribute("href");
    if (!href) continue;
    const identity = repositoryFromUrl(href);
    if (!identity) continue;

    const key = identity.name.toLowerCase();
    if (names.has(key)) continue;

    const starsLink = Array.from(article.querySelectorAll("a"))
      .find((anchor) => anchor.getAttribute("href")?.endsWith("/stargazers"));
    const stars = starsLink ? parseCount(starsLink.textContent ?? "") : undefined;
    if (stars === undefined) continue;

    const description = normalizeWhitespace(article.querySelector("p")?.textContent ?? "");
    const language = normalizeWhitespace(
      article.querySelector('[itemprop="programmingLanguage"]')?.textContent ?? "",
    );
    const starsInPeriod = findPeriodStars(article);
    const repository: TrendingRepo = {
      name: identity.name,
      url: identity.url,
      description,
      stars,
      source: "github-trending",
    };
    if (language) repository.language = language;
    if (starsInPeriod !== undefined) repository.starsInPeriod = starsInPeriod;

    names.add(key);
    repositories.push(repository);
    if (repositories.length === MAX_GITHUB_REPOSITORIES) break;
  }

  return repositories;
};

const isValidCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

export const buildGitHubSearchFallbackUrl = (since: string): string => {
  if (!isValidCalendarDate(since)) throw new TypeError("Invalid GitHub fallback date.");

  const url = new URL("https://api.github.com/search/repositories");
  url.searchParams.set("q", `pushed:>=${since}`);
  url.searchParams.set("sort", "stars");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", String(MAX_GITHUB_REPOSITORIES));
  return url.toString();
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasOwn = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export const mapGitHubSearchFallback = (value: unknown): TrendingRepo[] => {
  if (!isRecord(value) || !hasOwn(value, "items") || !Array.isArray(value.items)) return [];

  const repositories: TrendingRepo[] = [];
  const names = new Set<string>();
  for (const candidate of value.items) {
    if (!isRecord(candidate)) continue;
    const name = hasOwn(candidate, "full_name") && typeof candidate.full_name === "string"
      ? normalizeRepositoryName(candidate.full_name)
      : undefined;
    const identity = hasOwn(candidate, "html_url") && typeof candidate.html_url === "string"
      ? repositoryFromUrl(candidate.html_url)
      : undefined;
    const stars = hasOwn(candidate, "stargazers_count")
      ? candidate.stargazers_count
      : undefined;
    if (
      !name ||
      !identity ||
      identity.name.toLowerCase() !== name.toLowerCase() ||
      typeof stars !== "number" ||
      !Number.isInteger(stars) ||
      stars < 0
    ) continue;

    const key = name.toLowerCase();
    if (names.has(key)) continue;
    const description = hasOwn(candidate, "description") && typeof candidate.description === "string"
      ? candidate.description.trim()
      : "";
    const language = hasOwn(candidate, "language") && typeof candidate.language === "string"
      ? candidate.language.trim()
      : "";
    const repository: TrendingRepo = {
      name,
      url: `${GITHUB_ORIGIN}/${name}`,
      description,
      stars,
      source: "github-search-fallback",
    };
    if (language) repository.language = language;

    names.add(key);
    repositories.push(repository);
    if (repositories.length === MAX_GITHUB_REPOSITORIES) break;
  }

  return repositories;
};

const fallbackSince = (period: GitHubPeriod, now: Date): string => {
  const date = new Date(now.getTime());
  date.setUTCDate(date.getUTCDate() - (period === "daily" ? 1 : 7));
  return date.toISOString().slice(0, 10);
};

const responseJson = (response: RequestResult): unknown => {
  if (response.json !== undefined) return response.json;
  return JSON.parse(response.text) as unknown;
};

export class GitHubTrendingService {
  constructor(
    private readonly request: RequestPort,
    private readonly tokenProvider?: TokenProvider,
    private readonly retryDelayMs: () => number = () => 60 * 60_000,
  ) {}

  async fetch(period: GitHubPeriod, now = new Date()): Promise<TrendingRepo[]> {
    try {
      const response = await this.request({ url: `${TRENDING_URL}?since=${period}` });
      if (response.status >= 200 && response.status < 300) {
        const repositories = parseGitHubTrending(response.text);
        if (repositories.length > 0) return repositories;
      }
    } catch {
      // The official page is best-effort; the API fallback below owns the public failure state.
    }

    try {
      const url = buildGitHubSearchFallbackUrl(fallbackSince(period, now));
      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      const token = (await this.tokenProvider?.())?.trim();
      if (token && new URL(url).hostname === "api.github.com") {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await this.request({ url, headers });
      if (isRateLimited(response)) {
        throw new GitHubRateLimitError(retryAt(
          response.retryAfter,
          response.rateLimitReset,
          now,
          this.retryDelayMs(),
        ));
      }
      if (response.status < 200 || response.status >= 300) throw new GitHubFeedError();
      const repositories = mapGitHubSearchFallback(responseJson(response));
      if (repositories.length === 0) throw new GitHubFeedError();
      return repositories;
    } catch (error) {
      if (error instanceof GitHubRateLimitError) throw error;
      throw new GitHubFeedError();
    }
  }
}

function isRateLimited(response: RequestResult): boolean {
  return response.status === 429 ||
    (response.status === 403 &&
      (response.retryAfter !== undefined || response.rateLimitRemaining?.trim() === "0"));
}

function retryAt(
  retryAfter: string | undefined,
  rateLimitReset: string | undefined,
  now: Date,
  fallbackDelayMs: number,
): number {
  const nowTime = now.getTime();
  const fallback = nowTime + Math.max(0, Number.isFinite(fallbackDelayMs) ? fallbackDelayMs : 0);
  if (retryAfter !== undefined) {
    const trimmed = retryAfter.trim();
    if (/^\d+$/.test(trimmed)) {
      const seconds = Number(trimmed);
      const relative = nowTime + seconds * 1_000;
      if (Number.isSafeInteger(seconds) && Number.isSafeInteger(relative)) return relative;
    }
    const absolute = Date.parse(trimmed);
    if (Number.isFinite(absolute) && absolute > nowTime) return absolute;
  }
  if (rateLimitReset !== undefined && /^\d+$/.test(rateLimitReset.trim())) {
    const reset = Number(rateLimitReset.trim()) * 1_000;
    if (Number.isSafeInteger(reset) && reset > nowTime) return reset;
  }
  return fallback;
}
