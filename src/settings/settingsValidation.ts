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

export function normalizeCodexExecutableInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "codex") return trimmed;
  if (!/^[a-z]:[\\/]/i.test(trimmed) || /^(?:\\\\|\/\/)/.test(trimmed)) return null;
  const normalized = trimmed.replace(/\//g, "\\");
  if (!/\.exe$/i.test(normalized)) return null;
  const segments = normalized.slice(3).split("\\");
  if (segments.some((segment) => !isSafeSegment(segment))) return null;
  return normalized;
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
