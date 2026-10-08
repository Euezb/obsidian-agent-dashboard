import type { AgentDashboardSettings } from "../settings/settings";
import {
  dailyFortuneKey,
  loadDailyFortune,
  type DailyFortune,
} from "../features/divination/dailyFortune";
import { loadAlmanacCard, type AlmanacCard } from "../features/divination/almanacCard";
import { dailyTarotFacts } from "../features/divination/tarotFacts";
import type {
  DivinationReadingPort,
  DivinationReadingRequest,
} from "../features/divination/divinationReading";
import type { DivinationReadingViewState } from "./renderDivinationReading";
import { localDateKey } from "../domain/localDate";

export interface AsideDataDependencies {
  /** 解牌块页脚要写「哪个模型」，与摘要共用同一份接口配置。 */
  settings: () => AgentDashboardSettings;
  /** 解牌能力；宿主没接线时为 null，解牌块保持 idle。 */
  reading: () => DivinationReadingPort | null;
  /** 数据落地后的重渲染入口（视图的 renderCurrent）。 */
  onChanged: () => void;
}

/**
 * 头部黄历卡 + 「今日运势」+ 今日一牌解牌的取数、缓存键与在途守卫。
 *
 * 这三块原先直接长在 AgentDashboardView 上（审查 D4：视图类同时承担渲染、数据编排、
 * 缓存与持久化）。挪到这里之后，视图只留三个读取口（almanac / fortune / reading）
 * 和 refresh() / refreshReading() 调用，三套 token 语义集中在一处。

 * 与渲染解耦的一点：刷新本身不看卜筮开关 —— 开关只决定视图渲不渲染这两块，
 * 关掉期间照常跟着资讯节奏取数，重新打开时不会出现空洞。
 */
export class AsideDataController {
  private almanacCard: AlmanacCard | null = null;
  private almanacDateKey = "";
  private almanacToken = 0;

  private dailyFortune: DailyFortune | null = null;
  private dailyFortuneKey = "";
  /** 运势的在途序号：跨时辰/跨天可能连着触发两次，旧响应不许盖新的。 */
  private fortuneToken = 0;

  private fortuneReading: DivinationReadingViewState = { status: "idle" };
  private fortuneReadingKey = "";
  private fortuneReadingToken = 0;

  constructor(private readonly dependencies: AsideDataDependencies) {}

  /** 头部黄历卡；未取到时为 null。 */
  get almanac(): AlmanacCard | null {
    return this.almanacCard;
  }

  /** 「今日运势」的算据；未取到时为 null。 */
  get fortune(): DailyFortune | null {
    return this.dailyFortune;
  }

  /** 今日一牌的解牌状态。 */
  get reading(): DivinationReadingViewState {
    return this.fortuneReading;
  }

  /** 打开面板与每次外部刷新都调一次：黄历跨天、运势跨天/跨时辰才真正重算。 */
  refresh(): void {
    this.refreshAlmanac();
    // 资讯刷新与「今日运势」同一节奏:跨天换牌、跨时辰换课。
    this.refreshFortune();
  }

  /** 显示类设置刚被改过（例如刚填好接口）：补一次解牌。 */
  refreshReading(force = false): void {
    this.refreshFortuneReading(force);
  }

  /**
   * 「今日运势」按「本地日期 + 时辰」缓存:打开面板与每次外部刷新时检查,
   * 跨天或跨时辰才重算。计算失败保留上一次结果,不让板块出现空洞。
   */
  private refreshFortune(): void {
    const now = new Date();
    const key = dailyFortuneKey(now);
    if (key === this.dailyFortuneKey && this.dailyFortune !== null) return;
    const token = ++this.fortuneToken;
    void loadDailyFortune(now)
      .then((fortune) => {
        // 期间又跨了一个时辰：这次的结果已经过期，写回就会盖掉新的那一课。
        if (token !== this.fortuneToken) return;
        this.dailyFortune = fortune;
        this.dailyFortuneKey = key;
        this.refreshFortuneReading();
        this.dependencies.onChanged();
      })
      .catch(() => {
        // 保留上一次结果:下一次刷新或重启会再试。
      });
  }

  /**
   * 今日一牌的解牌:按日期取一次,失败保留牌面并给重试。
   *
   * 与牌面同一节奏 —— 跨天换牌时重取;session 里已经有同一张牌的解牌就不再请求
   * (服务里还有一层按「日期 + 牌面指纹」的缓存兜住重复渲染)。
   * 接口没配好时不发请求、也不在面板上写「由大模型生成」,页脚保持本地口径。
   */
  private refreshFortuneReading(force = false): void {
    const port = this.dependencies.reading();
    const fortune = this.dailyFortune;
    if (port === null || fortune === null) return;
    if (!port.isConfigured()) {
      this.fortuneReading = { status: "idle" };
      this.fortuneReadingKey = fortune.dateKey;
      return;
    }
    if (!force && this.fortuneReadingKey === fortune.dateKey &&
      this.fortuneReading.status !== "idle" && this.fortuneReading.status !== "error") {
      return;
    }
    this.fortuneReadingKey = fortune.dateKey;
    this.fortuneReadingToken += 1;
    const token = this.fortuneReadingToken;
    const request: DivinationReadingRequest = {
      kind: "daily",
      method: "tarot",
      cacheKey: fortune.dateKey,
      momentText: fortune.dateKey,
      // 今日一牌没有问事输入:解牌只看牌面与日期。
      question: "",
      facts: dailyTarotFacts(fortune.tarot),
    };
    this.fortuneReading = { status: "loading" };
    this.dependencies.onChanged();
    void port.read(request)
      .then((text) => {
        if (token !== this.fortuneReadingToken) return;
        this.fortuneReading = {
          status: "ready",
          text,
          meta: this.readingMeta(),
          onRetry: () => this.refreshFortuneReading(true),
          // 今日一牌通常不到折叠线;真写长了(模型没守字数)也得让人能展开。
          onToggleExpand: () => {
            this.fortuneReading = {
              ...this.fortuneReading,
              expanded: this.fortuneReading.expanded !== true,
            };
            this.dependencies.onChanged();
          },
        };
        this.dependencies.onChanged();
      })
      .catch((error: unknown) => {
        if (token !== this.fortuneReadingToken) return;
        const message = error instanceof Error && error.message !== ""
          ? error.message
          : "解卦失败，可稍后重试。";
        this.fortuneReading = {
          status: "error",
          message,
          onRetry: () => this.refreshFortuneReading(true),
        };
        this.dependencies.onChanged();
      });
  }

  /** 解牌块口径小字:哪个模型、什么时候生成的。 */
  private readingMeta(): string {
    const model = this.dependencies.settings().apiSummarizer.model;
    const time = new Date();
    const clock = `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
    return [model, `${clock} 生成`].filter((part) => part !== "").join(" · ");
  }

  /**
   * 黄历卡按本地日期键缓存:打开面板与每次外部刷新时检查,跨天才真正重算。
   * 计算失败时保留上一次卡片,不让头部出现空洞。
   */
  private refreshAlmanac(): void {
    const now = new Date();
    const key = localDateKey(now);
    if (key === this.almanacDateKey && this.almanacCard !== null) return;
    const token = ++this.almanacToken;
    void loadAlmanacCard(now)
      .then((card) => {
        // 跨天时可能连着触发两次：先发起的那张卡片不许再写回。
        if (token !== this.almanacToken) return;
        this.almanacCard = card;
        this.almanacDateKey = key;
        this.dependencies.onChanged();
      })
      .catch(() => {
        // 保留旧卡片:下一次刷新或重启会再试。
      });
  }
}
