import type { DashboardState } from "../domain/types";
import type { LocalDashboardData } from "../features/vault/VaultScanner";

export const LOCAL_SCAN_ERROR_MESSAGE = "本地 Vault 数据暂不可用。";

export function createLoadingDashboardState(): DashboardState {
  return {
    tasks: { status: "loading", data: [] },
    recentNotes: { status: "loading", data: [] },
    heatmap: { status: "loading", data: [] },
    health: { status: "loading", data: null },
    aiNews: { status: "loading", data: [] },
    githubDaily: { status: "loading", data: [] },
    githubWeekly: { status: "loading", data: [] },
    dailyBrief: { status: "idle", data: null },
  };
}

export function applyLocalScan(
  state: DashboardState,
  data: LocalDashboardData,
  updatedAt: number,
): DashboardState {
  return {
    ...state,
    tasks: { status: "ready", data: data.tasks, updatedAt },
    recentNotes: { status: "ready", data: data.recentNotes, updatedAt },
    heatmap: { status: "ready", data: data.heatmap, updatedAt },
    health: { status: "ready", data: data.health, updatedAt },
  };
}

export function applyLocalError(state: DashboardState): DashboardState {
  return {
    ...state,
    tasks: { status: "error", data: [], message: LOCAL_SCAN_ERROR_MESSAGE },
    recentNotes: { status: "error", data: [], message: LOCAL_SCAN_ERROR_MESSAGE },
    heatmap: { status: "error", data: [], message: LOCAL_SCAN_ERROR_MESSAGE },
    health: { status: "error", data: null, message: LOCAL_SCAN_ERROR_MESSAGE },
  };
}
