import type { TAbstractFile, TFile, Vault, Workspace } from "obsidian";
import type { DailyBrief, DashboardTask } from "../../domain/types";
import type { AgentDashboardSettings } from "../../settings/settings";
import { parseTasks } from "./taskParser";

const STALE_TASK_MESSAGE = "任务已在源笔记中变化，请打开笔记处理";
const DAILY_NOTE_CONTENT = (date: string): string =>
  `# ${date}\n\n## Tasks\n\n## Notes\n`;
const BRIEF_HEADING = "## 今日 AI 简报";

type VaultActionsPort = Pick<
  Vault,
  "getAbstractFileByPath" | "createFolder" | "create" | "process"
>;

export class InvalidVaultPathError extends Error {
  constructor(path: string) {
    super(`Vault 路径不安全：${path}`);
    this.name = "InvalidVaultPathError";
  }
}

export class StaleTaskError extends Error {
  constructor() {
    super(STALE_TASK_MESSAGE);
    this.name = "StaleTaskError";
  }
}

export class VaultActions {
  private dailyNoteInFlight: Promise<void> | null = null;

  constructor(
    private readonly vault: VaultActionsPort,
    private readonly workspace: Pick<Workspace, "getLeaf">,
    private readonly getSettings: () => AgentDashboardSettings,
    private readonly now: () => Date,
  ) {}

  async createOrOpenDailyNote(): Promise<void> {
    if (this.dailyNoteInFlight !== null) {
      return this.dailyNoteInFlight;
    }

    const operation = this.createOrOpenDailyNoteOnce();
    this.dailyNoteInFlight = operation;
    try {
      await operation;
    } finally {
      if (this.dailyNoteInFlight === operation) {
        this.dailyNoteInFlight = null;
      }
    }
  }

  async toggleTask(task: DashboardTask): Promise<void> {
    const path = normalizeVaultRelativePath(task.path, false);
    const candidate = this.vault.getAbstractFileByPath(path);
    if (!isFile(candidate)) throw new StaleTaskError();

    await this.vault.process(candidate, (content) => {
      const current = parseTasks(path, content).find((item) => item.line === task.line);
      if (!matchesTask(current, task)) throw new StaleTaskError();

      const parts = content.split(/(\r\n|\n)/);
      const sourceIndex = task.line * 2;
      const source = parts[sourceIndex];
      if (source === undefined) throw new StaleTaskError();
      const toggled = source.replace(
        /^(\s*-\s+\[)([ xX])(\])/,
        (_match, prefix: string, marker: string, suffix: string) =>
          `${prefix}${marker === " " ? "x" : " "}${suffix}`,
      );
      if (toggled === source) throw new StaleTaskError();
      parts[sourceIndex] = toggled;
      return parts.join("");
    });
  }

  /**
   * Writes a Markdown report into the configured reports folder and returns
   * the created file. Filenames are date-prefixed and de-duplicated.
   */
  async writeReport(baseName: string, markdown: string): Promise<TFile> {
    const folder = normalizeVaultRelativePath(this.getSettings().reportsFolder, true);
    await this.ensureFolders(folder);
    const date = formatLocalDate(this.now());
    const slug = slugifyReportName(baseName);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt}`;
      const path = folder.length > 0
        ? `${folder}/${date}-${slug}${suffix}.md`
        : `${date}-${slug}${suffix}.md`;
      const existing = this.vault.getAbstractFileByPath(path);
      if (existing === null) {
        try {
          return await this.vault.create(path, markdown.endsWith("\n") ? markdown : `${markdown}\n`);
        } catch (error) {
          const racedFile = this.vault.getAbstractFileByPath(path);
          if (isFile(racedFile)) return racedFile;
          throw error;
        }
      }
      if (!isFile(existing)) throw new InvalidVaultPathError(path);
    }
    throw new InvalidVaultPathError(slug);
  }

  /**
   * Idempotently upserts the daily AI brief into today's daily note under
   * "## 今日 AI 简报". An existing section with the same heading is replaced.
   */
  async upsertDailyBrief(brief: DailyBrief): Promise<void> {
    const folder = normalizeVaultRelativePath(this.getSettings().dailyFolder, true);
    const date = formatLocalDate(this.now());
    if (brief.date !== date) return;
    const path = folder.length > 0 ? `${folder}/${date}.md` : `${date}.md`;
    let file: TFile;
    const existing = this.vault.getAbstractFileByPath(path);
    if (isFile(existing)) {
      file = existing;
    } else if (existing !== null) {
      throw new InvalidVaultPathError(path);
    } else {
      await this.ensureFolders(folder);
      try {
        file = await this.vault.create(path, DAILY_NOTE_CONTENT(date));
      } catch (error) {
        const racedFile = this.vault.getAbstractFileByPath(path);
        if (!isFile(racedFile)) throw error;
        file = racedFile;
      }
    }

    const section = renderBriefSection(brief);
    await this.vault.process(file, (content) => upsertSection(content, BRIEF_HEADING, section));
  }

  private async createOrOpenDailyNoteOnce(): Promise<void> {
    const folder = normalizeVaultRelativePath(this.getSettings().dailyFolder, true);
    const date = formatLocalDate(this.now());
    const path = folder.length > 0 ? `${folder}/${date}.md` : `${date}.md`;
    const existing = this.vault.getAbstractFileByPath(path);
    let file: TFile;

    if (isFile(existing)) {
      file = existing;
    } else if (existing !== null) {
      throw new InvalidVaultPathError(path);
    } else {
      await this.ensureFolders(folder);
      try {
        file = await this.vault.create(path, DAILY_NOTE_CONTENT(date));
      } catch (error) {
        const racedFile = this.vault.getAbstractFileByPath(path);
        if (!isFile(racedFile)) throw error;
        file = racedFile;
      }
    }

    await this.workspace.getLeaf("tab").openFile(file);
  }

  private async ensureFolders(folder: string): Promise<void> {
    if (folder.length === 0) return;
    const segments = folder.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
      const path = segments.slice(0, index).join("/");
      const existing = this.vault.getAbstractFileByPath(path);
      if (existing === null) {
        try {
          await this.vault.createFolder(path);
        } catch (error) {
          const racedFolder = this.vault.getAbstractFileByPath(path);
          if (!isFolder(racedFolder)) {
            if (isFile(racedFolder)) throw new InvalidVaultPathError(path);
            throw error;
          }
        }
      } else if (isFile(existing)) {
        throw new InvalidVaultPathError(path);
      } else if (!isFolder(existing)) {
        throw new InvalidVaultPathError(path);
      }
    }
  }
}

export function formatLocalDate(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeVaultRelativePath(rawPath: string, allowEmpty: boolean): string {
  const trimmed = rawPath.trim();
  const slashed = trimmed.replace(/\\/g, "/");
  if (/^(?:[a-z]:|\/)/i.test(slashed)) throw new InvalidVaultPathError(rawPath);
  const segments = slashed.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.includes(":"))) {
    throw new InvalidVaultPathError(rawPath);
  }
  if (!allowEmpty && segments.length === 0) throw new InvalidVaultPathError(rawPath);
  return segments.join("/");
}

function isFile(candidate: TAbstractFile | null): candidate is TFile {
  return candidate !== null && "extension" in candidate;
}

function isFolder(candidate: TAbstractFile | null): boolean {
  return candidate !== null && "children" in candidate;
}

function matchesTask(current: DashboardTask | undefined, expected: DashboardTask): boolean {
  return current !== undefined &&
    current.text === expected.text &&
    current.completed === expected.completed &&
    current.dueDate === expected.dueDate;
}

function slugifyReportName(baseName: string): string {
  const slug = baseName
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|#%^&{}[\]]+/g, " ")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "report" : slug;
}

function renderBriefSection(brief: DailyBrief): string {
  const lines = brief.items.map((item) => `- [${item.title}](${item.url}) — ${item.summary}（${item.source}）`);
  return `${BRIEF_HEADING}\n\n${lines.join("\n")}`;
}

/**
 * Replaces the content of the `## …` section identified by `heading`
 * (up to the next same-or-higher-level heading or EOF), or appends a new
 * section when the heading is absent.
 */
export function upsertSection(content: string, heading: string, section: string): string {
  const lines = content.split("\n");
  const headingLevel = (heading.match(/^#+/)?.[0].length ?? 2);
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) {
    const separator = content.endsWith("\n") ? "" : "\n";
    return `${content}${separator}\n${section}\n`;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const match = /^(#+)\s/.exec(line);
    if (match !== null && (match[1]?.length ?? 99) <= headingLevel) {
      end = index;
      break;
    }
  }
  const replaced = [...lines.slice(0, start), ...section.split("\n"), ...lines.slice(end)];
  return replaced.join("\n");
}
