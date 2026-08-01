import { describe, expect, it, vi } from "vitest";
import { commitControlValue } from "../src/settings/SettingControlPersistence";

describe("commitControlValue", () => {
  it("shows the canonical next value after a successful save", async () => {
    const setValue = vi.fn();
    await expect(commitControlValue(
      { setValue }, "Dashboard/cache", String.raw`Dashboard\new-cache`,
      (value) => value.replace(/\\/g, "/"), async () => true,
    )).resolves.toBe(true);
    expect(setValue).toHaveBeenCalledOnce();
    expect(setValue).toHaveBeenLastCalledWith("Dashboard/new-cache");
  });

  it("restores the previous canonical display when persistence reports failure", async () => {
    const values: string[] = [];
    const saved: string[] = [];
    await expect(commitControlValue(
      { setValue: (value: string) => { values.push(value); } },
      ["https://old.example/feed"],
      ["https://new.example/feed"],
      (feeds) => feeds.join("\n"),
      async (feeds) => { saved.push(...feeds); return false; },
    )).resolves.toBe(false);
    expect(saved).toEqual(["https://new.example/feed"]);
    expect(values).toEqual(["https://new.example/feed", "https://old.example/feed"]);
  });

  it("restores toggle state even if an unexpected persistence rejection escapes", async () => {
    const values: boolean[] = [];
    await expect(commitControlValue(
      { setValue: (value: boolean) => { values.push(value); } }, true, false,
      (value) => value, async () => { throw new Error("failed"); },
    )).resolves.toBe(false);
    expect(values).toEqual([false, true]);
  });
});
