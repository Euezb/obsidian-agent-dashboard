export interface AgentDashboardSettings {
  dailyFolder: string;
  inboxFolder: string;
  reportsFolder: string;
  cacheFolder: string;
  rssFeeds: string[];
  externalCacheTtlMinutes: number;
  autoDailyCodexSummary: boolean;
  codexExecutable: string;
  githubSecretName: string;
  /** Internal persistence guard; intentionally not exposed as a user setting. */
  lastCodexSummaryAttemptDate: string;
}

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

const defaultRssFeeds: string[] = [];
Object.freeze(defaultRssFeeds);

export const DEFAULT_SETTINGS: DeepReadonly<AgentDashboardSettings> = Object.freeze({
  dailyFolder: "Daily",
  inboxFolder: "Inbox",
  reportsFolder: "Reports",
  cacheFolder: "Dashboard/cache",
  rssFeeds: defaultRssFeeds,
  externalCacheTtlMinutes: 60,
  autoDailyCodexSummary: true,
  codexExecutable: "codex",
  githubSecretName: "",
  lastCodexSummaryAttemptDate: "",
});

export function createDefaultSettings(): AgentDashboardSettings {
  return {
    dailyFolder: DEFAULT_SETTINGS.dailyFolder,
    inboxFolder: DEFAULT_SETTINGS.inboxFolder,
    reportsFolder: DEFAULT_SETTINGS.reportsFolder,
    cacheFolder: DEFAULT_SETTINGS.cacheFolder,
    rssFeeds: [...DEFAULT_SETTINGS.rssFeeds],
    externalCacheTtlMinutes: DEFAULT_SETTINGS.externalCacheTtlMinutes,
    autoDailyCodexSummary: DEFAULT_SETTINGS.autoDailyCodexSummary,
    codexExecutable: DEFAULT_SETTINGS.codexExecutable,
    githubSecretName: DEFAULT_SETTINGS.githubSecretName,
    lastCodexSummaryAttemptDate: DEFAULT_SETTINGS.lastCodexSummaryAttemptDate,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeSettings(saved: unknown): AgentDashboardSettings {
  const settings = createDefaultSettings();

  if (!isRecord(saved)) {
    return settings;
  }

  for (const key of ["dailyFolder", "inboxFolder", "reportsFolder", "cacheFolder"] as const) {
    if (typeof saved[key] !== "string") continue;
    const folder = normalizeVaultRelativeFolder(saved[key]);
    if (folder !== null) settings[key] = folder;
  }
  if (
    Array.isArray(saved.rssFeeds) &&
    saved.rssFeeds.every((feed): feed is string => typeof feed === "string")
  ) {
    const parsed = parseRssFeedLines(saved.rssFeeds.join("\n"));
    if (parsed.ok) settings.rssFeeds = parsed.feeds;
  }
  if (
    typeof saved.externalCacheTtlMinutes === "number" &&
    Number.isFinite(saved.externalCacheTtlMinutes)
  ) {
    const ttl = normalizeTtlMinutes(saved.externalCacheTtlMinutes);
    if (ttl !== null) settings.externalCacheTtlMinutes = ttl;
  }
  if (typeof saved.autoDailyCodexSummary === "boolean") {
    settings.autoDailyCodexSummary = saved.autoDailyCodexSummary;
  }
  if (typeof saved.codexExecutable === "string") {
    const executable = normalizeCodexExecutableInput(saved.codexExecutable);
    if (executable !== null) settings.codexExecutable = executable;
  }
  if (typeof saved.githubSecretName === "string") {
    const secretName = normalizeGithubSecretName(saved.githubSecretName);
    if (secretName !== null) settings.githubSecretName = secretName;
  }
  if (typeof saved.lastCodexSummaryAttemptDate === "string" &&
    isCalendarDate(saved.lastCodexSummaryAttemptDate)) {
    settings.lastCodexSummaryAttemptDate = saved.lastCodexSummaryAttemptDate;
  }

  return settings;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 0) - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === (month ?? 0) - 1 &&
    date.getUTCDate() === day;
}
import {
  normalizeCodexExecutableInput,
  normalizeGithubSecretName,
  normalizeTtlMinutes,
  normalizeVaultRelativeFolder,
  parseRssFeedLines,
} from "./settingsValidation";
