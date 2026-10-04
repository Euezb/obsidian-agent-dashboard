const INVALID_WINDOWS_CHARACTER = /[<>:"|?*]/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SECRET_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeVaultRelativeFolder(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || /^(?:[\\/]|[a-z]:)/i.test(trimmed)) return null;
  const segments = trimmed.replace(/\\/g, "/").split("/");
  if (segments.some((segment) => !isSafeSegment(segment))) return null;
  return segments.join("/");
}

export function normalizeTtlMinutes(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(1_440, Math.max(15, Math.trunc(value)));
}

/** Column-width limits shared by settings validation and both drag handles. */
export const NOTES_COLUMN_MIN_WIDTH = 240;
export const NOTES_COLUMN_MAX_WIDTH = 1200;

/** 0 keeps the responsive default; anything else is a dragged pixel width. */
export function normalizePanelWidth(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded <= 0) return 0;
  return Math.min(NOTES_COLUMN_MAX_WIDTH, Math.max(NOTES_COLUMN_MIN_WIDTH, rounded));
}

export type VaultFolderListResult =
  | { ok: true; folders: string[] }
  | { ok: false; folders: [] };

/**
 * Folder paths the Vault does not currently contain. A misspelled task folder
 * silently collects nothing, which looks like a broken plugin, so the settings
 * tab reports these after a successful save — the save itself is never blocked.
 */
export function missingVaultFolders(
  folders: readonly string[],
  exists: (path: string) => boolean,
): string[] {
  return folders.filter((folder) => !exists(folder));
}

/**
 * Parses one Vault-relative folder per line. Any unsafe line rejects the whole
 * list so a half-typed setting can never widen the scan scope silently.
 */
export function parseVaultFolderLines(value: string): VaultFolderListResult {
  const folders: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    const folder = normalizeVaultRelativeFolder(line);
    if (folder === null) return { ok: false, folders: [] };
    const key = folder.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    folders.push(folder);
  }
  return { ok: true, folders };
}

export type RssFeedParseResult =
  | { ok: true; feeds: string[] }
  | { ok: false; feeds: [] };

export function parseRssFeedLines(value: string): RssFeedParseResult {
  const feeds: string[] = [];
  const seen = new Set<string>();
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    let parsed: URL;
    try { parsed = new URL(line); } catch { return { ok: false, feeds: [] }; }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, feeds: [] };
    }
    const normalized = parsed.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      feeds.push(normalized);
    }
  }
  return { ok: true, feeds };
}


export function normalizeGithubSecretName(value: string): string | null {
  const normalized = value.trim();
  if (normalized === "") return "";
  return SECRET_ID.test(normalized) ? normalized : null;
}

function isSafeSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." &&
    !INVALID_WINDOWS_CHARACTER.test(segment) && !/[. ]$/.test(segment) &&
    !WINDOWS_DEVICE_NAME.test(segment) &&
    !Array.from(segment).some((character) => character.charCodeAt(0) <= 0x1f);
}


const SECRET_ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const API_STYLE_VALUES = ["openai", "anthropic"] as const;


export interface ApiSummarizerInput {
  providerBaseURL: string;
  api: string;
  model: string;
  apiKeyEnv: string;
}

export interface ApiSummarizerResult {
  providerBaseURL: string;
  api: "openai" | "anthropic";
  model: string;
  apiKeyEnv: string;
}

function normalizeApiBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed === "") return "";
  let parsed: URL;
  try { parsed = new URL(trimmed); } catch { return null; }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    return null;
  }
  return parsed.toString().replace(/\/+$/, "");
}

/** Validates one field at a time; an invalid field clears it instead of rejecting the block. */
export function normalizeApiSummarizer(
  value: ApiSummarizerInput,
): ApiSummarizerResult {
  // 损坏的 data.json 可能把这里写成数字或对象；?? 只挡 null/undefined，
  // 非字符串会在 normalizeApiBaseUrl 的 value.trim() 抛 TypeError，令整个插件加载失败。
  const base = normalizeApiBaseUrl(typeof value.providerBaseURL === "string" ? value.providerBaseURL : "");
  const api = (API_STYLE_VALUES as readonly string[]).includes(value.api ?? "")
    ? value.api as "openai" | "anthropic"
    : "openai";
  const model = typeof value.model === "string" ? value.model.trim() : "";
  const keyEnv = typeof value.apiKeyEnv === "string" ? value.apiKeyEnv.trim().toUpperCase() : "";
  return {
    providerBaseURL: base ?? "",
    api,
    model: model,
    apiKeyEnv: SECRET_ENV_NAME.test(keyEnv) ? keyEnv : "",
  };
}
