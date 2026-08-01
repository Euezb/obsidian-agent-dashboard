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

interface ScannedFile {
  tasks: DashboardTask[];
  note: RecentNote;
  createdAt: number;
  hasFrontmatter: boolean;
  hasLinks: boolean;
  hasTags: boolean;
  isActive: boolean;
  isInbox: boolean;
}

interface CachedScanEntry {
  mtime: number;
  size: number;
  result: ScannedFile;
}

const NOTE_DATE_IN_PATH = /(\d{4}-\d{2}-\d{2})/;

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
        const cached = previousCache.get(file.path);
        if (cached !== undefined && cached.mtime === file.stat.mtime && cached.size === file.stat.size) {
          nextCache.set(file.path, cached);
          return cached.result;
        }
        try {
          const markdown = await this.vault.cachedRead(file);
          const cache = this.metadataCache.getFileCache(file);
          const result: ScannedFile = {
            tasks: parseTasks(file.path, markdown).map((task) => {
              task.date = NOTE_DATE_IN_PATH.exec(file.path)?.[1] ?? localDateKey(new Date(file.stat.mtime));
              return task;
            }),
            note: { path: file.path, title: file.basename, modifiedAt: file.stat.mtime },
            createdAt: file.stat.ctime,
            hasFrontmatter: cache !== null && hasBusinessFrontmatter(cache),
            hasLinks: cache !== null &&
              ((cache.links?.length ?? 0) > 0 || (cache.frontmatterLinks?.length ?? 0) > 0),
            hasTags: cache !== null && (this.getTags(cache)?.length ?? 0) > 0,
            isActive: file.stat.mtime >= activeThreshold,
            isInbox: isPathWithin(file.path, settings.inboxFolder),
          };
          nextCache.set(file.path, { mtime: file.stat.mtime, size: file.stat.size, result });
          return result;
        } catch {
          // A file that is deleted or unreadable mid-scan must not fail the whole dashboard.
          return undefined;
        }
      })
    ).filter((scanned): scanned is ScannedFile => scanned !== undefined);
    this.fileCache = nextCache;

    for (const scanned of scannedFiles) {
      tasks.push(...scanned.tasks);
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

export function localDateKey(date: Date): string {
  const year = date.getFullYear().toString().padStart(4, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}
