import { describe, expect, it } from "vitest";
import {
  ApiKeyMissingError,
  ApiSummarizerError,
  ApiSummarizerService,
  ApiSummarizerUnavailableError,
  InvalidApiSummarizerOutputError,
} from "../src/features/feeds/ApiSummarizerService";
import { createDefaultSettings } from "../src/settings/settings";
import type { ApiSummarizerSettings } from "../src/settings/settings";
import type { NewsItem } from "../src/domain/types";

const NEWS: NewsItem[] = [
  {
    id: "hn:1",
    title: "OpenAI pauses training",
    url: "https://apnews.com/a",
    source: "Hacker News",
    publishedAt: "2026-09-28T01:00:00.000Z",
    score: 9,
  },
  {
    id: "hn:2",
    title: "TinyAIArena",
    url: "https://tinyaiarena.com/",
    source: "Hacker News",
    publishedAt: "2026-09-27T15:00:00.000Z",
    score: 103,
  },
];

function apiSettings(overrides: Partial<ApiSummarizerSettings> = {}): ApiSummarizerSettings {
  return {
    providerBaseURL: "https://llm.example/v1",
    api: "openai",
    model: "glm-5.3-flash",
    apiKeyEnv: "SUMMARY_API_KEY",
    ...overrides,
  };
}

interface HarnessOptions {
  response?: { status: number; body: unknown };
  /** Exact response text, bypassing the chat-completions wrapper. */
  rawResponse?: { status: number; text: string };
  environment?: Record<string, string>;
  settings?: Partial<ApiSummarizerSettings>;
  rejectThinking?: boolean;
  rejectReasoningEffort?: boolean;
}

type RecordedRequest = { url: string; headers?: Record<string, string>; body?: string };

function harness(options: HarnessOptions = {}) {
  const requests: RecordedRequest[] = [];
  const readingRequests: RecordedRequest[] = [];
  const responseBody = options.response?.body ??
    '{"overview":"今日综述","items":[{"i":1,"summary":"OpenAI 暂停训练。"},{"i":2,"summary":"TinyAI 竞技场上线。"}]}';
  const respond = async (requestOptions: RecordedRequest) => {
    if (options.rawResponse !== undefined) {
      return { status: options.rawResponse.status, text: options.rawResponse.text };
    }
    const body = options.response?.body;
    if (options.response !== undefined && typeof body === "object" && body !== null && "errorStatus" in body) {
      return { status: (body as { errorStatus: number }).errorStatus, text: "" };
    }
    if (options.rejectThinking === true && (requestOptions.body ?? "").includes("thinking")) {
      return { status: 400, text: '{"error":"unknown parameter thinking"}' };
    }
    if (options.rejectReasoningEffort === true &&
      (requestOptions.body ?? "").includes("reasoning_effort")) {
      return { status: 400, text: '{"error":"unknown parameter reasoning_effort"}' };
    }
    const text = typeof body === "string"
      ? JSON.stringify({ choices: [{ message: { content: body } }] })
      : JSON.stringify(body ?? { choices: [{ message: { content: responseBody } }] });
    return { status: options.response?.status ?? 200, text };
  };
  const service = new ApiSummarizerService({
    request: async (requestOptions) => {
      requests.push(requestOptions);
      return respond(requestOptions);
    },
    // 解牌单独一条通道（长超时）；解牌测试要断言它真的走了这条。
    readingRequest: async (requestOptions) => {
      readingRequests.push(requestOptions);
      return respond(requestOptions);
    },
    settings: () => ({ ...createDefaultSettings(), apiSummarizer: apiSettings(options.settings) }),
    fetchNews: async () => NEWS,
    readEnvironment: (name) =>
      name in (options.environment ?? {}) ? options.environment?.[name] : "key-value",
    now: () => Date.parse("2026-09-28T12:00:00.000Z"),
    nonce: () => "fixed-session",
  });
  return { service, requests, readingRequests };
}

const DAY = "2026-09-28";

describe("ApiSummarizerService", () => {
  it("reports configuration completeness for the engine gate", () => {
    expect(harness().service.isConfigured()).toBe(true);
    expect(harness({ settings: { model: "" } }).service.isConfigured()).toBe(false);
    expect(harness({ settings: { providerBaseURL: "" } }).service.isConfigured()).toBe(false);
    expect(harness({ settings: { apiKeyEnv: "" } }).service.isConfigured()).toBe(false);
  });

  it("posts a session-routed request with thinking disabled and maps the brief", async () => {
    const { service, requests } = harness();
    const brief = await service.runDailyBrief(DAY);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://llm.example/v1/chat/completions");
    expect(requests[0]?.headers?.authorization).toBe("Bearer key-value");
    expect(requests[0]?.headers?.["x-opencode-session"]).toBe("fixed-session");
    const body = JSON.parse(requests[0]?.body ?? "{}") as {
      model: string;
      thinking: unknown;
      messages: unknown[];
    };
    expect(body.model).toBe("glm-5.3-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages).toHaveLength(2);
    // The prompt contract is part of shipping: structure, length, and plain-text rules.
    const systemPrompt = (body.messages[0] as { content: string }).content;
    expect(systemPrompt).toContain("【今日主线】");
    expect(systemPrompt).toContain("【关键进展】");
    expect(systemPrompt).toContain("【值得关注】");
    expect(systemPrompt).toContain("750–900 字");
    expect(systemPrompt).toContain("不使用 Markdown 标记");
    expect(systemPrompt).toContain("小标题独占一行");
    expect(systemPrompt).toContain("格式硬性要求");
    expect(systemPrompt).toContain("不要省略任何标题");
    expect(brief.date).toBe(DAY);
    expect(brief.items).toHaveLength(2);
    expect(brief.items[0]).toEqual({
      title: "OpenAI pauses training",
      url: "https://apnews.com/a",
      source: "Hacker News",
      summary: "OpenAI 暂停训练。",
    });
  });

  it("retries once without the thinking switch when the provider rejects it", async () => {
    const { service, requests } = harness({ rejectThinking: true });
    const brief = await service.runDailyBrief(DAY);

    expect(requests).toHaveLength(2);
    expect((requests[0]?.body ?? "").includes("thinking")).toBe(true);
    expect((requests[1]?.body ?? "").includes("thinking")).toBe(false);
    expect(brief.items).toHaveLength(2);
  });

  it("accepts an {overview, items} wrapper and strips code fences", async () => {
    const body = "```json\n{\"overview\":\"O\",\"items\":[{\"i\":1,\"summary\":\"A\"},{\"i\":2,\"summary\":\"B\"}]}\n```";
    const { service } = harness({ response: { status: 200, body } });
    const brief = await service.runDailyBrief(DAY);
    expect(brief.overview).toBe("O");
    expect(brief.items.map((item) => item.summary)).toEqual(["A", "B"]);
  });

  it("refuses to run without the full configuration", async () => {
    const { service } = harness({ settings: { providerBaseURL: "" } });
    await expect(service.runDailyBrief(DAY)).rejects.toBeInstanceOf(ApiSummarizerUnavailableError);
  });

  it("fails with a named error when the env key is missing", async () => {
    const { service } = harness({ environment: { SUMMARY_API_KEY: "" } });
    await expect(service.runDailyBrief(DAY)).rejects.toBeInstanceOf(ApiKeyMissingError);
  });

  it("surfaces the HTTP status and redacts secrets from provider text", async () => {
    const { service } = harness({
      rawResponse: { status: 401, text: "authorization: Bearer sk-secret-123 rejected" },
    });
    await expect(service.runDailyBrief(DAY)).rejects.toThrow("HTTP 401");
    await expect(service.runDailyBrief(DAY)).rejects.not.toThrow("sk-secret-123");
  });

  it("rejects summaries that reference unknown items or drift titles", async () => {
    const drift = { choices: [{ message: { content: '{"overview":"O","items":[{"i":9,"summary":"X"}]}' } }] };
    await expect(harness({ response: { status: 200, body: drift } }).service.runDailyBrief(DAY))
      .rejects.toBeInstanceOf(InvalidApiSummarizerOutputError);
    const retitled = {
      choices: [{ message: { content: '{"overview":"O","items":[{"i":1,"title":"Other","summary":"A"}]}' } }],
    };
    await expect(harness({ response: { status: 200, body: retitled } }).service.runDailyBrief(DAY))
      .rejects.toBeInstanceOf(InvalidApiSummarizerOutputError);
  });

  it("accepts a lightly paraphrased echo and still renders the source title and URL", async () => {
    const paraphrased = {
      choices: [{ message: { content:
        '{"overview":"O","items":[{"i":1,"title":"OpenAI pauses the training","summary":"甲"},' +
        '{"i":2,"title":"TinyAIArena","summary":"乙"}]}' } }],
    };
    const brief = await harness({ response: { status: 200, body: paraphrased } })
      .service.runDailyBrief(DAY);
    expect(brief.items[0]).toEqual({
      title: "OpenAI pauses training",
      url: "https://apnews.com/a",
      source: "Hacker News",
      summary: "甲",
    });
  });

  it("still rejects an unrelated title and a drifted URL", async () => {
    const unrelated = {
      choices: [{ message: { content:
        '{"overview":"O","items":[{"i":1,"title":"Completely different story","summary":"甲"}]}' } }],
    };
    await expect(harness({ response: { status: 200, body: unrelated } }).service.runDailyBrief(DAY))
      .rejects.toBeInstanceOf(InvalidApiSummarizerOutputError);

    const driftedUrl = {
      choices: [{ message: { content:
        '{"overview":"O","items":[{"i":1,"url":"https://evil.example/x","summary":"甲"}]}' } }],
    };
    await expect(harness({ response: { status: 200, body: driftedUrl } }).service.runDailyBrief(DAY))
      .rejects.toBeInstanceOf(InvalidApiSummarizerOutputError);
  });
  it("rejects non-JSON content and rejects an invalid runner date", async () => {
    await expect(
      harness({ response: { status: 200, body: { choices: [{ message: { content: "not json" } }] } } })
        .service.runDailyBrief(DAY),
    ).rejects.toBeInstanceOf(InvalidApiSummarizerOutputError);
    await expect(harness().service.runDailyBrief("2026-02-30")).rejects.toBeInstanceOf(ApiSummarizerError);
  });

  it("runs a reading with thinking enabled at the highest reasoning effort", async () => {
    const { service, requests, readingRequests } = harness({
      response: { status: 200, body: "牌面在说：先收，再放。" },
    });
    const text = await service.runDivinationReading({ system: "S", user: "U" });

    expect(text).toBe("牌面在说：先收，再放。");
    // 解牌走长超时那条通道，摘要通道一次都不该被碰。
    expect(requests).toHaveLength(0);
    expect(readingRequests).toHaveLength(1);
    const body = JSON.parse(readingRequests[0]?.body ?? "{}") as {
      thinking: unknown;
      reasoning_effort: unknown;
      temperature: number;
    };
    expect(body.thinking).toEqual({ type: "enabled" });
    expect(body.reasoning_effort).toBe("max");
    expect(body.temperature).toBe(0.55);
  });

  it("drops reasoning_effort first and never downgrades a reading to thinking disabled", async () => {
    const { service, readingRequests: requests } = harness({
      rejectReasoningEffort: true,
      response: { status: 200, body: "解牌正文" },
    });
    const text = await service.runDivinationReading({ system: "S", user: "U" });

    expect(text).toBe("解牌正文");
    expect(requests).toHaveLength(2);
    expect((requests[1]?.body ?? "").includes("reasoning_effort")).toBe(false);
    const secondAttempt = JSON.parse(requests[1]?.body ?? "{}") as { thinking?: unknown };
    expect(secondAttempt.thinking).toEqual({ type: "enabled" });
    // 降级只减参数：解牌任何一次尝试都不许把思考关掉。
    expect(requests.some((attempt) => (attempt.body ?? "").includes('"disabled"'))).toBe(false);
  });

  it("keeps a reading running when the gateway rejects every thinking parameter", async () => {
    const { service, readingRequests: requests } = harness({
      rejectThinking: true,
      response: { status: 200, body: "解牌正文" },
    });
    const text = await service.runDivinationReading({ system: "S", user: "U" });

    expect(text).toBe("解牌正文");
    expect(requests).toHaveLength(3);
    expect(requests.some((attempt) => (attempt.body ?? "").includes('"disabled"'))).toBe(false);
  });

  it("runText returns the assistant text and keeps the session header", async () => {
    const { service, requests } = harness({
      response: { status: 200, body: { choices: [{ message: { content: "# 报告\n正文" } }] } },
    });
    const text = await service.runText("写个报告");
    expect(text).toBe("# 报告\n正文");
    expect(requests[0]?.headers?.["x-opencode-session"]).toBe("fixed-session");
  });

  it("runText rejects empty output", async () => {
    const { service } = harness({
      response: { status: 200, body: { choices: [{ message: { content: "  " } }] } },
    });
    await expect(service.runText("写个报告")).rejects.toBeInstanceOf(InvalidApiSummarizerOutputError);
  });
});