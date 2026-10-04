import type { CachedMetadata, MetadataCache, Vault } from "obsidian";
import type {
  DashboardTask,
  HeatmapDay,
  RecentNote,
  VaultHealth,
} from "../../domain/types";
import type { AgentDashboardSettings } from "../../settings/settings";
import { calculateHealthScore } from "./healthScore";
import { buildHeatmap } from "./heatmap";
import { isCalendarDate } from "./archiveTasks";
import { parseTasks } from "./taskParser";

const RECENT_NOTE_LIMIT = 3;
const SCAN_CONCURRENCY = 8;
const BUILT_IN_EXCLUSIONS = [".dev"] as const;

export interface LocalDashboardData {
  tasks: DashboardTask[];
  recentNotes: RecentNote[];
  heatmap: HeatmapDay[];
  health: VaultHealth;
}

export type TagResolver = (cache: CachedMetadata) => string[] | null;

/** 只由文件内容与 (mtime, size) 决定的部分：可以跨扫描缓存。 */
interface CachedFileContent {
  tasks: DashboardTask[];
  note: RecentNote;
  createdAt: number;
}

/** 缓存部分 + 每次扫描都必须重算的派生值。 */
interface ScannedFile extends CachedFileContent {
  hasFrontmatter: boolean;
  hasLinks: boolean;
  hasTags: boolean;
  isActive: boolean;
  isInbox: boolean;
}

interface CachedScanEntry {
  mtime: number;
  size: number;
  content: CachedFileContent;
}

const DATE_IN_BASENAME = /(\d{4}-\d{2}-\d{2})/;

/**
 * 任务日期只认文件名里的日期，绝不看文件夹名（`2026-09-28/会议.md` 里的任务
 * 不该被算作 09-28 那天的任务）。口径与 archiveTasks.dailyNoteDate 一致，
 * 同样要求是真实存在的日历日。
 */
function noteDateInBasename(path: string): string | undefined {
  const basename = path.slice(path.lastIndexOf("/") + 1);
  const match = DATE_IN_BASENAME.exec(basename)?.[1];
  return match !== undefined && isCalendarDate(match) ? match : undefined;
}

export class VaultScanner {
  private inFlight: Promise<LocalDashboardData> | null = null;
  private fileCache = new Map<string, CachedScanEntry>();

  constructor(
    private readonly vault: Pick<Vault, "configDir" | "getMarkdownFiles" | "cachedRead">,
    private readonly metadataCache: Pick<MetadataCache, "getFileCache">,
    private readonly getSettings: () => AgentDashboardSettings,
    private readonly now: () => Date,
    private readonly getTags: TagResolver,
  ) {}

  scan(): Promise<LocalDashboardData> {
    if (this.inFlight !== null) return this.inFlight;
    const operation = this.scanOnce();
    this.inFlight = operation;
    void operation.then(
      () => this.clearInFlight(operation),
      () => this.clearInFlight(operation),
    );
    return operation;
  }

  /**
   * Scan that is guaranteed to start after this call. File-change refreshes use
   * it: reusing a scan that started before the edit would render the previous
   * file content under a fresh revision, and no further event may arrive to
   * correct it. Concurrent callers still share the single scan it starts.
   */
  scanFresh(): Promise<LocalDashboardData> {
    const running = this.inFlight;
    if (running === null) return this.scan();
    return running.catch(() => undefined).then(() => this.scan());
  }

  private async scanOnce(): Promise<LocalDashboardData> {
    const settings = this.getSettings();
    const exclusions = [
      ...BUILT_IN_EXCLUSIONS,
      this.vault.configDir,
      settings.cacheFolder,
      settings.reportsFolder,
    ];
    const files = this.vault
      .getMarkdownFiles()
      .filter((file) => !exclusions.some((folder) => isPathWithin(file.path, folder)))
      .sort((left, right) => compareVaultPaths(left.path, right.path));
    const tasks: DashboardTask[] = [];
    const notes: RecentNote[] = [];
    const createdAt: number[] = [];
    let notesWithFrontmatter = 0;
    let notesWithLinks = 0;
    let notesWithTags = 0;
    let activeWithin90Days = 0;
    let inboxCount = 0;
    const scanTime = this.now();
    const activeThreshold = activityCutoff(scanTime);

    const previousCache = this.fileCache;
    const nextCache = new Map<string, CachedScanEntry>();
    const scannedFiles = (
      await mapWithConcurrency(files, SCAN_CONCURRENCY, async (file): Promise<ScannedFile | undefined> => {
        // 派生值每次扫描都按当次的 scanTime/settings/metadataCache 重算，绝不进缓存：
        // isActive 依赖跨天变化的 activityCutoff，isInbox 依赖可改的收件箱设置，
        // 三个 metadata 标志依赖索引是否已经跟上这次文件改动。
        // getFileCache 只是查内存表，不影响「缓存命中省掉一次 cachedRead」的收益。
        const metadata = this.metadataCache.getFileCache(file);
        const derived = {
          hasFrontmatter: metadata !== null && hasBusinessFrontmatter(metadata),
          hasLinks: metadata !== null &&
            ((metadata.links?.length ?? 0) > 0 || (metadata.frontmatterLinks?.length ?? 0) > 0),
          hasTags: metadata !== null && (this.getTags(metadata)?.length ?? 0) > 0,
          isActive: file.stat.mtime >= activeThreshold,
          isInbox: isPathWithin(file.path, settings.inboxFolder),
        };
        const cached = previousCache.get(file.path);
        if (cached !== undefined && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
          nextCache.set(file.path, cached);
          return { ...cached.content, ...derived };
        }
        try {
          const markdown = await this.vault.cachedRead(file);
          const content: CachedFileContent = {
            tasks: parseTasks(file.path, markdown).map((task) => {
              // Tasks are dated from their own 📅 token or their note's date-in-filename.
              // The file's modified day is deliberately NOT used: editing an old note
              // must never re-date its historical checkboxes to today.
              task.date = task.dueDate ?? noteDateInBasename(file.path);
              return task;
            }),
            note: { path: file.path, title: file.basename, modifiedAt: file.stat.mtime },
            createdAt: file.stat.ctime,
          };
          nextCache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, content });
          return { ...content, ...derived };
        } catch {
          // A file that is deleted or unreadable mid-scan must not fail the whole dashboard.
          return undefined;
        }
      })
    ).filter((scanned): scanned is ScannedFile => scanned !== undefined);
    this.fileCache = nextCache;

    for (const scanned of scannedFiles) {
      if (isTaskSourcePath(scanned.note.path, settings)) tasks.push(...scanned.tasks);
      notes.push(scanned.note);
      createdAt.push(scanned.createdAt);
      if (scanned.hasFrontmatter) notesWithFrontmatter += 1;
      if (scanned.hasLinks) notesWithLinks += 1;
      if (scanned.hasTags) notesWithTags += 1;
      if (scanned.isActive) activeWithin90Days += 1;
      if (scanned.isInbox) inboxCount += 1;
    }

    notes.sort((left, right) =>
      right.modifiedAt - left.modifiedAt || compareVaultPaths(left.path, right.path),
    );

    return {
      tasks,
      recentNotes: notes.slice(0, RECENT_NOTE_LIMIT),
      heatmap: buildHeatmap(createdAt, scanTime, 365),
      health: calculateHealthScore({
        noteCount: files.length,
        notesWithFrontmatter,
        notesWithLinks,
        notesWithTags,
        activeWithin90Days,
        inboxCount,
      }),
    };
  }

  private clearInFlight(operation: Promise<LocalDashboardData>): void {
    if (this.inFlight === operation) this.inFlight = null;
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const workerCount = Math.max(1, Math.min(items.length, Math.floor(concurrency)));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item !== undefined) results[index] = await mapper(item, index);
    }
  });
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find(
    (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
  );
  if (failure !== undefined) throw failure.reason;
  return results;
}

export function isPathWithin(path: string, folder: string): boolean {
  const normalizedPath = normalizeForComparison(path);
  const normalizedFolder = normalizeForComparison(folder);
  return normalizedFolder.length > 0 &&
    (normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`));
}

/**
 * Task scope is independent from the scan scope: notes outside the task folders
 * still feed recent notes, the heatmap, and the health score. Exclusions always
 * win; an empty include list means "every note may contribute tasks".
 */
export function isTaskSourcePath(
  path: string,
  settings: Pick<AgentDashboardSettings, "taskIncludeFolders" | "taskExcludeFolders">,
): boolean {
  if (settings.taskExcludeFolders.some((folder) => isPathWithin(path, folder))) return false;
  if (settings.taskIncludeFolders.length === 0) return true;
  return settings.taskIncludeFolders.some((folder) => isPathWithin(path, folder));
}

function normalizeForComparison(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").toLowerCase();
}

function compareVaultPaths(left: string, right: string): number {
  const normalizedLeft = normalizeForComparison(left);
  const normalizedRight = normalizeForComparison(right);
  if (normalizedLeft < normalizedRight) return -1;
  if (normalizedLeft > normalizedRight) return 1;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function hasBusinessFrontmatter(cache: CachedMetadata): boolean {
  return cache.frontmatter !== undefined &&
    Object.keys(cache.frontmatter).some((key) => key !== "position");
}

function activityCutoff(now: Date): number {
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - 89);
  return cutoff.getTime();
}

// 日期键的唯一实现在 domain/localDate（审查 D6）；这里转出一次，
// 视图与既有测试的 import 路径保持有效。
export { localDateKey } from "../../domain/localDate";
