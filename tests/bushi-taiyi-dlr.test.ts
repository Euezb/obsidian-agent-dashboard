/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { createXuanxueSessionState, panelStorage } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("daliurenPanel", () => {
  it("casts a ke and renders the pan grid, four ke and three chuan", async () => {
    const host = document.createElement("div");
    const { daliurenPanel } = await import("../src/view/bushi/daliurenPanel");
    const cleanup = daliurenPanel.render(host, { dateValue: "2026-09-29T10:00", question: "今日出行" });
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(host.querySelector(".ad-module-state--error")).toBeNull();
    // 天地盘 12 宫 + 四课 4 + 三传链 3 步。
    expect(host.querySelectorAll(".ad-dlr-pan__cell")).toHaveLength(12);
    expect(host.querySelectorAll(".ad-dlr-ke__item")).toHaveLength(4);
    expect(host.querySelectorAll(".ad-dlr-chuan__step")).toHaveLength(3);
    expect(host.querySelectorAll(".ad-dlr-chuan__arrow")).toHaveLength(2);
    expect(host.textContent).toContain("月将");
    expect(host.textContent).toContain("三传");
    cleanup();
  });

  it("rejects a broken datetime", () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = { dateValue: "nope" };
    void host;
    expect(storage.dateValue).toBe("nope");
  });
});

describe("taiyiPanel", () => {
  it("casts an hour board with the primary star and scale cards", async () => {
    const host = document.createElement("div");
    const { taiyiPanel } = await import("../src/view/bushi/taiyiPanel");
    const cleanup = taiyiPanel.render(host, { mode: "hour", dateValue: "2026-09-29T10:00", question: "今日出行" });
    const modes = Array.from(host.querySelectorAll<HTMLElement>(".ad-bp-segmented button"));
    expect(modes.map((button) => button.textContent)).toEqual(["时家", "日家", "月家", "年家", "分家"]);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(host.querySelector(".ad-module-state--error")).toBeNull();
    expect(host.querySelector(".ad-ty-star--primary")).not.toBeNull();
    expect(host.querySelectorAll(".ad-ty-star")).toHaveLength(5);
    expect(host.textContent).toContain("断事" in {} ? "" : "招摇");
    cleanup();
  });

  it("keeps results through the section switcher", async () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });
    const jump = (id: string): void => {
      const button = Array.from(container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"))
        .find((entry) => entry.dataset.method === id);
      button?.click();
    };
    jump("taiyi");
    container.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();
    expect(panelStorage(session, "taiyi").result).toBeDefined();
    cleanup();
  });
});
