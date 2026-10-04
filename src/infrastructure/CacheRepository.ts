import { CACHE_SCHEMA_VERSION } from "../constants";
import type {
  CacheEnvelope,
  CacheReadResult,
  DataGuard,
} from "../domain/cacheSchemas";

const DEFAULT_CACHE_FOLDER = "Dashboard/cache";
const CORRUPT_MESSAGE = "Cache entry is corrupt.";
const SAFE_CACHE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;
const INVALID_WINDOWS_CHARACTER = /[<>:"|?*]/;
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_QUARANTINE_ATTEMPTS = 10;

export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
export type CacheTtlSource = number | (() => number);

let fallbackNonceCounter = 0;

export interface CacheStoragePort {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  replace(from: string, to: string, backup: string): Promise<void>;
  remove?(path: string): Promise<void>;
}

export class InvalidCacheNameError extends Error {
  constructor(name: string) {
    super(`Invalid cache name: ${name}`);
    this.name = "InvalidCacheNameError";
  }
}

export class InvalidCacheFolderError extends Error {
  constructor(folder: string) {
    super(`Invalid cache folder: ${folder}`);
    this.name = "InvalidCacheFolderError";
  }
}

export class InvalidCacheTtlError extends Error {
  constructor(ttlMs: number) {
    super(`Invalid cache TTL: ${ttlMs}`);
    this.name = "InvalidCacheTtlError";
  }
}

export class InvalidCacheEnvelopeError extends Error {
  constructor() {
    super("Invalid cache envelope.");
    this.name = "InvalidCacheEnvelopeError";
  }
}

export class UnserializableCacheDataError extends Error {
  constructor() {
    super("Cache data is not JSON serializable.");
    this.name = "UnserializableCacheDataError";
  }
}

export class CacheRepository {
  private readonly folder: string;
  private readonly writeQueues = new Map<string, Promise<void>>();

  constructor(
    private readonly storage: CacheStoragePort,
    private readonly ttlSource: CacheTtlSource,
    private readonly now: () => number = Date.now,
    folder = DEFAULT_CACHE_FOLDER,
    private readonly nonceProvider: () => string = defaultNonceProvider,
  ) {
    if (typeof ttlSource === "number") validateTtl(ttlSource);
    this.folder = normalizeFolder(folder);
  }

  async read<T>(name: string, guard: DataGuard<T>): Promise<CacheReadResult<T>> {
    this.assertSafeName(name);
    const finalPath = this.finalPath(name);
    const backupPath = this.backupPath(name);

    try {
      return await this.readOnce(name, finalPath, backupPath, guard);
    } catch (error) {
      // A concurrent write briefly renames the final entry away (final → backup
      // → new final). One retry turns that window into a successful read
      // instead of a visible "cache read failed" error; a genuine IO failure
      // fails again on the second attempt and is reported exactly as before.
      try {
        return await this.readOnce(name, finalPath, backupPath, guard);
      } catch {
        throw error;
      }
    }
  }

  private async readOnce<T>(
    name: string,
    finalPath: string,
    backupPath: string,
    guard: DataGuard<T>,
  ): Promise<CacheReadResult<T>> {
    if (!await this.storage.exists(finalPath)) {
      if (!await this.storage.exists(backupPath)) return { status: "missing" };
      try {
        await this.storage.rename(backupPath, finalPath);
      } catch (error) {
        if (!await this.storage.exists(finalPath)) throw error;
      }
    }
    const content = await this.storage.read(finalPath);
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return this.quarantine(finalPath, name);
    }

    const now = this.now();
    if (!isValidCacheEnvelope(parsed, guard, now)) return this.quarantine(finalPath, name);
    // 校验通过之后才清 backup：删早了的话，final 一旦损坏，唯一的好副本就没了。
    // final 真的损坏时 quarantine 会移走它，下一次读取由上面的 backup 分支恢复。
    if (this.storage.remove !== undefined && await this.storage.exists(backupPath)) {
      try {
        await this.storage.remove(backupPath);
      } catch {
        // A valid final always wins; stale backup cleanup is best-effort.
      }
    }
    const envelope = parsed;
    const ttlMs = this.currentTtl();
    const status = now - envelope.generatedAt <= ttlMs ? "fresh" : "stale";
    return { status, envelope };
  }

  async write<T>(name: string, envelope: CacheEnvelope<T>): Promise<void> {
    this.assertSafeName(name);
    if (!isValidEnvelopeHeader(envelope)) throw new InvalidCacheEnvelopeError();

    const content = serializeEnvelope(envelope);
    const previous = this.writeQueues.get(name) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.writeOnce(name, content));
    this.writeQueues.set(name, operation);

    try {
      await operation;
    } finally {
      if (this.writeQueues.get(name) === operation) this.writeQueues.delete(name);
    }
  }

  private async writeOnce(name: string, content: string): Promise<void> {
    const timestamp = this.timestamp();
    const tempPath = `${this.folder}/${name}.tmp-${timestamp}-${this.nonceProvider()}.json`;
    const finalPath = this.finalPath(name);
    const backupPath = this.backupPath(name);

    await this.storage.write(tempPath, content);
    try {
      await this.storage.replace(tempPath, finalPath, backupPath);
    } catch (error) {
      if (this.storage.remove !== undefined) {
        try {
          await this.storage.remove(tempPath);
        } catch {
          // Cleanup is best-effort; preserve the write failure for the caller.
        }
      }
      throw error;
    }
  }

  private async quarantine(
    finalPath: string,
    name: string,
  ): Promise<CacheReadResult<never>> {
    const timestamp = this.timestamp();
    for (let attempt = 0; attempt < MAX_QUARANTINE_ATTEMPTS; attempt += 1) {
      const suffix = attempt === 0 ? "" : `-${attempt}`;
      const quarantinedPath = `${this.folder}/${name}.corrupt-${timestamp}${suffix}.json`;
      try {
        if (await this.storage.exists(quarantinedPath)) continue;
      } catch {
        return corruptResult();
      }

      try {
        await this.storage.rename(finalPath, quarantinedPath);
        return { status: "corrupt", message: CORRUPT_MESSAGE, quarantinedPath };
      } catch {
        try {
          if (await this.storage.exists(quarantinedPath)) continue;
        } catch {
          // Quarantine is best-effort once the original read completed.
        }
        return corruptResult();
      }
    }
    return corruptResult();
  }

  private assertSafeName(name: string): void {
    if (
      !SAFE_CACHE_NAME.test(name) ||
      name.includes("..") ||
      name.endsWith(".") ||
      isWindowsDeviceName(name)
    ) {
      throw new InvalidCacheNameError(name);
    }
  }

  private finalPath(name: string): string {
    return `${this.folder}/${name}.json`;
  }

  private backupPath(name: string): string {
    return `${this.folder}/${name}.backup.json`;
  }

  private timestamp(): number {
    return Math.trunc(this.now());
  }

  private currentTtl(): number {
    const ttlMs = typeof this.ttlSource === "function" ? this.ttlSource() : this.ttlSource;
    validateTtl(ttlMs);
    return ttlMs;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidEnvelopeHeader(value: unknown): value is {
  schemaVersion: 1;
  generatedAt: number;
  source: string;
  data: unknown;
} {
  return isRecord(value) &&
    value.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof value.generatedAt === "number" &&
    Number.isFinite(value.generatedAt) &&
    value.generatedAt >= 0 &&
    typeof value.source === "string" &&
    value.source.trim().length > 0 &&
    Object.prototype.hasOwnProperty.call(value, "data");
}

export function isValidCacheEnvelope<T>(
  value: unknown,
  guard: DataGuard<T>,
  now: number,
): value is CacheEnvelope<T> {
  return isValidEnvelopeHeader(value) && guard(value.data) &&
    value.generatedAt <= now + MAX_CLOCK_SKEW_MS;
}

function validateTtl(ttlMs: number): void {
  if (!Number.isFinite(ttlMs) || ttlMs < 0) throw new InvalidCacheTtlError(ttlMs);
}

function normalizeFolder(folder: string): string {
  if (folder.length === 0 || /^(?:[\\/]|[a-z]:)/i.test(folder)) {
    throw new InvalidCacheFolderError(folder);
  }
  const normalized = folder.replace(/\\/g, "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => !isSafeFolderSegment(segment))) {
    throw new InvalidCacheFolderError(folder);
  }
  return segments.join("/");
}

function isSafeFolderSegment(segment: string): boolean {
  return segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !INVALID_WINDOWS_CHARACTER.test(segment) &&
    !hasControlCharacter(segment) &&
    !/[. ]$/.test(segment) &&
    !isWindowsDeviceName(segment);
}

function isWindowsDeviceName(value: string): boolean {
  const basename = value.split(".", 1)[0];
  return basename !== undefined && WINDOWS_DEVICE_NAME.test(basename);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f);
}

function serializeEnvelope<T>(envelope: CacheEnvelope<T>): string {
  try {
    const content = JSON.stringify(envelope);
    if (typeof content !== "string") throw new UnserializableCacheDataError();
    const roundTrip: unknown = JSON.parse(content);
    if (!isRecord(roundTrip) || !Object.prototype.hasOwnProperty.call(roundTrip, "data")) {
      throw new UnserializableCacheDataError();
    }
    return content;
  } catch (error) {
    if (error instanceof UnserializableCacheDataError) throw error;
    throw new UnserializableCacheDataError();
  }
}

function defaultNonceProvider(): string {
  // eslint-disable-next-line obsidianmd/no-global-this -- crypto is runtime-global and independent of an Obsidian window.
  if (typeof globalThis.crypto?.randomUUID === "function") {
    // eslint-disable-next-line obsidianmd/no-global-this -- crypto is runtime-global and independent of an Obsidian window.
    return globalThis.crypto.randomUUID();
  }
  fallbackNonceCounter += 1;
  return `fallback-${fallbackNonceCounter}`;
}

function corruptResult(): CacheReadResult<never> {
  return { status: "corrupt", message: CORRUPT_MESSAGE };
}
