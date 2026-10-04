import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NodeRunnerFilePort,
  RunnerOutputTooLargeError,
  UnsafeRunnerPathError,
} from "../src/infrastructure/safeFilePort";

const temporaryRoots: string[] = [];

async function temporaryVault(): Promise<{ root: string; cache: string }> {
  const base = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-runner-"));
  temporaryRoots.push(base);
  const root = path.join(base, "vault");
  const cache = path.join(root, "Dashboard", "cache");
  await mkdir(cache, { recursive: true });
  return { root, cache };
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => rm(root, { recursive: true, force: true })));
});

describe("NodeRunnerFilePort", () => {
  it("accepts a missing or existing directory target but rejects an existing file", async () => {
    const { root, cache } = await temporaryVault();
    const port = new NodeRunnerFilePort();
    const promptRoot = path.join(cache, "prompts");

    await expect(port.assertSafePath(root, promptRoot, "directory-or-new"))
      .resolves.toBeUndefined();
    await mkdir(promptRoot);
    await expect(port.assertSafePath(root, promptRoot, "directory-or-new"))
      .resolves.toBeUndefined();

    const existingFile = path.join(cache, "not-a-directory");
    await writeFile(existingFile, "file", "utf8");
    await expect(port.assertSafePath(root, existingFile, "directory-or-new"))
      .rejects.toBeInstanceOf(UnsafeRunnerPathError);
  });

  it("uses exclusive text creation and validates existing/new/directory paths", async () => {
    const { root, cache } = await temporaryVault();
    const port = new NodeRunnerFilePort();
    const file = path.join(cache, "new.txt");

    await expect(port.assertSafePath(root, cache, "directory")).resolves.toBeUndefined();
    await expect(port.assertSafePath(root, file, "new-file")).resolves.toBeUndefined();
    await port.writeNewText(file, "safe");
    await expect(port.writeNewText(file, "replace"))
      .rejects.toMatchObject({ code: "EEXIST" });
    await expect(port.assertSafePath(root, file, "existing-file")).resolves.toBeUndefined();
    await expect(port.assertSafePath(root, path.resolve(root, "..", "escape.txt"), "new-file"))
      .rejects.toBeInstanceOf(UnsafeRunnerPathError);
  });

  it("reads exactly the limit and rejects limit+1 and sparse files before allocation", async () => {
    const { root, cache } = await temporaryVault();
    const port = new NodeRunnerFilePort();
    const exact = path.join(cache, "exact.txt");
    const over = path.join(cache, "over.txt");
    const sparse = path.join(cache, "sparse.txt");
    await writeFile(exact, "1234", "utf8");
    await writeFile(over, "12345", "utf8");
    const sparseHandle = await open(sparse, "w");
    await sparseHandle.truncate(5);
    await sparseHandle.close();

    await expect(port.readTextLimited(exact, 4)).resolves.toBe("1234");
    await expect(port.readTextLimited(over, 4)).rejects.toBeInstanceOf(RunnerOutputTooLargeError);
    await expect(port.readTextLimited(sparse, 4)).rejects.toBeInstanceOf(RunnerOutputTooLargeError);
    await expect(port.assertSafePath(root, sparse, "existing-file")).resolves.toBeUndefined();
  });

  it("rejects a directory junction before accessing its target", async ({ skip }) => {
    const { root } = await temporaryVault();
    const outside = await mkdtemp(path.join(os.tmpdir(), "agent-dashboard-outside-"));
    temporaryRoots.push(outside);
    const link = path.join(root, "linked-cache");
    try {
      await symlink(outside, link, "junction");
    } catch (error) {
      if (isPermissionError(error)) {
        skip();
        return;
      }
      throw error;
    }
    const port = new NodeRunnerFilePort();

    await expect(port.assertSafePath(root, link, "directory-or-new"))
      .rejects.toBeInstanceOf(UnsafeRunnerPathError);
    await expect(port.assertSafePath(root, path.join(link, "output.json"), "new-file"))
      .rejects.toBeInstanceOf(UnsafeRunnerPathError);
  });
});

function isPermissionError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error.code === "EPERM" || error.code === "EACCES");
}
