import type { AgentDashboardSettings } from "../../settings/settings";
import {
  buildDivinationReadingPrompt,
  DivinationReadingUnavailableError,
  divinationReadingCacheKey,
  parseDivinationReading,
  type DivinationReadingPort,
  type DivinationReadingPrompt,
  type DivinationReadingRequest,
} from "./divinationReading";

/**
 * 解卦服务:九个卜筮面板与「今日一牌」唯一要认的那一头。
 *
 * 缓存放在内存里,按「方法 + 种子 + 卦象指纹 + 问题」去重:
 * - 今日一牌:种子是本地日期,同一天里反复打开面板 / 每次心跳重渲染都只算一次;
 * - 卜筮:种子是这次起卦的输入(塔罗是抽牌 seed、八字是四柱、六爻是起卦输入…),
 *   重渲染、切方法、切面板都不重算,重新起一卦才重取。
 * 重开 Obsidian 会重新算一次(不落盘,免得多一个要和缓存清理对齐的文件);
 * 同一天同一张牌 / 同一卦的结果本来就该是一样的,这次重取只是多一次很短的调用。
 */

/** 真正发请求的那一头,由 ApiSummarizerService 实现。 */
export interface DivinationReadingGenerator {
  isConfigured(): boolean;
  runDivinationReading(prompt: DivinationReadingPrompt): Promise<string>;
}

export interface DivinationReadingServiceDependencies {
  generator: DivinationReadingGenerator;
  settings: () => AgentDashboardSettings;
}

/**
 * 解卦文本的定长缓存上限。一个长会话里每起一卦就多一条，不定长会只增不减；
 * 超上限时按写入顺序淘汰最早的一条。
 */
const MAX_CACHED_READINGS = 50;

export class DivinationReadingService implements DivinationReadingPort {
  private readonly cache = new Map<string, string>();
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(private readonly dependencies: DivinationReadingServiceDependencies) {}

  /** 三个条件缺一不可:卜筮开着、解卦开关开着、摘要那套接口配置齐了。 */
  isConfigured(): boolean {
    const settings = this.dependencies.settings();
    if (!settings.bushiEnabled || !settings.bushiReadingEnabled) return false;
    return this.dependencies.generator.isConfigured();
  }

  async read(request: DivinationReadingRequest): Promise<string> {
    if (!this.isConfigured()) throw new DivinationReadingUnavailableError();
    // 「问事文本发不发」只在这里说了算:调用方照常把问题给它,发不发由设置决定。
    const effective: DivinationReadingRequest = {
      ...request,
      includeQuestion: this.dependencies.settings().bushiReadingSendsQuestion,
    };
    const key = divinationReadingCacheKey(effective);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    // 同一卦的并发请求只调一次模型：起卦按钮被连点时，第二个请求等第一个的结果。
    const running = this.inFlight.get(key);
    if (running !== undefined) return running;

    const operation = (async (): Promise<string> => {
      const prompt = buildDivinationReadingPrompt(effective);
      const text = parseDivinationReading(
        await this.dependencies.generator.runDivinationReading(prompt),
      );
      this.remember(key, text);
      return text;
    })();
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key);
    }
  }

  /** 写入定长缓存：满员时先丢最早的那条。 */
  private remember(key: string, text: string): void {
    if (!this.cache.has(key) && this.cache.size >= MAX_CACHED_READINGS) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, text);
  }
}
