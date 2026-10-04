/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { xiaoliurenPanel } from "../src/view/bushi/xiaoliurenPanel";

/**
 * R1 端到端:面板表单口径是 0–23 时钟小时,传给 taibu-core 的必须是时辰序号。
 * 农历 8 月 19 日:月宫=留连、日宫=留连(与时辰无关)。
 *   10:00 = 巳时(序号 6) → 时宫 大安  ← 修复前按酉时(序号 10)算成 小吉
 *    5:00 = 卯时(序号 4) → 时宫 小吉  ← 修复前按序号 5 算成 空亡
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

async function draw(storage: Record<string, unknown>): Promise<{ host: HTMLElement; cleanup: () => void }> {
  const host = document.createElement("div");
  const cleanup = xiaoliurenPanel.render(host, storage);
  host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
  await flush();
  return { host, cleanup };
}

describe("小六壬时辰口径(R1)", () => {
  it("treats 10:00 as 巳时 and lands on 大安", async () => {
    const { host, cleanup } = await draw({ lunarMonth: 8, lunarDay: 19, hour: 10 });
    const text = host.textContent ?? "";
    expect(text).toContain("时辰 · 巳时");
    expect(text).toContain("时宫 · 大安");
    expect(text).not.toContain("小吉");
    expect(text).toContain("月宫 · 留连");
    expect(text).toContain("日宫 · 留连");
    cleanup();
  });

  it("treats 5:00 as 卯时 and lands on 小吉", async () => {
    const { host, cleanup } = await draw({ lunarMonth: 8, lunarDay: 19, hour: 5 });
    const text = host.textContent ?? "";
    expect(text).toContain("时辰 · 卯时");
    expect(text).toContain("时宫 · 小吉");
    expect(text).not.toContain("空亡");
    cleanup();
  });

  it("keeps the 0–23 input口径 and rejects out-of-range values", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = { lunarMonth: 8, lunarDay: 19, hour: 10 };
    const cleanup = xiaoliurenPanel.render(host, storage);
    const hourInput = host.querySelector<HTMLInputElement>('input[aria-label="时辰(0-23)"]');
    expect(hourInput?.min).toBe("0");
    expect(hourInput?.max).toBe("23");
    if (hourInput !== null) hourInput.value = "24";
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();
    expect(storage.error).toBe("时辰取 0–23 时");
    cleanup();
  });
});
