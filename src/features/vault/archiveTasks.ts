import type { DashboardTask } from "../../domain/types";
import { isCalendarDate } from "../../domain/localDate";

const DATE_IN_BASENAME = /(\d{4}-\d{2}-\d{2})/;

function normalizeForComparison(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

// 日期校验的唯一实现在 domain/localDate（审查 D6）；这里转出一次，
// vault 侧既有的引用路径（VaultScanner）保持有效。
export { isCalendarDate };

/**
 * Local date of a daily note, read from its file name (never from a folder
 * name, so a year folder cannot date the note inside it).
 */
export function dailyNoteDate(path: string, dailyFolder: string): string | undefined {
  const normalizedPath = normalizeForComparison(path);
  const folder = normalizeForComparison(dailyFolder);
  const prefix = folder === "" ? "" : `${folder}/`;
  if (!normalizedPath.startsWith(prefix)) return undefined;
  const rest = normalizedPath.slice(prefix.length);
  if (rest === "" || rest.includes("/")) return undefined;
  const basename = path.slice(path.length - rest.length);
  const date = DATE_IN_BASENAME.exec(basename)?.[1];
  return date !== undefined && isCalendarDate(date) ? date : undefined;
}

/**
 * Texts to append to today's daily note under the archive section.
 *
 * Only checked-off tasks that live in an *earlier daily note* qualify: the
 * feature exists to carry the previous days' finished work forward. Tasks from
 * other folders never qualify, even when their note name contains a date — that
 * mistake once pulled a whole plans document into a daily note. Lines that
 * already sit under the archive heading are skipped, otherwise every new daily
 * note would copy the previous note's whole archive forward and grow forever.
 */
export function selectArchivedTaskTexts(
  tasks: readonly DashboardTask[],
  options: { dailyFolder: string; today: string },
): string[] {
  const seen = new Set<string>();
  const selected: string[] = [];
  for (const task of tasks) {
    if (!task.completed || task.archived === true) continue;
    const date = dailyNoteDate(task.path, options.dailyFolder);
    if (date === undefined || date >= options.today) continue;
    const text = task.text.trim();
    if (text === "" || seen.has(text)) continue;
    seen.add(text);
    selected.push(text);
  }
  return selected;
}
