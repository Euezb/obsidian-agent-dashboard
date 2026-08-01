import type { RecentNote } from "../../domain/types";

export function selectRecentNotes(
  notes: RecentNote[],
  limit: number,
  excludedPrefixes: string[],
): RecentNote[] {
  const normalizedLimit = Math.floor(limit);

  if (!(normalizedLimit > 0)) {
    return [];
  }

  const prefixes = excludedPrefixes
    .map(normalizePath)
    .filter((prefix) => prefix.length > 0);

  return notes
    .filter((note) => {
      const path = normalizePath(note.path);
      return !prefixes.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      );
    })
    .sort((left, right) => {
      const leftTime = Number.isFinite(left.modifiedAt)
        ? left.modifiedAt
        : Number.NEGATIVE_INFINITY;
      const rightTime = Number.isFinite(right.modifiedAt)
        ? right.modifiedAt
        : Number.NEGATIVE_INFINITY;

      if (leftTime > rightTime) {
        return -1;
      }

      if (leftTime < rightTime) {
        return 1;
      }

      if (left.path < right.path) {
        return -1;
      }

      if (left.path > right.path) {
        return 1;
      }

      return 0;
    })
    .slice(0, normalizedLimit);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}
