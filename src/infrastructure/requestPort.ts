/**
 * HTTP 请求端口：取资讯、榜单、摘要都走它。
 *
 * 这两个类型原先定义在 `features/feeds/githubTrending.ts`，被 hackerNews / rss /
 * ApiSummarizerService 以及 infrastructure 层的 ObsidianRequestPort 反向 import ——
 * 一个「怎么发请求」的基础设施约定不该住在某个具体资讯源里（审查 D7）。
 */

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
  /** Optional non-GET request used by the HTTP summarizer. */
  method?: "GET" | "POST";
  body?: string;
}) => Promise<RequestResult>;
