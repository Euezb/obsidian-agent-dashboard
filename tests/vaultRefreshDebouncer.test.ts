import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_REFRESH_DEBOUNCE_MS } from "../src/constants";
import {
  isMarkdownVaultEvent,
  shouldRefreshForRename,
  VaultRefreshDebouncer,
} from "../src/infrastructure/VaultRefreshDebouncer";

afterEach(() => vi.useRealTimers());

describe("VaultRefreshDebouncer", () => {
  it("collapses a burst into one trailing local refresh after 350ms", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const debouncer = new VaultRefreshDebouncer(refresh);

    debouncer.trigger();
    vi.advanceTimersByTime(200);
    debouncer.trigger();
    vi.advanceTimersByTime(LOCAL_REFRESH_DEBOUNCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(refresh).toHaveBeenCalledOnce();
  });

  it("cancels pending work on unload", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const debouncer = new VaultRefreshDebouncer(refresh);

    debouncer.trigger();
    debouncer.cancel();
    vi.runAllTimers();

    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("Vault refresh event filtering", () => {
  it.each([
    [{ path: "Notes/Today.md", extension: "md" }, true],
    [{ path: "Notes/UPPER.MD" }, true],
    [{ path: "Dashboard/cache/github.json", extension: "json" }, false],
    [{ path: "Dashboard/cache/item.tmp-1.json" }, false],
    [{ path: "Notes", extension: "" }, false],
  ])("classifies Markdown-only events", (event, expected) => {
    expect(isMarkdownVaultEvent(event)).toBe(expected);
  });

  it("refreshes a rename when either the old or new path is Markdown", () => {
    expect(shouldRefreshForRename({ path: "Notes/Today.txt" }, "Notes/Today.md")).toBe(true);
    expect(shouldRefreshForRename({ path: "Notes/Today.md" }, "Notes/Today.txt")).toBe(true);
    expect(shouldRefreshForRename({ path: "Dashboard/cache/new.json" }, "Dashboard/cache/old.json"))
      .toBe(false);
  });
});
