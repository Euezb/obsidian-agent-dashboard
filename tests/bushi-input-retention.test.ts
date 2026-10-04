/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { createXuanxueSessionState } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";

/**
 * F2 回归:整页重渲染(每个资讯模块到达 / 5 分钟心跳都会触发)会重建面板 DOM,
 * 未提交的表单输入必须被采集回 storage,否则用户输入的内容和光标都会丢。
 */
function mount(container: HTMLElement, session: ReturnType<typeof createXuanxueSessionState>): () => void {
  return renderBushi(container, { session });
}

function jumpTo(container: HTMLElement, method: string): void {
  const button = Array.from(container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"))
    .find((entry) => entry.dataset.method === method);
  button?.click();
}

describe("未提交输入保持(F2)", () => {
  it("小六壬:输入被采集并在重渲染后恢复", () => {
    const session = createXuanxueSessionState();
    const first = document.createElement("div");
    const cleanupFirst = mount(first, session);

    const question = first.querySelector<HTMLInputElement>('input[aria-label="占问(可选)"]');
    const day = first.querySelector<HTMLInputElement>('input[aria-label="农历日"]');
    expect(question).not.toBeNull();
    if (question === null || day === null) return;
    question.value = "本周要不要换工作";
    day.value = "11";

    // 模拟整页重渲染:先卸载旧板块(此时应采集),再新建。
    cleanupFirst();
    const second = document.createElement("div");
    const cleanupSecond = mount(second, session);

    expect(second.querySelector<HTMLInputElement>('input[aria-label="占问(可选)"]')?.value).toBe("本周要不要换工作");
    expect(second.querySelector<HTMLInputElement>('input[aria-label="农历日"]')?.value).toBe("11");
    cleanupSecond();
  });

  it("六爻:问题与起卦时间在重渲染后仍在", () => {
    const session = createXuanxueSessionState();
    const first = document.createElement("div");
    const cleanupFirst = mount(first, session);
    jumpTo(first, "liuyao");

    const question = first.querySelector<HTMLInputElement>('input[aria-label="所问何事"]');
    const when = first.querySelector<HTMLInputElement>('input[aria-label="起卦时间"]');
    expect(question).not.toBeNull();
    if (question === null || when === null) return;
    question.value = "这笔生意能不能成";
    when.value = "2026-10-01T09:30";

    cleanupFirst();
    const second = document.createElement("div");
    const cleanupSecond = mount(second, session);
    jumpTo(second, "liuyao");

    expect(second.querySelector<HTMLInputElement>('input[aria-label="所问何事"]')?.value).toBe("这笔生意能不能成");
    expect(second.querySelector<HTMLInputElement>('input[aria-label="起卦时间"]')?.value).toBe("2026-10-01T09:30");
    cleanupSecond();
  });

  it("八字:出生日期与真太阳时开关在重渲染后仍在", () => {
    const session = createXuanxueSessionState();
    const first = document.createElement("div");
    const cleanupFirst = mount(first, session);
    jumpTo(first, "bazi");

    const date = first.querySelector<HTMLInputElement>('input[aria-label="出生日期"]');
    const trueSolar = first.querySelector<HTMLInputElement>("#ad-bz-true-solar");
    expect(date).not.toBeNull();
    if (date === null || trueSolar === null) return;
    date.value = "1988-12-24";
    trueSolar.checked = true;

    cleanupFirst();
    const second = document.createElement("div");
    const cleanupSecond = mount(second, session);
    jumpTo(second, "bazi");

    expect(second.querySelector<HTMLInputElement>('input[aria-label="出生日期"]')?.value).toBe("1988-12-24");
    expect(second.querySelector<HTMLInputElement>("#ad-bz-true-solar")?.checked).toBe(true);
    cleanupSecond();
  });
});
