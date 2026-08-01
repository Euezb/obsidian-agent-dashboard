import type { RequestPort, RequestResult } from "../features/feeds/githubTrending";

interface ObsidianRequestOptions {
  url: string;
  headers?: Record<string, string>;
}

interface ObsidianRequestResult {
  status: number;
  text: string;
  json?: unknown;
  headers?: Record<string, string>;
}

type ObsidianRequest = (options: ObsidianRequestOptions) => Promise<ObsidianRequestResult>;

export const REQUEST_TIMEOUT_MS = 15_000;

export class RequestTimeoutError extends Error {
  constructor(url: string) {
    super(`Request timed out: ${url}`);
    this.name = "RequestTimeoutError";
  }
}

export function createObsidianRequestPort(
  request: ObsidianRequest,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): RequestPort {
  return async (options): Promise<RequestResult> => {
    let timer: number | undefined;
    const response = await Promise.race([
      request(options),
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new RequestTimeoutError(options.url)), timeoutMs);
      }),
    ]).finally(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    });
    const result: RequestResult = { status: response.status, text: response.text };
    let json: unknown;
    try {
      json = response.json;
    } catch {
      // Obsidian parses this lazy getter; HTML and XML responses are valid text-only results.
    }
    if (json !== undefined) result.json = json;
    const retryAfter = findHeader(response.headers, "retry-after");
    if (retryAfter !== undefined) result.retryAfter = retryAfter;
    const rateLimitRemaining = findHeader(response.headers, "x-ratelimit-remaining");
    if (rateLimitRemaining !== undefined) result.rateLimitRemaining = rateLimitRemaining;
    const rateLimitReset = findHeader(response.headers, "x-ratelimit-reset");
    if (rateLimitReset !== undefined) result.rateLimitReset = rateLimitReset;
    return result;
  };
}

function findHeader(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  if (headers === undefined) return undefined;
  const entry = Object.entries(headers)
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}
