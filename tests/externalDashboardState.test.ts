import { describe, expect, it } from "vitest";
import type { ExternalDashboardState } from "../src/features/feeds/FeedService";
import {
  applyExternalSnapshot,
  dashboardAutomationStatus,
  latestDashboardUpdate,
} from "../src/view/externalDashboardState";
import { createLoadingDashboardState } from "../src/view/localDashboardState";

const weekly = [{
  name: "openai/codex",
  url: "https://github.com/openai/codex",
  description: "Agent",
  stars: 1,
  source: "github-trending" as const,
}];

describe("applyExternalSnapshot", () => {
  it("replaces only the three displayed external modules", () => {
    const external: ExternalDashboardState = {
      aiNews: { status: "error", data: [], message: "offline" },
      githubDaily: { status: "loading", data: [] },
      githubWeekly: { status: "stale", data: weekly, message: "暂时使用缓存" },
      dailyBrief: { status: "ready", data: null },
    };

    const base = createLoadingDashboardState();
    const result = applyExternalSnapshot(base, external);

    expect(result.aiNews).toBe(external.aiNews);
    expect(result.githubDaily).toBe(external.githubDaily);
    expect(result.githubWeekly).toBe(external.githubWeekly);
    expect(result.tasks).toBe(base.tasks);
  });

  it("prefers a current local-day brief without losing its summary", () => {
    const external: ExternalDashboardState = {
      aiNews: { status: "ready", data: [{
        id: "source", title: "Source", url: "https://example.com/source",
        source: "HN", publishedAt: "2026-06-29T00:00:00.000Z",
      }] },
      githubDaily: { status: "loading", data: [] },
      githubWeekly: { status: "loading", data: [] },
      dailyBrief: {
        status: "ready",
        updatedAt: 2_000,
        data: {
          date: "2026-06-29",
          generatedAt: new Date(2026, 5, 29, 12).getTime(),
          overview: "今日综述",
          items: [{
            title: "Brief item",
            url: "https://example.com/brief",
            source: "Daily brief",
            summary: "What matters",
          }],
        },
      },
    };

    const result = applyExternalSnapshot(
      createLoadingDashboardState(), external, new Date(2026, 5, 29, 18).getTime(),
    );

    expect(result.aiNews).toEqual({
      status: "ready",
      updatedAt: new Date(2026, 5, 29, 12).getTime(),
      data: [{
        id: "brief:2026-06-29:0",
        title: "Brief item",
        url: "https://example.com/brief",
        source: "Daily brief",
        summary: "What matters",
        publishedAt: new Date(2026, 5, 29, 12).toISOString(),
      }],
    });
    expect(result.dailyBrief).toBe(external.dailyBrief);
  });

  it("ignores a previous-day brief and preserves source headlines", () => {
    const sourceItem = {
      id: "hn:1",
      title: "Source item",
      url: "https://example.com/source",
      source: "Hacker News",
      publishedAt: "2026-06-29T00:00:00.000Z",
    };
    const external: ExternalDashboardState = {
      aiNews: { status: "loading", data: [sourceItem], updatedAt: 1_000 },
      githubDaily: { status: "loading", data: [] },
      githubWeekly: { status: "loading", data: [] },
      dailyBrief: {
        status: "ready",
        data: {
          date: "2026-06-29",
          generatedAt: new Date(2026, 5, 28, 23).getTime(),
          overview: "昨日综述",
          items: [{ title: "Brief", url: "https://example.com/brief", source: "Brief", summary: "Summary" }],
        },
      },
    };

    const result = applyExternalSnapshot(
      createLoadingDashboardState(), external, new Date(2026, 5, 29, 8).getTime(),
    );

    expect(result.aiNews).toBe(external.aiNews);
  });
});

describe("latestDashboardUpdate", () => {
  it("uses the newest finite timestamp across local and external modules", () => {
    const state = createLoadingDashboardState();
    state.tasks = { status: "ready", data: [], updatedAt: 1_000 };
    state.aiNews = { status: "ready", data: [], updatedAt: 3_000 };
    state.githubDaily = { status: "ready", data: [], updatedAt: Number.NaN };

    expect(latestDashboardUpdate(state)).toBe(3_000);
  });
});

describe("dashboardAutomationStatus", () => {
  it("does not announce completion while the daily summary is running", () => {
    const state = createLoadingDashboardState();
    state.aiNews = { status: "ready", data: [] };
    state.githubDaily = { status: "ready", data: [] };
    state.githubWeekly = { status: "ready", data: [] };
    state.dailyBrief = { status: "loading", data: null };

    expect(dashboardAutomationStatus(state)).toBe("正在生成今日摘要");
    state.dailyBrief = { status: "ready", data: null };
    expect(dashboardAutomationStatus(state)).toBe("自动更新完成");
  });
});
