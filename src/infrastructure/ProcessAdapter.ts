import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat as fsLstat, realpath as fsRealpath, stat as fsStat } from "node:fs/promises";
import path from "node:path";
import { fsPath } from "./fsPath";

export const MAX_PROCESS_OUTPUT_BYTES = 1024 * 1024;
export const TERMINATION_GRACE_MS = 2_000;

export interface SpawnRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
}

export interface SpawnResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  startedAt: number;
  finishedAt: number;
  timedOut: boolean;
}

export interface ProcessHandle {
  completion: Promise<SpawnResult>;
  terminate(): void;
}

export interface ProcessAdapter {
  start(request: SpawnRequest): ProcessHandle;
}

export class ProcessOutputLimitError extends Error {
  constructor() {
    super("Process output exceeded the allowed limit.");
    this.name = "ProcessOutputLimitError";
  }
}

export class InvalidProcessRequestError extends Error {
  constructor() {
    super("Invalid process request.");
    this.name = "InvalidProcessRequestError";
  }
}

type SpawnProcess = (
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    shell: false;
    windowsHide: true;
    stdio: ["pipe", "pipe", "pipe"];
  },
) => ChildProcessWithoutNullStreams;

export class NodeProcessAdapter implements ProcessAdapter {
  constructor(
    private readonly spawnProcess: SpawnProcess = nodeSpawn,
    private readonly now: () => number = Date.now,
    private readonly maxOutputBytes = MAX_PROCESS_OUTPUT_BYTES,
  ) {}

  start(request: SpawnRequest): ProcessHandle {
    if (!path.isAbsolute(request.cwd) || request.timeoutMs <= 0 || !Number.isFinite(request.timeoutMs)) {
      throw new InvalidProcessRequestError();
    }

    const startedAt = this.now();
    const child = this.spawnProcess(request.executable, [...request.args], {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    let terminationStarted = false;
    let pendingError: unknown;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectCompletion!: (reason: unknown) => void;
    let resolveCompletion!: (result: SpawnResult) => void;

    const completion = new Promise<SpawnResult>((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    const clearTimers = (): void => {
      // eslint-disable-next-line obsidianmd/prefer-window-timers -- this desktop-only process adapter is not tied to an Obsidian window.
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      // eslint-disable-next-line obsidianmd/prefer-window-timers -- this desktop-only process adapter is not tied to an Obsidian window.
      if (graceTimer !== undefined) clearTimeout(graceTimer);
    };
    const cleanup = (): void => {
      clearTimers();
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onChildError);
      child.off("close", onClose);
      child.stdin.off("error", onStdinError);
    };
    const settle = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      cleanup();
      if (pendingError !== undefined) {
        rejectCompletion(pendingError);
        return;
      }
      resolveCompletion({
        exitCode,
        stdout,
        stderr,
        startedAt,
        finishedAt: this.now(),
        timedOut,
      });
    };
    const forceSettle = (): void => {
      if (settled) return;
      try { child.kill("SIGKILL"); } catch { /* forced settlement still proceeds */ }
      settle(null);
    };
    const beginTermination = (error?: unknown, fromTimeout = false): void => {
      if (settled) return;
      if (terminationStarted) return;
      if (error !== undefined && pendingError === undefined) pendingError = error;
      if (fromTimeout) timedOut = true;
      terminationStarted = true;
      // eslint-disable-next-line obsidianmd/prefer-window-timers -- this desktop-only process adapter is not tied to an Obsidian window.
      if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
      try { child.kill("SIGTERM"); } catch { /* grace timer guarantees convergence */ }
      if (settled) return;
      // eslint-disable-next-line obsidianmd/prefer-window-timers -- child-process convergence must survive popout window changes.
      graceTimer = setTimeout(forceSettle, TERMINATION_GRACE_MS);
    };
    const append = (stream: "stdout" | "stderr", chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stream === "stdout") {
        stdoutBytes += buffer.byteLength;
        if (stdoutBytes > this.maxOutputBytes) return beginTermination(new ProcessOutputLimitError());
        stdout += buffer.toString("utf8");
      } else {
        stderrBytes += buffer.byteLength;
        if (stderrBytes > this.maxOutputBytes) return beginTermination(new ProcessOutputLimitError());
        stderr += buffer.toString("utf8");
      }
    };

    const onStdout = (chunk: Buffer | string): void => append("stdout", chunk);
    const onStderr = (chunk: Buffer | string): void => append("stderr", chunk);
    const onChildError = (error: Error): void => beginTermination(error);
    const onClose = (exitCode: number | null): void => settle(exitCode);
    const onStdinError = (error: Error): void => beginTermination(error);
    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.on("error", onChildError);
    child.on("close", onClose);
    // eslint-disable-next-line obsidianmd/prefer-window-timers -- child-process lifetime must survive popout window changes.
    timeoutTimer = setTimeout(() => beginTermination(undefined, true), request.timeoutMs);
    child.stdin.on("error", onStdinError);
    child.stdin.end(request.stdin, "utf8");

    return {
      completion,
      terminate: () => beginTermination(),
    };
  }
}

export interface ExecutableResolutionDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  lstat?: (candidate: string) => Promise<ExecutablePathStat>;
  stat?: (candidate: string) => Promise<ExecutablePathStat>;
  realpath?: (candidate: string) => Promise<string>;
}

export interface ExecutablePathStat {
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

export class CodexExecutableNotFoundError extends Error {
  constructor() {
    super("A usable Codex executable was not found.");
    this.name = "CodexExecutableNotFoundError";
  }
}

export async function resolveCodexExecutable(
  configured: string,
  dependencies: ExecutableResolutionDependencies = {},
): Promise<string> {
  const env = dependencies.env ?? process.env;
  const fileSystem = {
    lstat: dependencies.lstat ?? fsLstat,
    stat: dependencies.stat ?? fsStat,
    realpath: dependencies.realpath ?? fsRealpath,
  };
  const candidates: string[] = [];

  if (configured !== "codex") {
    if (isSafeExecutablePath(configured)) candidates.push(fsPath.normalize(configured));
  } else {
    const override = env.CODEX_EXECUTABLE;
    if (override !== undefined && isSafeExecutablePath(override)) {
      candidates.push(fsPath.normalize(override));
    }
    for (const base of npmGlobalRoots(env)) {
      for (const architecture of [
        ["codex-win32-x64", "x86_64-pc-windows-msvc"],
        ["codex-win32-arm64", "aarch64-pc-windows-msvc"],
      ] as const) {
        candidates.push(fsPath.join(
          base,
          "node_modules", "@openai", "codex", "node_modules", "@openai", architecture[0],
          "vendor", architecture[1], "bin", "codex.exe",
        ));
      }
    }
  }

  for (const candidate of [...new Set(candidates)]) {
    try {
      const canonical = await canonicalExecutable(candidate, fileSystem);
      if (canonical !== null) return canonical;
    } catch {
      // Candidate probing is intentionally non-diagnostic and never exposes local paths.
    }
  }
  throw new CodexExecutableNotFoundError();
}

function npmGlobalRoots(env: Readonly<Record<string, string | undefined>>): string[] {
  const roots: string[] = [];
  if (env.LOCALAPPDATA !== undefined) {
    roots.push(fsPath.join(env.LOCALAPPDATA, "Programs", "nodejs"));
  }
  if (env.APPDATA !== undefined) roots.push(fsPath.join(env.APPDATA, "npm"));
  return roots;
}

function isSafeExecutablePath(candidate: string): boolean {
  if (candidate.replaceAll("/", "\\").split("\\").includes("..")) return false;
  const normalized = fsPath.normalize(candidate);
  return fsPath.isAbsolute(normalized) &&
    fsPath.extname(normalized).toLowerCase() === ".exe" &&
    !hasWindowsAppsSegment(normalized);
}

function hasWindowsAppsSegment(candidate: string): boolean {
  return candidate.replaceAll("/", "\\").split("\\")
    .some((segment) => segment.toLowerCase() === "windowsapps");
}

async function canonicalExecutable(
  candidate: string,
  fileSystem: Required<Pick<ExecutableResolutionDependencies, "lstat" | "stat" | "realpath">>,
): Promise<string | null> {
  if (!isSafeExecutablePath(candidate)) return null;
  await assertNoLinkedAncestor(candidate, fileSystem.lstat);
  if (!(await fileSystem.stat(candidate)).isFile()) return null;
  const canonical = fsPath.normalize(await fileSystem.realpath(candidate));
  if (!isSafeExecutablePath(canonical)) return null;
  await assertNoLinkedAncestor(canonical, fileSystem.lstat);
  if (!(await fileSystem.stat(canonical)).isFile()) return null;
  return canonical;
}

async function assertNoLinkedAncestor(
  candidate: string,
  readLinkStat: (candidate: string) => Promise<ExecutablePathStat>,
): Promise<void> {
  let current = fsPath.normalize(candidate);
  const root = fsPath.parse(current).root;
  while (true) {
    if ((await readLinkStat(current)).isSymbolicLink()) throw new CodexExecutableNotFoundError();
    if (current.toLowerCase() === root.toLowerCase()) return;
    const parent = fsPath.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}
