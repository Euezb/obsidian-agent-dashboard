import { describe, expect, it } from "vitest";
import { emptyDashboardState } from "../src/domain/refreshState";

describe("empty dashboard state", () => {
  it("initializes every module with empty idle data", () => {
    const state = emptyDashboardState();
    const arrayData = [
      state.tasks.data,
      state.recentNotes.data,
      state.heatmap.data,
      state.aiNews.data,
      state.githubDaily.data,
      state.githubWeekly.data,
    ];
    const statuses = [
      state.tasks.status,
      state.recentNotes.status,
      state.heatmap.status,
      state.health.status,
      state.aiNews.status,
      state.githubDaily.status,
      state.githubWeekly.status,
    ];

    expect(statuses).toEqual([
      "idle",
      "idle",
      "idle",
      "idle",
      "idle",
      "idle",
      "idle",
    ]);
    expect(arrayData.every((data) => data.length === 0)).toBe(true);
    expect(state.health.data).toBeNull();
    expect(new Set(arrayData).size).toBe(arrayData.length);
  });

  it("does not share arrays across calls", () => {
    const first = emptyDashboardState();
    const second = emptyDashboardState();

    expect(first.tasks.data).not.toBe(second.tasks.data);
    expect(first.recentNotes.data).not.toBe(second.recentNotes.data);
    expect(first.heatmap.data).not.toBe(second.heatmap.data);
    expect(first.aiNews.data).not.toBe(second.aiNews.data);
    expect(first.githubDaily.data).not.toBe(second.githubDaily.data);
    expect(first.githubWeekly.data).not.toBe(second.githubWeekly.data);
  });
});
