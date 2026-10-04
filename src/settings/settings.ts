/** Settings keys written by the column splitters. */
export type ColumnWidthKey = "todayNotesWidth" | "discoveryRankingWidth";

export interface AgentDashboardSettings {
  dailyFolder: string;
  inboxFolder: string;
  reportsFolder: string;
  cacheFolder: string;
  /** Vault-relative folders that may contribute tasks; empty means the whole Vault. */
  taskIncludeFolders: string[];
  /** Vault-relative folders whose Markdown checkboxes are never collected as tasks. */
  taskExcludeFolders: string[];
  rssFeeds: string[];
  externalCacheTtlMinutes: number;
  autoDailySummary: boolean;
  /**
   * Width of the 最近笔记 column in pixels, chosen by dragging the 今天 divider.
   * 0 keeps the responsive default, so the panel stays adaptive until a drag happens.
   */
  todayNotesWidth: number;
  /** Same idea for the GitHub 榜单 column inside 今日发现. */
  discoveryRankingWidth: number;

  githubSecretName: string;
  /** Direct-HTTP summarizer configuration; unset means summaries cannot be generated. */
  apiSummarizer: ApiSummarizerSettings;
  /** Internal persistence guard; intentionally not exposed as a user setting. */
  lastSummaryAttemptDate: string;
  /**
   * 头部黄历卡与「卜筮」板块的总开关。
   * 术数计算全部本地完成,关闭只是不渲染,打包体积不变。
   */
  bushiEnabled: boolean;
  /**
   * 「今日一牌」与卜筮九个方法的解卦是否调用大模型。
   * 复用 apiSummarizer 那一套接口配置;关掉就完全回到本地(卦象照常,只是没有解卦文字)。
   */
  bushiReadingEnabled: boolean;
  /**
   * 解卦时是否把手写的「问题」一起发给模型。
   * 关掉只发方法名、卦象与事实行 —— 问事文本是唯一会离开本机的内容。
   */
  bushiReadingSendsQuestion: boolean;
}

/**
 * OpenAI-compatible /chat/completions endpoint used to summarise the day's
 * news when configured. Only the environment-variable NAME of the key is
 * persisted, never the key itself.
 */
export interface ApiSummarizerSettings {
  /** Absolute http(s) origin plus path to the completions route, e.g. https://…/v1. */
  providerBaseURL: string;
  /** Transport style: OpenAI chat-completions or Anthropic messages. */
  api: "openai" | "anthropic";
  /** Requested model id at the provider, e.g. glm-5.3-flash. */
  model: string;
  /** Environment variable that holds the API key at Obsidian launch. */
  apiKeyEnv: string;
}

export type DeepReadonly<T> = T extends readonly (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

const defaultRssFeeds: string[] = [];
Object.freeze(defaultRssFeeds);
const defaultTaskFolders: string[] = [];
Object.freeze(defaultTaskFolders);
const defaultApiSummarizer: ApiSummarizerSettings = Object.freeze({
  providerBaseURL: "",
  api: "openai",
  model: "deepseek-v4.1-flash",
  apiKeyEnv: "",
});

export const DEFAULT_SETTINGS: DeepReadonly<AgentDashboardSettings> = Object.freeze({
  dailyFolder: "Daily",
  inboxFolder: "Inbox",
  reportsFolder: "Reports",
  cacheFolder: "Dashboard/cache",
  taskIncludeFolders: defaultTaskFolders,
  taskExcludeFolders: defaultTaskFolders,
  rssFeeds: defaultRssFeeds,
  externalCacheTtlMinutes: 60,
  autoDailySummary: true,
  todayNotesWidth: 0,
  discoveryRankingWidth: 0,

  githubSecretName: "",
  apiSummarizer: defaultApiSummarizer,
  lastSummaryAttemptDate: "",
  bushiEnabled: true,
  bushiReadingEnabled: true,
  bushiReadingSendsQuestion: true,
});

export function createDefaultSettings(): AgentDashboardSettings {
  return {
    dailyFolder: DEFAULT_SETTINGS.dailyFolder,
    inboxFolder: DEFAULT_SETTINGS.inboxFolder,
    reportsFolder: DEFAULT_SETTINGS.reportsFolder,
    cacheFolder: DEFAULT_SETTINGS.cacheFolder,
    taskIncludeFolders: [...DEFAULT_SETTINGS.taskIncludeFolders],
    taskExcludeFolders: [...DEFAULT_SETTINGS.taskExcludeFolders],
    rssFeeds: [...DEFAULT_SETTINGS.rssFeeds],
    externalCacheTtlMinutes: DEFAULT_SETTINGS.externalCacheTtlMinutes,
    autoDailySummary: DEFAULT_SETTINGS.autoDailySummary,
    todayNotesWidth: DEFAULT_SETTINGS.todayNotesWidth,
    discoveryRankingWidth: DEFAULT_SETTINGS.discoveryRankingWidth,

    githubSecretName: DEFAULT_SETTINGS.githubSecretName,
    apiSummarizer: { ...DEFAULT_SETTINGS.apiSummarizer },
    lastSummaryAttemptDate: DEFAULT_SETTINGS.lastSummaryAttemptDate,
    bushiEnabled: DEFAULT_SETTINGS.bushiEnabled,
    bushiReadingEnabled: DEFAULT_SETTINGS.bushiReadingEnabled,
    bushiReadingSendsQuestion: DEFAULT_SETTINGS.bushiReadingSendsQuestion,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 逐行规整文件夹列表：坏行丢弃、好行保留、按小写去重。
 *
 * mergeSettings 不能复用 parseVaultFolderLines 的「一行非法整单拒收」契约：
 * data.json 里出现一行坏路径时整单丢弃会让 taskExcludeFolders 落回默认空表，
 * 之前的排除项全部失效，扫描范围反而被放宽 —— 正是那条规定要防的事。
 * 设置页仍然整单拒收（那是用户正在输入时的校验，不该静默丢行）。
 */
function normalizeFolderLines(lines: readonly string[]): string[] {
  const folders: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const folder = normalizeVaultRelativeFolder(trimmed);
    if (folder === null) continue;
    const dedupeKey = folder.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    folders.push(folder);
  }
  return folders;
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
  for (const key of ["taskIncludeFolders", "taskExcludeFolders"] as const) {
    const savedFolders = saved[key];
    if (
      !Array.isArray(savedFolders) ||
      !savedFolders.every((folder): folder is string => typeof folder === "string")
    ) {
      continue;
    }
    settings[key] = normalizeFolderLines(savedFolders);
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
  for (const key of ["todayNotesWidth", "discoveryRankingWidth"] as const) {
    const savedWidth = saved[key];
    if (typeof savedWidth !== "number") continue;
    const width = normalizePanelWidth(savedWidth);
    if (width !== null) settings[key] = width;
  }
  if (typeof saved.autoDailySummary === "boolean") {
    settings.autoDailySummary = saved.autoDailySummary;
  }

  if (isRecord(saved.apiSummarizer)) {
    settings.apiSummarizer = normalizeApiSummarizer(saved.apiSummarizer as {
      providerBaseURL: string;
      api: string;
      model: string;
      apiKeyEnv: string;
    });
  }
  if (typeof saved.githubSecretName === "string") {
    const secretName = normalizeGithubSecretName(saved.githubSecretName);
    if (secretName !== null) settings.githubSecretName = secretName;
  }
  if (typeof saved.bushiEnabled === "boolean") {
    settings.bushiEnabled = saved.bushiEnabled;
  }
  /**
   * 解卦两个开关。0.2.0 叫「塔罗解牌」,只覆盖塔罗;0.3.0 起覆盖卜筮全部方法,
   * 键名跟着改成 bushiReading*。旧键仍然认 —— 用户当初把开关关掉过,
   * 升级后不该被悄悄打开(那是会往外发数据的行为)。
   */
  for (const key of ["bushiReadingEnabled", "tarotReadingEnabled"] as const) {
    if (typeof saved[key] === "boolean") {
      settings.bushiReadingEnabled = saved[key];
      break;
    }
  }
  for (const key of ["bushiReadingSendsQuestion", "tarotReadingSendsQuestion"] as const) {
    if (typeof saved[key] === "boolean") {
      settings.bushiReadingSendsQuestion = saved[key];
      break;
    }
  }
  if (typeof saved.lastSummaryAttemptDate === "string" &&
    isCalendarDate(saved.lastSummaryAttemptDate)) {
    settings.lastSummaryAttemptDate = saved.lastSummaryAttemptDate;
  }

  return settings;
}

import {
  normalizeApiSummarizer,

  normalizeGithubSecretName,
  normalizeTtlMinutes,
  normalizePanelWidth,
  normalizeVaultRelativeFolder,
  parseRssFeedLines,
} from "./settingsValidation";
import { isCalendarDate } from "../domain/localDate";
