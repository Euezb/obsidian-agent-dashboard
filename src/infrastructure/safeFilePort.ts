import type { Stats } from "node:fs";
import { lstat, mkdir, open, realpath, rm } from "node:fs/promises";
import { fsPath } from "./fsPath";

export type RunnerPathExpectation =
  "existing-file" | "new-file" | "directory" | "directory-or-new";

export interface RunnerFilePort {
  mkdir(directory: string): Promise<void>;
  assertSafePath(
    vaultRoot: string,
    target: string,
    expectation?: RunnerPathExpectation,
  ): Promise<void>;
  writeNewText(file: string, content: string): Promise<void>;
  readTextLimited(file: string, maxBytes: number): Promise<string>;
  remove(file: string): Promise<void>;
}

export class UnsafeRunnerPathError extends Error {
  constructor() { super("Unsafe runner path."); this.name = "UnsafeRunnerPathError"; }
}

export class RunnerOutputTooLargeError extends Error {
  constructor() {
    super("Output exceeded the allowed limit.");
    this.name = "RunnerOutputTooLargeError";
  }
}

/** File operations whose paths must stay inside the Vault after canonicalization. */
export class NodeRunnerFilePort implements RunnerFilePort {
  async mkdir(directory: string): Promise<void> { await mkdir(directory, { recursive: true }); }
  async assertSafePath(
    vaultRoot: string,
    target: string,
    expectation?: RunnerPathExpectation,
  ): Promise<void> {
    if (!fsPath.isAbsolute(vaultRoot) || !fsPath.isAbsolute(target) ||
      !isPathWithin(vaultRoot, target)) throw new UnsafeRunnerPathError();
    let realVault: string;
    try { realVault = fsPath.normalize(await realpath(vaultRoot)); } catch { throw new UnsafeRunnerPathError(); }
    const targetStat = await optionalLstat(target);
    if (targetStat?.isSymbolicLink() === true) throw new UnsafeRunnerPathError();

    let current = fsPath.normalize(target);
    const filesystemRoot = fsPath.parse(current).root;
    let nearestReal: string | undefined;
    while (true) {
      const currentStat = await optionalLstat(current);
      if (currentStat !== undefined) {
        if (currentStat.isSymbolicLink()) throw new UnsafeRunnerPathError();
        if (nearestReal === undefined) {
          try { nearestReal = fsPath.normalize(await realpath(current)); }
          catch { throw new UnsafeRunnerPathError(); }
        }
      }
      if (current.toLowerCase() === filesystemRoot.toLowerCase()) break;
      const parent = fsPath.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    if (nearestReal === undefined || !isPathWithin(realVault, nearestReal)) {
      throw new UnsafeRunnerPathError();
    }

    if (expectation === "existing-file" && (targetStat === undefined || !targetStat.isFile())) {
      throw new UnsafeRunnerPathError();
    }
    if (expectation === "directory" && (targetStat === undefined || !targetStat.isDirectory())) {
      throw new UnsafeRunnerPathError();
    }
    if (expectation === "directory-or-new" &&
      targetStat !== undefined && !targetStat.isDirectory()) {
      throw new UnsafeRunnerPathError();
    }
    if (expectation === "new-file") {
      if (targetStat !== undefined) throw new UnsafeRunnerPathError();
      const parentStat = await optionalLstat(fsPath.dirname(target));
      if (parentStat === undefined || parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
        throw new UnsafeRunnerPathError();
      }
    }
    if (expectation === undefined && targetStat !== undefined && !targetStat.isFile()) {
      throw new UnsafeRunnerPathError();
    }
  }

  async writeNewText(file: string, content: string): Promise<void> {
    const handle = await open(file, "wx");
    try { await handle.writeFile(content, "utf8"); } finally { await handle.close(); }
  }

  async readTextLimited(file: string, maxBytes: number): Promise<string> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RunnerOutputTooLargeError();
    const handle = await open(file, "r");
    try {
      const fileStat = await handle.stat();
      if (!fileStat.isFile() || fileStat.size > maxBytes) throw new RunnerOutputTooLargeError();
      const chunks: Buffer[] = [];
      let total = 0;
      while (total <= maxBytes) {
        const capacity = Math.min(64 * 1024, maxBytes + 1 - total);
        if (capacity <= 0) break;
        const buffer = Buffer.allocUnsafe(capacity);
        const { bytesRead } = await handle.read(buffer, 0, capacity, total);
        if (bytesRead === 0) break;
        total += bytesRead;
        if (total > maxBytes) throw new RunnerOutputTooLargeError();
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const trailing = Buffer.allocUnsafe(1);
      if ((await handle.read(trailing, 0, 1, total)).bytesRead > 0) {
        throw new RunnerOutputTooLargeError();
      }
      return Buffer.concat(chunks, total).toString("utf8");
    } finally {
      await handle.close();
    }
  }
  async remove(file: string): Promise<void> { await rm(file, { force: true }); }
}

function isPathWithin(root: string, target: string): boolean {
  const relation = fsPath.relative(fsPath.normalize(root), fsPath.normalize(target));
  return relation === "" || relation === "." ||
    (!relation.startsWith("..\\") && relation !== ".." && !fsPath.isAbsolute(relation));
}

async function optionalLstat(target: string): Promise<Stats | undefined> {
  try {
    return await lstat(target);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new UnsafeRunnerPathError();
  }
}