/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { tarotPanel } from "../src/view/bushi/tarotPanel";

/**
 * F4 回归:抽牌的随机种子必须在「点击那一刻」生成。
 * 旧实现在 render 时生成一次种子并存进隐藏输入框,于是同一次渲染里连点两次
 * 会拿到完全相同的牌 —— 用户看起来就像按钮失效了。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

interface TarotResultLike {
  seed: string;
  spreadId: string;
  cards: Array<{ card: { nameChinese: string }; orientation: string }>;
}

describe("塔罗重复抽牌(F4)", () => {
  it("同一次渲染内连点两次,种子不同且都出牌", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const cleanup = tarotPanel.render(host, storage);
    const submit = host.querySelector<HTMLButtonElement>("button.ad-bp-submit");
    expect(submit).not.toBeNull();
    if (submit === null) return;

    submit.click();
    await flush();
    const first = storage.result as TarotResultLike | undefined;
    expect(first).toBeDefined();
    expect(first?.cards.length).toBeGreaterThan(0);

    submit.click();
    await flush();
    const second = storage.result as TarotResultLike | undefined;
    expect(second).toBeDefined();
    expect(second?.cards.length).toBeGreaterThan(0);

    expect(second?.seed).not.toBe(first?.seed);
    cleanup();
  });

  it("两次抽牌之间不再共用隐藏种子输入", () => {
    const host = document.createElement("div");
    const cleanup = tarotPanel.render(host, {});
    expect(host.querySelector('input[type="hidden"]')).toBeNull();
    cleanup();
  });
});
