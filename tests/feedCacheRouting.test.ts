import { describe, expect, it } from "vitest";
import { FEED_CACHE_NAMES, VAULT_ROUTED_CACHE_NAMES } from "../src/features/feeds/FeedService";

/**
 * 路由名单的锚点。
 *
 * 这份名单原先硬编码在 main.ts 里（审查 D7）：改了缓存名、却忘了改名单，
 * 缓存就会静默落到另一个目录（沙箱化的 CLI 读不到 / 占用了同步空间）。
 * 名单挪到 FEED_CACHE_NAMES 旁边后，这条测试负责钉住它。
 */
describe("feed cache routing", () => {
  it("keeps only the AI news cache inside the Vault", () => {
    expect(VAULT_ROUTED_CACHE_NAMES.has(FEED_CACHE_NAMES.aiNews)).toBe(true);
    expect(VAULT_ROUTED_CACHE_NAMES.size).toBe(1);

    for (const name of [
      FEED_CACHE_NAMES.githubDaily,
      FEED_CACHE_NAMES.githubWeekly,
      FEED_CACHE_NAMES.dailyBrief,
    ]) {
      expect(VAULT_ROUTED_CACHE_NAMES.has(name)).toBe(false);
    }
  });
});
