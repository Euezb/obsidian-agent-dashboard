/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { liuyaoPanel } from "../src/view/bushi/liuyaoPanel";

/**
 * R3 回归(文案即行为说明):
 * - 「自动摇卦」在 taibu-core 里的种子是 `YYYY-MM-DDTHH | 所问何事 | 起卦方式`,
 *   即**同一小时内问同一件事结果固定**(不是「同一分钟」)。旧文案让用户去改分钟,
 *   改完还是同一卦,看起来像按钮坏了。这里既锁文案,也锁真实行为。
 * - D4:变卦列的静爻六亲纳甲取的是本卦(本源库只给动爻的变后信息),口径要写明。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

async function autoHexagram(dateValue: string): Promise<string | undefined> {
  const storage: Record<string, unknown> = {
    question: "本周适合加仓吗",
    yongShenTargets: ["妻财"],
    method: "auto",
    dateValue,
  };
  const host = document.createElement("div");
  const cleanup = liuyaoPanel.render(host, storage);
  host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
  await flush();
  cleanup();
  return (storage.result as { hexagramName?: string } | undefined)?.hexagramName;
}

describe("六爻文案(R3/D4)", () => {
  it("states the real determinism of 自动摇卦", () => {
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, {});
    const text = host.textContent ?? "";
    expect(text).toContain("同一小时");
    expect(text).toContain("种子");
    expect(text).toContain("数字起卦");
    expect(text).toContain("手动选卦");
    expect(text).not.toContain("同一分钟");
    cleanup();
  });

  it("stays deterministic inside one hour and changes in the next 时辰", async () => {
    const first = await autoHexagram("2026-09-29T10:00");
    const sameHour = await autoHexagram("2026-09-29T10:37");
    const nextHour = await autoHexagram("2026-09-29T11:00");
    expect(first).toBe("风火家人");
    expect(sameHour).toBe(first);
    expect(nextHour).not.toBe(first);
  });

  it("变卦盘注明静爻纳甲的口径来自本卦", async () => {
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, {
      question: "本周适合加仓吗",
      yongShenTargets: ["妻财"],
      method: "auto",
      dateValue: "2026-09-29T10:00",
    });
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();
    const text = host.textContent ?? "";
    expect(text).toContain("静爻");
    expect(text).toContain("本源库");
    cleanup();
  });
});
