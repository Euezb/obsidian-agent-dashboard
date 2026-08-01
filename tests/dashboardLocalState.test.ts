import { describe, expect, it } from "vitest";
import type { LocalDashboardData } from "../src/features/vault/VaultScanner";
import {
  LOCAL_SCAN_ERROR_MESSAGE,
  applyLocalError,
  applyLocalScan,
  createLoadingDashboardState,
} from "../src/view/localDashboardState";

const local: LocalDashboardData = {
  tasks: [{ id: "A.md:0", path: "A.md", line: 0, text: "A", completed: false }],
  recentNotes: [{ path: "A.md", title: "A", modifiedAt: 1 }],
  heatmap: [{ date: "2026-06-29", count: 1 }],
  health: {
    score: 100,
    breakdown: { frontmatter: 20, links: 25, tags: 15, activity: 20, inbox: 20 },
    suggestions: [],
    insufficientData: false,
  },
};

describe("dashboard local state", () => {
  it("starts local and external modules loading without displaying mock feeds", () => {
    const state = createLoadingDashboardState();

    expect([state.tasks.status, state.recentNotes.status, state.heatmap.status, state.health.status]).toEqual([
      "loading", "loading", "loading", "loading",
    ]);
    expect(state.tasks.data).toEqual([]);
    expect(state.health.data).toBeNull();
    expect(state.aiNews).toEqual({ status: "loading", data: [] });
    expect(state.githubDaily).toEqual({ status: "loading", data: [] });
    expect(state.githubWeekly).toEqual({ status: "loading", data: [] });
  });

  it("applies one scan timestamp to all four ready local modules", () => {
    const state = applyLocalScan(createLoadingDashboardState(), local, 1234);

    expect(state.tasks).toEqual({ status: "ready", data: local.tasks, updatedAt: 1234 });
    expect(state.recentNotes).toEqual({ status: "ready", data: local.recentNotes, updatedAt: 1234 });
    expect(state.heatmap).toEqual({ status: "ready", data: local.heatmap, updatedAt: 1234 });
    expect(state.health).toEqual({ status: "ready", data: local.health, updatedAt: 1234 });
  });

  it("marks only local modules with a stable error message", () => {
    const loading = createLoadingDashboardState();
    const state = applyLocalError(loading);

    for (const module of [state.tasks, state.recentNotes, state.heatmap, state.health]) {
      expect(module.status).toBe("error");
      expect(module.message).toBe(LOCAL_SCAN_ERROR_MESSAGE);
    }
    expect(state.aiNews).toEqual({ status: "loading", data: [] });
  });
});
