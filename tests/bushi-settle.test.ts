/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it, vi } from "vitest";
import { createXuanxueSessionState } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";

/**
 * F3 回归:面板的计算是异步收尾的。如果这段时间里发生了整页重渲染
 * (资讯模块到达 / 5 分钟心跳),旧面板的宿主已经脱离文档,结果写进去也看不见。
 * 契约:计算收尾时必须告诉板块「我结算了」,由板块判断自己是否还活着,
 * 不活着就请视图重渲染一次,把 storage 里已有的结果画出来。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function clickSubmit(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
}

describe("计算收尾时机(F3)", () => {
  it("宿主仍在文档中时不额外触发视图重渲染", async () => {
    const session = createXuanxueSessionState();
    const container = document.createElement("div");
    document.body.append(container);
    const onSettled = vi.fn();
    const cleanup = renderBushi(container, { session, onSettled });

    clickSubmit(container);
    await flush();

    expect(onSettled).not.toHaveBeenCalled();
    cleanup();
    container.remove();
  });

  it("计算收尾时宿主已脱离文档,则请求视图重渲染", async () => {
    const session = createXuanxueSessionState();
    const container = document.createElement("div");
    document.body.append(container);
    const onSettled = vi.fn();
    const cleanup = renderBushi(container, { session, onSettled });

    clickSubmit(container);
    // 同步模拟整页重渲染:先卸载再脱离文档,此时计算还没收尾。
    cleanup();
    container.remove();

    await flush();

    expect(onSettled).toHaveBeenCalledTimes(1);
    // 结果本身已经落在会话里,视图拿到通知后重渲染即可显示。
    expect(session.panels.get("xiaoliuren")?.result).toBeDefined();
  });

  it("计算结果写在会话里,新板块能直接画出结果", async () => {
    const session = createXuanxueSessionState();
    const first = document.createElement("div");
    document.body.append(first);
    /** 视图收到通知后重建出来的板块(用数组承载,避免闭包变量被收窄成 null)。 */
    const rebuiltSections: HTMLElement[] = [];
    let cleanupSecond = (): void => undefined;

    const onSettled = vi.fn(() => {
      cleanupSecond();
      const rebuilt = document.createElement("div");
      document.body.append(rebuilt);
      cleanupSecond = renderBushi(rebuilt, { session, onSettled });
      rebuiltSections.push(rebuilt);
    });

    const firstCleanup = renderBushi(first, { session, onSettled });
    clickSubmit(first);
    // 模拟整页重渲染:旧板块卸载,新板块先画(此时还没有结果)。
    firstCleanup();
    first.remove();
    const second = document.createElement("div");
    document.body.append(second);
    cleanupSecond = renderBushi(second, { session, onSettled });

    await flush();

    expect(onSettled).toHaveBeenCalled();
    const rebuilt = rebuiltSections[rebuiltSections.length - 1];
    expect(rebuilt?.textContent).toContain("宫");
    cleanupSecond();
    second.remove();
  });
});
