import { describe, expect, it, vi } from "vitest";
import { DivinationReadingService } from "../src/features/divination/DivinationReadingService";
import {
  buildDivinationReadingPrompt,
  DivinationReadingUnavailableError,
  divinationReadingCacheKey,
  InvalidDivinationReadingError,
  methodGuideOf,
  parseDivinationReading,
  PROMPT_REVISION,
  supportedReadingMethods,
  type DivinationReadingPrompt,
  type DivinationReadingRequest,
} from "../src/features/divination/divinationReading";
import { createDefaultSettings } from "../src/settings/settings";
import type { AgentDashboardSettings } from "../src/settings/settings";

/**
 * 解卦的契约:
 * - 九个方法各有一套术语、断法、本门定位(所长/所短/转介)与应期口径,
 *   输出骨架统一是【总断】【逐条】【应期】【可行】;
 * - 事实行由各面板自己拼,提示词只负责把它们讲清楚、把标签原样带进【逐条】;
 * - 「问题」只有在开关打开时才进提示词 —— 这是唯一会离开本机的内容;
 * - 缓存键把提示词版本 + 方法 + 种子 + 事实指纹算进去:改提示词或换卦都必须重取;
 * - 输出格式不对(空、超长、半截、缺段、乱序)宁可报失败,不画进面板。
 */

const LONG_ENOUGH = [
  "【总断】这一卦里没有外力，真正卡住的是不愿意把冲突摊开（依据：用神妻财子水得月建生）。",
  "【逐条】本卦：泽火革，改弦更张之象（依据：本卦泽火革）→ 局面本来就在变。",
  "【应期】三日至一旬见分晓（依据：用神旺相不动，合待冲）。",
  "【可行】宜今日午后把话说明（依据：用神临日辰）。",
].join("\n");

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

  it("方法提示词:四段骨架 + 标签照抄 + 依据标注,事实行按原样进提示词", () => {
    const prompt = buildDivinationReadingPrompt(methodRequest({ includeQuestion: true }));
    expect(prompt.system).toContain("六爻");
    expect(prompt.system).toContain("【总断】");
    expect(prompt.system).toContain("【逐条】");
    expect(prompt.system).toContain("【应期】");
    expect(prompt.system).toContain("【可行】");
    expect(prompt.system).toContain("标签必须照抄输入里给出的标签");
    // 专业化的两条骨架:标注依据 + 本门定位。
    expect(prompt.system).toContain("本门定位");
    expect(prompt.system).toContain("标注依据不等于写推理过程");
    // 断语分寸词表:只禁「大凶」而不给替代表达,模型只会退回「可能」「建议」。
    expect(prompt.system).toContain("虚断用");
    // 应期口径因术而异:六爻按合冲空伏推,六壬按三传,合盘明说不主应期。
    expect(prompt.system).toContain("合待冲");
    expect(prompt.user).toContain("本卦：泽火革（坎宫 · 属水）");
    expect(prompt.user).toContain("动爻：三爻 官鬼亥水（发动） → 妻财");
    expect(prompt.user).toContain("读者所问：要不要把这件事摊开谈");
    expect(prompt.user).toContain("起卦方式：六爻");
    // 用户段点名的段数必须跟着系统段走,否则模型按「三段」写,【应期】就没了。
    expect(prompt.user).toContain("【总断】【逐条】【应期】【可行】四段");
  });

  it("每个方法都有自己的所长、所短、转介与应期口径", () => {
    for (const method of supportedReadingMethods()) {
      const guide = methodGuideOf(method);
      expect(guide.scope.length).toBeGreaterThan(0);
      expect(guide.limit.length).toBeGreaterThan(0);
      expect(guide.referral.length).toBeGreaterThan(0);
      expect(guide.timing.length).toBeGreaterThan(0);
    }
    // 因术制宜:六爻敢定应期,合盘与塔罗明说不给时间点。
    expect(methodGuideOf("liuyao").timing).toContain("出空");
    expect(methodGuideOf("hepan").timing).toContain("不主应期");
    expect(methodGuideOf("taiyi").limit).toContain("不应期到日");
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

  it("日运月运:换掉【逐条】口径,且不再要求输入里给不出的用神", () => {
    const prompt = buildDivinationReadingPrompt(methodRequest({
      method: "fortune",
      question: "",
      facts: [
        { label: "本命日主", value: "丙火 · 男命" },
        { label: "上旬（01–10）", value: "09-01 甲子七杀；09-02 乙丑正官。本旬十神：七杀5天·正官5天" },
      ],
    }));
    // 四段骨架与结构校验不变。
    for (const section of ["【总断】", "【逐条】", "【应期】", "【可行】"]) {
      expect(prompt.system).toContain(section);
    }
    // 排运没有爻宫可逐条断:通用那句「标签必须照抄输入里给出的标签」不该再出现。
    expect(prompt.system).not.toContain("标签必须照抄输入里给出的标签");
    expect(prompt.system).toContain("【逐条】本门没有爻宫可逐条罗列");
    expect(prompt.system).toContain("不凑数");
    // 用户段也不能再承诺「标签就是【逐条】要用的标签」——那样与系统段自相矛盾。
    expect(prompt.user).not.toContain("标签就是【逐条】要用的标签");
    expect(prompt.user).toContain("已经算好的卦象（按读序）：");
    // 用神是八字那边的输入,排运算不出来 —— guide 里不许再要求「与用神对照」。
    expect(methodGuideOf("fortune").guide).toContain("排运");
    expect(methodGuideOf("fortune").guide).not.toContain("用神");
    // 没有所问之事(排盘与排运本来就没问事)时的总断口径:断这一盘,不自己编问题。
    expect(prompt.system).toContain("不要自己编一个问题");
    expect(prompt.user).toContain("读者没有写具体问题。");
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

  it("缺段与乱序都当失败:半截文本不许画进面板", () => {
    const lines = LONG_ENOUGH.split("\n");
    // 少了【应期】:思考模式下偶发,只判长度的话会当成正常解卦画出来。
    const missingTiming = lines.filter((line) => !line.startsWith("【应期】")).join("\n");
    expect(() => parseDivinationReading(missingTiming)).toThrow(InvalidDivinationReadingError);

    // 【应期】跑到【逐条】前面:顺序不对同样是坏输出。
    const timing = lines.find((line) => line.startsWith("【应期】")) ?? "";
    const reordered = lines.filter((line) => !line.startsWith("【应期】"));
    reordered.splice(1, 0, timing);
    expect(() => parseDivinationReading(reordered.join("\n")))
      .toThrow(InvalidDivinationReadingError);

    expect(parseDivinationReading(LONG_ENOUGH)).toBe(LONG_ENOUGH);
  });

  it("今日一牌按散文段数校验,少一段说明被截断了", () => {
    const three = "第一段写在这里，够长。\n\n第二段也写在这里，也够长。\n\n第三段收尾，同样够长。";
    expect(parseDivinationReading(three, "daily")).toBe(three);
    const two = "第一段写在这里，够长。\n\n第二段也写在这里，也够长。";
    expect(() => parseDivinationReading(two, "daily")).toThrow(InvalidDivinationReadingError);
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

  it("缓存键带提示词版本号:改提示词就自动失效面板上旧的解卦", () => {
    const key = divinationReadingCacheKey(methodRequest({ includeQuestion: true }));
    expect(key.startsWith(`v${PROMPT_REVISION}|`)).toBe(true);
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
