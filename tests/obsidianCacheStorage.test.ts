import { describe, expect, it } from "vitest";
import { ObsidianCacheStorage } from "../src/infrastructure/ObsidianCacheStorage";

class FakeAdapter {
  readonly existing = new Set<string>();
  readonly operations: string[] = [];
  failMkdir = new Set<string>();
  raceMkdir = new Set<string>();

  async exists(path: string): Promise<boolean> { return this.existing.has(path); }
  async read(path: string): Promise<string> { this.operations.push(`read:${path}`); return "data"; }
  async write(path: string, content: string): Promise<void> { this.operations.push(`write:${path}:${content}`); }
  async rename(from: string, to: string): Promise<void> { this.operations.push(`rename:${from}->${to}`); }
  async remove(path: string): Promise<void> { this.operations.push(`remove:${path}`); }
  async mkdir(path: string): Promise<void> {
    this.operations.push(`mkdir:${path}`);
    if (this.raceMkdir.has(path)) {
      this.existing.add(path);
      throw new Error("already exists");
    }
    if (this.failMkdir.has(path)) throw new Error("permission denied");
    this.existing.add(path);
  }
}

describe("ObsidianCacheStorage", () => {
  it("creates missing parent folders in order before writing", async () => {
    const adapter = new FakeAdapter();
    const storage = new ObsidianCacheStorage(adapter);

    await storage.write("Dashboard/cache/items.tmp.json", "content");

    expect(adapter.operations).toEqual([
      "mkdir:Dashboard",
      "mkdir:Dashboard/cache",
      "write:Dashboard/cache/items.tmp.json:content",
    ]);
  });

  it("tolerates concurrent mkdir when the folder exists after the failure", async () => {
    const adapter = new FakeAdapter();
    adapter.raceMkdir.add("Dashboard");
    const storage = new ObsidianCacheStorage(adapter);

    await expect(storage.write("Dashboard/cache/items.json", "content")).resolves.toBeUndefined();
    expect(adapter.operations).toContain("write:Dashboard/cache/items.json:content");
  });

  it("propagates mkdir failures when the folder still does not exist", async () => {
    const adapter = new FakeAdapter();
    adapter.failMkdir.add("Dashboard");
    const storage = new ObsidianCacheStorage(adapter);

    await expect(storage.write("Dashboard/cache/items.json", "content"))
      .rejects.toThrow("permission denied");
    expect(adapter.operations.some((value) => value.startsWith("write:"))).toBe(false);
  });

  it("delegates read, rename, remove, and exists without Node filesystem access", async () => {
    const adapter = new FakeAdapter();
    adapter.existing.add("item.json");
    const storage = new ObsidianCacheStorage(adapter);

    await expect(storage.exists("item.json")).resolves.toBe(true);
    await expect(storage.read("item.json")).resolves.toBe("data");
    await storage.rename("a", "b");
    await storage.remove("b");

    expect(adapter.operations).toEqual(["read:item.json", "rename:a->b", "remove:b"]);
  });

  it("replaces an existing file on adapters where rename cannot overwrite", async () => {
    const adapter = new WindowsRenameAdapter();
    adapter.files.set("items.json", "old");
    adapter.files.set("items.tmp.json", "new");
    const storage = new ObsidianCacheStorage(adapter);

    await storage.replace("items.tmp.json", "items.json", "items.backup.json");

    expect(adapter.files.get("items.json")).toBe("new");
    expect(adapter.files.has("items.backup.json")).toBe(false);
  });

  it("restores the old final when promoting the temporary file fails", async () => {
    const adapter = new WindowsRenameAdapter();
    adapter.files.set("items.json", "old");
    adapter.files.set("items.tmp.json", "new");
    adapter.failRenameFrom = "items.tmp.json";
    const storage = new ObsidianCacheStorage(adapter);

    await expect(storage.replace("items.tmp.json", "items.json", "items.backup.json"))
      .rejects.toThrow("rename failed");

    expect(adapter.files.get("items.json")).toBe("old");
    expect(adapter.files.has("items.backup.json")).toBe(false);
  });

  it("keeps a stale backup when its cleanup fails instead of failing the write", async () => {
    const adapter = new LockedBackupAdapter();
    adapter.files.set("items.json", "old");
    adapter.files.set("items.backup.json", "stale");
    adapter.files.set("items.tmp.json", "new");
    adapter.lockedPaths.add("items.backup.json");
    const storage = new ObsidianCacheStorage(adapter);

    await expect(storage.replace("items.tmp.json", "items.json", "items.backup.json"))
      .resolves.toBeUndefined();

    expect(adapter.files.get("items.json")).toBe("new");
    expect(adapter.files.has("items.tmp.json")).toBe(false);
    // The locked path is left behind on purpose; the fresh final always wins.
    expect(adapter.files.get("items.backup.json")).toBe("old");
  });

  it("does not lose the last valid value when two storage instances replace concurrently", async () => {
    const adapter = new WindowsRenameAdapter();
    adapter.files.set("items.json", "old");
    adapter.files.set("first.tmp.json", "first");
    adapter.files.set("second.tmp.json", "second");
    const first = new ObsidianCacheStorage(adapter);
    const second = new ObsidianCacheStorage(adapter);

    const results = await Promise.allSettled([
      first.replace("first.tmp.json", "items.json", "items.backup.json"),
      second.replace("second.tmp.json", "items.json", "items.backup.json"),
    ]);

    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect([adapter.files.get("items.json"), adapter.files.get("items.backup.json")])
      .toEqual(expect.arrayContaining([expect.stringMatching(/^(?:old|first|second)$/)]));
  });
});

/** fs.rename semantics (the target is overwritten) plus a path that cannot be unlinked. */
class LockedBackupAdapter {
  readonly files = new Map<string, string>();
  readonly lockedPaths = new Set<string>();

  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error("missing");
    return value;
  }
  async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async rename(from: string, to: string): Promise<void> {
    const value = this.files.get(from);
    if (value === undefined) throw new Error("missing");
    this.files.delete(from);
    this.files.set(to, value);
  }
  async remove(path: string): Promise<void> {
    if (this.lockedPaths.has(path)) throw new Error("EBUSY");
    this.files.delete(path);
  }
  async mkdir(): Promise<void> {}
}

class WindowsRenameAdapter {
  readonly files = new Map<string, string>();
  failRenameFrom: string | null = null;

  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error("missing");
    return value;
  }
  async write(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async rename(from: string, to: string): Promise<void> {
    if (from === this.failRenameFrom) throw new Error("rename failed");
    if (this.files.has(to)) throw new Error("target exists");
    const value = this.files.get(from);
    if (value === undefined) throw new Error("missing");
    this.files.delete(from);
    this.files.set(to, value);
  }
  async remove(path: string): Promise<void> { this.files.delete(path); }
  async mkdir(): Promise<void> {}
}
