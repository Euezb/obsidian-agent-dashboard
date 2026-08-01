import { CACHE_SCHEMA_VERSION } from "../constants";

export interface CacheEnvelope<T> {
  schemaVersion: typeof CACHE_SCHEMA_VERSION;
  generatedAt: number;
  source: string;
  data: T;
}

export type DataGuard<T> = (value: unknown) => value is T;

export type CacheReadResult<T> =
  | { status: "missing" }
  | { status: "fresh"; envelope: CacheEnvelope<T> }
  | { status: "stale"; envelope: CacheEnvelope<T> }
  | { status: "corrupt"; message: string; quarantinedPath?: string };
