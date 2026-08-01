import { fsPath } from "../infrastructure/fsPath";
import type { ProcessAdapter, ProcessHandle } from "../infrastructure/ProcessAdapter";

const DETECTION_TIMEOUT_MS = 5_000;
const MAX_VERSION_TEXT = 512;

export class CodexDetectionError extends Error {
  constructor(message = "Codex detection failed.") {
    super(message);
    this.name = "CodexDetectionError";
  }
}

export class CodexDetector {
  private readonly cwd: string;
  private readonly active = new Set<ProcessHandle>();
  private disposed = false;

  constructor(
    private readonly process: ProcessAdapter,
    vaultRoot: string,
    private readonly resolveExecutable: (configured: string) => Promise<string>,
  ) {
    this.cwd = fsPath.normalize(vaultRoot);
    if (!fsPath.isAbsolute(this.cwd)) throw new CodexDetectionError("Invalid Vault root.");
  }

  async detect(configured: string): Promise<string> {
    if (this.disposed) throw new CodexDetectionError();
    const executable = await this.resolveExecutable(configured);
    if (this.disposed) throw new CodexDetectionError();
    if (!fsPath.isAbsolute(executable) || !/\.exe$/i.test(executable) ||
      fsPath.normalize(executable) !== executable) {
      throw new CodexDetectionError("Resolver did not return a canonical Codex executable.");
    }
    const handle = this.process.start({
      executable,
      args: ["--version"],
      cwd: this.cwd,
      stdin: "",
      timeoutMs: DETECTION_TIMEOUT_MS,
    });
    this.active.add(handle);
    let result;
    try {
      result = await handle.completion;
    } finally {
      this.active.delete(handle);
    }
    if (result.timedOut || result.exitCode !== 0) throw new CodexDetectionError();
    const version = (result.stdout.trim() || result.stderr.trim()).replace(/[\r\n]+/g, " ");
    if (version === "" || version.length > MAX_VERSION_TEXT) throw new CodexDetectionError();
    return version;
  }

  terminateAll(): void {
    this.disposed = true;
    for (const handle of this.active) handle.terminate();
  }
}
