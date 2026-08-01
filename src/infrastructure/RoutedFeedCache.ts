import type { CacheEnvelope, CacheReadResult, DataGuard } from "../domain/cacheSchemas";
import type { FeedCachePort } from "../features/feeds/FeedService";

/**
 * Routes cache entries to different physical locations by cache name. Codex
 * inputs (e.g. ai-news-sources) must stay inside the Vault so the sandboxed
 * CLI can read them; everything else lives in the plugin data folder so it
 * stays out of sync, search, and the graph.
 */
export class RoutedFeedCache implements FeedCachePort {
  constructor(
    private readonly vaultCache: FeedCachePort,
    private readonly dataCache: FeedCachePort,
    private readonly vaultNames: ReadonlySet<string>,
  ) {}

  read<T>(name: string, guard: DataGuard<T>): Promise<CacheReadResult<T>> {
    return this.route(name).read(name, guard);
  }

  write<T>(name: string, envelope: CacheEnvelope<T>): Promise<void> {
    return this.route(name).write(name, envelope);
  }

  private route(name: string): FeedCachePort {
    return this.vaultNames.has(name) ? this.vaultCache : this.dataCache;
  }
}
