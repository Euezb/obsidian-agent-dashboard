import { describe, expect, it, vi } from "vitest";
import {
  runSafely,
  ViewActivationCoordinator,
} from "../src/view/viewActivation";

describe("view activation coordinator", () => {
  it("shares concurrent activation and creates only one leaf", async () => {
    let finishViewState: (() => void) | undefined;
    const viewStateReady = new Promise<void>((resolve) => {
      finishViewState = resolve;
    });
    const leaf = {
      setViewState: vi.fn(() => viewStateReady),
    };
    const createLeaf = vi.fn(() => leaf);
    const revealLeaf = vi.fn(() => Promise.resolve());
    const coordinator = new ViewActivationCoordinator({
      getExistingLeaf: () => undefined,
      createLeaf,
      revealLeaf,
    });

    const first = coordinator.activate();
    const second = coordinator.activate();

    expect(second).toBe(first);
    expect(createLeaf).toHaveBeenCalledTimes(1);

    finishViewState?.();
    await Promise.all([first, second]);

    expect(leaf.setViewState).toHaveBeenCalledWith({
      type: "agent-dashboard-view",
      active: true,
    });
    expect(revealLeaf).toHaveBeenCalledTimes(1);
  });

  it("clears completed activation and then reveals an existing leaf", async () => {
    const leaf = { setViewState: vi.fn(() => Promise.resolve()) };
    let existingLeaf: typeof leaf | undefined;
    const createLeaf = vi.fn(() => leaf);
    const revealLeaf = vi.fn(() => Promise.resolve());
    const coordinator = new ViewActivationCoordinator({
      getExistingLeaf: () => existingLeaf,
      createLeaf,
      revealLeaf,
    });

    await coordinator.activate();
    existingLeaf = leaf;
    await coordinator.activate();

    expect(createLeaf).toHaveBeenCalledTimes(1);
    expect(revealLeaf).toHaveBeenCalledTimes(2);
  });
});

describe("runSafely", () => {
  it("reports an asynchronous rejection at the synchronous UI boundary", async () => {
    const error = new Error("activation failed");
    const onError = vi.fn();

    runSafely(() => Promise.reject(error), onError);

    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledOnce();
    });
    expect(onError).toHaveBeenCalledWith(error);
  });
});
