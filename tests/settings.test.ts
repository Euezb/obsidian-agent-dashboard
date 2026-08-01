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
    expect(DEFAULT_SETTINGS.rssFeeds).toEqual([]);
    expect(DEFAULT_SETTINGS.externalCacheTtlMinutes).toBe(60);
    expect(DEFAULT_SETTINGS.autoDailyCodexSummary).toBe(true);
    expect(DEFAULT_SETTINGS.codexExecutable).toBe("codex");
    expect(DEFAULT_SETTINGS.githubSecretName).toBe("");
    expect(DEFAULT_SETTINGS.lastCodexSummaryAttemptDate).toBe("");
  });

  it("is frozen together with its RSS feeds", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SETTINGS.rssFeeds)).toBe(true);
  });

  it("creates settings with isolated mutable RSS feed lists", () => {
    const first = createDefaultSettings();
    const second = createDefaultSettings();

    expect(first.rssFeeds).not.toBe(second.rssFeeds);
    first.rssFeeds.push("https://example.com/feed.xml");
    expect(second.rssFeeds).toEqual([]);
    expect(DEFAULT_SETTINGS.rssFeeds).toEqual([]);
  });

  it("merges saved values over all formal defaults", () => {
    const settings = mergeSettings({ dailyFolder: "Journal" });

    expect(settings).toEqual({
      ...createDefaultSettings(),
      dailyFolder: "Journal",
    });
    expect(Object.keys(settings)).toHaveLength(10);
  });

  it("keeps a valid internal Codex attempt date and rejects malformed values", () => {
    expect(mergeSettings({ lastCodexSummaryAttemptDate: "2026-06-29" })
      .lastCodexSummaryAttemptDate).toBe("2026-06-29");
    expect(mergeSettings({ lastCodexSummaryAttemptDate: "2026-02-30" })
      .lastCodexSummaryAttemptDate).toBe("");
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

  it("rejects unsafe persisted RSS, Codex executable, and secret key values", () => {
    const settings = mergeSettings({
      rssFeeds: ["https://example.com/feed", "file:///secret"],
      codexExecutable: "codex.cmd",
      githubSecretName: "GitHub Token",
    });

    expect(settings.rssFeeds).toEqual([]);
    expect(settings.codexExecutable).toBe(DEFAULT_SETTINGS.codexExecutable);
    expect(settings.githubSecretName).toBe("");
  });
});
