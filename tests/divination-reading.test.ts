import { describe, expect, it, vi } from "vitest";
import { DivinationReadingService } from "../src/features/divination/DivinationReadingService";
import {
  buildDivinationReadingPrompt,
  DivinationReadingUnavailableError,
  divinationReadingCacheKey,
  InvalidDivinationReadingError,
  methodGuideOf,
  parseDivinationReading,
  supportedReadingMethods,
  type DivinationReadingPrompt,
  type DivinationReadingRequest,
} from "../src/features/divination/divinationReading";
import { createDefaultSettings } from "../src/settings/settings";
import type { AgentDashboardSettings } from "../src/settings/settings";

/**
 * 解卦的契约:
 * - 九个方法各有一套术语与断法(guide),但输出骨架统一是【总断】【逐条】【可行】;
 * - 事实行由各面板自己拼,提示词只负责把它们讲清楚、把标签原样带进【逐条】;
 * - 「问题」只有在开关打开时才进提示词 —— 这是唯一会离开本机的内容;
 * - 缓存键把方法 + 种子 + 事实指纹算进去:卦变了必须重取,同一卦不重取;
 * - 输出格式不对(空、超长、半截)宁可报失败,不画进面板。
 */

const LONG_ENOUGH = "【总断】这一卦里没有外力，真正卡住的是不愿意把冲突摊开。";

function methodRequest(overrides: Partial<DivinationReadingRequest> = {}): DivinationReadingRequest {
  return {
    kind: "method",
    method: "liuyao",
    cacheKey: "seed-1",
    momentText: "2026-09-30 13:52",
    question: "要不要把这件事摊开谈",
    facts: [
      { label: "本卦", value: "泽火革（坎宫 · 属水）" },
      { label: "动爻", value: "三爻 官鬼亥水（发动） → 妻财" },
    ],
    ...overrides,
  };
}

function settings(overrides: Partial<AgentDashboardSettings> = {}): AgentDashboardSettings {
  return { ...createDefaultSettings(), ...overrides };
}

function service(
  run: (prompt: DivinationReadingPrompt) => Promise<string>,
  current: AgentDashboardSettings = settings(),
): { reading: DivinationReadingService; run: ReturnType<typeof vi.fn> } {
  const spy = vi.fn<(prompt: DivinationReadingPrompt) => Promise<string>>(run);
  return {
    reading: new DivinationReadingService({
      generator: { isConfigured: () => true, runDivinationReading: spy },
      settings: () => current,
    }),
    run: spy,
  };
}

describe("解卦提示词", () => {
  it("每个方法都有一份自己的术语与断法", () => {
    expect(supportedReadingMethods()).toEqual([
      "tarot",
      "xiaoliuren",
      "liuyao",
      "taiyi",
      "daliuren",
      "bazi",
      "ziwei",
      "hepan",
      "fortune",
    ]);
    // 抽查两门:六爻讲用神,紫微讲命宫四化 —— 不是同一套套话。
    expect(methodGuideOf("liuyao").guide).toContain("用神");
    expect(methodGuideOf("ziwei").guide).toContain("命宫");
    expect(methodGuideOf("xiaoliuren").guide).toContain("时宫");
    // 没有专门 guide 的方法不该炸,退回通用口径。
    expect(methodGuideOf("not-a-method").label).toBe("术数");
  });

  it("方法提示词:三段骨架 + 标签照抄,事实行按原样进提示词", () => {
    const prompt = buildDivinationReadingPrompt(methodRequest({ includeQuestion: true }));
    expect(prompt.system).toContain("六爻");
    expect(prompt.system).toContain("【总断】");
    expect(prompt.system).toContain("【逐条】");
    expect(prompt.system).toContain("【可行】");
    expect(prompt.system).toContain("标签必须照抄输入里给出的标签");
    expect(prompt.user).toContain("本卦：泽火革（坎宫 · 属水）");
    expect(prompt.user).toContain("动爻：三爻 官鬼亥水（发动） → 妻财");
    expect(prompt.user).toContain("读者所问：要不要把这件事摊开谈");
    expect(prompt.user).toContain("起卦方式：六爻");
  });

  it("关掉「一起发」时,问题文本根本不进提示词", () => {
    const prompt = buildDivinationReadingPrompt(methodRequest({ includeQuestion: false }));
    expect(prompt.user).not.toContain("要不要把这件事摊开谈");
    expect(prompt.user).toContain("读者没有写具体问题。");
  });

  it("今日一牌走三段散文,不套【逐条】", () => {
    const prompt = buildDivinationReadingPrompt({
      kind: "daily",
      method: "tarot",
      cacheKey: "2026-09-30",
      momentText: "2026-09-30",
      question: "",
      facts: [
        { label: "牌名", value: "宝剑二（Two of Swords）" },
        { label: "正逆", value: "正位" },
        { label: "关键词", value: "抉择、僵局" },
      ],
    });
    expect(prompt.system).toContain("今日一牌");
    expect(prompt.system).toContain("约 200 字");
    expect(prompt.user).toContain("今天是 2026-09-30");
    expect(prompt.user).toContain("牌名：宝剑二（Two of Swords）");
    expect(prompt.user).not.toContain("【逐条】");
  });

  it("没有事实行时说清楚,不让模型凭空造", () => {
    const prompt = buildDivinationReadingPrompt(methodRequest({ facts: [] }));
    expect(prompt.user).toContain("（没有可用的卦象信息）");
  });
});

describe("解卦输出收尾", () => {
  it("剥掉代码围栏与多余空行", () => {
    expect(parseDivinationReading("```\n" + LONG_ENOUGH + "\n```")).toBe(LONG_ENOUGH);
    expect(parseDivinationReading(LONG_ENOUGH + "\n\n\n\n下一段")).toBe(`${LONG_ENOUGH}\n\n下一段`);
  });

  it("空、半截、超长都当失败", () => {
    expect(() => parseDivinationReading("   ")).toThrow(InvalidDivinationReadingError);
    expect(() => parseDivinationReading("太短")).toThrow(InvalidDivinationReadingError);
    expect(() => parseDivinationReading("卦".repeat(7_000))).toThrow(InvalidDivinationReadingError);
  });
});

describe("解卦服务", () => {
  it("同一请求只发一次,第二次走缓存", async () => {
    const { reading, run } = service(async () => LONG_ENOUGH);
    const first = await reading.read(methodRequest({ includeQuestion: true }));
    const second = await reading.read(methodRequest({ includeQuestion: true }));
    expect(first).toBe(LONG_ENOUGH);
    expect(second).toBe(LONG_ENOUGH);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("卦变了(事实指纹不同)就重新取", async () => {
    const { reading, run } = service(async () => LONG_ENOUGH);
    await reading.read(methodRequest({ includeQuestion: true }));
    await reading.read(methodRequest({
      includeQuestion: true,
      facts: [{ label: "本卦", value: "乾为天（乾宫 · 属金）" }],
    }));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("同一卦换个方法问,不会串用彼此的结果", async () => {
    const { reading, run } = service(async () => LONG_ENOUGH);
    await reading.read(methodRequest({ includeQuestion: true }));
    await reading.read(methodRequest({ includeQuestion: true, method: "daliuren" }));
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("缓存键把方法与「发不发问题」都算进指纹", () => {
    const withQuestion = divinationReadingCacheKey(methodRequest({ includeQuestion: true }));
    const withoutQuestion = divinationReadingCacheKey(methodRequest({ includeQuestion: false }));
    const otherMethod = divinationReadingCacheKey(methodRequest({ includeQuestion: true, method: "bazi" }));
    expect(withQuestion).not.toBe(withoutQuestion);
    expect(withQuestion).not.toBe(otherMethod);
    expect(divinationReadingCacheKey(methodRequest({ includeQuestion: true }))).toBe(withQuestion);
  });

  it("开关由服务按设置决定,调用方不必知道自己会不会泄露问题", async () => {
    const { reading, run } = service(async () => LONG_ENOUGH, settings({
      bushiReadingSendsQuestion: false,
    }));
    await reading.read(methodRequest({ includeQuestion: true }));
    const prompt = run.mock.calls[0]?.[0] as DivinationReadingPrompt;
    expect(prompt.user).not.toContain("要不要把这件事摊开谈");
  });

  it("解卦开关关掉、或卜筮关掉,都不发请求", async () => {
    for (const off of [
      settings({ bushiReadingEnabled: false }),
      settings({ bushiEnabled: false }),
    ]) {
      const { reading, run } = service(async () => LONG_ENOUGH, off);
      expect(reading.isConfigured()).toBe(false);
      await expect(reading.read(methodRequest())).rejects.toBeInstanceOf(DivinationReadingUnavailableError);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it("输出格式不对时抛错,不进缓存", async () => {
    const { reading, run } = service(async () => "太短");
    await expect(reading.read(methodRequest())).rejects.toBeInstanceOf(InvalidDivinationReadingError);
    await expect(reading.read(methodRequest())).rejects.toBeInstanceOf(InvalidDivinationReadingError);
    expect(run).toHaveBeenCalledTimes(2);
  });
});
