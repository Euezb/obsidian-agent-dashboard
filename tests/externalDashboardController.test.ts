import { describe, expect, it, vi } from "vitest";
import type {
  ExternalDashboardState,
  FeedStateListener,
  RetryableExternalModule,
} from "../src/features/feeds/FeedService";
import { ExternalDashboardController } from "../src/view/ExternalDashboardController";

const state: ExternalDashboardState = {
  aiNews: { status: "loading", data: [] },
  githubDaily: { status: "loading", data: [] },
  githubWeekly: { status: "loading", data: [] },
  dailyBrief: { status: "idle", data: null },
};

describe("ExternalDashboardController", () => {
  it("ignores cache and network emissions after close", async () => {
    let emit!: (value: ExternalDashboardState) => void;
    let finish!: () => void;
    const openFeed = vi.fn((listener: (value: ExternalDashboardState) => void) => {
      emit = listener;
      return new Promise<void>((resolve) => { finish = resolve; });
    });
    const onState = vi.fn();
    const controller = new ExternalDashboardController(openFeed, onState);

    const opening = controller.open();
    controller.close();
    emit(state);
    finish();
    await opening;

    expect(onState).not.toHaveBeenCalled();
  });

  it("lets the latest open own subsequent emissions", async () => {
    const listeners: Array<(value: ExternalDashboardState) => void> = [];
    const onState = vi.fn();
    const controller = new ExternalDashboardController(
      async (listener) => { listeners.push(listener); },
      onState,
    );

    await controller.open();
    await controller.open();
    listeners[0]?.(state);
    listeners[1]?.(state);

    expect(onState).toHaveBeenCalledOnce();
  });

  it("handles an open-feed rejection without leaving an unhandled promise", async () => {
    const onError = vi.fn();
    const controller = new ExternalDashboardController(
      async () => { throw new Error("feed open failed"); },
      vi.fn(),
      onError,
    );

    await expect(controller.open()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("guards contextual retry emissions after close", async () => {
    let emit!: (value: ExternalDashboardState) => void;
    const onState = vi.fn();
    const retryFeed = vi.fn(async (
      _module: RetryableExternalModule,
      listener: FeedStateListener,
    ) => { emit = listener; });
    const controller = new ExternalDashboardController(async () => undefined, onState, vi.fn(), retryFeed);
    await controller.retry("aiNews");
    controller.close();
    emit(state);
    expect(onState).not.toHaveBeenCalled();
  });

  it("isolates contextual retry rejections", async () => {
    const onError = vi.fn();
    const controller = new ExternalDashboardController(
      async () => undefined,
      vi.fn(),
      onError,
      async () => { throw new Error("retry failed"); },
    );

    await controller.open();
    await expect(controller.retry("githubDaily")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledOnce();
  });

  it("isolates errors thrown by the error observer for open and retry", async () => {
    const onError = vi.fn(() => { throw new Error("observer failed"); });
    const controller = new ExternalDashboardController(
      async () => { throw new Error("open failed"); },
      vi.fn(),
      onError,
      async () => { throw new Error("retry failed"); },
    );

    await expect(controller.open()).resolves.toBeUndefined();
    await expect(controller.retry("aiNews")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
