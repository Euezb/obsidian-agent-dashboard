/**
 * 卜筮解卦:提示词、输出收尾与缓存键。
 *
 * 九个方法(塔罗 / 小六壬 / 六爻 / 太乙 / 大六壬 / 八字 / 紫微 / 八字合盘 / 日运月运)
 * 共用一条链路:
 *
 *   面板算出结果 → 自己把结果折成「事实行」(标签 + 值)→ 服务拼提示词发给模型 → 题签块画回面板下方
 *
 * 所以**这个文件不认识任何一种术数**:它只负责把事实行讲清楚、把文风与结构钉死、
 * 把每个方法的术语与取舍写在 METHOD_GUIDES 里。要加新方法,只需要加一条 guide + 面板侧的一份事实行。
 *
 * 发出去的内容只有:方法名、口径时间、事实行、以及(默认开启、可在设置里关掉的)用户手写的「问题」。
 * 牌面图、盘面图、Vault 内容、缓存都不出本机。
 */

export type DivinationReadingKind = "daily" | "method";

/** 结果的一条事实:「标签」是术语,「值」是人可读的一行。 */
export interface DivinationReadingFact {
  label: string;
  value: string;
}

export interface DivinationReadingRequest {
  /** daily = 今日一牌(单张塔罗);method = 卜筮面板里的一次起卦/排盘。 */
  kind: DivinationReadingKind;
  /** 方法 id:tarot / xiaoliuren / liuyao / taiyi / daliuren / bazi / ziwei / hepan / fortune。 */
  method: string;
  /** 缓存键的一半:同一次结果不重取(塔罗用抽牌 seed,八字用四柱,六爻用起卦输入…)。 */
  cacheKey: string;
  /** 口径时间,例如「2026-09-30 13:52」。 */
  momentText: string;
  /** 用户手写的问事文本;空串表示没写。 */
  question: string;
  /**
   * 是否把问事文本发出去。缺省 false(不发)。
   * 调用方不判断这个开关 —— 由 DivinationReadingService 按设置统一填,
   * 这样「哪一段文字会离开本机」只有一个地方说了算。
   */
  includeQuestion?: boolean;
  /** 这次结果的要点,由各面板自己拼。 */
  facts: readonly DivinationReadingFact[];
}

/** 面板与板块只认这个接口:能不能解卦、以及取一段解卦文本。 */
export interface DivinationReadingPort {
  isConfigured(): boolean;
  read(request: DivinationReadingRequest): Promise<string>;
}

export interface DivinationReadingPrompt {
  system: string;
  user: string;
}

/** 解卦正文的长度上限:超过说明模型没按格式写,宁可当失败重试。 */
export const MAX_DIVINATION_READING_LENGTH = 6_144;
const MIN_DIVINATION_READING_LENGTH = 12;

/**
 * 每个方法的术语与取舍。guide 会拼进系统提示词,负责告诉模型:
 * 这门术数看什么、按什么顺序断、哪些话不该说。
 */
interface MethodGuide {
  /** 写进提示词的方法名。 */
  label: string;
  /** 这门术数的断法要点(两三句,只写这门特有的)。 */
  guide: string;
}

const METHOD_GUIDES: Readonly<Record<string, MethodGuide>> = Object.freeze({
  tarot: {
    label: "塔罗牌阵",
    guide: "按牌位读,不逐张复述牌义表:先看哪些牌在互相牵制,再看牌位之间的关系(交叉、先后、分叉)。正逆位与元素(风/火/水/土)是判断语气轻重的依据。不谈吉凶宿命,谈眼下的处境与可动的选择。",
  },
  xiaoliuren: {
    label: "小六壬",
    guide: "以时宫(最终落宫)为主断,月宫与日宫是过程:月宫看起因、日宫看转折。六宫各有五行与方位,断事要落到具体的人事与时间尺度(几日内),不用它断生死、疾病、婚姻成败这类重事。",
  },
  liuyao: {
    label: "六爻",
    guide: "以用神为主:先按所问之事取用神,看它旺衰、动静、生克,再看世应关系与动爻化出之爻。旬空、月建日辰是判断真假与时间点的依据。变卦说明事情的走向。只依卦中已有的信息断,不另起他法。",
  },
  taiyi: {
    label: "太乙",
    guide: "以太乙所在宫与主算、客算的对比看大势:主算看自己一侧,客算看外部与对手,计神、文昌、始击指出关键位。太乙是大格局之术,断事用「势」与「时」,不要落到一天里的具体小事。",
  },
  daliuren: {
    label: "大六壬",
    guide: "以三传为骨:初传发端、中传转折、末传结果。四课看事情的四个面,天地盘与天将说明各方态度。断事顺序是「课体 → 三传 → 天将神煞」,先看整体课体格局,再落到所问之事。",
  },
  bazi: {
    label: "八字",
    guide: "以日主为主:先看日主在月令的旺衰与全局的寒暖燥湿,再看十神格局与用神喜忌。大运流年只在与所问之事相关时才提。不做寿命、疾病诊断、婚姻必然性的断言,讲倾向与取用,不讲注定。",
  },
  ziwei: {
    label: "紫微斗数",
    guide: "以命宫与身宫为纲,先看命宫主星与三方四正的组合,再看四化落在哪一宫(化禄机会、化权压力、化科名声、化忌卡点)。十二宫各主一事,断事要落到问题对应的那一宫与其对宫。不做生死、疾病的断言。",
  },
  hepan: {
    label: "八字合盘",
    guide: "先分别看两人的日主与月令,再看两盘之间的合冲刑害与五行互补:谁给谁补了什么、哪里在互相消耗。谈相处的方式与需要注意的地方,不做「合不合、能不能成」的判决,也不预判时间点。",
  },
  fortune: {
    label: "日运月运",
    guide: "把流日(必要时流月)的干支与本命的日主、用神对照:今天哪一路力量被放大、哪一路被压住,适合推进还是收拾。以一天(或一月)为尺度,给可执行的安排,不写全年大运。",
  },
});

const FALLBACK_GUIDE: MethodGuide = {
  label: "术数",
  guide: "只依据输入里已经算出的信息断,不另行起局、不虚构术语。",
};

export function methodGuideOf(method: string): MethodGuide {
  return METHOD_GUIDES[method] ?? FALLBACK_GUIDE;
}

/** 有专门提示词的方法;用来给「解卦能力」做白名单与测试断言。 */
export function supportedReadingMethods(): string[] {
  return Object.keys(METHOD_GUIDES);
}

const DAILY_SYSTEM_PROMPT = [
  "你是一名讲求实用的塔罗解牌者，为一位每天只看一次面板的读者写「今日一牌」。",
  "输入是今天抽到的一张牌（牌名、正逆位、关键词、元素）与日期。",
  "输出纯文本，简体中文，三段，段与段之间空一行，全文约 200 字（180–240 字）：",
  "第一段：这张牌在说什么 —— 从牌面图像与基本牌义讲，两三句。",
  "第二段：落到今天 —— 这个人今天可能遇到什么、真正要留意的是什么。",
  "第三段：给一条今天可执行的做法，具体到动作与时间。",
  "硬性要求：不写小标题、不用 Markdown（不要 #、**、- 和表格）、不排比堆砌；",
  "不预言吉凶祸福，不涉及疾病、法律、投资的具体决策；只使用输入里给出的信息，不虚构牌义。",
].join("\n");

/** 共同骨架:总断 → 逐条 → 可行。逐条的标签直接用输入里给出的标签。 */
function methodSystemPrompt(guide: MethodGuide): string {
  return [
    `你是一名讲求实用的${guide.label}解卦者，为一位在面板上刚起了一卦的读者解这一卦。`,
    `断法要点：${guide.guide}`,
    "",
    "输出纯文本，简体中文，按下面三段写，段与段之间空一行：",
    "【总断】150–250 字：把这一卦连起来读，指出真正的卡点与推力、哪些部分在互相牵制；不要逐条复述。",
    "【逐条】每一条一行，30–50 字，写成「标签：一句」，标签必须照抄输入里给出的标签；不重复总断里已经说过的判断。",
    "【可行】1–3 条，每条 20–40 字，具体到动作与时间，写成「1. ……」。",
    "硬性要求：必须完整包含【总断】【逐条】【可行】三个方括号标题，每个标题独占一行；",
    "不要用 Markdown（不要 #、**、- 和表格）；不预言吉凶祸福，不涉及疾病、法律、投资的具体决策；",
    "不使用输入之外的信息，不虚构卦象与术语。",
  ].join("\n");
}

function factsBlock(facts: readonly DivinationReadingFact[]): string {
  if (facts.length === 0) return "（没有可用的卦象信息）";
  return facts.map((fact) => `${fact.label}：${fact.value}`).join("\n");
}

/** 问题文本:没写、或用户关掉了「一起发」,模型都看不到问的是什么。 */
function questionLine(request: DivinationReadingRequest): string {
  const asked = request.question.trim();
  if (request.includeQuestion !== true || asked === "") return "读者没有写具体问题。";
  return `读者所问：${asked}`;
}

export function buildDivinationReadingPrompt(
  request: DivinationReadingRequest,
): DivinationReadingPrompt {
  if (request.kind === "daily") {
    return {
      system: DAILY_SYSTEM_PROMPT,
      user: [
        `今天是 ${request.momentText}。抽到的牌：`,
        factsBlock(request.facts),
        questionLine(request),
        "请按系统提示写三段、约 200 字的今日解牌。",
      ].join("\n"),
    };
  }

  const guide = methodGuideOf(request.method);
  return {
    system: methodSystemPrompt(guide),
    user: [
      `起卦方式：${guide.label}，时间 ${request.momentText}。`,
      "已经算好的卦象（按读序，标签就是【逐条】要用的标签）：",
      factsBlock(request.facts),
      questionLine(request),
      "请按系统提示写【总断】【逐条】【可行】三段。",
    ].join("\n"),
  };
}

/** 缓存键:方法 + 调用方给的种子 + 事实指纹(卦变了就必须重取) + 发出去的问题。 */
export function divinationReadingCacheKey(request: DivinationReadingRequest): string {
  const fingerprint = request.facts
    .map((fact) => `${fact.label}=${fact.value}`)
    .join("|");
  const asked = request.includeQuestion === true ? request.question.trim() : "";
  return `${request.kind}|${request.method}|${request.cacheKey}|${fingerprint}|${asked}`;
}

/** 去掉模型偶尔裹上的代码围栏,并把过长的空行压成一个空行。 */
export function stripDivinationReadingFences(raw: string): string {
  const fenced = /^```(?:text|markdown|json)?\s*([\s\S]*?)\s*```$/.exec(raw.trim());
  const body = (fenced?.[1] ?? raw).trim();
  return body.replace(/\n{3,}/g, "\n\n");
}

export class InvalidDivinationReadingError extends Error {
  constructor() {
    super("解卦结果不符合格式。");
    this.name = "InvalidDivinationReadingError";
  }
}

export class DivinationReadingUnavailableError extends Error {
  constructor() {
    super("解卦未开启或未配置接口。");
    this.name = "DivinationReadingUnavailableError";
  }
}

/** 收尾:判空、判长、压空行。格式不对宁可报失败,不把半截文本画进面板。 */
export function parseDivinationReading(raw: string): string {
  const text = stripDivinationReadingFences(raw);
  if (
    text.length < MIN_DIVINATION_READING_LENGTH ||
    text.length > MAX_DIVINATION_READING_LENGTH
  ) {
    throw new InvalidDivinationReadingError();
  }
  return text;
}
