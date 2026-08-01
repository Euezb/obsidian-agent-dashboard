import type { DashboardTask } from "../../domain/types";

const TASK_LINE = /^\s*- \[([ xX])\]\s+(.+)$/;
const DUE_DATE_TOKEN = /\s*📅\s+(\d{4}-\d{2}-\d{2})(?=\s|$)\s*/g;

export function parseTasks(path: string, markdown: string): DashboardTask[] {
  const tasks: DashboardTask[] = [];

  for (const [line, source] of markdown.split(/\r?\n/).entries()) {
    const match = TASK_LINE.exec(source);

    if (!match) {
      continue;
    }

    const marker = match[1] ?? " ";
    const sourceText = match[2] ?? "";
    let dueDate: string | undefined;
    const text = sourceText
      .replace(DUE_DATE_TOKEN, (_token, date: string) => {
        dueDate ??= date;
        return " ";
      })
      .trim();
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

    tasks.push(task);
  }

  return tasks;
}
