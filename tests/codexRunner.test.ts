import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CacheEnvelope } from "../src/domain/cacheSchemas";
import type { DailyBrief } from "../src/domain/types";
import {
  CodexProcessError,
  CodexRunner,
  MAX_DAILY_BRIEF_BYTES,
  RunnerOutputTooLargeError,
  RunnerUnloadedError,
  RunnerTimeoutError,
  TaskAlreadyRunningError,
  UnknownCodexTaskError,
  UnsafeRunnerPathError,
  resolveTaskArguments,
  type RunnerCachePort,
  type RunnerFilePort,
} from "../src/features/codex/CodexRunner";
import {
  CodexExecutableNotFoundError,
  ProcessOutputLimitError,
  resolveCodexExecutable,
  type ExecutablePathStat,
  type ProcessAdapter,
  type ProcessHandle,
  type SpawnRequest,
  type SpawnResult,
} from "../src/infrastructure/ProcessAdapter";

const VAULT = String.raw`<vault A>`;
const EXE = String.raw`C:\Tools\codex.exe`;
const NOW = Date.parse("2026-06-29T08:00:00.000Z");

class MemoryFiles implements RunnerFilePort {
  readonly files = new Map<string, string>();
  readonly directories: string[] = [];
  readonly removed: string[] = [];
  readonly writeAttempts: string[] = [];
  readonly safetyChecks: Array<{ vaultRoot: string; target: string; expectation?: string }> = [];
  readonly unsafePaths = new Set<string>();
  readonly sizeOverrides = new Map<string, number>();
  readonly unsafeAfterRead = new Set<string>();
  writeGate?: Promise<void>;

  async mkdir(directory: string): Promise<void> { this.directories.push(directory); }
  async assertSafePath(
    vaultRoot: string,
    target: string,
    expectation?: "existing-file" | "new-file" | "directory" | "directory-or-new",
  ): Promise<void> {
    this.safetyChecks.push({ vaultRoot, target, ...(expectation === undefined ? {} : { expectation }) });
    if (this.unsafePaths.has(target)) throw new UnsafeRunnerPathError();
  }
  async read(file: string): Promise<string> {
    const value = this.files.get(file);
    if (value === undefined) throw new Error("missing file");
    return value;
  }
  async write(file: string, content: string): Promise<void> {
    this.writeAttempts.push(file);
    await this.writeGate;
    this.files.set(file, content);
  }
  async writeNewText(file: string, content: string): Promise<void> {
    this.writeAttempts.push(file);
    await this.writeGate;
    if (this.files.has(file)) throw new Error("EEXIST");
    this.files.set(file, content);
  }
  async readTextLimited(file: string, maxBytes: number): Promise<string> {
    const value = this.files.get(file);
    if (value === undefined) throw new Error("missing file");
    const size = this.sizeOverrides.get(file) ?? Buffer.byteLength(value);
    if (size > maxBytes) throw new RunnerOutputTooLargeError();
    if (this.unsafeAfterRead.has(file)) this.unsafePaths.add(file);
    return value;
  }
  async remove(file: string): Promise<void> { this.removed.push(file); this.files.delete(file); }
}

class RecordingCache implements RunnerCachePort {
  readonly writes: Array<{ name: string; envelope: CacheEnvelope<DailyBrief> }> = [];
  fail = false;
  async write(name: string, envelope: CacheEnvelope<DailyBrief>): Promise<void> {
    if (this.fail) throw new Error("cache unavailable");
    this.writes.push({ name, envelope });
  }
}

function processResult(overrides: Partial<SpawnResult> = {}): SpawnResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    startedAt: NOW,
    finishedAt: NOW + 1,
    timedOut: false,
    ...overrides,
  };
}

class FakeProcess implements ProcessAdapter {
  readonly requests: SpawnRequest[] = [];
  terminateCalls = 0;
  result: SpawnResult = processResult();
  beforeComplete?: (request: SpawnRequest) => void | Promise<void>;
  completion?: Promise<SpawnResult>;

  start(request: SpawnRequest): ProcessHandle {
    this.requests.push(request);
    const completion = this.completion ?? Promise.resolve().then(async () => {
      await this.beforeComplete?.(request);
      return this.result;
    });
    return { completion, terminate: () => { this.terminateCalls += 1; } };
  }
}

function validModelOutput(date = "2026-06-29"): string {
  return JSON.stringify({
    date,
    items: [{
      title: "OpenAI 发布新工具",
      url: "https://example.com/news",
      source: "Example",
      summary: "一段简洁的中文摘要。",
    }],
  });
}

function setup(options: {
  cacheFolder?: string;
  result?: SpawnResult;
  nonce?: () => string;
  resolveExecutable?: () => Promise<string>;
} = {}) {
  const files = new MemoryFiles();
  const cache = new RecordingCache();
  const process = new FakeProcess();
  const cacheFolder = options.cacheFolder ?? "Dashboard/cache";
  files.files.set(path.resolve(VAULT, cacheFolder, "ai-news-sources.json"), "[]");
  if (options.result !== undefined) process.result = options.result;
  process.beforeComplete = (request) => {
    const outputIndex = request.args.indexOf("--output-last-message");
    const outputPath = request.args[outputIndex + 1];
    if (outputPath !== undefined) files.files.set(outputPath, validModelOutput());
  };
  const runner = new CodexRunner({
    process,
    files,
    cache,
    vaultRoot: VAULT,
    cacheFolder,
    resolveExecutable: options.resolveExecutable ?? (async () => EXE),
    now: () => NOW,
    nonce: options.nonce ?? (() => "fixed"),
  });
  return { files, cache, process, runner };
}

describe("Codex task allowlist", () => {
  it("rejects an unknown task before producing arguments", () => {
    expect(() => resolveTaskArguments("anything-else", {
      vaultRoot: VAULT,
      schemaPath: String.raw`<vault A>\Dashboard\cache\schema.json`,
      outputPath: String.raw`<vault A>\Dashboard\cache\output.json`,
    })).toThrow(UnknownCodexTaskError);
  });

  it("keeps every allowlisted task free of bypass and shell arguments", () => {
    const context = {
      vaultRoot: VAULT,
      schemaPath: String.raw`<vault A>\Dashboard\cache\schema.json`,
      outputPath: String.raw`<vault A>\Dashboard\cache\output.json`,
    };
    const banned = /dangerously|danger-full-access|skip-(?:approval|sandbox)|(?:^|\s)(?:cmd|powershell|sh)(?:\s|$)/i;

    for (const task of ["daily-ai-brief", "deep-research", "vault-lint-explanation"] as const) {
      const args = resolveTaskArguments(task, context);
      expect(Array.isArray(args)).toBe(true);
      expect(args).toContain("--skip-git-repo-check");
      expect(args.join(" ")).not.toMatch(banned);
    }
  });
});

describe("CodexRunner daily brief", () => {
  it("derives the source file and prompt from a non-default cache folder", async () => {
    const context = setup({ cacheFolder: "Private/agent-cache" });

    await context.runner.runDailyBrief("2026-06-29");

    const sourcePath = path.resolve(VAULT, "Private/agent-cache/ai-news-sources.json");
    expect(context.files.safetyChecks).toContainEqual({
      vaultRoot: VAULT,
      target: sourcePath,
      expectation: "existing-file",
    });
    expect(context.process.requests[0]?.stdin).toContain(
      "只读取 Private/agent-cache/ai-news-sources.json",
    );
    expect(context.process.requests[0]?.stdin).not.toContain("Dashboard/cache");
  });

  it("writes constrained prompt/schema, uses exact safe arguments, validates output, and caches it", async () => {
    const context = setup();

    const brief = await context.runner.runDailyBrief("2026-06-29");

    expect(context.process.requests).toHaveLength(1);
    const request = context.process.requests[0];
    expect(request).toBeDefined();
    const promptDir = path.resolve(VAULT, "Dashboard/cache/prompts");
    const schemaPath = path.join(promptDir, "daily-ai-brief-fixed.schema.json");
    const outputPath = path.resolve(VAULT, "Dashboard/cache/ai-news-summary.tmp-fixed.json");
    const expectedPrompt = "你正在生成 2026-06-29 的每日 AI 新闻简报。\n" +
      "只读取 Dashboard/cache/ai-news-sources.json；不要读取 Vault 中的其他文件。\n" +
      "用简洁中文概括每条新闻，保留原始来源 URL。\n" +
      "若条目带有 score（热度），优先详细概括 score 高的条目。\n" +
      "只返回符合 schema 的 JSON，不要写入任何文件。\n" +
      "不要输出凭据、令牌或其他私人内容。\n";
    expect(request).toEqual({
      executable: EXE,
      args: ["exec", "--cd", VAULT, "--skip-git-repo-check", "--sandbox", "workspace-write", "--output-schema", schemaPath,
        "--output-last-message", outputPath, "-"],
      cwd: VAULT,
      stdin: expectedPrompt,
      timeoutMs: 600_000,
    });
    expect(request?.stdin).toContain("不要读取 Vault 中的其他文件");
    expect(request?.stdin).toContain("只返回符合 schema 的 JSON");
    const promptPath = path.join(promptDir, "daily-ai-brief-2026-06-29-fixed.md");
    expect(context.files.writeAttempts).toContain(promptPath);
    expect(context.files.writeAttempts).toContain(schemaPath);
    expect(brief).toEqual({
      date: "2026-06-29",
      generatedAt: NOW,
      items: [{
        title: "OpenAI 发布新工具",
        url: "https://example.com/news",
        source: "Example",
        summary: "一段简洁的中文摘要。",
      }],
    });
    expect(context.cache.writes).toEqual([{ name: "ai-news-summary", envelope: {
      schemaVersion: 1,
      generatedAt: NOW,
      source: "codex-daily-ai-brief",
      data: brief,
    } }]);
    expect(context.files.removed).toEqual(expect.arrayContaining([promptPath, schemaPath, outputPath]));
    expect(context.files.files.has(promptPath)).toBe(false);
    expect(context.files.files.has(schemaPath)).toBe(false);
    const cacheRoot = `${path.resolve(VAULT, "Dashboard/cache").toLowerCase()}${path.sep}`;
    for (const filePath of [...context.files.files.keys(), outputPath]) {
      expect(filePath.toLowerCase().startsWith(cacheRoot)).toBe(true);
    }
    expect(context.runner.getLastResult("daily-ai-brief")).toEqual({
      exitCode: 0,
      startedAt: NOW,
      finishedAt: NOW,
      succeeded: true,
      timedOut: false,
    });
    expect(context.files.safetyChecks).toEqual(expect.arrayContaining([
      { vaultRoot: VAULT, target: promptDir, expectation: "directory" },
      { vaultRoot: VAULT, target: path.resolve(VAULT, "Dashboard/cache/ai-news-sources.json"), expectation: "existing-file" },
      { vaultRoot: VAULT, target: path.join(promptDir, "daily-ai-brief-2026-06-29-fixed.md"), expectation: "new-file" },
      { vaultRoot: VAULT, target: schemaPath, expectation: "new-file" },
      { vaultRoot: VAULT, target: outputPath, expectation: "new-file" },
      { vaultRoot: VAULT, target: outputPath, expectation: "existing-file" },
      { vaultRoot: VAULT, target: path.resolve(VAULT, "Dashboard/cache/ai-news-summary.json") },
    ]));
  });

  it.each([
    ["wrong date", { date: "2026-06-28", items: [{ title: "x", url: "https://e.test", source: "x", summary: "x" }] }],
    ["extra root field", { date: "2026-06-29", items: [], secret: "x" }],
    ["URL credentials", { date: "2026-06-29", items: [{ title: "x", url: "https://user:pass@e.test", source: "x", summary: "x" }] }],
    ["empty field", { date: "2026-06-29", items: [{ title: " ", url: "https://e.test", source: "x", summary: "x" }] }],
    ["extra item field", { date: "2026-06-29", items: [{ title: "x", url: "https://e.test", source: "x", summary: "x", extra: true }] }],
  ])("rejects %s model output and still cleans the temp file", async (_case, value) => {
    const context = setup();
    context.process.beforeComplete = (request) => {
      const outputPath = request.args[request.args.indexOf("--output-last-message") + 1];
      if (outputPath !== undefined) context.files.files.set(outputPath, JSON.stringify(value));
    };

    await expect(context.runner.runDailyBrief("2026-06-29")).rejects.toThrow("Invalid Codex output.");
    expect(context.cache.writes).toEqual([]);
    expect(context.files.removed).toHaveLength(3);
  });

  it("rejects unsafe cache paths before file or process work", () => {
    expect(() => setup({ cacheFolder: "../outside" })).toThrow(UnsafeRunnerPathError);
    expect(() => setup({ cacheFolder: String.raw`C:\outside` })).toThrow(UnsafeRunnerPathError);
  });

  it.each(["", "../x", String.raw`..\..\x`, String.raw`C:\outside`, "a/b", String.raw`a\b`])(
    "rejects unsafe nonce %j before writing files or spawning",
    async (nonce) => {
      const context = setup({ nonce: () => nonce });

      await expect(context.runner.runDailyBrief("2026-06-29"))
        .rejects.toBeInstanceOf(UnsafeRunnerPathError);
      expect(context.files.writeAttempts).toEqual([]);
      expect(context.process.requests).toEqual([]);
      expect(context.cache.writes).toEqual([]);
    },
  );

  it("maps timeout and nonzero exit to stable typed errors without leaking stderr", async () => {
    const timeout = setup({ result: processResult({ timedOut: true, stderr: "token=secret" }) });
    await expect(timeout.runner.runDailyBrief("2026-06-29")).rejects.toBeInstanceOf(RunnerTimeoutError);
    expect(timeout.runner.getLastResult("daily-ai-brief")).toMatchObject({
      exitCode: 0, succeeded: false, timedOut: true, startedAt: NOW, finishedAt: NOW,
    });

    const failed = setup({ result: processResult({ exitCode: 17, stderr: "token=secret" }) });
    const rejection = failed.runner.runDailyBrief("2026-06-29");
    await expect(rejection).rejects.toBeInstanceOf(CodexProcessError);
    await expect(rejection).rejects.not.toThrow(/secret/);
    expect(failed.runner.getLastResult("daily-ai-brief")).toEqual({
      exitCode: 17,
      startedAt: NOW,
      finishedAt: NOW,
      succeeded: false,
      timedOut: false,
    });
  });

  it("records process success when validation or cache persistence later fails", async () => {
    const invalid = setup();
    invalid.process.beforeComplete = (request) => {
      const outputPath = request.args[request.args.indexOf("--output-last-message") + 1];
      if (outputPath !== undefined) invalid.files.files.set(outputPath, "{}");
    };
    await expect(invalid.runner.runDailyBrief("2026-06-29"))
      .rejects.toThrow("Invalid Codex output.");
    expect(invalid.runner.getLastResult("daily-ai-brief")).toMatchObject({
      exitCode: 0, succeeded: false, timedOut: false,
    });

    const cacheFailure = setup();
    cacheFailure.cache.fail = true;
    await expect(cacheFailure.runner.runDailyBrief("2026-06-29"))
      .rejects.toThrow("cache unavailable");
    expect(cacheFailure.runner.getLastResult("daily-ai-brief")).toMatchObject({
      exitCode: 0, succeeded: false, timedOut: false,
    });
  });

  it("clears active state when process output termination rejects without a close result", async () => {
    const context = setup();
    let rejectProcess!: (error: unknown) => void;
    context.process.completion = new Promise((_resolve, reject) => { rejectProcess = reject; });
    const running = context.runner.runDailyBrief("2026-06-29");
    await vi.waitFor(() => expect(context.process.requests).toHaveLength(1));
    rejectProcess(new ProcessOutputLimitError());

    await expect(running).rejects.toBeInstanceOf(ProcessOutputLimitError);

    expect(context.runner.getStatus("daily-ai-brief")).toMatchObject({
      status: "finished", exitCode: null, succeeded: false, timedOut: false,
    });
  });

  it("rejects an oversized model output after process exit zero and cleans it", async () => {
    const context = setup();
    context.process.beforeComplete = (request) => {
      const outputPath = request.args[request.args.indexOf("--output-last-message") + 1];
      if (outputPath !== undefined) {
        context.files.files.set(outputPath, validModelOutput());
        context.files.sizeOverrides.set(outputPath, MAX_DAILY_BRIEF_BYTES + 1);
      }
    };

    await expect(context.runner.runDailyBrief("2026-06-29"))
      .rejects.toBeInstanceOf(RunnerOutputTooLargeError);
    expect(context.runner.getLastResult("daily-ai-brief")).toMatchObject({
      exitCode: 0, succeeded: false, timedOut: false,
    });
    expect(context.cache.writes).toEqual([]);
    expect(context.files.removed).toHaveLength(3);
  });

  it("rejects unsafe source/cache paths and exclusive prompt preplants before spawn", async () => {
    const sourceUnsafe = setup();
    sourceUnsafe.files.unsafePaths.add(path.resolve(VAULT, "Dashboard/cache/ai-news-sources.json"));
    await expect(sourceUnsafe.runner.runDailyBrief("2026-06-29"))
      .rejects.toBeInstanceOf(UnsafeRunnerPathError);
    expect(sourceUnsafe.process.requests).toEqual([]);

    const cacheUnsafe = setup();
    cacheUnsafe.files.unsafePaths.add(path.resolve(VAULT, "Dashboard/cache/ai-news-summary.json"));
    await expect(cacheUnsafe.runner.runDailyBrief("2026-06-29"))
      .rejects.toBeInstanceOf(UnsafeRunnerPathError);
    expect(cacheUnsafe.process.requests).toEqual([]);

    const preplanted = setup();
    preplanted.files.files.set(
      path.resolve(VAULT, "Dashboard/cache/prompts/daily-ai-brief-2026-06-29-fixed.md"),
      "hostile",
    );
    await expect(preplanted.runner.runDailyBrief("2026-06-29"))
      .rejects.toThrow("EEXIST");
    expect(preplanted.process.requests).toEqual([]);
  });

  it("rejects an unsafe prompt ancestor before mkdir can create anything", async () => {
    const context = setup();
    const promptRoot = path.resolve(VAULT, "Dashboard/cache/prompts");
    context.files.unsafePaths.add(promptRoot);

    await expect(context.runner.runDailyBrief("2026-06-29"))
      .rejects.toBeInstanceOf(UnsafeRunnerPathError);

    expect(context.files.directories).toEqual([]);
    expect(context.process.requests).toEqual([]);
  });

  it("does not remove output when its path becomes unsafe during cleanup", async () => {
    const context = setup();
    const outputPath = path.resolve(VAULT, "Dashboard/cache/ai-news-summary.tmp-fixed.json");
    context.files.unsafeAfterRead.add(outputPath);

    await expect(context.runner.runDailyBrief("2026-06-29")).resolves.toMatchObject({
      date: "2026-06-29",
    });

    expect(context.files.removed).toEqual(expect.arrayContaining([
      path.resolve(VAULT, "Dashboard/cache/prompts/daily-ai-brief-2026-06-29-fixed.md"),
      path.resolve(VAULT, "Dashboard/cache/prompts/daily-ai-brief-fixed.schema.json"),
    ]));
    expect(context.files.removed).not.toContain(outputPath);
    expect(context.files.files.get(outputPath)).toBe(validModelOutput());
  });

  it("cancels during executable resolution and permanently rejects work after unload", async () => {
    let release!: (value: string) => void;
    const executable = new Promise<string>((resolve) => { release = resolve; });
    let resolverCalled = false;
    const context = setup({ resolveExecutable: () => {
      resolverCalled = true;
      return executable;
    } });
    const running = context.runner.runDailyBrief("2026-06-29");

    await vi.waitFor(() => expect(resolverCalled).toBe(true));
    context.runner.terminateAll();
    release(EXE);

    await expect(running).rejects.toBeInstanceOf(RunnerUnloadedError);
    await expect(context.runner.runDailyBrief("2026-06-29"))
      .rejects.toBeInstanceOf(RunnerUnloadedError);
    expect(context.process.requests).toEqual([]);
    expect(context.cache.writes).toEqual([]);
  });

  it("cancels after a pending prompt write without spawning or writing cache", async () => {
    const context = setup();
    let release!: () => void;
    context.files.writeGate = new Promise<void>((resolve) => { release = resolve; });
    const running = context.runner.runDailyBrief("2026-06-29");
    await vi.waitFor(() => expect(context.files.writeAttempts).toHaveLength(1));

    context.runner.terminateAll();
    release();

    await expect(running).rejects.toBeInstanceOf(RunnerUnloadedError);
    expect(context.process.requests).toEqual([]);
    expect(context.cache.writes).toEqual([]);
  });

  it("rejects duplicate work and terminates active work on unload", async () => {
    const context = setup();
    let finish!: (result: SpawnResult) => void;
    context.process.completion = new Promise((resolve) => { finish = resolve; });
    const first = context.runner.runDailyBrief("2026-06-29");
    await Promise.resolve();

    await expect(context.runner.runDailyBrief("2026-06-29"))
      .rejects.toBeInstanceOf(TaskAlreadyRunningError);
    expect(context.runner.getStatus("daily-ai-brief").status).toBe("running");
    await vi.waitFor(() => expect(context.process.requests).toHaveLength(1));
    context.runner.terminateAll();
    expect(context.process.terminateCalls).toBe(1);
    finish(processResult({ exitCode: 1 }));
    await expect(first).rejects.toBeInstanceOf(RunnerUnloadedError);
  });
});

describe("resolveCodexExecutable", () => {
  it("accepts only an existing absolute exe and discovers npm's native vendor binary", async () => {
    const expected = String.raw`C:\Users\Tester\AppData\Local\Programs\nodejs\node_modules\@openai\codex\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe`;
    const result = await resolveCodexExecutable("codex", {
      env: { LOCALAPPDATA: String.raw`C:\Users\Tester\AppData\Local`, APPDATA: String.raw`C:\Users\Tester\AppData\Roaming` },
      lstat: async () => regularExecutableStat(),
      stat: async (candidate) => candidate.toLowerCase() === expected.toLowerCase()
        ? regularExecutableStat()
        : missingExecutable(),
      realpath: async (candidate) => candidate,
    });
    expect(result).toBe(expected);
    expect(result).not.toContain("WindowsApps");
  });

  it.each([
    "codex.cmd",
    "../codex.exe",
    String.raw`C:\Tools\..\codex.exe`,
    String.raw`C:\WindowsApps\codex.exe`,
  ])(
    "rejects unsafe or unavailable executable %s",
    async (configured) => {
      await expect(resolveCodexExecutable(configured, {
        env: {},
        lstat: async () => missingExecutable(),
        stat: async () => missingExecutable(),
        realpath: async (candidate) => candidate,
      }))
        .rejects.toBeInstanceOf(CodexExecutableNotFoundError);
    },
  );

  it("rejects an absolute executable path containing traversal even if its normalized target exists", async () => {
    await expect(resolveCodexExecutable(String.raw`C:\Tools\..\codex.exe`, {
      env: {},
      lstat: async () => regularExecutableStat(),
      stat: async () => regularExecutableStat(),
      realpath: async (candidate) => candidate,
    })).rejects.toBeInstanceOf(CodexExecutableNotFoundError);
  });

  it.each([
    ["file symlink", String.raw`C:\Tools\codex.exe`],
    ["ancestor junction", String.raw`C:\Tools`],
  ])("rejects an executable with a %s", async (_case, unsafePath) => {
    const candidate = String.raw`C:\Tools\codex.exe`;
    await expect(resolveCodexExecutable(candidate, {
      env: {},
      lstat: async (checked) => checked.toLowerCase() === unsafePath.toLowerCase()
        ? symbolicExecutableStat()
        : regularExecutableStat(),
      stat: async () => regularExecutableStat(),
      realpath: async (checked) => checked,
    })).rejects.toBeInstanceOf(CodexExecutableNotFoundError);
  });

  it("rejects a canonical path that resolves into WindowsApps", async () => {
    await expect(resolveCodexExecutable(String.raw`C:\Tools\codex.exe`, {
      env: {},
      lstat: async () => regularExecutableStat(),
      stat: async () => regularExecutableStat(),
      realpath: async () => String.raw`C:\Program Files\WindowsApps\codex.exe`,
    })).rejects.toBeInstanceOf(CodexExecutableNotFoundError);
  });

  it("ignores relative and WindowsApps environment overrides without probing them", async () => {
    const checked: string[] = [];
    for (const override of ["codex.exe", String.raw`C:\Program Files\WindowsApps\codex.exe`]) {
      await expect(resolveCodexExecutable("codex", {
        env: { CODEX_EXECUTABLE: override },
        lstat: async (candidate) => { checked.push(candidate); return regularExecutableStat(); },
        stat: async () => regularExecutableStat(),
        realpath: async (candidate) => candidate,
      })).rejects.toBeInstanceOf(CodexExecutableNotFoundError);
    }
    expect(checked).toEqual([]);
  });
});

function regularExecutableStat(): ExecutablePathStat {
  return { isFile: () => true, isSymbolicLink: () => false };
}

function symbolicExecutableStat(): ExecutablePathStat {
  return { isFile: () => false, isSymbolicLink: () => true };
}

async function missingExecutable(): Promise<never> {
  throw Object.assign(new Error("missing"), { code: "ENOENT" });
}
