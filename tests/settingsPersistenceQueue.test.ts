import { describe, expect, it } from "vitest";
import { SettingsPersistenceQueue } from "../src/settings/SettingsPersistenceQueue";

describe("SettingsPersistenceQueue", () => {
  it("serializes delayed saves and persists the latest complete settings without losing attempt date", async () => {
    const settings = { auto: true, attempt: "", feeds: ["one"] };
    const snapshots: typeof settings[] = [];
    const releases: Array<() => void> = [];
    const queue = new SettingsPersistenceQueue(settings, async (snapshot) => {
      snapshots.push(snapshot);
      await new Promise<void>((resolve) => releases.push(resolve));
    });

    const first = queue.update("auto", false);
    const second = queue.update("attempt", "2026-06-30");
    await Promise.resolve();
    expect(snapshots).toEqual([{ auto: false, attempt: "", feeds: ["one"] }]);
    releases.shift()?.();
    await first;
    await Promise.resolve();
    expect(snapshots[1]).toEqual({ auto: false, attempt: "2026-06-30", feeds: ["one"] });
    releases.shift()?.();
    await second;
    expect(settings).toEqual({ auto: false, attempt: "2026-06-30", feeds: ["one"] });
  });

  it("rolls back a failed save and remains retryable", async () => {
    const settings = { folder: "old" };
    let fail = true;
    const saved: Array<{ folder: string }> = [];
    const queue = new SettingsPersistenceQueue(settings, async (snapshot) => {
      if (fail) throw new Error("disk full");
      saved.push(snapshot);
    });
    await expect(queue.update("folder", "first")).rejects.toThrow("disk full");
    expect(settings.folder).toBe("old");
    fail = false;
    await expect(queue.update("folder", "second")).resolves.toBeUndefined();
    expect(saved).toEqual([{ folder: "second" }]);
  });
});
