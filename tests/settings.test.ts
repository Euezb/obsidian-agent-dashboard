import { describe, expect, it } from "vitest";
import {
  createDefaultSettings,
  DEFAULT_SETTINGS,
  mergeSettings,
} from "../src/settings/settings";

describe("default settings", () => {
  it("uses all approved defaults", () => {
    expect(DEFAULT_SETTINGS.dailyFolder).toBe("Daily");
    expect(DEFAULT_SETTINGS.inboxFolder).toBe("Inbox");
    expect(DEFAULT_SETTINGS.reportsFolder).toBe("Reports");
    expect(DEFAULT_SETTINGS.cacheFolder).toBe("Dashboard/cache");
    expect(DEFAULT_SETTINGS.taskIncludeFolders).toEqual([]);
    expect(DEFAULT_SETTINGS.taskExcludeFolders).toEqual([]);
    expect(DEFAULT_SETTINGS.rssFeeds).toEqual([]);
    expect(DEFAULT_SETTINGS.externalCacheTtlMinutes).toBe(60);
    expect(DEFAULT_SETTINGS.autoDailySummary).toBe(true);

    expect(DEFAULT_SETTINGS.githubSecretName).toBe("");
    expect(DEFAULT_SETTINGS.lastSummaryAttemptDate).toBe("");
  });

  it("is frozen together with its RSS feeds and task folders", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.rssFeeds)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.taskIncludeFolders)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.taskExcludeFolders)).toBe(true);
  });

  it("creates settings with isolated mutable RSS feed lists", () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();

    expect(first.rssFeeds).not.toBe(second.rssFeeds);
    first.rssFeeds.push("https://example.com/feed.xml");
    expect(second.rssFeeds).toEqual([]);
    expect(DEFAULT_SETTINGS.rssFeeds).toEqual([]);
  });

  it("creates settings with isolated mutable task folder lists", () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();

    expect(first.taskIncludeFolders).not.toBe(second.taskIncludeFolders);
    expect(first.taskExcludeFolders).not.toBe(second.taskExcludeFolders);
    first.taskIncludeFolders.push("Daily");
    expect(second.taskIncludeFolders).toEqual([]);
    expect(DEFAULT_SETTINGS.taskIncludeFolders).toEqual([]);
  });

  it("merges saved values over all formal defaults", () => {
    const settings = mergeSettings({ dailyFolder: "Journal" });

    expect(settings).toEqual({
      ...createDefaultSettings(),
      dailyFolder: "Journal",
    });
    expect(Object.keys(settings)).toHaveLength(17);
  });

  it("defaults the divination reading switches on and accepts explicit values", () => {
    const defaults = createDefaultSettings();
    expect(defaults.bushiReadingEnabled).toBe(true);
    expect(defaults.bushiReadingSendsQuestion).toBe(true);

    const saved = mergeSettings({
      bushiReadingEnabled: false,
      bushiReadingSendsQuestion: false,
    });
    expect(saved.bushiReadingEnabled).toBe(false);
    expect(saved.bushiReadingSendsQuestion).toBe(false);

    // 脏数据不该把开关打开或关掉:只认真正的布尔值。
    const dirty = mergeSettings({
      bushiReadingEnabled: "no",
      bushiReadingSendsQuestion: 0,
    });
    expect(dirty.bushiReadingEnabled).toBe(true);
    expect(dirty.bushiReadingSendsQuestion).toBe(true);
  });

  it("keeps reading an old 塔罗解牌 switch so an upgrade cannot silently switch it on", () => {
    // 0.2.0 的键名只覆盖塔罗;0.3.0 起覆盖卜筮全部方法。用户当初关掉过就得继续关着。
    const legacyOff = mergeSettings({
      tarotReadingEnabled: false,
      tarotReadingSendsQuestion: false,
    });
    expect(legacyOff.bushiReadingEnabled).toBe(false);
    expect(legacyOff.bushiReadingSendsQuestion).toBe(false);

    // 新键优先于旧键。
    const both = mergeSettings({ tarotReadingEnabled: false, bushiReadingEnabled: true });
    expect(both.bushiReadingEnabled).toBe(true);

    // 升级后写回的新键照常生效。
    const upgraded = mergeSettings({ bushiReadingEnabled: false });
    expect(upgraded.bushiReadingEnabled).toBe(false);
  });

  it("clamps a dragged 今天 column width and keeps 0 as the responsive default", () => {
    expect(mergeSettings({ todayNotesWidth: 9999 }).todayNotesWidth).toBe(1200);
    expect(mergeSettings({ discoveryRankingWidth: 12 }).discoveryRankingWidth).toBe(240);
    expect(mergeSettings({ todayNotesWidth: 12 }).todayNotesWidth).toBe(240);
    expect(mergeSettings({ todayNotesWidth: 372.6 }).todayNotesWidth).toBe(373);
    expect(mergeSettings({ todayNotesWidth: 0 }).todayNotesWidth).toBe(0);
    expect(mergeSettings({ todayNotesWidth: Number.NaN }).todayNotesWidth).toBe(0);
    expect(mergeSettings({ todayNotesWidth: "320" }).todayNotesWidth).toBe(0);
  });

  it("keeps the usable lines of a saved task folder list and drops only the unsafe ones", () => {
    const settings = mergeSettings({
      taskIncludeFolders: [String.raw`Daily\2026`, "Daily/2026", "Inbox"],
      taskExcludeFolders: ["Projects/Plans", "../outside"],
    });

    expect(settings.taskIncludeFolders).toEqual(["Daily/2026", "Inbox"]);
    // 一行坏路径不该让整张排除表落回空表：那等于把扫描范围悄悄放宽，
    // 正是被删掉的「整单拒绝」行为的反面（见 docs/fix-plan-2026-09-30.md 的 B6）。
    expect(settings.taskExcludeFolders).toEqual(["Projects/Plans"]);

    // 类型就不对的值仍然整项忽略、落回默认。
    const broken = mergeSettings({
      taskIncludeFolders: "Daily",
      taskExcludeFolders: ["Daily", 42],
    });
    expect(broken.taskIncludeFolders).toEqual([]);
    expect(broken.taskExcludeFolders).toEqual([]);
  });

  it("keeps a valid internal Codex attempt date and rejects malformed values", () => {
    expect(mergeSettings({ lastSummaryAttemptDate: "2026-06-29" })
      .lastSummaryAttemptDate).toBe("2026-06-29");
    expect(mergeSettings({ lastSummaryAttemptDate: "2026-02-30" })
      .lastSummaryAttemptDate).toBe("");
  });

  it("copies valid saved RSS feeds without sharing references", () => {
    const savedFeeds = ["https://example.com/feed.xml"];
    const settings = mergeSettings({ rssFeeds: savedFeeds });

    expect(settings.rssFeeds).toEqual(savedFeeds);
    expect(settings.rssFeeds).not.toBe(savedFeeds);

    savedFeeds.push("https://example.com/second.xml");
    expect(settings.rssFeeds).toEqual(["https://example.com/feed.xml"]);
  });

  it("falls back to an isolated default list for invalid saved RSS feeds", () => {
    const first = mergeSettings({ rssFeeds: ["https://example.com/feed.xml", 42] });
    const second = mergeSettings({ rssFeeds: "https://example.com/feed.xml" });

    expect(first.rssFeeds).toEqual([]);
    expect(second.rssFeeds).toEqual([]);
    expect(first.rssFeeds).not.toBe(second.rssFeeds);
  });

  it("sanitizes persisted user-controlled paths and TTL before services are constructed", () => {
    const settings = mergeSettings({
      dailyFolder: String.raw`Journal\2026`,
      inboxFolder: "../outside",
      reportsFolder: String.raw`C:\Reports`,
      cacheFolder: "Dashboard/./cache",
      externalCacheTtlMinutes: 9_999,
    });

    expect(settings.dailyFolder).toBe("Journal/2026");
    expect(settings.inboxFolder).toBe(DEFAULT_SETTINGS.inboxFolder);
    expect(settings.reportsFolder).toBe(DEFAULT_SETTINGS.reportsFolder);
    expect(settings.cacheFolder).toBe(DEFAULT_SETTINGS.cacheFolder);
    expect(settings.externalCacheTtlMinutes).toBe(1_440);
  });

  it("rejects unsafe persisted RSS and secret key values", () => {
    const settings = mergeSettings({
      rssFeeds: ["https://example.com/feed", "file:///secret"],
      githubSecretName: "GitHub Token",
    });

    expect(settings.rssFeeds).toEqual([]);
    expect(settings.githubSecretName).toBe("");
    expect(settings.apiSummarizer.model).toBe("deepseek-v4.1-flash");
  });
});
