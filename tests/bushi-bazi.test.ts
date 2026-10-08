/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { createXuanxueSessionState, panelStorage } from "../src/features/divination/bushiTypes";
import { renderBushi } from "../src/view/renderBushi";
import { baziPanel } from "../src/view/bushi/baziPanel";

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

function mount(storage: Record<string, unknown>): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  const cleanup = baziPanel.render(host, storage);
  return { host, cleanup };
}

describe("baziPanel", () => {
  it("小运为空时写明原因,不是少画一行", async () => {
    // 1980-01-07 10:00 实测起运不足 1 岁,库直接返回空小运。
    const { host, cleanup } = mount({
      birthDate: "1980-01-07",
      birthTime: "10:00",
      gender: "male",
    });
    host.querySelector<HTMLButtonElement>("button.ad-bp-submit")?.click();
    await flush();

    expect(host.querySelector(".ad-module-state--error")).toBeNull();
    expect(host.textContent).toContain("起运不足 1 岁，本盘无小运。");
    cleanup();
  });

  it("renders the birth form with calendar and true-solar controls", () => {
    const { host, cleanup } = mount({});
    expect(host.textContent).toContain("出生日期");
    expect(host.textContent).toContain("真太阳时");
    // 默认公历:闰月隐藏;默认关真太阳时:经度隐藏。
    const leap = host.querySelector<HTMLElement>(".ad-bp-field--inline");
    expect(leap?.style.display).toBe("none");
    expect(host.querySelector("button.ad-bp-submit")?.textContent).toBe("排盘");
    cleanup();
    cleanup();
  });

  it("computes a chart and renders four pillars, wuxing bars and dayun", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
    };
    const { host, cleanup } = mount(storage);
    const submit = host.querySelector<HTMLButtonElement>("button.ad-bp-submit");
    submit?.click();
    await flush();

    expect(storage.error).toBeUndefined();
    expect(storage.result).toBeDefined();
    expect(host.querySelectorAll(".ad-bz-pillar")).toHaveLength(4);
    expect(host.querySelector(".ad-bz-pillar--day")?.textContent).toContain("日主");
    expect(host.querySelectorAll(".ad-bz-wuxing__row")).toHaveLength(5);
    expect(host.querySelectorAll(".ad-bz-dayun__step").length).toBeGreaterThan(3);
    // 1990 年生的盘,大运步数固定 9 步;文本里应出现起运说明与藏干/纳音。
    expect(host.textContent).toContain("起运");
    // R5:库的 startAgeDetail 自带「起运」后缀,面板不能再拼一个。
    expect(host.textContent).not.toContain("起运起运");
    expect(host.textContent).toContain("8年3月22天起运");
    expect(host.textContent).toContain("纳音");
    expect(host.textContent).toContain("藏干");
    // 当前大运步至少高亮一步(生年 1990 相对现在)。
    expect(host.querySelectorAll(".ad-bz-dayun__step--current").length).toBe(1);
    cleanup();
  });

  it("switches calendar to lunar and reveals the leap-month control", () => {
    const storage: Record<string, unknown> = {};
    const { host, cleanup } = mount(storage);
    const calendar = host.querySelector<HTMLSelectElement>("select");
    expect(calendar).not.toBeNull();
    if (calendar === null) return;
    calendar.value = "lunar";
    calendar.dispatchEvent(new Event("change"));
    const leap = host.querySelectorAll<HTMLElement>(".ad-bp-field--inline")[0];
    expect(leap?.style.display).toBe("");
    expect(storage.calendarType).toBe("lunar");
    cleanup();
  });

  it("reveals longitude controls only when true solar time is on", () => {
    const storage: Record<string, unknown> = {};
    const { host, cleanup } = mount(storage);
    const displays = host.querySelectorAll<HTMLElement>(".ad-bp-field--inline");
    const trueSolar = displays[1]?.querySelector<HTMLInputElement>("input");
    expect(trueSolar).not.toBeNull();
    if (trueSolar === undefined || trueSolar === null) return;
    trueSolar.checked = true;
    trueSolar.dispatchEvent(new Event("change"));
    const selects = host.querySelectorAll<HTMLElement>(".ad-bp-field");
    const longitude = Array.from(selects).find((field) => field.textContent?.includes("参考经度"));
    expect(longitude?.style.display).toBe("");
    expect(storage.trueSolar).toBe(true);
    cleanup();
  });

  // R9:自定义经度超范围时面板先拦(库只会在调用后抛 longitude 范围错误)。
  it("rejects a custom longitude outside 73–135 before calling the library", async () => {
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      trueSolar: true,
      longitudeChoice: "custom",
      customLongitude: 200,
    };
    const { host, cleanup } = mount(storage);
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

  it("keeps the result across re-render inside the bushi section", async () => {
    const container = document.createElement("div");
    const session = createXuanxueSessionState();
    const cleanup = renderBushi(container, { session });
    const jump = (id: string): void => {
      const button = Array.from(container.querySelectorAll<HTMLElement>(".ad-bushi__switcher button"))
        .find((entry) => entry.dataset.method === id);
      button?.click();
    };
    jump("bazi");
    const submit = container.querySelector<HTMLButtonElement>("button.ad-bp-submit");
    submit?.click();
    await flush();
    expect(panelStorage(session, "bazi").result).toBeDefined();
    expect(container.querySelectorAll(".ad-bz-dayun__step").length).toBeGreaterThan(3);

    // 模拟整页重渲染。
    const second = document.createElement("div");
    renderBushi(second, { session });
    expect(panelStorage(session, "bazi").result).toBeDefined();
    expect(second.querySelectorAll(".ad-bz-pillar")).toHaveLength(4);
    cleanup();
  });
});
