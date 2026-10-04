import type { DailyBrief, NewsItem } from "../../domain/types";
import type { AgentDashboardSettings } from "../../settings/settings";
import type { RequestPort } from "../../infrastructure/requestPort";
import { isCalendarDate } from "../../domain/localDate";

/**
 * Generates the daily brief and plain research reports through a
 * user-configured OpenAI-compatible endpoint. The API key never enters plugin
 * data: only the NAME of an environment variable is persisted, and the value is
 * resolved per request. Persistence of the produced brief belongs to FeedService.
 */

export interface ApiSummarizerDependencies {
  request: RequestPort;
  settings: () => AgentDashboardSettings;
  fetchNews: () => Promise<NewsItem[]>;
  /** Environment lookup so the key value never enters plugin data. */
  readEnvironment?: (name: string) => string | undefined;
  now?: () => number;
  /** Session-id source for the provider routing header. */
  nonce?: () => string;
}

const SYSTEM_PROMPT = [
  "你是一名资深 AI 新闻主编，为一位每天只看一次面板的读者撰写「今日摘要」。",
  "输入是今天的新闻列表（JSON 数组，字段 title/url/source/score）。",
  "输出一个 JSON 对象：{\"overview\": string, \"items\": [{\"i\":number,\"title\":string,\"url\":string,\"source\":string,\"summary\":string}]}，不要包裹代码围栏。",
  "",
  "overview 约 800 字（750–900 字），用简体中文纯文本，固定三段式，三段之间空一行：",
  "【今日主线】小标题独占一行、正文从下一行开始，150–180 字：概括今天新闻的整体走向，点出最重要的一两件事及其含义。",
  "【关键进展】小标题单独占一行；下面每条占一行、相互之间不空行，共 3–5 条，每条 60–90 字，形式为「1. 事件：影响」，写清具体公司、模型、产品、数字；同类新闻合并成一条，不要照抄原标题。",
  "【值得关注】小标题独占一行、正文从下一行开始，100–140 字：趋势判断、潜在影响，或需要留意的争议。",
  "格式硬性要求：overview 必须完整包含【今日主线】【关键进展】【值得关注】这三个方括号标题，每个标题独占一行、正文从下一行开始；",
  "不要省略任何标题，也不要用 Markdown 标题（##）、加粗（**）、纯冒号等替代写法，更不要写成「【今日主线】正文…」这种标题与正文同一行的形式。",
  "写作要求：概括性优先，提炼共性与因果，不做逐条罗列，让人读完就知道今天发生了什么；",
  "覆盖列表中的主要主题（score 高的优先），必要时把多条新闻归纳为一条进展；",
  "只能使用输入中已有的信息，不虚构、不补充外部知识；",
  "不使用 Markdown 标记（不要 #、**、- 和表格）；不要输出凭据或其他私人内容。",
  "",
  "items：为每一条新闻生成 summary，一句 20–60 字的中文概括；保留原始 title/url/source，不改写 URL。",
].join("\n");
const USER_PROMPT = (date: string, payload: string): string =>
  `今天是 ${date}。以下是候选新闻 JSON 数组。` +
  `请按系统提示的三段式写好 overview（约 800 字，【关键进展】的小标题与条目各占一行），并为每条输出 items 对象 ` +
  `{i,title,url,source,summary}（i 为输入序号，按输入顺序）：\n${payload}`;
const REPORT_SYSTEM_PROMPT =
  "你是一名严谨的研究助手。直接输出 Markdown 报告正文，不要输出代码围栏，不要输出凭据或其他私人内容。";

/** Providers that reject unknown parameters may refuse the thinking switch. */
const THINKING_DISABLED = { type: "disabled" };

export class ApiSummarizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiSummarizerError";
  }
}

export class ApiSummarizerUnavailableError extends ApiSummarizerError {
  constructor() {
    super("API 摘要未配置完整（需要接口地址、模型、密钥环境变量名）。");
    this.name = "ApiSummarizerUnavailableError";
  }
}

export class ApiKeyMissingError extends ApiSummarizerError {
  constructor(envName: string) {
    super(`环境变量 ${envName} 未设置，无法调用 API 摘要。`);
    this.name = "ApiKeyMissingError";
  }
}

export class InvalidApiSummarizerOutputError extends ApiSummarizerError {
  constructor() {
    super("API 返回的 JSON 不符合摘要结构。");
    this.name = "InvalidApiSummarizerOutputError";
  }
}

const SECRET_PATTERN = /(api[_-]?key|authorization|bearer|token|secret|password|credential)[^,\s"]{0,200}/gi;

/** Drops secret-looking spans before they reach a panel message. */
function redactSecrets(text: string): string {
  return text.replace(SECRET_PATTERN, "[redacted]").replace(/\s+/g, " ").trim();
}

function summarizeHttpFailure(status: number, body: string): string {
  const head = redactSecrets(body.slice(0, 200));
  return `HTTP ${status}${head === "" ? "" : `:${head}`}`;
}

/** Strips the common ```json fences a model may wrap its answer in. */
function stripFences(text: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text.trim());
  return (fenced?.[1] ?? text).trim();
}

/** Pulls the assistant text out of a chat-completions response body. */
function extractContent(raw: string): string | undefined {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return undefined; }
  if (typeof parsed === "string") return parsed;
  if (typeof parsed === "object" && parsed !== null && "choices" in parsed) {
    const first = (parsed as { choices?: Array<{ message?: { content?: string } }> }).choices?.[0];
    return typeof first?.message?.content === "string" ? first.message.content : undefined;
  }
  return undefined;
}

/** Maps the model's {overview, items} answer onto the original news items. */
function parseBrief(raw: string, date: string, source: readonly NewsItem[]): DailyBrief {
  if (!isCalendarDate(date)) throw new ApiSummarizerError("Invalid runner date.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new InvalidApiSummarizerOutputError(); }
  const wrapper = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : null;
  const overview = typeof wrapper?.overview === "string" ? wrapper.overview.trim() : "";
  if (overview === "" || overview.length > 8_192) throw new InvalidApiSummarizerOutputError();
  const value = Array.isArray(wrapper?.items) ? (wrapper as { items: unknown[] }).items : undefined;
  if (value === undefined || value.length < 1 || value.length > 20) {
    throw new InvalidApiSummarizerOutputError();
  }
  const byIndex = new Map<string, NewsItem>();
  source.forEach((item, index) => { byIndex.set(String(index + 1), item); });
  const items = value.map((candidate): DailyBrief["items"][number] => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new InvalidApiSummarizerOutputError();
    }
    const record = candidate as Record<string, unknown>;
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    if (summary === "" || summary.length > 4_096) throw new InvalidApiSummarizerOutputError();
    const index = typeof record.i === "string" || typeof record.i === "number"
      ? String(record.i)
      : "";
    const reference = byIndex.get(index);
    if (reference === undefined) throw new InvalidApiSummarizerOutputError();
    // Echoed fields are alignment hints: the URL must be exact, the title may be
    // lightly paraphrased because the rendered text comes from the source item.
    if (record.url !== undefined &&
      (typeof record.url !== "string" ||
        normalizeComparableUrl(record.url) !== normalizeComparableUrl(reference.url))) {
      throw new InvalidApiSummarizerOutputError();
    }
    if (record.title !== undefined &&
      (typeof record.title !== "string" || !isSameTitle(record.title, reference.title))) {
      throw new InvalidApiSummarizerOutputError();
    }
    return {
      title: reference.title,
      url: reference.url,
      source: reference.source,
      summary,
    };
  });
  return { date, generatedAt: 0, overview, items };
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path}`;
}

function normalizeComparableUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/** Lowercase, and keep only letters/digits/CJK so punctuation never decides a match. */
function normalizeComparableTitle(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Models paraphrase the echoed title now and then ("…agents it out" for
 * "…agents battle it out"). Because the summary is attached by index and the
 * rendered text always comes from the source item, a near-match is fine; only a
 * genuinely different story should be rejected.
 */
function isSameTitle(candidate: string, reference: string): boolean {
  const left = normalizeComparableTitle(candidate);
  const right = normalizeComparableTitle(reference);
  if (left === right) return true;
  if (left === "" || right === "") return false;
  const leftTokens = new Set(left.split(" "));
  const rightTokens = new Set(right.split(" "));
  let shared = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) shared += 1;
  }
  // 0.6 tolerates a dropped/inserted word; unrelated stories share far fewer tokens.
  return shared / Math.max(leftTokens.size, rightTokens.size) >= 0.6;
}

export class ApiSummarizerService {
  private readonly nonce: () => string;

  constructor(private readonly dependencies: ApiSummarizerDependencies) {
    this.nonce = dependencies.nonce ?? (() => crypto.randomUUID());
  }

  isConfigured(): boolean {
    const api = this.dependencies.settings().apiSummarizer;
    return api.providerBaseURL !== "" && api.model !== "" && api.apiKeyEnv !== "";
  }

  /** Plain text completion used by the report commands. */
  async runText(prompt: string): Promise<string> {
    const content = await this.complete([
      { role: "system", content: REPORT_SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ]);
    const text = stripFences(content).trim();
    if (text === "") throw new InvalidApiSummarizerOutputError();
    return text;
  }

  /**
   * 塔罗解牌:同一个接口、同一套配置,但用另一套提示词与略高的温度。
   * 摘要要保守(只许用输入里的事实),解牌本来就是在牌义上做解释,
   * 0.2 那样低的温度会让每张牌都写成同一句套话。
   */
  async runDivinationReading(prompt: { system: string; user: string }): Promise<string> {
    const content = await this.complete(
      [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      { temperature: 0.55 },
    );
    const text = stripFences(content).trim();
    if (text === "") throw new InvalidApiSummarizerOutputError();
    return text;
  }

  async runDailyBrief(date: string): Promise<DailyBrief> {
    if (!isCalendarDate(date)) throw new ApiSummarizerError("Invalid runner date.");
    const source = await this.dependencies.fetchNews();
    if (source.length === 0) throw new ApiSummarizerError("没有可用于摘要的新闻。");
    const payload = JSON.stringify(source.map((item, index) => ({
      i: index + 1,
      title: item.title,
      url: item.url,
      source: item.source,
      score: item.score,
    })));
    const content = await this.complete([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: USER_PROMPT(date, payload) },
    ]);
    const brief = parseBrief(stripFences(content), date, source);
    return { ...brief, generatedAt: this.dependencies.now?.() ?? Date.now() };
  }

  /** Posts one chat-completions request, disabling thinking when supported. */
  private async complete(
    messages: Array<{ role: "system" | "user"; content: string }>,
    options: { temperature?: number } = {},
  ): Promise<string> {
    const api = this.dependencies.settings().apiSummarizer;
    if (api.providerBaseURL === "" || api.model === "" || api.apiKeyEnv === "") {
      throw new ApiSummarizerUnavailableError();
    }
    const apiKey = this.dependencies.readEnvironment?.(api.apiKeyEnv);
    if (apiKey === undefined || apiKey.trim() === "") throw new ApiKeyMissingError(api.apiKeyEnv);
    const request = (withThinking: boolean) => this.dependencies.request({
      url: joinUrl(api.providerBaseURL, "chat/completions"),
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey.trim()}`,
        // OpenCode-family gateways route on it; OpenAI-compatible servers ignore it.
        "x-opencode-session": this.nonce(),
      },
      body: JSON.stringify({
        model: api.model,
        messages,
        temperature: options.temperature ?? 0.2,
        ...(withThinking ? { thinking: THINKING_DISABLED } : {}),
      }),
    });
    let response = await request(true);
    if (response.status === 400) {
      // Some providers reject unknown parameters; retry once without the switch.
      response = await request(false);
    }
    if (response.status !== 200) {
      throw new ApiSummarizerError(summarizeHttpFailure(response.status, response.text));
    }
    const content = extractContent(response.text);
    if (content === undefined) throw new InvalidApiSummarizerOutputError();
    return content;
  }
}