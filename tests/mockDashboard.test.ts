import { describe, expect, it } from "vitest";
import { MOCK_DASHBOARD_STATE } from "../src/data/mockDashboard";

describe("mock dashboard state", () => {
  it("contains the approved deterministic mock data shape", () => {
    expect(MOCK_DASHBOARD_STATE.tasks.data).toHaveLength(4);
    expect(MOCK_DASHBOARD_STATE.recentNotes.data).toHaveLength(3);
    expect(MOCK_DASHBOARD_STATE.heatmap.data).toHaveLength(365);
    expect(MOCK_DASHBOARD_STATE.health.data?.score).toBe(86);
    expect(MOCK_DASHBOARD_STATE.aiNews.data).toHaveLength(3);
    expect(MOCK_DASHBOARD_STATE.githubDaily.data).toHaveLength(4);
    expect(MOCK_DASHBOARD_STATE.githubWeekly.data).toHaveLength(4);
  });

  it("marks every dashboard module as ready", () => {
    const statuses = [
      MOCK_DASHBOARD_STATE.tasks.status,
      MOCK_DASHBOARD_STATE.recentNotes.status,
      MOCK_DASHBOARD_STATE.heatmap.status,
      MOCK_DASHBOARD_STATE.health.status,
      MOCK_DASHBOARD_STATE.aiNews.status,
      MOCK_DASHBOARD_STATE.githubDaily.status,
      MOCK_DASHBOARD_STATE.githubWeekly.status,
    ];

    expect(statuses.every((status) => status === "ready")).toBe(true);
  });

  it("uses a unique date for every heatmap entry", () => {
    const dates = MOCK_DASHBOARD_STATE.heatmap.data.map(({ date }) => date);

    expect(new Set(dates).size).toBe(365);
  });
});
