import { describe, expect, it } from "vitest";
import type { DashboardTask } from "../src/domain/types";
import { dailyNoteDate, selectArchivedTaskTexts } from "../src/features/vault/archiveTasks";

const TODAY = "2026-09-29";

function task(
  path: string,
  text: string,
  overrides: Partial<DashboardTask> = {},
): DashboardTask {
  return {
    id: `${path}:0`,
    path,
    line: 0,
    text,
    completed: true,
    ...overrides,
  };
}

function select(tasks: readonly DashboardTask[], dailyFolder = "Daily"): string[] {
  return selectArchivedTaskTexts(tasks, { dailyFolder, today: TODAY });
}

describe("selectArchivedTaskTexts", () => {
  it("carries over checked-off tasks from earlier daily notes in note order", () => {
    const tasks = [
      task("Daily/2026-09-27.md", "Friday review"),
      task("Daily/2026-09-28.md", "Write failing tests"),
      task("Daily/2026-09-28.md", "Ship the fix"),
    ];

    expect(select(tasks)).toEqual(["Friday review", "Write failing tests", "Ship the fix"]);
  });

  it("ignores tasks outside the daily folder even when the note name holds a date", () => {
    const tasks = [
      task("docs/superpowers/plans/2026-07-31-citation-prompt-evaluation.md", "Step 1: Write failing tests"),
      task("待办事项/2026-08-01-sprint.md", "Old sprint item"),
      task("Daily/2026-09-28.md", "Real carry-over"),
    ];

    expect(select(tasks)).toEqual(["Real carry-over"]);
  });

  it("ignores today's own daily note and future-dated notes", () => {
    const tasks = [
      task("Daily/2026-09-29.md", "Today"),
      task("Daily/2026-09-30.md", "Tomorrow"),
    ];

    expect(select(tasks)).toEqual([]);
  });

  it("never re-archives a line that already sits under the archive heading", () => {
    const tasks = [
      task("Daily/2026-09-28.md", "Already carried over", { archived: true }),
      task("Daily/2026-09-28.md", "Fresh carry-over"),
    ];

    expect(select(tasks)).toEqual(["Fresh carry-over"]);
  });

  it("keeps one copy of a text repeated across days", () => {
    const tasks = [
      task("Daily/2026-09-26.md", "Recurring chore"),
      task("Daily/2026-09-27.md", "Recurring chore"),
      task("Daily/2026-09-27.md", "  Recurring chore  "),
    ];

    expect(select(tasks)).toEqual(["Recurring chore"]);
  });

  it("ignores unchecked and blank tasks", () => {
    const tasks = [
      task("Daily/2026-09-28.md", "Still open", { completed: false }),
      task("Daily/2026-09-28.md", "   "),
      task("Daily/2026-09-28.md", "Done"),
    ];

    expect(select(tasks)).toEqual(["Done"]);
  });

  it("accepts Windows separators and a nested daily folder", () => {
    const tasks = [
      task("Journal\\Daily\\2026-09-28.md", "Nested carry-over"),
      task("Journal\\Daily\\sub\\2026-09-28.md", "Nested too deep"),
    ];

    expect(select(tasks, "Journal\\Daily")).toEqual(["Nested carry-over"]);
  });

  it("reads the date from the file name, not from a parent folder", () => {
    expect(dailyNoteDate("Daily/2026-09-28.md", "Daily")).toBe("2026-09-28");
    expect(dailyNoteDate("Daily/2026-09-28/notes.md", "Daily")).toBeUndefined();
    expect(dailyNoteDate("Daily/notes.md", "Daily")).toBeUndefined();
    expect(dailyNoteDate("Other/2026-09-28.md", "Daily")).toBeUndefined();
    expect(dailyNoteDate("2026-09-28.md", "")).toBe("2026-09-28");
    expect(dailyNoteDate("Daily/2026-02-30.md", "Daily")).toBeUndefined();
  });
});
