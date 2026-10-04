/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { taiyiPanel } from "../src/view/bushi/taiyiPanel";

/**
 * F7 回归:太乙此前只有星卡、没有盘面,是 9 个方法里唯一「有卦无盘」的。
 * 契约:按洛书九宫(巽4 离9 坤2 / 震3 中5 兑7 / 艮8 坎1 乾6)画出九宫,
 * 把主星与年/月/日/时星按 position 落到对应宫位。
 * 期望值取自 2026-09-29 10:00 时盘的真实输出:主星「招摇」落巽(东南)。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("太乙九宫盘面(F7)", () => {
  it("渲染九个宫格,顺序为洛书九宫", async () => {
    const host = document.createElement("div");
    const cleanup = taiyiPanel.render(host, { mode: "hour", dateValue: "2026-09-29T10:00" });
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    const cells = Array.from(host.querySelectorAll<HTMLElement>(".ad-ty-palace"));
    expect(cells).toHaveLength(9);
    expect(cells.map((cell) => cell.dataset.gua)).toEqual([
      "巽", "离", "坤",
      "震", "中", "兑",
      "艮", "坎", "乾",
    ]);
    cleanup();
  });

  it("主星按 position 落到对应宫位", async () => {
    const host = document.createElement("div");
    const cleanup = taiyiPanel.render(host, { mode: "hour", dateValue: "2026-09-29T10:00" });
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    const xun = Array.from(host.querySelectorAll<HTMLElement>(".ad-ty-palace"))
      .find((cell) => cell.dataset.gua === "巽");
    expect(xun).toBeDefined();
    expect(xun?.textContent).toContain("招摇");
    expect(xun?.textContent).toContain("东南");
    cleanup();
  });

  it("五档尺度都能出盘", async () => {
    for (const mode of ["year", "month", "day", "hour", "minute"]) {
      const host = document.createElement("div");
      const cleanup = taiyiPanel.render(host, { mode, dateValue: "2026-09-29T10:00" });
      host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
      await flush();
      expect(host.querySelectorAll(".ad-ty-palace"), `${mode} 盘缺宫格`).toHaveLength(9);
      cleanup();
    }
  });
});
