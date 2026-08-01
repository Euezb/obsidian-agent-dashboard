import type { CachedMetadata, TFile } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "../src/settings/settings";
import { VaultScanner } from "../src/features/vault/VaultScanner";

interface FakeFile {
  path: string;
  basename: string;
  stat: { ctime: number; mtime: number; size: number };
}

function file(path: string, ctime: number, mtime = ctime): FakeFile {
  const name = path.replace(/\\/g, "/").split("/").at(-1) ?? path;
  return {
    path,
    basename: name.replace(/\.md$/i, ""),
    stat: { ctime, mtime, size: 1 },
  };
}

describe("VaultScanner", () => {
  it("returns complete empty-state data for an empty Vault without reading files", async () => {
    const cachedRead = vi.fn();
    const getFileCache = vi.fn();
    const configDir = [".", "config"].join("");
    const scanner = new VaultScanner(
      { configDir, getMarkdownFiles: () => [], cachedRead },
      { getFileCache },
      createDefaultSettings,
      () => new Date(2026, 5, 30, 12),
      () => null,
    );

    const result = await scanner.scan();
    expect(result.tasks).toEqual([]);
    expect(result.recentNotes).toEqual([]);
    expect(result.health).toMatchObject({ score: null, insufficientData: true });
    expect(result.heatmap).toHaveLength(365);
    expect(cachedRead).not.toHaveBeenCalled();
    expect(getFileCache).not.toHaveBeenCalled();
  });

  it("scans each included note once and deterministically aggregates local modules", async () => {
    const now = new Date(2026, 5, 29, 12);
    const day = 24 * 60 * 60 * 1000;
    const configFolder = [".", "obsidian"].join("");
    const files = [
      file("Projects/note.md", now.getTime() - 2 * day),
      file(".DEV\\private.md", now.getTime()),
      file("Reports-archive/keep.md", now.getTime() - 400 * day, now.getTime() - 91 * day),
      file("dashboard/CACHE/feed.md", now.getTime()),
      file("Inbox/a.md", now.getTime() - day),
      file("Reports/generated.md", now.getTime()),
      file(`${configFolder}/config.md`, now.getTime()),
    ];
    const content: Record<string, string> = {
      "Projects/note.md": "# Project\n- [X] Ship it",
      "Reports-archive/keep.md": "- [ ] Keep archive",
      "Inbox/a.md": "- [ ] Sort inbox 📅 2026-06-30\n- [x] Filed",
    };
    const caches: Record<string, CachedMetadata> = {
      "Projects/note.md": { frontmatterLinks: [{ key: "related", link: "A", original: "A", displayText: "A" }] },
      "Reports-archive/keep.md": { frontmatter: { position: {} } },
      "Inbox/a.md": {
        frontmatter: { position: {}, topic: "inbox" },
        links: [{ link: "Project", original: "[[Project]]", displayText: "Project", position: {} as never }],
      },
    };
    const cachedRead = vi.fn(async (candidate: TFile) => content[candidate.path] ?? "excluded");
    const getFileCache = vi.fn((candidate: TFile) => caches[candidate.path] ?? null);
    const settings = createDefaultSettings();
    const scanner = new VaultScanner(
      {
        configDir: configFolder,
        getMarkdownFiles: () => files as unknown as TFile[],
        cachedRead,
      },
      { getFileCache },
      () => settings,
      () => new Date(now),
      (cache) => cache === caches["Reports-archive/keep.md"] ? null : ["#public"],
    );

    const result = await scanner.scan();

    expect(cachedRead).toHaveBeenCalledTimes(3);
    expect(cachedRead.mock.calls.map(([candidate]) => candidate.path)).toEqual([
      "Inbox/a.md",
      "Projects/note.md",
      "Reports-archive/keep.md",
    ]);
    expect(result.tasks.map(({ path, line, completed }) => ({ path, line, completed }))).toEqual([
      { path: "Inbox/a.md", line: 0, completed: false },
      { path: "Inbox/a.md", line: 1, completed: true },
      { path: "Projects/note.md", line: 1, completed: true },
      { path: "Reports-archive/keep.md", line: 0, completed: false },
    ]);
    expect(result.recentNotes.map(({ path }) => path)).toEqual([
      "Inbox/a.md",
      "Projects/note.md",
      "Reports-archive/keep.md",
    ]);
    expect(result.heatmap).toHaveLength(365);
    expect(result.heatmap.at(-1)).toEqual({ date: "2026-06-29", count: 0 });
    expect(result.health.score).toBe(67);
    expect(result.health.breakdown.frontmatter).toBeCloseTo(20 / 3);
    expect(result.health.breakdown.links).toBeCloseTo(50 / 3);
    expect(result.health.breakdown.tags).toBe(10);
    expect(result.health.breakdown.activity).toBeCloseTo(40 / 3);
    expect(result.health.breakdown.inbox).toBe(20);
    expect(getFileCache).toHaveBeenCalledTimes(3);
  });

  it("skips a file whose cached read fails instead of failing the whole scan", async () => {
    const failure = new Error("disk read failed");
    const broken = file("Broken.md", 1);
    const healthy = file("Healthy.md", 2);
    const scanner = new VaultScanner(
      {
        configDir: [".", "obsidian"].join(""),
        getMarkdownFiles: () => [broken, healthy] as unknown as TFile[],
        cachedRead: vi.fn().mockRejectedValueOnce(failure).mockResolvedValue("- [ ] Recovered task"),
      },
      { getFileCache: vi.fn().mockReturnValue(null) },
      createDefaultSettings,
      () => new Date(2026, 5, 29),
      () => null,
    );

    const result = await scanner.scan();
    expect(result.tasks.map((task) => task.text)).toEqual(["Recovered task"]);
    expect(result.recentNotes.map((note) => note.path)).toEqual(["Healthy.md"]);
  });

  it("assigns each task the note date from the filename or falls back to the modified day", async () => {
    const dated = file("Daily/2026-06-28.md", 1);
    const undated = file("Inbox/scratch.md", 2, new Date(2026, 5, 27, 10).getTime());
    const scanner = new VaultScanner(
      {
        configDir: ".config",
        getMarkdownFiles: () => [dated, undated] as unknown as TFile[],
        cachedRead: vi.fn().mockResolvedValue("- [ ] Task"),
      },
      { getFileCache: vi.fn().mockReturnValue(null) },
      createDefaultSettings,
      () => new Date(2026, 5, 29),
      () => null,
    );

    const result = await scanner.scan();
    expect(result.tasks.map((task) => task.date)).toEqual(["2026-06-28", "2026-06-27"]);
  });

  it("reuses per-file results when mtime and size are unchanged between scans", async () => {
    const candidate = file("Note.md", 7);
    const cachedRead = vi.fn().mockResolvedValue("- [ ] Task");
    const scanner = new VaultScanner(
      {
        configDir: ".config",
        getMarkdownFiles: () => [candidate] as unknown as TFile[],
        cachedRead,
      },
      { getFileCache: vi.fn().mockReturnValue(null) },
      createDefaultSettings,
      () => new Date(2026, 5, 29),
      () => null,
    );

    await scanner.scan();
    await scanner.scan();
    expect(cachedRead).toHaveBeenCalledTimes(1);

    candidate.stat.mtime += 1;
    await scanner.scan();
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it("shares an overlapping scan promise and clears it after success", async () => {
    const candidate = file("Note.md", 1);
    let release!: (content: string) => void;
    const cachedRead = vi.fn()
      .mockImplementationOnce(() => new Promise<string>((resolve) => { release = resolve; }))
      .mockResolvedValue("- [ ] Second");
    const scanner = new VaultScanner(
      {
        configDir: ".config",
        getMarkdownFiles: () => [candidate] as unknown as TFile[],
        cachedRead,
      },
      { getFileCache: vi.fn().mockReturnValue(null) },
      createDefaultSettings,
      () => new Date(2026, 5, 29),
      () => null,
    );

    const first = scanner.scan();
    const second = scanner.scan();
    expect(second).toBe(first);
    expect(cachedRead).toHaveBeenCalledOnce();
    release("- [ ] First");
    await first;
    // mtime is unchanged, so the next scan is served from the per-file cache.
    await scanner.scan();
    expect(cachedRead).toHaveBeenCalledTimes(1);
  });

  it("retries a failed file on the next scan without failing the dashboard", async () => {
    const candidate = file("Note.md", 1);
    const cachedRead = vi.fn()
      .mockRejectedValueOnce(new Error("first failure"))
      .mockResolvedValueOnce("- [ ] Recovered");
    const scanner = new VaultScanner(
      {
        configDir: ".config",
        getMarkdownFiles: () => [candidate] as unknown as TFile[],
        cachedRead,
      },
      { getFileCache: vi.fn().mockReturnValue(null) },
      createDefaultSettings,
      () => new Date(2026, 5, 29),
      () => null,
    );

    await expect(scanner.scan()).resolves.toMatchObject({ tasks: [] });
    await expect(scanner.scan()).resolves.toMatchObject({
      tasks: [expect.objectContaining({ text: "Recovered" })],
    });
    expect(cachedRead).toHaveBeenCalledTimes(2);
  });

  it("reads with bounded concurrency while preserving sorted output order", async () => {
    const files = Array.from({ length: 20 }, (_, index) =>
      file(`Notes/${(19 - index).toString().padStart(2, "0")}.md`, index + 1),
    );
    let active = 0;
    let maximumActive = 0;
    const cachedRead = vi.fn(async (candidate: TFile) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const numericName = Number.parseInt(candidate.basename, 10);
      await new Promise((resolve) => window.setTimeout(resolve, numericName % 3));
      active -= 1;
      return `- [ ] ${candidate.basename}`;
    });
    const scanner = new VaultScanner(
      {
        configDir: ".config",
        getMarkdownFiles: () => files as unknown as TFile[],
        cachedRead,
      },
      { getFileCache: vi.fn().mockReturnValue(null) },
      createDefaultSettings,
      () => new Date(2026, 5, 29),
      () => null,
    );

    const result = await scanner.scan();

    expect(maximumActive).toBeGreaterThan(1);
    expect(maximumActive).toBeLessThanOrEqual(8);
    expect(result.tasks.map(({ path }) => path)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Notes/${index.toString().padStart(2, "0")}.md`),
    );
  });

  it("uses a 90-day inclusive local-calendar activity window across DST", async () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const now = new Date(2025, 2, 10, 12);
      const cutoff = new Date(now);
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - 89);
      const files = [
        file("At.md", 1, cutoff.getTime()),
        file("Before.md", 1, cutoff.getTime() - 1),
      ];
      const scanner = new VaultScanner(
        {
          configDir: ".config",
          getMarkdownFiles: () => files as unknown as TFile[],
          cachedRead: vi.fn().mockResolvedValue(""),
        },
        { getFileCache: vi.fn().mockReturnValue(null) },
        createDefaultSettings,
        () => new Date(now),
        () => null,
      );

      const result = await scanner.scan();

      expect(result.health.breakdown.activity).toBe(10);
    } finally {
      if (previousTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimeZone;
    }
  });
});
