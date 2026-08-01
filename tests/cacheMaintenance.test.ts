import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  CacheMaintenance,
  runConfirmed,
  type CacheMaintenanceFilePort,
} from "../src/settings/CacheMaintenance";

const VAULT = String.raw`D:\Vault`;
const CACHE = path.win32.join(VAULT, "Dashboard", "cache");
const cacheFile = (name: string): string => path.win32.join(CACHE, name);
const envelope = (data: unknown, generatedAt = 1_000): string => JSON.stringify({
  schemaVersion: 1, generatedAt, source: "test", data,
});
const repo = [{
  name: "sample/repo", url: "https://github.com/sample/repo", description: "",
  stars: 1, source: "github-trending",
}];

class MemoryPort implements CacheMaintenanceFilePort {
  readonly files = new Map<string, string>();
  readonly touched: string[] = [];
  readonly unsafe = new Set<string>();
  listError: Error | undefined;
  missingDirectory = false;
  unsafeRenamedTarget = false;

  async kind(target: string): Promise<"missing" | "file" | "directory"> {
    if (target === CACHE) return this.missingDirectory ? "missing" : "directory";
    return this.files.has(target) ? "file" : "missing";
  }
  async assertSafePath(_vaultRoot: string, target: string, expectation?: string): Promise<void> {
    this.touched.push(`guard:${target}`);
    if (this.unsafe.has(target) ||
      (this.unsafeRenamedTarget && target.includes(".corrupt-") && this.files.has(target))) {
      throw new Error("unsafe junction");
    }
    if (expectation === "directory-or-new" && this.files.has(target)) {
      throw new Error("expected directory or missing");
    }
  }
  async list(_directory: string): Promise<string[]> {
    this.touched.push(`list:${CACHE}`);
    if (this.listError !== undefined) throw this.listError;
    return [...this.files.keys()].filter((file) => path.win32.dirname(file) === CACHE);
  }
  async read(file: string): Promise<string> {
    this.touched.push(`read:${file}`);
    const value = this.files.get(file);
    if (value === undefined) throw new Error("missing");
    return value;
  }
  async remove(file: string): Promise<void> {
    this.touched.push(`remove:${file}`); this.files.delete(file);
  }
  async rename(from: string, to: string): Promise<void> {
    this.touched.push(`rename:${from}->${to}`);
    const value = this.files.get(from);
    if (value === undefined) throw new Error("missing");
    this.files.delete(from); this.files.set(to, value);
  }
}

const maintenance = (port: MemoryPort, now = 2_000) =>
  new CacheMaintenance(port, VAULT, () => "Dashboard/cache", () => now);

describe("CacheMaintenance", () => {
  it("regenerates only allowlisted direct cache artifacts and checks paths before and after removal", async () => {
    const port = new MemoryPort();
    port.files.set(cacheFile("github-daily.json"), "{}");
    port.files.set(cacheFile("github-daily.backup.json"), "{}");
    port.files.set(path.win32.join(CACHE, "prompts", "schema.json"), "{}");
    port.files.set(cacheFile("user-note.md"), "keep");

    await expect(maintenance(port).regenerate()).resolves.toBe(2);
    expect(port.touched).toContain(`remove:${cacheFile("github-daily.json")}`);
    const removeIndex = port.touched.indexOf(`remove:${cacheFile("github-daily.json")}`);
    expect(port.touched[removeIndex - 1]).toBe(`guard:${cacheFile("github-daily.json")}`);
    expect(port.touched[removeIndex + 1]).toBe(`guard:${cacheFile("github-daily.json")}`);
    expect(port.files.has(cacheFile("user-note.md"))).toBe(true);
  });

  it("returns zero only for an explicitly missing cache directory", async () => {
    const port = new MemoryPort();
    port.missingDirectory = true;
    await expect(maintenance(port).regenerate()).resolves.toBe(0);
    expect(port.touched).not.toContain(`list:${CACHE}`);
  });

  it("propagates list permission and IO failures instead of reporting zero", async () => {
    const port = new MemoryPort();
    port.listError = Object.assign(new Error("access denied"), { code: "EACCES" });
    await expect(maintenance(port).regenerate()).rejects.toThrow("access denied");
  });

  it.each(["vault root", "cache ancestor", "file target"])(
    "rejects an unsafe symlink or junction at the %s before mutation",
    async (location) => {
      const port = new MemoryPort();
      const file = cacheFile("github-daily.json");
      port.files.set(file, envelope(repo));
      port.unsafe.add(location === "vault root" ? VAULT : location === "cache ancestor" ? CACHE : file);
      await expect(maintenance(port).regenerate()).rejects.toThrow("unsafe junction");
      expect(port.files.has(file)).toBe(true);
      expect(port.touched.some((entry) => entry.startsWith("remove:"))).toBe(false);
    },
  );

  it("rechecks a renamed quarantine target and rejects a post-operation path swap", async () => {
    const port = new MemoryPort();
    port.files.set(cacheFile("ai-news-sources.json"), "bad");
    port.unsafeRenamedTarget = true;
    await expect(maintenance(port).quarantineCorrupt()).rejects.toThrow("unsafe junction");
    expect(port.touched.some((entry) => entry.startsWith("rename:"))).toBe(true);
  });

  it.each([
    ["wrong schema", JSON.stringify({ schemaVersion: 2, generatedAt: 1_000, source: "test", data: repo })],
    ["wrong domain data", envelope([{ nope: true }])],
    ["future generatedAt", envelope(repo, 2_000 + 5 * 60_000 + 1)],
  ])("quarantines %s using repository-equivalent validation", async (_case, content) => {
    const port = new MemoryPort();
    port.files.set(cacheFile("github-daily.json"), content);
    await expect(maintenance(port).quarantineCorrupt()).resolves.toBe(1);
    expect(port.files.has(cacheFile("github-daily.corrupt-2000.json"))).toBe(true);
  });

  it("preserves cache data that passes the basename-specific domain guard", async () => {
    const port = new MemoryPort();
    port.files.set(cacheFile("github-daily.json"), envelope(repo));
    await expect(maintenance(port).quarantineCorrupt()).resolves.toBe(0);
    expect(port.files.has(cacheFile("github-daily.json"))).toBe(true);
  });

  it("preserves an existing quarantine and allocates a collision suffix", async () => {
    const port = new MemoryPort();
    port.files.set(cacheFile("github-daily.json"), "bad");
    port.files.set(cacheFile("github-daily.corrupt-2000.json"), "older");
    await expect(maintenance(port).quarantineCorrupt()).resolves.toBe(1);
    expect(port.files.get(cacheFile("github-daily.corrupt-2000.json"))).toBe("older");
    expect(port.files.get(cacheFile("github-daily.corrupt-2000-1.json"))).toBe("bad");
  });

  it("rejects traversal before touching the file port", async () => {
    const port = new MemoryPort();
    const unsafe = new CacheMaintenance(port, VAULT, () => "../outside");
    await expect(unsafe.regenerate()).rejects.toThrow();
    expect(port.touched).toEqual([]);
  });
});

describe("runConfirmed", () => {
  it("does not run the action when confirmation is cancelled", async () => {
    const action = vi.fn(async () => undefined);
    await runConfirmed(async () => false, action);
    expect(action).not.toHaveBeenCalled();
  });

  it("runs the action once after confirmation", async () => {
    const action = vi.fn(async () => undefined);
    await runConfirmed(async () => true, action);
    expect(action).toHaveBeenCalledOnce();
  });
});
