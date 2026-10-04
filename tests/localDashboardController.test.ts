import { describe, expect, it, vi } from "vitest";
import type { DashboardTask } from "../src/domain/types";
import type { LocalDashboardData } from "../src/features/vault/VaultScanner";
import { LocalDashboardController } from "../src/view/LocalDashboardController";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

function data(label: string): LocalDashboardData {
  return {
    tasks: [{ id: `${label}:0`, path: `${label}.md`, line: 0, text: label, completed: false }],
    recentNotes: [],
    heatmap: [],
    health: {
      score: null,
      breakdown: { frontmatter: 0, links: 0, tags: 0, activity: 0, inbox: 0 },
      suggestions: [],
      insufficientData: true,
    },
  };
}

function task(id: string): DashboardTask {
  return { id, path: "Tasks.md", line: 0, text: id, completed: false };
}

describe("LocalDashboardController", () => {
  it("allows only the latest scan request to apply", async () => {
    const first = deferred<LocalDashboardData>();
    const second = deferred<LocalDashboardData>();
    const scan = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const onReady = vi.fn();
    const controller = new LocalDashboardController({
      scan,
      toggleTask: vi.fn(),
      onReady,
      onScanError: vi.fn(),
      onToggleError: vi.fn(),
      now: () => 1,
    });

    const opening = controller.open();
    const refreshing = controller.refresh();
    second.resolve(data("new"));
    await refreshing;
    first.resolve(data("old"));
    await opening;

    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(data("new"), 1);
  });

  it("re-scans after a file change instead of reusing the scan that is already running", async () => {
    const running = deferred<LocalDashboardData>();
    const afterChange = deferred<LocalDashboardData>();
    const scan = vi.fn(() => running.promise);
    const scanAfterChange = vi.fn(() => afterChange.promise);
    const onReady = vi.fn();
    const controller = new LocalDashboardController({
      scan,
      scanAfterChange,
      toggleTask: vi.fn(),
      onReady,
      onScanError: vi.fn(),
      onToggleError: vi.fn(),
      now: () => 1,
    });

    const opening = controller.open();
    const refreshing = controller.refresh();
    afterChange.resolve(data("new"));
    await refreshing;
    running.resolve(data("old"));
    await opening;

    expect(scan).toHaveBeenCalledOnce();
    expect(scanAfterChange).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(data("new"), 1);
  });

  it("ignores a scan result arriving after close", async () => {
    const pending = deferred<LocalDashboardData>();
    const onReady = vi.fn();
    const controller = new LocalDashboardController({
      scan: () => pending.promise,
      toggleTask: vi.fn(),
      onReady,
      onScanError: vi.fn(),
      onToggleError: vi.fn(),
      now: () => 1,
    });

    const opening = controller.open();
    controller.close();
    pending.resolve(data("late"));
    await opening;

    expect(onReady).not.toHaveBeenCalled();
  });

  it("locks the same task while pending but allows a different task in parallel", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const toggleTask = vi.fn((candidate: DashboardTask) =>
      candidate.id === "one" ? first.promise : second.promise,
    );
    const controller = new LocalDashboardController({
      scan: vi.fn().mockResolvedValue(data("scan")),
      toggleTask,
      onReady: vi.fn(),
      onScanError: vi.fn(),
      onToggleError: vi.fn(),
      now: () => 1,
    });
    await controller.open();

    const one = controller.toggle(task("one"));
    const duplicate = controller.toggle(task("one"));
    const two = controller.toggle(task("two"));
    expect(toggleTask.mock.calls.map(([candidate]) => candidate.id)).toEqual(["one", "two"]);
    first.resolve();
    second.resolve();
    await Promise.all([one, duplicate, two]);
  });

  it("waits out an initial scan before starting the post-toggle fresh scan", async () => {
    const initial = deferred<LocalDashboardData>();
    const fresh = deferred<LocalDashboardData>();
    const scan = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(fresh.promise);
    const onReady = vi.fn();
    const controller = new LocalDashboardController({
      scan,
      toggleTask: vi.fn().mockResolvedValue(undefined),
      onReady,
      onScanError: vi.fn(),
      onToggleError: vi.fn(),
      now: () => 1,
    });

    const opening = controller.open();
    const toggling = controller.toggle(task("one"));
    await Promise.resolve();
    expect(scan).toHaveBeenCalledOnce();
    initial.resolve(data("old"));
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));
    fresh.resolve(data("new"));
    await Promise.all([opening, toggling]);

    expect(onReady).toHaveBeenCalledOnce();
    expect(onReady).toHaveBeenCalledWith(data("new"), 1);
  });
});
