/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it, vi } from "vitest";
import type {
  DivinationReadingPort,
  DivinationReadingRequest,
} from "../src/features/divination/divinationReading";
import { daliurenPanel } from "../src/view/bushi/daliurenPanel";
import { fortunePanel } from "../src/view/bushi/fortunePanel";
import { liuyaoPanel } from "../src/view/bushi/liuyaoPanel";
import { taiyiPanel } from "../src/view/bushi/taiyiPanel";
import { xiaoliurenPanel } from "../src/view/bushi/xiaoliurenPanel";

/**
 * 解卦铺到卜筮九个方法的契约(抽查五个不同形状的面板):
 * - 算完结果就自动要一次解卦,方法名、事实行与所问之事都带上;
 * - 解卦块用「解卦」竖签,排在结果下方,【总断】/【逐条】/【可行】照读;
 * - 同一卦重渲染不重取(缓存键由各面板自己拼);
 * - 宿主没给解卦能力时只出卦象。
 */
async function flush(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

const READING = [
  "【总断】这一卦里没有一样是外力，卡住的是不愿意把话摊开。",
  "",
  "【逐条】",
  "时宫：落宫偏凶，主口舌与拖延。",
  "",
  "【可行】",
  "1. 今天先把要说的那句话写下来，再决定说不说。",
].join("\n");

function fakePort(
  read: (request: DivinationReadingRequest) => Promise<string>,
): DivinationReadingPort {
  return { isConfigured: () => true, read };
}

function clickSubmit(host: HTMLElement): void {
  const submit = host.querySelector<HTMLButtonElement>("button.ad-bp-submit");
  expect(submit).not.toBeNull();
  submit?.click();
}

describe("小六壬解卦", () => {
  it("起课后自动要一次解卦,落宫与三宫就是事实行", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(
      async () => READING,
    );
    const cleanup = xiaoliurenPanel.render(host, storage, {
      reading: fakePort(read),
      onSettled: () => undefined,
    });
    const question = host.querySelector<HTMLInputElement>('input[aria-label="占问(可选)"]');
    if (question !== null) question.value = "这次要不要先开口";
    clickSubmit(host);
    await flush();

    expect(read).toHaveBeenCalledTimes(1);
    const sent = read.mock.calls[0]?.[0] as DivinationReadingRequest;
    expect(sent.kind).toBe("method");
    expect(sent.method).toBe("xiaoliuren");
    expect(sent.question).toBe("这次要不要先开口");
    expect(sent.facts.map((fact) => fact.label)).toContain("时宫(最终落宫)");
    // 解卦块:竖签写「解卦」,逐条行照读。
    const note = host.querySelector(".ad-note");
    expect(note).not.toBeNull();
    expect(note?.getAttribute("data-status")).toBe("ready");
    expect(host.querySelector(".ad-note__tab")?.textContent).toBe("解卦");
    expect(host.querySelector(".ad-note__section")?.textContent).toBe("【总断】");
    expect(host.querySelectorAll(".ad-note__rows")).toHaveLength(1);
    cleanup();
  });

  it("解卦状态留在 storage 里,整页重渲染不重取", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(
      async () => READING,
    );
    const port = fakePort(read);
    const cleanup = xiaoliurenPanel.render(host, storage, { reading: port, onSettled: () => undefined });
    clickSubmit(host);
    await flush();
    cleanup();
    expect(read).toHaveBeenCalledTimes(1);

    const again = document.createElement("div");
    const cleanupAgain = xiaoliurenPanel.render(again, storage, {
      reading: port,
      onSettled: () => undefined,
    });
    expect(again.querySelector(".ad-note")?.getAttribute("data-status")).toBe("ready");
    expect(read).toHaveBeenCalledTimes(1);
    cleanupAgain();
  });

  it("宿主没给解卦能力时只出卦象", async () => {
    const host = document.createElement("div");
    const cleanup = xiaoliurenPanel.render(host, {});
    clickSubmit(host);
    await flush();
    expect(host.querySelector(".ad-note")).toBeNull();
    cleanup();
  });
});

describe("其余方法同样走解卦", () => {
  it("六爻:自动摇卦用库回填的 seed 当缓存键", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(
      async () => READING,
    );
    const cleanup = liuyaoPanel.render(host, storage, {
      reading: fakePort(read),
      onSettled: () => undefined,
    });
    const question = host.querySelector<HTMLInputElement>('input[aria-label="所问何事"]');
    if (question !== null) question.value = "这桩合作要不要继续";
    clickSubmit(host);
    await flush();

    expect(read).toHaveBeenCalledTimes(1);
    const sent = read.mock.calls[0]?.[0] as DivinationReadingRequest;
    expect(sent.method).toBe("liuyao");
    expect(sent.question).toBe("这桩合作要不要继续");
    expect(sent.facts.map((fact) => fact.label)).toContain("本卦");
    const seed = (storage.result as { seed?: string } | undefined)?.seed;
    if (seed !== undefined) expect(sent.cacheKey).toBe(seed);
    expect(host.querySelector(".ad-note__tab")?.textContent).toBe("解卦");
    cleanup();
  });

  it("大六壬:三传进了事实行,标签即【逐条】要用的标签", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(
      async () => READING,
    );
    const cleanup = daliurenPanel.render(host, storage, {
      reading: fakePort(read),
      onSettled: () => undefined,
    });
    clickSubmit(host);
    await flush();

    const sent = read.mock.calls[0]?.[0] as DivinationReadingRequest;
    const labels = sent.facts.map((fact) => fact.label);
    expect(sent.method).toBe("daliuren");
    expect(labels).toContain("课体");
    expect(labels).toContain("初传");
    expect(labels).toContain("四课");
    cleanup();
  });

  it("太乙:主星与吉凶信号进事实行,所问之事一起发", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {};
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(
      async () => READING,
    );
    const cleanup = taiyiPanel.render(host, storage, {
      reading: fakePort(read),
      onSettled: () => undefined,
    });
    const question = host.querySelector<HTMLInputElement>('input[aria-label="占问(可选)"]');
    if (question !== null) question.value = "这个盘怎么看";
    clickSubmit(host);
    await flush();

    const sent = read.mock.calls[0]?.[0] as DivinationReadingRequest;
    expect(sent.method).toBe("taiyi");
    expect(sent.question).toBe("这个盘怎么看");
    expect(sent.facts.map((fact) => fact.label)).toContain("盘元");
    expect(sent.facts.map((fact) => fact.label)).toContain("主星");
    cleanup();
  });
});

describe("日运月运解卦", () => {
  it("月运:全月逐日折成三条旬事实,一天不落", async () => {
    const host = document.createElement("div");
    // 2026 年 9 月有 30 天,正好压住老毛病「只发前 10 天」。
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      dayDate: "2026-09-29",
      monthKey: "2026-09",
      isMonth: true,
    };
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(
      async () => READING,
    );
    const cleanup = fortunePanel.render(host, storage, {
      reading: fakePort(read),
      onSettled: () => undefined,
    });
    clickSubmit(host);
    await flush();

    expect(read).toHaveBeenCalledTimes(1);
    const sent = read.mock.calls[0]?.[0] as DivinationReadingRequest;
    expect(sent.method).toBe("fortune");
    expect(sent.question).toBe("");
    const labels = sent.facts.map((fact) => fact.label);
    expect(labels).toContain("上旬（01–10）");
    expect(labels).toContain("中旬（11–20）");
    expect(labels).toContain("下旬（21–30）");
    expect(labels).toContain("当月十神分布");
    expect(labels.some((label) => label.includes("前 10 天"))).toBe(false);
    // 标签是【逐条】要照抄的:必须能被解卦块的行正则认出来(无空格、不超 14 字)。
    for (const label of labels) {
      expect(label).not.toMatch(/\s/);
      expect(label.length).toBeLessThanOrEqual(14);
    }
    // 每一天都要出现在发出去的事实里:尤其是第 11 天以后。
    const values = sent.facts.map((fact) => fact.value).join("\n");
    const monthDays = (storage.monthDays ?? []) as Array<{ date: string }>;
    expect(monthDays).toHaveLength(30);
    for (const entry of monthDays) {
      expect(values).toContain(entry.date.slice(5));
    }
    cleanup();
  });

  it("日运:五行关系与黄历宜忌各一条,宜忌不再拆成可逐条断的两项", async () => {
    const host = document.createElement("div");
    const storage: Record<string, unknown> = {
      birthDate: "1990-01-01",
      birthTime: "10:00",
      gender: "male",
      dayDate: "2026-09-29",
      isMonth: false,
    };
    const read = vi.fn<(request: DivinationReadingRequest) => Promise<string>>(
      async () => READING,
    );
    const cleanup = fortunePanel.render(host, storage, {
      reading: fakePort(read),
      onSettled: () => undefined,
    });
    clickSubmit(host);
    await flush();

    const sent = read.mock.calls[0]?.[0] as DivinationReadingRequest;
    const labels = sent.facts.map((fact) => fact.label);
    expect(sent.method).toBe("fortune");
    expect(labels).toContain("当日干支");
    expect(labels).toContain("当日十神");
    // 用神是八字那边的输入,排运给不出 —— 给日主与当日的五行关系代替。
    expect(labels).toContain("日主与当日五行");
    expect(labels).toContain("黄历宜忌");
    expect(labels).not.toContain("宜");
    expect(labels).not.toContain("忌");
    cleanup();
  });
});
