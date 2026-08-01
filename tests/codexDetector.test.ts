import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CodexDetector } from "../src/settings/CodexDetector";
import type { ProcessAdapter, SpawnRequest } from "../src/infrastructure/ProcessAdapter";

describe("CodexDetector", () => {
  it("resolves a canonical executable then runs only --version with bounded execution", async () => {
    const requests: SpawnRequest[] = [];
    const process: ProcessAdapter = {
      start: (request) => {
        requests.push(request);
        return {
          terminate: vi.fn(),
          completion: Promise.resolve({
            exitCode: 0, stdout: "codex-cli 0.142.4\n", stderr: "",
            startedAt: 1, finishedAt: 2, timedOut: false,
          }),
        };
      },
    };
    const resolver = vi.fn(async () => String.raw`C:\Canonical\codex.exe`);
    const detector = new CodexDetector(process, String.raw`<vault A>`, resolver);

    await expect(detector.detect("codex")).resolves.toBe("codex-cli 0.142.4");
    expect(resolver).toHaveBeenCalledWith("codex");
    expect(requests).toEqual([{
      executable: String.raw`C:\Canonical\codex.exe`,
      args: ["--version"],
      cwd: path.win32.normalize(String.raw`<vault A>`),
      stdin: "",
      timeoutMs: 5_000,
    }]);
  });

  it("rejects a resolver result that is not an absolute canonical exe before spawning", async () => {
    const start = vi.fn();
    const detector = new CodexDetector({ start }, String.raw`D:\Vault`, async () => "codex.cmd");
    await expect(detector.detect("codex")).rejects.toThrow("canonical Codex executable");
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects timeout, nonzero exit, and oversized display output", async () => {
    const result = { exitCode: 1, stdout: "", stderr: "failed", startedAt: 1, finishedAt: 2, timedOut: false };
    const detector = new CodexDetector({
      start: () => ({ terminate: vi.fn(), completion: Promise.resolve(result) }),
    }, String.raw`D:\Vault`, async () => String.raw`C:\Codex\codex.exe`);
    await expect(detector.detect("codex")).rejects.toThrow("Codex detection failed");
  });

  it("accepts a canonical executable whose ordinary filename contains two dots", async () => {
    const detector = new CodexDetector({
      start: () => ({
        terminate: vi.fn(),
        completion: Promise.resolve({ exitCode: 0, stdout: "ok", stderr: "", startedAt: 1, finishedAt: 2, timedOut: false }),
      }),
    }, String.raw`D:\Vault`, async () => String.raw`C:\Tools\foo..bar.exe`);
    await expect(detector.detect("codex")).resolves.toBe("ok");
  });

  it("terminates an in-flight detection on unload", async () => {
    let finish!: (value: { exitCode: number | null; stdout: string; stderr: string; startedAt: number; finishedAt: number; timedOut: boolean }) => void;
    const terminate = vi.fn();
    const completion = new Promise<{
      exitCode: number | null; stdout: string; stderr: string;
      startedAt: number; finishedAt: number; timedOut: boolean;
    }>((resolve) => { finish = resolve; });
    const detector = new CodexDetector({
      start: () => ({ terminate, completion }),
    }, String.raw`D:\Vault`, async () => String.raw`C:\Tools\codex.exe`);
    const pending = detector.detect("codex");
    await Promise.resolve();
    detector.terminateAll();
    expect(terminate).toHaveBeenCalledOnce();
    finish({ exitCode: null, stdout: "", stderr: "", startedAt: 1, finishedAt: 2, timedOut: true });
    await expect(pending).rejects.toThrow();
  });
});
