/* eslint-disable @typescript-eslint/no-misused-promises, @typescript-eslint/no-unsafe-return, obsidianmd/no-tfile-tfolder-cast -- Structural Obsidian port fixtures intentionally avoid the unavailable app runtime. */
import type { TAbstractFile, TFile, TFolder, Vault, Workspace } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import type { DashboardTask } from "../src/domain/types";
import { createDefaultSettings } from "../src/settings/settings";
import {
  InvalidVaultPathError,
  StaleTaskError,
  VaultActions,
  formatLocalDate,
  upsertSection,
} from "../src/features/vault/VaultActions";

interface ActionHarness {
  actions: VaultActions;
  create: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  openFile: ReturnType<typeof vi.fn>;
  process: ReturnType<typeof vi.fn>;
  entries: Map<string, TAbstractFile>;
}

function makeFile(path: string): TFile {
  return { path, name: path.split("/").at(-1), extension: "md", basename: path.replace(/^.*\//, "").replace(/\.md$/, "") } as unknown as TFile;
}

function makeFolder(path: string): TFolder {
  return { path, name: path.split("/").at(-1), children: [] } as unknown as TFolder;
}

function harness(dailyFolder = "Daily", initial: TAbstractFile[] = []): ActionHarness {
  const entries = new Map(initial.map((entry) => [entry.path, entry]));
  const createFolder = vi.fn(async (path: string) => {
    const folder = { path, name: path.split("/").at(-1), children: [] } as unknown as TFolder;
    entries.set(path, folder);
    return folder;
  });
  const create = vi.fn(async (path: string, data: string) => {
    void data;
    const created = makeFile(path);
    entries.set(path, created);
    return created;
  });
  const process = vi.fn();
  const vault = {
    getAbstractFileByPath: (path: string) => entries.get(path) ?? null,
    createFolder,
    create,
    process,
  } as unknown as Pick<Vault, "getAbstractFileByPath" | "createFolder" | "create" | "process">;
  const openFile = vi.fn().mockResolvedValue(undefined);
  const workspace = {
    getLeaf: vi.fn(() => ({ openFile })),
  } as unknown as Pick<Workspace, "getLeaf">;
  const settings = { ...createDefaultSettings(), dailyFolder };
  return {
    actions: new VaultActions(vault, workspace, () => settings, () => new Date(2026, 5, 9, 8)),
    create,
    createFolder,
    openFile,
    process,
    entries,
  };
}

function task(overrides: Partial<DashboardTask> = {}): DashboardTask {
  return {
    id: "Tasks.md:0",
    path: "Tasks.md",
    line: 0,
    text: "Write tests",
    completed: false,
    ...overrides,
  };
}

describe("VaultActions", () => {
  it("formats local calendar dates without UTC conversion", () => {
    expect(formatLocalDate(new Date(2026, 0, 2, 0, 1))).toBe("2026-01-02");
  });

  it("opens an existing daily note without creating anything", async () => {
    const existing = makeFile("Daily/2026-06-09.md");
    const test = harness("Daily", [existing]);

    await test.actions.createOrOpenDailyNote();

    expect(test.create).not.toHaveBeenCalled();
    expect(test.createFolder).not.toHaveBeenCalled();
    expect(test.openFile).toHaveBeenCalledWith(existing);
  });

  it("creates nested daily folders, exact content, then opens the note", async () => {
    const test = harness("Journal/Daily");

    await test.actions.createOrOpenDailyNote();

    expect(test.createFolder.mock.calls.map(([path]) => path)).toEqual(["Journal", "Journal/Daily"]);
    expect(test.create).toHaveBeenCalledWith(
      "Journal/Daily/2026-06-09.md",
      "# 2026-06-09\n\n## Tasks\n\n## Notes\n",
    );
    expect(test.openFile).toHaveBeenCalledWith(test.entries.get("Journal/Daily/2026-06-09.md"));
  });

  it("recovers when a concurrently-created folder wins the createFolder race", async () => {
    const test = harness("Daily");
    const raceError = new Error("already exists");
    test.createFolder.mockImplementationOnce(async (path: string) => {
      test.entries.set(path, makeFolder(path));
      throw raceError;
    });

    await test.actions.createOrOpenDailyNote();

    expect(test.create).toHaveBeenCalledOnce();
    expect(test.openFile).toHaveBeenCalledOnce();
  });

  it("rejects a folder occupying the final daily Markdown path", async () => {
    const occupied = makeFolder("Daily/2026-06-09.md");
    const test = harness("Daily", [occupied]);

    await expect(test.actions.createOrOpenDailyNote()).rejects.toBeInstanceOf(
      InvalidVaultPathError,
    );
    expect(test.create).not.toHaveBeenCalled();
    expect(test.openFile).not.toHaveBeenCalled();
  });

  it("deduplicates concurrent daily-note creation", async () => {
    const test = harness();
    let release!: () => void;
    test.create.mockImplementation(async (path: string) => {
      await new Promise<void>((resolve) => { release = resolve; });
      const created = makeFile(path);
      test.entries.set(path, created);
      return created;
    });

    const first = test.actions.createOrOpenDailyNote();
    const second = test.actions.createOrOpenDailyNote();
    await vi.waitFor(() => expect(test.create).toHaveBeenCalledOnce());
    release();
    await Promise.all([first, second]);

    expect(test.create).toHaveBeenCalledOnce();
    expect(test.openFile).toHaveBeenCalledOnce();
  });

  it.each(["../Outside", "/absolute", "C:/outside", String.raw`\\server\share`, "Daily/./Nested"])(
    "rejects unsafe configured daily folder %s",
    async (dailyFolder) => {
      const test = harness(dailyFolder);
      await expect(test.actions.createOrOpenDailyNote()).rejects.toBeInstanceOf(InvalidVaultPathError);
      expect(test.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["- [ ] Write tests", "- [x] Write tests"],
    ["- [x] Write tests", "- [ ] Write tests"],
    ["- [X] Write tests", "- [ ] Write tests"],
  ])("toggles only the checkbox marker in %s", async (source, expected) => {
    const sourceTask = task({ completed: source !== "- [ ] Write tests" });
    const sourceFile = makeFile("Tasks.md");
    const test = harness("Daily", [sourceFile]);
    let written = "";
    test.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => {
      written = transform(source);
      return written;
    });

    await test.actions.toggleTask(sourceTask);

    expect(written).toBe(expected);
    expect(test.process).toHaveBeenCalledWith(sourceFile, expect.any(Function));
  });

  it("preserves indentation, CRLF separators, and the final newline", async () => {
    const sourceFile = makeFile("Tasks.md");
    const test = harness("Daily", [sourceFile]);
    const source = "intro\r\n  - [ ] Write tests 📅 2026-06-30\r\noutro\r\n";
    let written = "";
    test.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => {
      written = transform(source);
      return written;
    });

    await test.actions.toggleTask(task({ line: 1, dueDate: "2026-06-30" }));

    expect(written).toBe("intro\r\n  - [x] Write tests 📅 2026-06-30\r\noutro\r\n");
  });

  it.each([
    ["missing file", null, "- [ ] Write tests", task()],
    ["line missing", makeFile("Tasks.md"), "heading", task({ line: 3 })],
    ["text changed", makeFile("Tasks.md"), "- [ ] Different", task()],
    ["state changed", makeFile("Tasks.md"), "- [x] Write tests", task()],
    ["date changed", makeFile("Tasks.md"), "- [ ] Write tests 📅 2026-07-01", task({ dueDate: "2026-06-30" })],
  ])("rejects a stale task when %s", async (_case, sourceFile, source, staleTask) => {
    const test = harness("Daily", sourceFile ? [sourceFile] : []);
    test.process.mockImplementation(async (_file: TFile, transform: (data: string) => string) => transform(source));

    await expect(test.actions.toggleTask(staleTask)).rejects.toEqual(
      expect.objectContaining<Partial<StaleTaskError>>({
        message: "任务已在源笔记中变化，请打开笔记处理",
      }),
    );
  });

  describe("upsertSection", () => {
    const heading = "## 今日 AI 简报";
    const section = "## 今日 AI 简报\n\n- [Item A](https://a.test) — summary";

    it("appends a new section when the heading is absent", () => {
      const content = "# 2026-08-01\n\n## Tasks\n\n## Notes\n";
      const result = upsertSection(content, heading, section);
      expect(result).toContain(section);
      expect(result).toContain("## Notes");
      expect(result).toMatch(/## 今日 AI 简报\n\n- \[Item A\]\(https:\/\/a\.test\)/);
    });

    it("replaces the content of an existing section in-place", () => {
      const content = "# 2026-08-01\n\n## 今日 AI 简报\n\nold content\n\n## Tasks\n";
      const result = upsertSection(content, heading, section);
      expect(result).toContain("Item A");
      expect(result).not.toContain("old content");
      expect(result).toContain("## Tasks");
    });

    it("removes nothing when the section stays empty after the heading", () => {
      const content = "# 2026-08-01\n\n## 今日 AI 简报\n\n## Tasks\n### sub\n";
      const result = upsertSection(content, heading, "## 今日 AI 简报");
      expect(result).toContain("## 今日 AI 简报");
      expect(result.split("\n").filter((l) => l.trim() === "## 今日 AI 简报")).toHaveLength(1);
    });
  });
});
