import { describe, expect, it, vi } from "vitest";
import {
  createRefreshKey,
  RefreshCoordinator,
} from "../src/infrastructure/RefreshCoordinator";

describe("RefreshCoordinator", () => {
  it("returns the same Promise and runs same-key work once while in flight", async () => {
    const coordinator = new RefreshCoordinator();
    const key = createRefreshKey<string>("github");
    let release!: (value: string) => void;
    const work = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));

    const first = coordinator.runOnce(key, work);
    const second = coordinator.runOnce(key, work);

    expect(first).toBe(second);
    await vi.waitFor(() => expect(work).toHaveBeenCalledOnce());
    release("done");
    await expect(first).resolves.toBe("done");
  });

  it("clears a successful operation so later work can run", async () => {
    const coordinator = new RefreshCoordinator();
    const key = createRefreshKey<string>("github");
    const work = vi.fn().mockResolvedValue("done");

    await coordinator.runOnce(key, work);
    await coordinator.runOnce(key, work);

    expect(work).toHaveBeenCalledTimes(2);
  });

  it("clears a failed operation so later work can run", async () => {
    const coordinator = new RefreshCoordinator();
    const key = createRefreshKey<string>("github");
    const failure = new Error("failed");
    const work = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce("recovered");

    await expect(coordinator.runOnce(key, work)).rejects.toBe(failure);
    await expect(coordinator.runOnce(key, work)).resolves.toBe("recovered");
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("converts a synchronous throw into a rejected Promise and clears the key", async () => {
    const coordinator = new RefreshCoordinator();
    const key = createRefreshKey<string>("github");
    const failure = new Error("sync failure");
    const work = vi.fn(() => { throw failure; });

    let operation: Promise<unknown> | undefined;
    expect(() => { operation = coordinator.runOnce(key, work); }).not.toThrow();
    await expect(operation).rejects.toBe(failure);
    await expect(coordinator.runOnce(key, async () => "recovered")).resolves.toBe("recovered");
  });

  it("runs different keys independently", async () => {
    const coordinator = new RefreshCoordinator();
    const githubKey = createRefreshKey<void>("github");
    const newsKey = createRefreshKey<void>("news");
    let releaseGithub!: () => void;
    let releaseNews!: () => void;
    const github = vi.fn(() => new Promise<void>((resolve) => { releaseGithub = resolve; }));
    const news = vi.fn(() => new Promise<void>((resolve) => { releaseNews = resolve; }));

    const githubPromise = coordinator.runOnce(githubKey, github);
    const newsPromise = coordinator.runOnce(newsKey, news);

    expect(githubPromise).not.toBe(newsPromise);
    await vi.waitFor(() => {
      expect(github).toHaveBeenCalledOnce();
      expect(news).toHaveBeenCalledOnce();
    });
    releaseGithub();
    releaseNews();
    await Promise.all([githubPromise, newsPromise]);
  });

  it("treats separately-created keys with the same debug id as independent", async () => {
    const coordinator = new RefreshCoordinator();
    const firstKey = createRefreshKey<string>("github");
    const secondKey = createRefreshKey<string>("github");
    const first = coordinator.runOnce(firstKey, async () => "first");
    const second = coordinator.runOnce(secondKey, async () => "second");

    expect(first).not.toBe(second);
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
  });

  it("prevents work with a different result type at compile time", () => {
    const coordinator = new RefreshCoordinator();
    const numberKey = createRefreshKey<number>("count");

    const compileTimeOnly = (): void => {
      // @ts-expect-error A number refresh key cannot coordinate string work.
      void coordinator.runOnce(numberKey, async () => "wrong");
    };
    expect(compileTimeOnly).toBeTypeOf("function");
    expect(numberKey.id).toBe("count");
  });
});
