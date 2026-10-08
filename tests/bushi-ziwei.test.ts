/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { createXuanxueSessionState, panelStorage } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";
import { ziweiPanel } from "../src/view/bushi/ziweiPanel";

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("ziweiPanel", () => {
  it("renders the birth form with gender and true-solar controls", () => {
    const host = document.createElement("div");
    const cleanup = ziweiPanel.render(host, {});
    expect(host.textContent).toContain("出生日期");
    expect(host.textContent).toContain("安星排盘");
    cleanup();
  });

  it("casts the chart and renders the 12-palace grid", async () => {
    const host = document.createElement("div");
    const cleanup = ziweiPanel.render(host, {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
    });
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(host.querySelector(".ad-module-state--error")).toBeNull();
    expect(host.querySelectorAll(".ad-zw-palace")).toHaveLength(12);
    expect(host.querySelector(".ad-zw-palace--soul")?.textContent).toContain("命宫");
    expect(host.querySelector(".ad-zw-center")).not.toBeNull();
    expect(host.textContent).toContain("命主");
    cleanup();
  });

  it("空宫写明「借对宫」,不是留一格空白", async () => {
    // 1990-01-01 00:00 实测有两处空宫(疾厄、财帛)。
    const host = document.createElement("div");
    const cleanup = ziweiPanel.render(host, {
      birthDate: "1990-01-01",
      birthTime: "00:00",
      gender: "male",
    });
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    const empties = Array.from(host.querySelectorAll(".ad-zw-star--empty"));
    expect(empties.length).toBeGreaterThan(0);
    expect(empties[0]?.textContent).toBe("空宫（借对宫）");
    cleanup();
  });

  it("keeps the chart across section re-render", async () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });
    const jump = (id: string): void => {
      const button = Array.from(container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"))
        .find((entry) => entry.dataset.method === id);
      button?.click();
    };
    jump("ziwei");
    container.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();
    expect(panelStorage(session, "ziwei").result).toBeDefined();
    expect(container.querySelectorAll(".ad-zw-palace")).toHaveLength(12);
    cleanup();
  });

  // R9:自定义经度只在库侧报错(「longitude 必须是 -180 到 180」),面板先就地拦。
  it("rejects a custom longitude outside 73–135 before calling the library", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      trueSolar: true,
      longitudeChoice: "custom",
      customLongitude: 200,
    };
    const host = document.createElement("div");
    const cleanup = ziweiPanel.render(host, storage);
    // happy-dom 下用 option.selected 初始化的 select.value 不可靠,这里按真实用户操作直接赋值。
    const longitude = host.querySelector<HTMLSelectElement>('select[aria-label="参考经度"]');
    if (longitude !== null) longitude.value = "custom";
    const custom = host.querySelector<HTMLInputElement>('input[aria-label="自定义经度"]');
    if (custom !== null) custom.value = "200";
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();
    expect(storage.error).toBe("经度取 73–135");
    expect(storage.result).toBeUndefined();
    cleanup();
  });
});
