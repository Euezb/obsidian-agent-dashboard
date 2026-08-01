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
  private generation = 0;
  private isOpen = false;

  constructor(
    private readonly openFeed: OpenFeed,
    private readonly onState: (state: ExternalDashboardState) => void,
    private readonly onError: (error: unknown) => void = () => undefined,
    private readonly retryFeed?: RetryFeed,
  ) {}

  async open(): Promise<void> {
    this.isOpen = true;
    const generation = ++this.generation;
    try {
      await this.openFeed((state) => {
        if (this.isOpen && generation === this.generation) this.onState(state);
      });
    } catch (error) {
      if (this.isOpen && generation === this.generation) this.reportError(error);
    }
  }

  async retry(module: RetryableExternalModule): Promise<void> {
    if (this.retryFeed === undefined) return;
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
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Error observers are best-effort and must never reject fire-and-forget operations.
    }
  }
}
