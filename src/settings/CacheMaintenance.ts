import { lstat, readFile, readdir, rename, unlink } from "node:fs/promises";
import { fsPath } from "../infrastructure/fsPath";
import type { DataGuard } from "../domain/cacheSchemas";
import { NodeRunnerFilePort, type RunnerPathExpectation } from "../features/codex/CodexRunner";
import {
  FEED_CACHE_NAMES,
  isDailyBrief,
  isNewsItemArray,
  isTrendingRepoArray,
} from "../features/feeds/FeedService";
import { isValidCacheEnvelope } from "../infrastructure/CacheRepository";
import { normalizeVaultRelativeFolder } from "./settingsValidation";

const CACHE_GUARDS: Readonly<Record<string, DataGuard<unknown>>> = Object.freeze({
  [FEED_CACHE_NAMES.githubDaily]: isTrendingRepoArray,
  [FEED_CACHE_NAMES.githubWeekly]: isTrendingRepoArray,
  [FEED_CACHE_NAMES.aiNews]: isNewsItemArray,
  [FEED_CACHE_NAMES.dailyBrief]: isDailyBrief,
});

export interface CacheMaintenanceFilePort {
  kind(target: string): Promise<"missing" | "file" | "directory">;
  assertSafePath(
    vaultRoot: string,
    target: string,
    expectation?: RunnerPathExpectation,
  ): Promise<void>;
  list(directory: string): Promise<string[]>;
  read(file: string): Promise<string>;
  remove(file: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export class NodeCacheMaintenanceFilePort implements CacheMaintenanceFilePort {
  constructor(private readonly guard = new NodeRunnerFilePort()) {}

  async kind(target: string): Promise<"missing" | "file" | "directory"> {
    try {
      const stat = await lstat(target);
      if (stat.isFile()) return "file";
      if (stat.isDirectory()) return "directory";
      throw new UnsafeMaintenanceFolderError();
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return "missing";
      throw error;
    }
  }

  assertSafePath(
    vaultRoot: string,
    target: string,
    expectation?: RunnerPathExpectation,
  ): Promise<void> {
    return this.guard.assertSafePath(vaultRoot, target, expectation);
  }

  async list(directory: string): Promise<string[]> {
    return (await readdir(directory)).map((name) => fsPath.join(directory, name));
  }
  read(file: string): Promise<string> { return readFile(file, "utf8"); }
  async remove(file: string): Promise<void> { await unlink(file); }
  async rename(from: string, to: string): Promise<void> { await rename(from, to); }
}

export class UnsafeMaintenanceFolderError extends Error {
  constructor() {
    super("Unsafe cache folder.");
    this.name = "UnsafeMaintenanceFolderError";
  }
}

export class CacheMaintenance {
  // Pre/post checks harden trusted local use but are intentionally non-atomic; see docs/architecture.md.
  private readonly vaultRoot: string;

  constructor(
    private readonly files: CacheMaintenanceFilePort,
    vaultRoot: string,
    private readonly cacheFolder: () => string,
    private readonly now: () => number = Date.now,
  ) {
    if (!fsPath.isAbsolute(vaultRoot)) throw new UnsafeMaintenanceFolderError();
    this.vaultRoot = fsPath.normalize(vaultRoot);
  }

  async regenerate(): Promise<number> {
    const context = await this.openCacheFolder();
    if (context === null) return 0;
    const allowed = new Set(Object.keys(CACHE_GUARDS).flatMap((name) => [
      fsPath.join(context.root, `${name}.json`),
      fsPath.join(context.root, `${name}.backup.json`),
    ]));
    let removed = 0;
    for (const file of context.entries) {
      if (!allowed.has(file)) continue;
      await this.files.assertSafePath(this.vaultRoot, file, "existing-file");
      await this.files.remove(file);
      await this.files.assertSafePath(this.vaultRoot, file, "new-file");
      removed += 1;
    }
    return removed;
  }

  async quarantineCorrupt(): Promise<number> {
    const context = await this.openCacheFolder();
    if (context === null) return 0;
    let quarantined = 0;
    for (const [name, guard] of Object.entries(CACHE_GUARDS)) {
      const file = fsPath.join(context.root, `${name}.json`);
      if (!context.entries.includes(file)) continue;
      await this.files.assertSafePath(this.vaultRoot, file, "existing-file");
      const content = await this.files.read(file);
      await this.files.assertSafePath(this.vaultRoot, file, "existing-file");
      if (isCacheEnvelope(content, guard, this.now())) continue;
      const target = await this.nextQuarantinePath(file);
      await this.files.assertSafePath(this.vaultRoot, file, "existing-file");
      await this.files.assertSafePath(this.vaultRoot, target, "new-file");
      await this.files.rename(file, target);
      await this.files.assertSafePath(this.vaultRoot, file, "new-file");
      await this.files.assertSafePath(this.vaultRoot, target, "existing-file");
      quarantined += 1;
    }
    return quarantined;
  }

  private async openCacheFolder(): Promise<{ root: string; entries: string[] } | null> {
    const folder = normalizeVaultRelativeFolder(this.cacheFolder());
    if (folder === null) throw new UnsafeMaintenanceFolderError();
    const root = resolveContained(this.vaultRoot, folder);
    await this.files.assertSafePath(this.vaultRoot, this.vaultRoot, "directory");
    await this.files.assertSafePath(this.vaultRoot, root, "directory-or-new");
    const kind = await this.files.kind(root);
    if (kind === "missing") return null;
    if (kind !== "directory") throw new UnsafeMaintenanceFolderError();
    await this.files.assertSafePath(this.vaultRoot, root, "directory");
    const entries = await this.files.list(root);
    await this.files.assertSafePath(this.vaultRoot, root, "directory");
    return { root, entries: entries.filter((entry) => fsPath.dirname(entry) === root) };
  }

  private async nextQuarantinePath(file: string): Promise<string> {
    const stem = file.slice(0, -".json".length);
    const timestamp = Math.trunc(this.now());
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt}`;
      const candidate = `${stem}.corrupt-${timestamp}${suffix}.json`;
      await this.files.assertSafePath(this.vaultRoot, candidate);
      if (await this.files.kind(candidate) === "missing") return candidate;
    }
    throw new Error("Unable to allocate quarantine path.");
  }
}

export async function runConfirmed(
  confirm: () => Promise<boolean>,
  action: () => Promise<void>,
): Promise<void> {
  if (await confirm()) await action();
}

function isCacheEnvelope(content: string, guard: DataGuard<unknown>, now: number): boolean {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return false; }
  return isValidCacheEnvelope(value, guard, now);
}

function resolveContained(root: string, relative: string): string {
  const resolved = fsPath.resolve(root, relative);
  const relation = fsPath.relative(root, resolved);
  if (relation === "" || relation === "." || relation === ".." || relation.startsWith("..\\") ||
    fsPath.isAbsolute(relation)) throw new UnsafeMaintenanceFolderError();
  return resolved;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
