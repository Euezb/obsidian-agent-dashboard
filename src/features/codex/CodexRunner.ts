import type { Stats } from "node:fs";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { fsPath } from "../../infrastructure/fsPath";
import { CACHE_SCHEMA_VERSION } from "../../constants";
import type { CacheEnvelope } from "../../domain/cacheSchemas";
import type { DailyBrief } from "../../domain/types";
import type { ProcessAdapter, ProcessHandle } from "../../infrastructure/ProcessAdapter";

export const CODEX_RUNNER_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_DAILY_BRIEF_BYTES = 1024 * 1024;
export type CodexTaskId = "daily-ai-brief" | "deep-research" | "vault-lint-explanation";
export type RunnerPathExpectation =
  "existing-file" | "new-file" | "directory" | "directory-or-new";

export interface TaskArgumentContext {
  vaultRoot: string;
  schemaPath: string;
  outputPath: string;
}

export interface RunnerFilePort {
  mkdir(directory: string): Promise<void>;
  assertSafePath(
    vaultRoot: string,
    target: string,
    expectation?: RunnerPathExpectation,
  ): Promise<void>;
  writeNewText(file: string, content: string): Promise<void>;
  readTextLimited(file: string, maxBytes: number): Promise<string>;
  remove(file: string): Promise<void>;
}

export interface RunnerCachePort {
  write(name: string, envelope: CacheEnvelope<DailyBrief>): Promise<void>;
}

export interface CodexRunnerDependencies {
  process: ProcessAdapter;
  files: RunnerFilePort;
  cache: RunnerCachePort;
  vaultRoot: string;
  cacheFolder: string;
  resolveExecutable: () => Promise<string>;
  now?: () => number;
  nonce?: () => string;
}

export class UnknownCodexTaskError extends Error {
  constructor() { super("Unknown Codex task."); this.name = "UnknownCodexTaskError"; }
}
export class UnsafeRunnerPathError extends Error {
  constructor() { super("Unsafe runner path."); this.name = "UnsafeRunnerPathError"; }
}
export class InvalidCodexOutputError extends Error {
  constructor() { super("Invalid Codex output."); this.name = "InvalidCodexOutputError"; }
}
export class RunnerTimeoutError extends Error {
  constructor() { super("Codex task timed out."); this.name = "RunnerTimeoutError"; }
}
export class CodexProcessError extends Error {
  readonly exitCode: number | null;
  constructor(exitCode: number | null) {
    super(`Codex task failed with exit code ${exitCode === null ? "unknown" : String(exitCode)}.`);
    this.name = "CodexProcessError";
    this.exitCode = exitCode;
  }
}
export class TaskAlreadyRunningError extends Error {
  constructor() { super("Codex task is already running."); this.name = "TaskAlreadyRunningError"; }
}
export class InvalidRunnerDateError extends Error {
  constructor() { super("Invalid runner date."); this.name = "InvalidRunnerDateError"; }
}
export class RunnerUnloadedError extends Error {
  constructor() { super("Codex runner is unloaded."); this.name = "RunnerUnloadedError"; }
}
export class RunnerOutputTooLargeError extends Error {
  constructor() { super("Codex output exceeded the allowed limit."); this.name = "RunnerOutputTooLargeError"; }
}

export function resolveTaskArguments(taskId: string, context: TaskArgumentContext): string[] {
  if (taskId === "daily-ai-brief") {
    return [
      "exec", "--cd", context.vaultRoot, "--skip-git-repo-check", "--sandbox", "workspace-write",
      "--output-schema", context.schemaPath,
      "--output-last-message", context.outputPath,
      "-",
    ];
  }
  if (taskId === "deep-research" || taskId === "vault-lint-explanation") {
    return [
      "exec", "--cd", context.vaultRoot, "--skip-git-repo-check", "--sandbox", "read-only",
      "--output-last-message", context.outputPath,
      "-",
    ];
  }
  throw new UnknownCodexTaskError();
}

export class NodeRunnerFilePort implements RunnerFilePort {
  async mkdir(directory: string): Promise<void> { await mkdir(directory, { recursive: true }); }
  async assertSafePath(
    vaultRoot: string,
    target: string,
    expectation?: RunnerPathExpectation,
  ): Promise<void> {
    if (!fsPath.isAbsolute(vaultRoot) || !fsPath.isAbsolute(target) ||
      !isPathWithin(vaultRoot, target)) throw new UnsafeRunnerPathError();
    let realVault: string;
    try { realVault = fsPath.normalize(await realpath(vaultRoot)); } catch { throw new UnsafeRunnerPathError(); }
    const targetStat = await optionalLstat(target);
    if (targetStat?.isSymbolicLink() === true) throw new UnsafeRunnerPathError();

    let current = fsPath.normalize(target);
    const filesystemRoot = fsPath.parse(current).root;
    let nearestReal: string | undefined;
    while (true) {
      const currentStat = await optionalLstat(current);
      if (currentStat !== undefined) {
        if (currentStat.isSymbolicLink()) throw new UnsafeRunnerPathError();
        if (nearestReal === undefined) {
          try { nearestReal = fsPath.normalize(await realpath(current)); }
          catch { throw new UnsafeRunnerPathError(); }
        }
      }
      if (current.toLowerCase() === filesystemRoot.toLowerCase()) break;
      const parent = fsPath.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (nearestReal === undefined || !isPathWithin(realVault, nearestReal)) {
      throw new UnsafeRunnerPathError();
    }

    if (expectation === "existing-file" && (targetStat === undefined || !targetStat.isFile())) {
      throw new UnsafeRunnerPathError();
    }
    if (expectation === "directory" && (targetStat === undefined || !targetStat.isDirectory())) {
      throw new UnsafeRunnerPathError();
    }
    if (expectation === "directory-or-new" &&
      targetStat !== undefined && !targetStat.isDirectory()) {
      throw new UnsafeRunnerPathError();
    }
    if (expectation === "new-file") {
      if (targetStat !== undefined) throw new UnsafeRunnerPathError();
      const parentStat = await optionalLstat(fsPath.dirname(target));
      if (parentStat === undefined || parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
        throw new UnsafeRunnerPathError();
      }
    }
    if (expectation === undefined && targetStat !== undefined && !targetStat.isFile()) {
      throw new UnsafeRunnerPathError();
    }
  }

  async writeNewText(file: string, content: string): Promise<void> {
    const handle = await open(file, "wx");
    try { await handle.writeFile(content, "utf8"); } finally { await handle.close(); }
  }

  async readTextLimited(file: string, maxBytes: number): Promise<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RunnerOutputTooLargeError();
    const handle = await open(file, "r");
    try {
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size > maxBytes) throw new RunnerOutputTooLargeError();
      const chunks: Buffer[] = [];
      let total = 0;
      while (total <= maxBytes) {
        const capacity = Math.min(64 * 1024, maxBytes + 1 - total);
        if (capacity <= 0) break;
        const buffer = Buffer.allocUnsafe(capacity);
        const { bytesRead } = await handle.read(buffer, 0, capacity, total);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) throw new RunnerOutputTooLargeError();
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const trailing = Buffer.allocUnsafe(1);
      if ((await handle.read(trailing, 0, 1, total)).bytesRead > 0) {
        throw new RunnerOutputTooLargeError();
      }
      return Buffer.concat(chunks, total).toString("utf8");
    } finally {
      await handle.close();
    }
  }
  async remove(file: string): Promise<void> { await rm(file, { force: true }); }
}

export interface LastTaskResult {
  exitCode: number | null;
  startedAt: number;
  finishedAt: number;
  succeeded: boolean;
  timedOut: boolean;
}

export type TaskState = { status: "idle" } | { status: "running" } |
  ({ status: "finished" } & LastTaskResult);

interface ActiveTaskRecord {
  handle: ProcessHandle | null;
  cancelled: boolean;
  startedAt: number;
}

export class CodexRunner {
  private readonly vaultRoot: string;
  private readonly cacheRoot: string;
  private readonly promptRoot: string;
  private readonly now: () => number;
  private readonly nonce: () => string;
  private readonly active = new Map<CodexTaskId, ActiveTaskRecord>();
  private readonly last = new Map<CodexTaskId, LastTaskResult>();
  private disposed = false;

  constructor(private readonly dependencies: CodexRunnerDependencies) {
    if (!fsPath.isAbsolute(dependencies.vaultRoot)) throw new UnsafeRunnerPathError();
    this.vaultRoot = fsPath.resolve(dependencies.vaultRoot);
    validateRelativeFolder(dependencies.cacheFolder);
    this.cacheRoot = resolveContained(this.vaultRoot, dependencies.cacheFolder);
    this.promptRoot = resolveContained(this.vaultRoot, fsPath.join(dependencies.cacheFolder, "prompts"));
    this.now = dependencies.now ?? Date.now;
    this.nonce = dependencies.nonce ?? (() => crypto.randomUUID());
  }

  getStatus(taskId: CodexTaskId): TaskState {
    if (this.active.has(taskId)) return { status: "running" };
    const result = this.last.get(taskId);
    return result === undefined ? { status: "idle" } : { status: "finished", ...result };
  }

  getLastResult(taskId: CodexTaskId): LastTaskResult | undefined {
    return this.last.get(taskId);
  }

  async runDailyBrief(date: string): Promise<DailyBrief> {
    const taskId: CodexTaskId = "daily-ai-brief";
    if (this.disposed) throw new RunnerUnloadedError();
    if (this.active.has(taskId)) throw new TaskAlreadyRunningError();
    if (!isCalendarDate(date)) throw new InvalidRunnerDateError();
    const startedAt = this.now();
    const record: ActiveTaskRecord = { handle: null, cancelled: false, startedAt };
    this.active.set(taskId, record);
    let succeeded = false;
    let exitCode: number | null = null;
    let timedOut = false;
    let outputPath: string | undefined;
    let promptPath: string | undefined;
    let schemaPath: string | undefined;
    try {
      this.assertNotCancelled(record);
      const nonce = this.nonce();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(nonce)) throw new UnsafeRunnerPathError();
      promptPath = resolveContained(this.promptRoot, `daily-ai-brief-${date}-${nonce}.md`);
      schemaPath = resolveContained(this.promptRoot, `daily-ai-brief-${nonce}.schema.json`);
      outputPath = resolveContained(this.cacheRoot, `ai-news-summary.tmp-${nonce}.json`);
      const sourcePath = resolveContained(this.cacheRoot, "ai-news-sources.json");
      const finalPath = resolveContained(this.cacheRoot, "ai-news-summary.json");
      const sourceVaultPath = fsPath.relative(this.vaultRoot, sourcePath).replaceAll("\\", "/");
      const prompt = dailyBriefPrompt(date, sourceVaultPath);

      await this.dependencies.files.assertSafePath(
        this.vaultRoot,
        this.promptRoot,
        "directory-or-new",
      );
      this.assertNotCancelled(record);
      await this.dependencies.files.mkdir(this.promptRoot);
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, this.promptRoot, "directory");
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, sourcePath, "existing-file");
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, promptPath, "new-file");
      this.assertNotCancelled(record);
      await this.dependencies.files.writeNewText(promptPath, prompt);
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, schemaPath, "new-file");
      this.assertNotCancelled(record);
      await this.dependencies.files.writeNewText(schemaPath, `${JSON.stringify(DAILY_BRIEF_SCHEMA, null, 2)}\n`);
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, outputPath, "new-file");
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, this.cacheRoot, "directory");
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, finalPath);
      this.assertNotCancelled(record);

      const executable = await this.dependencies.resolveExecutable();
      this.assertNotCancelled(record);
      const handle = this.dependencies.process.start({
        executable,
        args: resolveTaskArguments(taskId, {
          vaultRoot: this.vaultRoot,
          schemaPath,
          outputPath,
        }),
        cwd: this.vaultRoot,
        stdin: prompt,
        timeoutMs: CODEX_RUNNER_TIMEOUT_MS,
      });
      record.handle = handle;
      const result = await handle.completion;
      exitCode = result.exitCode;
      timedOut = result.timedOut;
      this.assertNotCancelled(record);
      if (result.timedOut) throw new RunnerTimeoutError();
      if (result.exitCode !== 0) {
        // The thrown error deliberately stays generic (stderr may contain secrets);
        // the snippet goes to the devtools console so failures are diagnosable locally.
        console.error(
          "[agent-dashboard] Codex daily brief failed:",
          summarizeProcessOutput(result.stderr) ?? summarizeProcessOutput(result.stdout) ??
            `exit code ${result.exitCode}`,
        );
        throw new CodexProcessError(result.exitCode);
      }
      await this.dependencies.files.assertSafePath(this.vaultRoot, outputPath, "existing-file");
      this.assertNotCancelled(record);
      const parsed: unknown = JSON.parse(
        await this.dependencies.files.readTextLimited(outputPath, MAX_DAILY_BRIEF_BYTES),
      );
      this.assertNotCancelled(record);
      const modelBrief = validateModelBrief(parsed, date);
      const generatedAt = this.now();
      const brief: DailyBrief = { date: modelBrief.date, generatedAt, items: modelBrief.items };
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, finalPath);
      this.assertNotCancelled(record);
      await this.dependencies.cache.write("ai-news-summary", {
        schemaVersion: CACHE_SCHEMA_VERSION,
        generatedAt,
        source: "codex-daily-ai-brief",
        data: brief,
      });
      this.assertNotCancelled(record);
      succeeded = true;
      return brief;
    } catch (error) {
      if (error instanceof SyntaxError) throw new InvalidCodexOutputError();
      throw error;
    } finally {
      if (this.active.get(taskId) === record) this.active.delete(taskId);
      this.last.set(taskId, {
        exitCode,
        startedAt,
        finishedAt: this.now(),
        succeeded,
        timedOut,
      });
      if (outputPath !== undefined) {
        try {
          await this.dependencies.files.assertSafePath(this.vaultRoot, outputPath, "existing-file");
          await this.dependencies.files.remove(outputPath);
        } catch { /* best-effort cleanup only after a fresh safety check */ }
      }
      // Prompt/schema files are single-run artifacts; never let them accumulate.
      for (const artifact of [promptPath, schemaPath]) {
        if (artifact === undefined) continue;
        try {
          await this.dependencies.files.assertSafePath(this.vaultRoot, artifact, "existing-file");
          await this.dependencies.files.remove(artifact);
        } catch { /* best-effort cleanup only after a fresh safety check */ }
      }
    }
  }

  /**
   * Runs a read-only research task and returns the model's final message.
   * No prompt/schema files are planted; the only artifact is a temporary
   * output file inside the cache root, always cleaned up afterwards.
   */
  async runResearch(
    taskId: "deep-research" | "vault-lint-explanation",
    prompt: string,
  ): Promise<string> {
    if (this.disposed) throw new RunnerUnloadedError();
    if (this.active.has(taskId)) throw new TaskAlreadyRunningError();
    if (prompt.trim() === "") throw new InvalidCodexOutputError();
    const startedAt = this.now();
    const record: ActiveTaskRecord = { handle: null, cancelled: false, startedAt };
    this.active.set(taskId, record);
    let succeeded = false;
    let exitCode: number | null = null;
    let timedOut = false;
    let outputPath: string | undefined;
    try {
      this.assertNotCancelled(record);
      const nonce = this.nonce();
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(nonce)) throw new UnsafeRunnerPathError();
      outputPath = resolveContained(this.cacheRoot, `${taskId}.tmp-${nonce}.md`);
      await this.dependencies.files.assertSafePath(this.vaultRoot, this.cacheRoot, "directory");
      this.assertNotCancelled(record);
      await this.dependencies.files.assertSafePath(this.vaultRoot, outputPath, "new-file");
      this.assertNotCancelled(record);

      const executable = await this.dependencies.resolveExecutable();
      this.assertNotCancelled(record);
      const handle = this.dependencies.process.start({
        executable,
        args: resolveTaskArguments(taskId, {
          vaultRoot: this.vaultRoot,
          schemaPath: "",
          outputPath,
        }),
        cwd: this.vaultRoot,
        stdin: prompt,
        timeoutMs: CODEX_RUNNER_TIMEOUT_MS,
      });
      record.handle = handle;
      const result = await handle.completion;
      exitCode = result.exitCode;
      timedOut = result.timedOut;
      this.assertNotCancelled(record);
      if (result.timedOut) throw new RunnerTimeoutError();
      if (result.exitCode !== 0) {
        console.error(
          `[agent-dashboard] Codex ${taskId} failed:`,
          summarizeProcessOutput(result.stderr) ?? summarizeProcessOutput(result.stdout) ??
            `exit code ${result.exitCode}`,
        );
        throw new CodexProcessError(result.exitCode);
      }
      await this.dependencies.files.assertSafePath(this.vaultRoot, outputPath, "existing-file");
      this.assertNotCancelled(record);
      const report = (await this.dependencies.files.readTextLimited(outputPath, MAX_DAILY_BRIEF_BYTES)).trim();
      if (report === "") throw new InvalidCodexOutputError();
      succeeded = true;
      return report;
    } finally {
      if (this.active.get(taskId) === record) this.active.delete(taskId);
      this.last.set(taskId, {
        exitCode,
        startedAt,
        finishedAt: this.now(),
        succeeded,
        timedOut,
      });
      if (outputPath !== undefined) {
        try {
          await this.dependencies.files.assertSafePath(this.vaultRoot, outputPath, "existing-file");
          await this.dependencies.files.remove(outputPath);
        } catch { /* best-effort cleanup only after a fresh safety check */ }
      }
    }
  }

  /** Cancels a single active task; the runner itself stays usable afterwards. */
  cancel(taskId: CodexTaskId): void {
    const record = this.active.get(taskId);
    if (record === undefined) return;
    record.cancelled = true;
    record.handle?.terminate();
  }

  terminateAll(): void {
    this.disposed = true;
    for (const record of this.active.values()) {
      record.cancelled = true;
      record.handle?.terminate();
    }
  }

  private assertNotCancelled(record: ActiveTaskRecord): void {
    if (this.disposed || record.cancelled) throw new RunnerUnloadedError();
  }
}

const DAILY_BRIEF_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["date", "items"],
  properties: {
    date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "url", "source", "summary"],
        properties: {
          title: { type: "string", minLength: 1 },
          url: { type: "string", minLength: 1 },
          source: { type: "string", minLength: 1 },
          summary: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

function dailyBriefPrompt(date: string, sourceVaultPath: string): string {
  return `你正在生成 ${date} 的每日 AI 新闻简报。\n` +
    `只读取 ${sourceVaultPath}；不要读取 Vault 中的其他文件。\n` +
    "用简洁中文概括每条新闻，保留原始来源 URL。\n" +
    "若条目带有 score（热度），优先详细概括 score 高的条目。\n" +
    "只返回符合 schema 的 JSON，不要写入任何文件。\n" +
    "不要输出凭据、令牌或其他私人内容。\n";
}

function summarizeProcessOutput(output: string): string | undefined {
  const collapsed = output.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;
  return collapsed.length <= 300 ? collapsed : `${collapsed.slice(0, 299)}…`;
}

function validateRelativeFolder(folder: string): void {
  if (folder.length === 0 || fsPath.isAbsolute(folder)) throw new UnsafeRunnerPathError();
  const segments = folder.replaceAll("/", "\\").split("\\");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new UnsafeRunnerPathError();
  }
}

function resolveContained(root: string, relative: string): string {
  if (fsPath.isAbsolute(relative)) throw new UnsafeRunnerPathError();
  const resolved = fsPath.resolve(root, relative);
  const relation = fsPath.relative(root, resolved);
  if (relation === "" || relation === ".") return resolved;
  if (relation.startsWith("..\\") || relation === ".." || fsPath.isAbsolute(relation)) {
    throw new UnsafeRunnerPathError();
  }
  return resolved;
}

function isPathWithin(root: string, target: string): boolean {
  const relation = fsPath.relative(fsPath.normalize(root), fsPath.normalize(target));
  return relation === "" || relation === "." ||
    (!relation.startsWith("..\\") && relation !== ".." && !fsPath.isAbsolute(relation));
}

async function optionalLstat(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new UnsafeRunnerPathError();
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateModelBrief(value: unknown, expectedDate: string): Pick<DailyBrief, "date" | "items"> {
  if (!isExactRecord(value, ["date", "items"]) || value.date !== expectedDate || !Array.isArray(value.items) ||
    value.items.length < 1 || value.items.length > 20) {
    throw new InvalidCodexOutputError();
  }
  const items = value.items.map((item): DailyBrief["items"][number] => {
    if (!isExactRecord(item, ["title", "url", "source", "summary"])) {
      throw new InvalidCodexOutputError();
    }
    const { title, url, source, summary } = item;
    if (![title, url, source, summary].every((field) =>
      typeof field === "string" && field.trim().length > 0 && field.length <= 4_096)) {
      throw new InvalidCodexOutputError();
    }
    let parsedUrl: URL;
    try { parsedUrl = new URL(url as string); } catch { throw new InvalidCodexOutputError(); }
    if ((parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") ||
      parsedUrl.username !== "" || parsedUrl.password !== "") {
      throw new InvalidCodexOutputError();
    }
    return {
      title: (title as string).trim(),
      url: parsedUrl.toString(),
      source: (source as string).trim(),
      summary: (summary as string).trim(),
    };
  });
  return { date: expectedDate, items };
}

function isExactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const ownKeys = Object.keys(value);
  return ownKeys.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
