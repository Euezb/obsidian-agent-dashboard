/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { createXuanxueSessionState, panelStorage } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";
import { liuyaoPanel } from "../src/view/bushi/liuyaoPanel";

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("liuyaoPanel", () => {
  it("renders the cast form with four methods and yongshen chips", () => {
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, {});
    expect(host.textContent).toContain("所问何事");
    const methods = Array.from(host.querySelectorAll<HTMLElement>(".ad-bp-segmented button"));
    expect(methods.map((button) => button.textContent)).toEqual(["自动摇卦", "时间起卦", "数字起卦", "手动选卦"]);
    expect(methods[0]?.getAttribute("aria-pressed")).toBe("true");
    // 默认方式:数字输入与选卦下拉隐藏(display:none),时间显示。
    expect(host.textContent).toContain("起卦时间");
    const numberField = host.querySelector('input[aria-label="第1个数"]')?.closest(".ad-bp-field");
    const selectField = host.querySelector('select[aria-label="本卦"]')?.closest(".ad-bp-field");
    expect((numberField as HTMLElement | null)?.style.display).toBe("none");
    expect((selectField as HTMLElement | null)?.style.display).toBe("none");
    // 用神默认选中妻财。
    expect(host.querySelector(".ad-bp-chip--hit")?.textContent).toBe("妻财");
    cleanup();
  });

  it("requires a question and a yongshen before casting", () => {
    const storage: Record<string, unknown> = { question: "", yongShenTargets: [] };
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    expect(storage.error).toBe("请先填写所问何事");
    cleanup();
  });

  it("casts an auto hexagram and renders the graphical chart", async () => {
    const storage: Record<string, unknown> = {
      question: "本周适合加仓吗",
      yongShenTargets: ["妻财"],
      method: "auto",
      dateValue: "2026-09-29T10:00",
    };
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(storage.error).toBeUndefined();
    const result = storage.result as { hexagramName: string; changedHexagramName?: string } | undefined;
    expect(result?.hexagramName).toBe("风火家人");
    // 卦盘:本卦 6 爻 + 变卦 6 爻(本卦有动爻才有变卦列)。
    expect(host.querySelectorAll(".ad-ly-chart__col")).toHaveLength(2);
    expect(host.querySelectorAll(".ad-ly-yao")).toHaveLength(12);
    expect(host.querySelectorAll(".ad-ly-yao__line--yin").length).toBeGreaterThan(0);
    expect(host.textContent).toContain("世");
    expect(host.textContent).toContain("应");
    expect(host.textContent).toContain("干支" in {} ? "" : "旬空");
    expect(host.textContent).toContain("用神");
    expect(host.textContent).toContain("伏神");
    expect(host.textContent).toContain("家人");
    cleanup();
  });

  it("库给不出应期时也留一句,不让整节消失", async () => {
    // 2026-09-01 05 时 + 这句问法实测是「天山遯」,有动爻但应期参考为空。
    const storage: Record<string, unknown> = {
      question: "这件事要不要摊开谈",
      yongShenTargets: ["妻财"],
      method: "auto",
      dateValue: "2026-09-01T05:30",
    };
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    const result = storage.result as { hexagramName: string; timeRecommendations?: unknown[] } | undefined;
    expect(result?.hexagramName).toBe("天山遯");
    expect((result?.timeRecommendations ?? []).length).toBe(0);
    expect(host.textContent).toContain("应期参考：本卦未见明显的应期提示。");
    cleanup();
  });

  it("六爻安静时不画变卦栏,但要说清为什么没有变卦", async () => {
    // 这个种子(2026-09-15 14 时 + 这句问法)实测就是六爻全静的一卦。
    const storage: Record<string, unknown> = {
      question: "换一个问法试试",
      yongShenTargets: ["妻财"],
      method: "auto",
      dateValue: "2026-09-15T14:30",
    };
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, storage);
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    const result = storage.result as { hexagramName: string; changedHexagramName?: string } | undefined;
    expect(result?.hexagramName).toBe("天水讼");
    expect(result?.changedHexagramName ?? "").toBe("");
    // 只有本卦一栏、六爻。
    expect(host.querySelectorAll(".ad-ly-chart__col")).toHaveLength(1);
    expect(host.querySelectorAll(".ad-ly-yao")).toHaveLength(6);
    // 空着的那一栏要自己说清为什么空 —— 否则「本来没有」与「数据丢了」分不出来。
    expect(host.textContent).toContain("六爻安静，无动爻，故无变卦。");
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
    jump("liuyao");
    const question = container.querySelector<HTMLInputElement>('input[aria-label="所问何事"]');
    if (question !== null) question.value = "本周适合加仓吗";
    // 起卦时间必须固定:自动摇卦以时间为种子,用「现在」会让断言随时辰漂移
    // (没有动爻时变卦列根本不渲染,爻数会在 6 与 12 之间跳)。
    const when = container.querySelector<HTMLInputElement>('input[aria-label="起卦时间"]');
    if (when !== null) when.value = "2026-09-29T10:00";
    container.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();
    expect(panelStorage(session, "liuyao").result).toBeDefined();
    expect(container.querySelectorAll(".ad-ly-yao")).toHaveLength(12);

    const second = document.createElement("div");
    renderBushi(second, { session });
    expect(panelStorage(session, "liuyao").result).toBeDefined();
    expect(second.querySelectorAll(".ad-ly-chart__col")).toHaveLength(2);
    cleanup();
  });

  it("switches the number method and reveals the three inputs", () => {
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, {});
    const numberButton = Array.from(host.querySelectorAll<HTMLElement>(".ad-bp-segmented button"))
      .find((button) => button.textContent === "数字起卦");
    numberButton?.click();
    const numberField = host.querySelector('input[aria-label="第1个数"]')?.closest(".ad-bp-field");
    const selectField = host.querySelector('select[aria-label="本卦"]')?.closest(".ad-bp-field");
    expect((numberField as HTMLElement | null)?.style.display).toBe("");
    expect((selectField as HTMLElement | null)?.style.display).toBe("none");
    cleanup();
  });

  // R9:清空数字框后 Number("") = 0,旧实现直接把 0 交给库,报出的是库的
  // 「numbers 必须是正整数」。面板自己先拦,给用户看得懂的话。
  it("rejects an empty or zero number input before calling the library", () => {
    const storage: Record<string, unknown> = {
      question: "本周适合加仓吗",
      yongShenTargets: ["妻财"],
      method: "number",
      numbers: [1, 2, 3],
      dateValue: "2026-09-29T10:00",
    };
    const host = document.createElement("div");
    const cleanup = liuyaoPanel.render(host, storage);
    const first = host.querySelector<HTMLInputElement>('input[aria-label="第1个数"]');
    if (first !== null) first.value = "";
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    expect(storage.error).toBe("三个数都填 1–999 的整数");
    expect(storage.result).toBeUndefined();
    cleanup();
  });
});
