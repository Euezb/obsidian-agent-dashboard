import type { DashboardTask } from "../../domain/types";

const TASK_LINE = /^\s*- \[([ xX])\]\s+(.+)$/;
const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
const DUE_DATE_TOKEN = /\s*📅\s+(\d{4}-\d{2}-\d{2})(?=\s|$)\s*/g;
const CODE_SPAN = /`+([^`\n]+?)`+/g;
// Private-use-area sentinels: never control characters, never plausible note text.
const CODE_PLACEHOLDER_OPEN = "\uE000";
const CODE_PLACEHOLDER_CLOSE = "\uE001";
const CODE_PLACEHOLDER = /\uE000(\d+)\uE001/g;

/** Section title that marks tasks already carried over from earlier daily notes. */
export const ARCHIVE_TITLE = "归档";

/**
 * Heading level of an archive heading, or undefined for every other line.
 * Shared by the parser (which flags the tasks inside that section) and by the
 * archive writer (which appends into it), so both agree on what an archive is.
 */
export function archiveHeadingLevel(source: string): number | undefined {
  const heading = HEADING.exec(source);
  if (heading === null || (heading[2] ?? "").trim() !== ARCHIVE_TITLE) return undefined;
  return (heading[1] ?? "").length;
}

/** Index of the archive heading line, or -1 when the note has none yet. */
export function findArchiveHeadingIndex(lines: readonly string[]): number {
  return lines.findIndex((line) => archiveHeadingLevel(line) !== undefined);
}

/**
 * Converts inline Markdown into the plain text a task row shows. Code spans are
 * protected first so their contents survive the emphasis rules untouched.
 */
export function stripMarkdown(source: string): string {
  const codeSpans: string[] = [];
  const protectedSource = source.replace(CODE_SPAN, (_match, code: string) => {
    codeSpans.push(code.trim());
    return `${CODE_PLACEHOLDER_OPEN}${codeSpans.length - 1}${CODE_PLACEHOLDER_CLOSE}`;
  });
  return protectedSource
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, (_match, inner: string) => {
      const [target = "", heading = ""] = inner.split("#");
      return (target.trim() || heading.trim() || inner.trim());
    })
    .replace(/\*\*([^*\n]+?)\*\*/g, "$1")
    .replace(/(?<![\w*])\*([^*\n]+?)\*(?![\w*])/g, "$1")
    .replace(/~~([^~\n]+?)~~/g, "$1")
    .replace(/==([^=\n]+?)==/g, "$1")
    .replace(CODE_PLACEHOLDER, (_match, index: string) => codeSpans[Number(index)] ?? "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function parseTasks(path: string, markdown: string): DashboardTask[] {
  const tasks: DashboardTask[] = [];
  let archivedLevel = 0;
  /** 当前代码围栏的字符（` 或 ~）；null 表示不在围栏内。 */
  let fence: string | null = null;

  for (const [line, source] of markdown.split(/\r?\n/).entries()) {
    // 围栏判断必须排在最前：否则块内的 `## 归档` 会先把 archivedLevel 置上，
    // 让它后面（块外）的任务全部被误标成已归档；块内的 `- [ ] 示例` 也会进待办。
    // 简化实现：只认行首（可带缩进）的三个以上 ` 或 ~，不处理同行开闭与嵌套。
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(source);
    if (fenceMatch !== null) {
      const char = (fenceMatch[1] ?? "`").charAt(0);
      if (fence === null) fence = char;
      else if (fence === char) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const archivedHeading = archiveHeadingLevel(source);
    if (archivedHeading !== undefined) {
      archivedLevel = archivedHeading;
      continue;
    }
    const heading = HEADING.exec(source);
    if (heading !== null) {
      const level = (heading[1] ?? "").length;
      if (archivedLevel !== 0 && level <= archivedLevel) archivedLevel = 0;
      continue;
    }
    const match = TASK_LINE.exec(source);

    if (!match) {
      continue;
    }

    const marker = match[1] ?? " ";
    const sourceText = match[2] ?? "";
    let dueDate: string | undefined;
    const text = stripMarkdown(sourceText
      .replace(DUE_DATE_TOKEN, (_token, date: string) => {
        dueDate ??= date;
        return " ";
      })
      .trim());
    const task: DashboardTask = {
      id: `${path}:${line}`,
      path,
      line,
      text,
      completed: marker.toLowerCase() === "x",
    };

    if (dueDate !== undefined) {
      task.dueDate = dueDate;
    }

    if (archivedLevel !== 0) {
      task.archived = true;
    }

    tasks.push(task);
  }

  return tasks;
}
