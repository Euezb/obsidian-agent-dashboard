import type {
  ExternalDashboardState,
  FeedStateListener,
  RetryableExternalModule,
} from "../features/feeds/FeedService";

type OpenFeed = (listener: FeedStateListener) => Promise<void>;
type RetryFeed = (
  module: RetryableExternalModule,
  listener: FeedStateListener,
) => Promise<void>;

export class ExternalDashboardController {
  /** 会话代次：只在 close 递增，用来作废全部在途操作的结果。 */
  private generation = 0;
  /** 只用来作废上一次 open：open 与 retry 互不作废对方的在途结果。 */
  private openToken = 0;
  private isOpen = false;

  constructor(
    private readonly openFeed: OpenFeed,
    private readonly onState: (state: ExternalDashboardState) => void,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly retryFeed?: RetryFeed,
  ) {}

  async open(): Promise<void> {
    this.isOpen = true;
    const token = ++this.openToken;
    const generation = this.generation;
    try {
      await this.openFeed((state) => {
        if (this.isOpen && token === this.openToken && generation === this.generation) {
          this.onState(state);
        }
      });
    } catch (error) {
      if (this.isOpen && token === this.openToken && generation === this.generation) {
        this.reportError(error);
      }
    }
  }

  async retry(module: RetryableExternalModule): Promise<void> {
    if (this.retryFeed === undefined) return;
    // 只比会话代次：retry 期间顺手 open() 一次不该把已经在跑的 retry 结果静默丢掉，
    // 那会让面板停在 loading，而且没有后续事件来纠正它。
    const generation = this.generation;
    try {
      await this.retryFeed(module, (state) => {
        if (this.isOpen && generation === this.generation) this.onState(state);
      });
    } catch (error) {
      if (this.isOpen && generation === this.generation) this.reportError(error);
    }
  }

  close(): void {
    this.isOpen = false;
    this.generation += 1;
    this.openToken += 1;
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Error observers are best-effort and must never reject fire-and-forget operations.
    }
  }
}
