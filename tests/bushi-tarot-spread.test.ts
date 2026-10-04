/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it, vi } from "vitest";
import type { DivinationReadingPort, DivinationReadingRequest } from "../src/features/divination/divinationReading";
import { tarotPanel } from "../src/view/bushi/tarotPanel";

/**
 * 卜筮 · 塔罗的两件新契约:
 * 1. 多张牌按牌阵几何铺开 —— 凯尔特十字摆成十字 + 权杖,2 横压在 1 上;
 * 2. 抽完牌自动去要大模型解牌,重渲染不重取,失败给重试。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function drawSpread(host: HTMLElement, spreadId: string): void {
  const select = host.querySelector<HTMLSelectElement>('select[aria-label="牌阵"]');
  expect(select).not.toBeNull();
  if (select !== null) select.value = spreadId;
  const submit = host.querySelector<HTMLButtonElement>("button.ad-bp-submit");
  expect(submit).not.toBeNull();
  submit?.click();
}

const READING = [
  "【总断】十张牌里没有一张是外力，真正卡住的是不愿意把冲突摊开。",
  "",
  "【逐张】",
  "1 现状：僵局，两边都成立。",
  "2 交叉/挑战：真正的阻力是回避本身。",
  "",
  "【可行】",
  "1. 本周挑一件 30 分钟能做完的小事先做。",
].join("\n");

function fakePort(overrides: Partial<DivinationReadingPort> = {}): DivinationReadingPort {
  return {
    isConfigured: () => true,
    read: async () => READING,
    ...overrides,
  };
}

describe("塔罗牌阵几何", () => {
  it("凯尔特十字:10 张折成 9 格,1、2 叠成一摞且 2 横过来", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const cleanup = tarotPanel.render(host, storage);
    drawSpread(host, "celtic-cross");
    await flush();

    const spread = host.querySelector(".ad-spread--celtic-cross");
    expect(spread).not.toBeNull();
    expect(spread?.classList.contains("ad-spread--shaped")).toBe(true);
    expect(host.querySelectorAll(".ad-spread__item")).toHaveLength(9);
    expect(host.querySelectorAll(".ad-spread__pile .ad-card")).toHaveLength(2);
    expect(host.querySelector(".ad-card--crossing")).not.toBeNull();
    // 十字与权杖各就各位,牌位序号按读序排到 10。
    expect(host.querySelector('[data-area="core"]')).not.toBeNull();
    expect(host.querySelector('[data-area="staff-10"]')).not.toBeNull();
    expect(
      Array.from(host.querySelectorAll(".ad-reading__slot-index")).map((node) => node.textContent),
    ).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    cleanup();
  });

  it("三牌阵走同权横排:有类名、有紧凑读牌,但没有格子", async () => {
    const host = document.createElement("div");
    const cleanup = tarotPanel.render(host, {});
    drawSpread(host, "three-card");
    await flush();

    expect(host.querySelector(".ad-spread--three-card")).not.toBeNull();
    expect(host.querySelectorAll(".ad-spread__item")).toHaveLength(3);
    expect(host.querySelector("[data-area]")).toBeNull();
    // 完整读牌(英文名)让位给紧凑读牌;正逆位照样写清楚。
    expect(host.querySelector(".ad-reading__en")).toBeNull();
    expect(host.querySelector(".ad-reading__slot-name small")?.textContent).toMatch(/^(正位|逆位)$/);
    expect(host.querySelectorAll(".ad-reading__slot-index")).toHaveLength(3);
    cleanup();
  });

  it("单牌仍是原来的排版(牌面加大 + 完整读牌)", async () => {
    const host = document.createElement("div");
    const cleanup = tarotPanel.render(host, {});
    drawSpread(host, "single");
    await flush();

    expect(host.querySelector(".ad-spread--single")).not.toBeNull();
    expect(host.querySelector(".ad-card--xl")).not.toBeNull();
    expect(host.querySelector(".ad-reading__en")).not.toBeNull();
    cleanup();
  });
});

describe("塔罗解牌", () => {
  it("抽完牌自动要一次解牌,牌位与所问之事一起发出去", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(async () => READING);
    const cleanup = tarotPanel.render(host, storage, {
      reading: fakePort({ read }),
      onSettled: () => undefined,
    });
    const question = host.querySelector<HTMLInputElement>('input[type="text"]');
    if (question !== null) question.value = "要不要把这件事摊开谈";
    drawSpread(host, "celtic-cross");
    await flush();

    expect(read).toHaveBeenCalledTimes(1);
    const sent = read.mock.calls[0]?.[0] as DivinationReadingRequest;
    expect(sent.kind).toBe("method");
    expect(sent.method).toBe("tarot");
    expect(sent.question).toBe("要不要把这件事摊开谈");
    expect(sent.facts).toHaveLength(10);
    expect(sent.facts[0]?.label).toBe("1 现状");
    // 缓存键就是这次抽牌的 seeds:同一副牌不会重取。
    expect(sent.cacheKey).toBe((storage.result as { seed: string }).seed);

    expect(host.querySelector(".ad-note")).not.toBeNull();
    expect(host.querySelector(".ad-note__tab")?.textContent).toBe("解牌");
    expect(host.querySelector(".ad-note__section")?.textContent).toBe("【总断】");
    expect(host.querySelectorAll(".ad-note__rows")).toHaveLength(2);
    expect(host.querySelector(".ad-note__foot")?.textContent).toContain("重新解牌");
    cleanup();
  });

  it("重渲染时沿用 storage 里的解牌,不重复请求", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(async () => READING);
    const port = fakePort({ read });
    const cleanup = tarotPanel.render(host, storage, { reading: port, onSettled: () => undefined });
    drawSpread(host, "three-card");
    await flush();
    cleanup();
    expect(read).toHaveBeenCalledTimes(1);

    // 整页重渲染:同一份 storage,解牌已经在了,直接画出来。
    const again = document.createElement("div");
    const cleanupAgain = tarotPanel.render(again, storage, {
      reading: port,
      onSettled: () => undefined,
    });
    expect(again.querySelector(".ad-note")).not.toBeNull();
    expect(read).toHaveBeenCalledTimes(1);
    cleanupAgain();
  });

  it("失败时牌面照常,解牌块给原因与重试", async () => {
    const host = document.createElement("div");
    let attempt = 0;
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error("环境变量 OPENCODE_API_KEY 未设置");
      return READING;
    });
    const cleanup = tarotPanel.render(host, {}, {
      reading: fakePort({ read }),
      onSettled: () => undefined,
    });
    drawSpread(host, "three-card");
    await flush();

    expect(host.querySelectorAll(".ad-spread__item")).toHaveLength(3);
    expect(host.querySelector(".ad-note__pending")?.textContent).toContain("环境变量");
    const retry = host.querySelector<HTMLButtonElement>(".ad-note__foot button");
    expect(retry?.textContent).toBe("重试");
    retry?.click();
    await flush();
    expect(read).toHaveBeenCalledTimes(2);
    expect(host.querySelector(".ad-note__pending")).toBeNull();
    expect(host.querySelector(".ad-note__body")?.textContent).toContain("【总断】");
    cleanup();
  });

  it("宿主没给解牌能力时只出牌面,不出现空的解牌块", async () => {
    const host = document.createElement("div");
    const cleanup = tarotPanel.render(host, {});
    drawSpread(host, "three-card");
    await flush();

    expect(host.querySelectorAll(".ad-spread__item")).toHaveLength(3);
    expect(host.querySelector(".ad-note")).toBeNull();
    cleanup();
  });

  it("接口没配置时不发请求,给一行说明", async () => {
    const host = document.createElement("div");
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(async () => READING);
    const cleanup = tarotPanel.render(host, {}, {
      reading: fakePort({ isConfigured: () => false, read }),
      onSettled: () => undefined,
    });
    drawSpread(host, "three-card");
    await flush();

    expect(read).not.toHaveBeenCalled();
    expect(host.querySelector(".ad-note")?.getAttribute("data-status")).toBe("off");
    cleanup();
  });
});

