import type { RequestPort, RequestResult } from "./requestPort";

interface ObsidianRequestOptions {
  url: string;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: string;
}

interface ObsidianRequestResult {
  status: number;
  text: string;
  json?: unknown;
  headers?: Record<string, string>;
}

type ObsidianRequest = (options: ObsidianRequestOptions) => Promise<ObsidianRequestResult>;

export const REQUEST_TIMEOUT_MS = 15_000;

/** 未决请求达到这个数量时提醒一次，用来判断超时后积压的真实规模。 */
const REQUEST_BACKLOG_WARN_AT = 8;

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
  let inFlight = 0;
  const send = async (options: Parameters<RequestPort>[0]): Promise<RequestResult> => {
    const obsidianOptions: ObsidianRequestOptions = {
      url: options.url,
      headers: options.headers,
      method: options.method,
      body: options.body,
    };
    let timer: number | undefined;
    const response = await Promise.race([
      request(obsidianOptions),
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
  return async (options): Promise<RequestResult> => {
    inFlight += 1;
    // requestUrl 没有 abort 通道:超时只是不再等它,底层请求仍在跑,这里只统计积压。
    // 审查把线上触发频率标为「未确认」,所以先只观测,熔断阈值等看清规模再定。
    if (inFlight === REQUEST_BACKLOG_WARN_AT) {
      console.warn(
        `[agent-dashboard] ${inFlight} in-flight HTTP requests: timed-out requests keep running`,
      );
    }
    try {
      return await send(options);
    } finally {
      inFlight -= 1;
    }
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
