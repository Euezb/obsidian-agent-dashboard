import { describe, expect, it } from "vitest";
import { CACHE_SCHEMA_VERSION } from "../src/constants";
import type { CacheEnvelope } from "../src/domain/cacheSchemas";
import {
  CacheRepository,
  type CacheStoragePort,
  InvalidCacheFolderError,
  InvalidCacheNameError,
  InvalidCacheTtlError,
  MAX_CLOCK_SKEW_MS,
  UnserializableCacheDataError,
} from "../src/infrastructure/CacheRepository";

interface Item {
  title: string;
}

const isItem = (value: unknown): value is Item =>
  typeof value === "object" && value !== null &&
  "title" in value && typeof value.title === "string";

class MemoryStorage implements CacheStoragePort {
  readonly files = new Map<string, string>();
  readonly operations: string[] = [];
  failExists = false;
  failRead = false;
  failWrite = false;
  failRenameFrom: string | null = null;
  raceCollisionTarget: string | null = null;

  async exists(path: string): Promise<boolean> {
    this.operations.push(`exists:${path}`);
    if (this.failExists) throw new Error("exists failed");
    return this.files.has(path);
  }

  async read(path: string): Promise<string> {
    this.operations.push(`read:${path}`);
    if (this.failRead) throw new Error("sensitive read failure");
    const content = this.files.get(path);
    if (content === undefined) throw new Error("missing");
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.operations.push(`write:${path}`);
    if (this.failWrite) throw new Error("write failed");
    this.files.set(path, content);
  }

  async rename(from: string, to: string): Promise<void> {
    this.operations.push(`rename:${from}->${to}`);
    if (this.failRenameFrom === from) throw new Error("rename failed");
    if (this.raceCollisionTarget === to) {
      this.raceCollisionTarget = null;
      this.files.set(to, "racing quarantine");
      throw new Error("target exists");
    }
    const content = this.files.get(from);
    if (content === undefined) throw new Error("missing source");
    this.files.delete(from);
    this.files.set(to, content);
  }

  async replace(from: string, to: string, _backup: string): Promise<void> {
    this.operations.push(`replace:${from}->${to}`);
    if (this.failRenameFrom === from) throw new Error("rename failed");
    const content = this.files.get(from);
    if (content === undefined) throw new Error("missing source");
    this.files.delete(from);
    this.files.set(to, content);
  }

  async remove(path: string): Promise<void> {
    this.operations.push(`remove:${path}`);
    this.files.delete(path);
  }
}

const envelope = (generatedAt = 1_000): CacheEnvelope<Item> => ({
  schemaVersion: CACHE_SCHEMA_VERSION,
  generatedAt,
  source: "test",
  data: { title: "cached" },
});

const makeRepository = (storage: MemoryStorage, now = 1_500, ttlMs = 500) =>
  new CacheRepository(storage, ttlMs, () => now, "Dashboard/cache", () => "1");

describe("CacheRepository.read", () => {
  it("returns missing when the cache file does not exist", async () => {
    const result = await makeRepository(new MemoryStorage()).read("items", isItem);

    expect(result).toEqual({ status: "missing" });
  });

  it("recovers the deterministic backup when a crashed replacement left the final missing", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.backup.json", JSON.stringify(envelope()));

    const result = await makeRepository(storage).read("items", isItem);

    expect(result).toEqual({ status: "fresh", envelope: envelope() });
    expect(storage.files.has("Dashboard/cache/items.json")).toBe(true);
    expect(storage.files.has("Dashboard/cache/items.backup.json")).toBe(false);
  });

  it("keeps the valid final and cleans a stale deterministic backup", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(envelope()));
    storage.files.set("Dashboard/cache/items.backup.json", "older valid cache");

    const result = await makeRepository(storage).read("items", isItem);

    expect(result).toEqual({ status: "fresh", envelope: envelope() });
    expect(storage.files.has("Dashboard/cache/items.backup.json")).toBe(false);
  });

  it("returns a guarded envelope while it is fresh", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(envelope()));

    const result = await makeRepository(storage).read("items", isItem);

    expect(result).toEqual({ status: "fresh", envelope: envelope() });
  });

  it("treats the exact TTL boundary as fresh", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(envelope()));

    await expect(makeRepository(storage, 1_500, 500).read("items", isItem))
      .resolves.toMatchObject({ status: "fresh" });
  });

  it("returns stale after the TTL boundary", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(envelope()));

    await expect(makeRepository(storage, 1_501, 500).read("items", isItem))
      .resolves.toEqual({ status: "stale", envelope: envelope() });
  });

  it("treats a future generatedAt value within clock skew as fresh", async () => {
    const storage = new MemoryStorage();
    storage.files.set(
      "Dashboard/cache/items.json",
      JSON.stringify(envelope(1_500 + MAX_CLOCK_SKEW_MS)),
    );

    await expect(makeRepository(storage, 1_500, 500).read("items", isItem))
      .resolves.toMatchObject({ status: "fresh" });
  });

  it("quarantines a generatedAt value beyond allowed clock skew", async () => {
    const storage = new MemoryStorage();
    storage.files.set(
      "Dashboard/cache/items.json",
      JSON.stringify(envelope(1_500 + MAX_CLOCK_SKEW_MS + 1)),
    );

    await expect(makeRepository(storage).read("items", isItem)).resolves.toMatchObject({
      status: "corrupt",
      quarantinedPath: "Dashboard/cache/items.corrupt-1500.json",
    });
  });

  it.each([
    ["wrong schema", { ...envelope(), schemaVersion: 2 }],
    ["wrong data", { ...envelope(), data: { title: 42 } }],
    ["negative generatedAt", { ...envelope(), generatedAt: -1 }],
    ["empty source", { ...envelope(), source: "" }],
    ["blank source", { ...envelope(), source: "   " }],
  ])("quarantines an envelope with %s", async (_case, value) => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(value));

    const result = await makeRepository(storage).read("items", isItem);

    expect(result).toEqual({
      status: "corrupt",
      message: "Cache entry is corrupt.",
      quarantinedPath: "Dashboard/cache/items.corrupt-1500.json",
    });
    expect(storage.files.has("Dashboard/cache/items.json")).toBe(false);
  });

  it("quarantines malformed JSON without exposing its raw content", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", "secret invalid json");

    const result = await makeRepository(storage).read("items", isItem);

    expect(result).toEqual({
      status: "corrupt",
      message: "Cache entry is corrupt.",
      quarantinedPath: "Dashboard/cache/items.corrupt-1500.json",
    });
    expect(JSON.stringify(result)).not.toContain("secret invalid json");
  });

  it("returns corrupt even when quarantine rename fails", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", "bad");
    storage.failRenameFrom = "Dashboard/cache/items.json";

    await expect(makeRepository(storage).read("items", isItem)).resolves.toEqual({
      status: "corrupt",
      message: "Cache entry is corrupt.",
    });
  });

  it("propagates storage exists failures without quarantine", async () => {
    const storage = new MemoryStorage();
    storage.failExists = true;

    await expect(makeRepository(storage).read("items", isItem)).rejects.toThrow("exists failed");
    expect(storage.operations.some((operation) => operation.startsWith("rename:"))).toBe(false);
  });

  it("propagates storage read failures without quarantine", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(envelope()));
    storage.failRead = true;

    await expect(makeRepository(storage).read("items", isItem))
      .rejects.toThrow("sensitive read failure");
    expect(storage.operations.some((operation) => operation.startsWith("rename:"))).toBe(false);
  });

  it("propagates guard failures without quarantine", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(envelope()));
    const guardError = new Error("guard failed");
    const throwingGuard = (_value: unknown): _value is Item => { throw guardError; };

    await expect(makeRepository(storage).read("items", throwingGuard))
      .rejects.toBe(guardError);
    expect(storage.operations.some((operation) => operation.startsWith("rename:"))).toBe(false);
  });

  it("preserves an existing quarantine and moves corrupt data to a suffix", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", "bad");
    storage.files.set("Dashboard/cache/items.corrupt-1500.json", "older quarantine");

    const result = await makeRepository(storage).read("items", isItem);

    expect(result).toMatchObject({
      status: "corrupt",
      quarantinedPath: "Dashboard/cache/items.corrupt-1500-1.json",
    });
    expect(storage.files.get("Dashboard/cache/items.corrupt-1500.json"))
      .toBe("older quarantine");
    expect(storage.files.get("Dashboard/cache/items.corrupt-1500-1.json")).toBe("bad");
  });

  it("retries the next quarantine suffix after a collision race", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", "bad");
    storage.raceCollisionTarget = "Dashboard/cache/items.corrupt-1500.json";

    const result = await makeRepository(storage).read("items", isItem);

    expect(result).toMatchObject({
      status: "corrupt",
      quarantinedPath: "Dashboard/cache/items.corrupt-1500-1.json",
    });
    expect(storage.files.get("Dashboard/cache/items.corrupt-1500.json"))
      .toBe("racing quarantine");
    expect(storage.files.get("Dashboard/cache/items.corrupt-1500-1.json")).toBe("bad");
  });
});

describe("CacheRepository.write", () => {
  it("writes a temporary sibling before transactionally replacing the final path", async () => {
    const storage = new MemoryStorage();
    const value = envelope();

    await makeRepository(storage).write("items", value);

    expect(storage.operations).toEqual([
      "write:Dashboard/cache/items.tmp-1500-1.json",
      "replace:Dashboard/cache/items.tmp-1500-1.json->Dashboard/cache/items.json",
    ]);
    expect(JSON.parse(storage.files.get("Dashboard/cache/items.json") ?? "")).toEqual(value);
  });

  it("keeps the last valid cache when writing the temporary file fails", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", "old valid cache");
    storage.failWrite = true;

    await expect(makeRepository(storage).write("items", envelope())).rejects.toThrow("write failed");

    expect(storage.files.get("Dashboard/cache/items.json")).toBe("old valid cache");
    expect(storage.operations.some((operation) => operation.startsWith("rename:"))).toBe(false);
  });

  it("keeps the last valid cache and cleans the temp when final rename fails", async () => {
    const storage = new MemoryStorage();
    const tempPath = "Dashboard/cache/items.tmp-1500-1.json";
    storage.files.set("Dashboard/cache/items.json", "old valid cache");
    storage.failRenameFrom = tempPath;

    await expect(makeRepository(storage).write("items", envelope())).rejects.toThrow("rename failed");

    expect(storage.files.get("Dashboard/cache/items.json")).toBe("old valid cache");
    expect(storage.files.has(tempPath)).toBe(false);
    expect(storage.operations).toContain(`remove:${tempPath}`);
  });

  it("uses distinct default temp paths across repository instances", async () => {
    const storage = new MemoryStorage();
    const first = new CacheRepository(storage, 500, () => 1_500);
    const second = new CacheRepository(storage, 500, () => 1_500);

    await Promise.all([
      first.write("items", envelope(1_000)),
      second.write("items", { ...envelope(1_001), data: { title: "second" } }),
    ]);

    const tempWrites = storage.operations
      .filter((operation) => operation.startsWith("write:"))
      .map((operation) => operation.slice("write:".length));
    expect(tempWrites).toHaveLength(2);
    expect(new Set(tempWrites).size).toBe(2);
    for (const tempPath of tempWrites) expect(storage.files.has(tempPath)).toBe(false);
  });

  it.each([
    ["undefined", undefined],
    ["function", () => "not JSON"],
    ["symbol", Symbol("not JSON")],
  ])("rejects %s cache data before writing a temp file", async (_case, data) => {
    const storage = new MemoryStorage();
    const value = { ...envelope(), data } as unknown as CacheEnvelope<Item>;

    await expect(makeRepository(storage).write("items", value))
      .rejects.toBeInstanceOf(UnserializableCacheDataError);
    expect(storage.operations).toEqual([]);
  });

  it.each([
    ["cyclic data", (() => { const value: Record<string, unknown> = {}; value.self = value; return value; })()],
    ["BigInt data", 1n],
  ])("wraps JSON stringify failure for %s without writing", async (_case, data) => {
    const storage = new MemoryStorage();
    const value = { ...envelope(), data } as unknown as CacheEnvelope<Item>;

    await expect(makeRepository(storage).write("items", value))
      .rejects.toBeInstanceOf(UnserializableCacheDataError);
    expect(storage.operations).toEqual([]);
  });
});

describe("CacheRepository validation", () => {
  it("reads the current TTL from a getter so settings changes apply without restart", async () => {
    const storage = new MemoryStorage();
    storage.files.set("Dashboard/cache/items.json", JSON.stringify(envelope(0)));
    let ttlMs = 60 * 60_000;
    const repository = new CacheRepository(storage, () => ttlMs, () => 30 * 60_000);

    await expect(repository.read("items", isItem)).resolves.toMatchObject({ status: "fresh" });
    ttlMs = 15 * 60_000;
    await expect(repository.read("items", isItem)).resolves.toMatchObject({ status: "stale" });
  });

  it.each([
    "../items",
    "a/b",
    String.raw`a\b`,
    "..",
    ".hidden",
    "white space",
    "items.",
    "CON",
    "con.foo",
    "LPT9.json",
    "",
  ])(
    "rejects unsafe cache name %j",
    async (name) => {
      const repository = makeRepository(new MemoryStorage());

      await expect(repository.read(name, isItem)).rejects.toBeInstanceOf(InvalidCacheNameError);
      await expect(repository.write(name, envelope())).rejects.toBeInstanceOf(InvalidCacheNameError);
    },
  );

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rejects invalid TTL %s", (ttlMs) => {
    expect(() => new CacheRepository(new MemoryStorage(), ttlMs, () => 0))
      .toThrow(InvalidCacheTtlError);
  });

  it.each([
    "",
    "/Dashboard/cache",
    String.raw`\Dashboard\cache`,
    "C:/Dashboard/cache",
    "Dashboard//cache",
    "Dashboard/./cache",
    "Dashboard/../cache",
    "Dashboard/CON",
    "Dashboard/con.data",
    "Dashboard/cache.",
    "Dashboard/cache ",
    "Dashboard/ca?che",
    "Dashboard/ca\u0001che",
  ])("rejects unsafe cache folder %j", (folder) => {
    expect(() => new CacheRepository(new MemoryStorage(), 500, () => 0, folder))
      .toThrow(InvalidCacheFolderError);
  });

  it("normalizes safe folder separators to forward slashes", async () => {
    const storage = new MemoryStorage();
    const repository = new CacheRepository(
      storage,
      500,
      () => 1_500,
      String.raw`Dashboard\cache`,
      () => "1",
    );

    await repository.write("items", envelope());

    expect(storage.files.has("Dashboard/cache/items.json")).toBe(true);
  });
});
