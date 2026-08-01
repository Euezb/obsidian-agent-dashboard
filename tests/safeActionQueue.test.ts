import { describe, expect, it, vi } from "vitest";
import {
  persistSetting,
  SafeActionQueue,
  SafeButtonActionRunner,
} from "../src/settings/SafeActionQueue";

describe("SafeActionQueue", () => {
  it("serializes actions and isolates rejection without an unhandled returned promise", async () => {
    const order: string[] = [];
    const errors: unknown[] = [];
    const queue = new SafeActionQueue();
    const first = queue.run(async () => {
      order.push("first-start");
      await Promise.resolve();
      order.push("first-end");
      throw new Error("failed");
    }, (error) => errors.push(error));
    const second = queue.run(async () => { order.push("second"); return 2; }, (error) => errors.push(error));

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBe(2);
    expect(order).toEqual(["first-start", "first-end", "second"]);
    expect(errors).toHaveLength(1);
  });

  it("rolls back the in-memory setting and reports when saveData fails", async () => {
    const settings = { cacheFolder: "Dashboard/cache" };
    const report = vi.fn();
    const saved = await persistSetting(
      new SafeActionQueue(), settings, "cacheFolder", "New/cache",
      async () => { throw new Error("disk full"); }, report,
    );
    expect(saved).toBe(false);
    expect(settings.cacheFolder).toBe("Dashboard/cache");
    expect(report).toHaveBeenCalledOnce();
  });
});

describe("SafeButtonActionRunner", () => {
  it("disables during work, ignores duplicate runs, and restores after success", async () => {
    const states: boolean[] = [];
    let release!: () => void;
    const runner = new SafeButtonActionRunner(new SafeActionQueue());
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const control = { setDisabled: (value: boolean) => { states.push(value); } };
    const first = runner.run(control, action, vi.fn());
    const duplicate = runner.run(control, action, vi.fn());
    await Promise.resolve();
    expect(action).toHaveBeenCalledOnce();
    expect(states).toEqual([true]);
    release();
    await Promise.all([first, duplicate]);
    expect(states).toEqual([true, false]);
  });

  it("restores the button and reports failure without rejecting", async () => {
    const states: boolean[] = [];
    const report = vi.fn();
    const runner = new SafeButtonActionRunner(new SafeActionQueue());
    await expect(runner.run(
      { setDisabled: (value) => { states.push(value); } },
      async () => { throw new Error("failed"); }, report,
    )).resolves.toBeUndefined();
    expect(states).toEqual([true, false]);
    expect(report).toHaveBeenCalledOnce();
  });
});
