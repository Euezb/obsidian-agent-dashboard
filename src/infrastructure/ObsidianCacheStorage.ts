import type { CacheStoragePort } from "./CacheRepository";

interface ObsidianAdapterPort {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}

export class ObsidianCacheStorage implements CacheStoragePort {
  constructor(private readonly adapter: ObsidianAdapterPort) {}

  exists(path: string): Promise<boolean> { return this.adapter.exists(path); }
  read(path: string): Promise<string> { return this.adapter.read(path); }

  async write(path: string, content: string): Promise<void> {
    await this.ensureParentFolders(path);
    await this.adapter.write(path, content);
  }

  rename(from: string, to: string): Promise<void> { return this.adapter.rename(from, to); }
  remove(path: string): Promise<void> { return this.adapter.remove(path); }

  async replace(from: string, to: string, backup: string): Promise<void> {
    let targetExists = await this.adapter.exists(to);
    const backupExists = await this.adapter.exists(backup);

    if (!targetExists && backupExists) {
      await this.adapter.rename(backup, to);
      targetExists = true;
    } else if (targetExists && backupExists) {
      // A stale backup is cleanup only. On Windows it can be locked by an
      // indexer or antivirus, and failing here would throw away a write whose
      // data is already safely on disk.
      await this.removeBestEffort(backup);
    }

    if (!targetExists) {
      await this.adapter.rename(from, to);
      return;
    }

    await this.adapter.rename(to, backup);
    try {
      await this.adapter.rename(from, to);
    } catch (error) {
      try {
        if (!await this.adapter.exists(to) && await this.adapter.exists(backup)) {
          await this.adapter.rename(backup, to);
        }
      } catch {
        // The deterministic backup remains recoverable by CacheRepository.read.
      }
      throw error;
    }

    await this.removeBestEffort(backup);
  }

  private async removeBestEffort(path: string): Promise<void> {
    try {
      await this.adapter.remove(path);
    } catch {
      // A leftover backup or temporary file is harmless: CacheRepository.read
      // prefers the final entry and treats the backup as recovery only.
    }
  }

  private async ensureParentFolders(path: string): Promise<void> {
    const segments = path.split("/");
    segments.pop();
    let folder = "";
    for (const segment of segments) {
      folder = folder === "" ? segment : `${folder}/${segment}`;
      if (await this.adapter.exists(folder)) continue;
      try {
        await this.adapter.mkdir(folder);
      } catch (error) {
        if (!await this.adapter.exists(folder)) throw error;
      }
    }
  }
}
