import type { DashboardState } from "./types";

export function emptyDashboardState(): DashboardState {
  return {
    tasks: { status: "idle", data: [] },
    recentNotes: { status: "idle", data: [] },
    heatmap: { status: "idle", data: [] },
    health: { status: "idle", data: null },
    aiNews: { status: "idle", data: [] },
    githubDaily: { status: "idle", data: [] },
    githubWeekly: { status: "idle", data: [] },
    dailyBrief: { status: "idle", data: null },
  };
}
