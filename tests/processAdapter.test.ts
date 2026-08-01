import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  NodeProcessAdapter,
  ProcessOutputLimitError,
  TERMINATION_GRACE_MS,
  type SpawnRequest,
} from "../src/infrastructure/ProcessAdapter";

class FakeChild extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

const request: SpawnRequest = {
  executable: String.raw`C:\Tools\codex.exe`,
  args: ["exec", "-"],
  cwd: String.raw`<vault A>`,
  stdin: "prompt text",
  timeoutMs: 60_000,
};

describe("NodeProcessAdapter", () => {
  it("spawns without a shell, hides the window, pipes stdio, and returns captured output", async () => {
    const child = new FakeChild();
    const stdinChunks: Buffer[] = [];
    child.stdin.on("data", (chunk: Buffer) => stdinChunks.push(chunk));
    let call: { executable: string; args: readonly string[]; options: unknown } | undefined;
    let now = 10;
    const adapter = new NodeProcessAdapter((executable, args, options) => {
      call = { executable, args, options };
      return child as unknown as ChildProcessWithoutNullStreams;
    }, () => now);

    const handle = adapter.start(request);
    child.stdout.write("safe stdout");
    child.stderr.write("safe stderr");
    now = 20;
    child.emit("close", 0);

    await expect(handle.completion).resolves.toEqual({
      exitCode: 0,
      stdout: "safe stdout",
      stderr: "safe stderr",
      startedAt: 10,
      finishedAt: 20,
      timedOut: false,
    });
    expect(call).toEqual({
      executable: request.executable,
      args: request.args,
      options: { cwd: request.cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    });
    expect(Buffer.concat(stdinChunks).toString("utf8")).toBe(request.stdin);
  });

  it("kills and rejects when either captured stream exceeds the fixed byte limit", async () => {
    vi.useFakeTimers();
    try {
    const child = new FakeChild();
    const adapter = new NodeProcessAdapter(
      () => child as unknown as ChildProcessWithoutNullStreams,
      () => 1,
      3,
    );

    const handle = adapter.start(request);
    child.stderr.write("four");

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    let settled = false;
    void handle.completion.finally(() => { settled = true; }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(TERMINATION_GRACE_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(handle.completion).rejects.toBeInstanceOf(ProcessOutputLimitError);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a timed-out child and supports explicit termination", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const adapter = new NodeProcessAdapter(
        () => child as unknown as ChildProcessWithoutNullStreams,
        () => 1,
      );
      const handle = adapter.start({ ...request, timeoutMs: 10 });

      await vi.advanceTimersByTimeAsync(10);
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      child.emit("close", null);
      await expect(handle.completion).resolves.toMatchObject({ timedOut: true, exitCode: null });

      handle.terminate();
      expect(child.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("force-settles after grace when the child never closes and both kill calls throw", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      child.kill.mockImplementation(() => { throw new Error("kill unavailable"); });
      const adapter = new NodeProcessAdapter(
        () => child as unknown as ChildProcessWithoutNullStreams,
        () => 42,
      );
      const handle = adapter.start({ ...request, timeoutMs: 10 });

      await vi.advanceTimersByTimeAsync(10 + TERMINATION_GRACE_MS);

      await expect(handle.completion).resolves.toMatchObject({
        exitCode: null,
        timedOut: true,
        finishedAt: 42,
      });
      expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      child.emit("close", 1);
      await expect(handle.completion).resolves.toMatchObject({ exitCode: null, timedOut: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for close after a child error, then rejects once without leaking a late close", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const adapter = new NodeProcessAdapter(
        () => child as unknown as ChildProcessWithoutNullStreams,
        () => 1,
      );
      const handle = adapter.start(request);
      const failure = new Error("spawn failed");
      const rejection = expect(handle.completion).rejects.toBe(failure);

      child.emit("error", failure);
      await vi.advanceTimersByTimeAsync(TERMINATION_GRACE_MS);

      await rejection;
      child.emit("close", 1);
      await expect(handle.completion).rejects.toBe(failure);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps timeout as the first reason when late output overflow arrives", async () => {
    vi.useFakeTimers();
    try {
      const child = new FakeChild();
      const adapter = new NodeProcessAdapter(
        () => child as unknown as ChildProcessWithoutNullStreams,
        () => 1,
        3,
      );
      const handle = adapter.start({ ...request, timeoutMs: 10 });

      await vi.advanceTimersByTimeAsync(10);
      child.stderr.write("late overflow");
      child.emit("close", null);

      await expect(handle.completion).resolves.toMatchObject({ timedOut: true, exitCode: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps manual termination as the first reason when a late child error arrives", async () => {
    const child = new FakeChild();
    const adapter = new NodeProcessAdapter(
      () => child as unknown as ChildProcessWithoutNullStreams,
      () => 1,
    );
    const handle = adapter.start(request);

    handle.terminate();
    child.emit("error", new Error("late error"));
    child.emit("close", null);

    await expect(handle.completion).resolves.toMatchObject({ timedOut: false, exitCode: null });
  });
});
