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
 *
 * 2026-10 专业化改版,三件事:
 * - 输出从三段变四段,多了【应期】—— 应期埋进总断的长句里被略过时看不出来,
 *   独立成段配合 parseDivinationReading 的结构校验,漏写就是失败重试;
 * - 每个判断必须标注依据(依据：输入里的哪一项)。这是这套提示词的核心:
 *   读者能复核,模型也不敢写没有凭据的判断 —— 抑制幻觉最有效的一条;
 * - 每个方法多一份本门定位(所长/所短/转介)与应期口径,断得敢断、越界明说。
 *
 * 一处例外:日运月运是「排运」不是起卦 —— 没有爻宫可逐条断、也没有所问之事。
 * 它用 guide.rows 换掉【逐条】的口径(不照抄给定项),数据侧按旬聚合
 * (见 view/bushi/fortunePanel.ts 的 xunFacts):31 天逐日写不进 600–1200 字。
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

/** 解卦正文的长度上限:超过说明模型没按格式写,宁可当失败重试。6144 字符约合 5000 汉字,提示词里 600–1200 字的要求远在其内。 */
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
  /** 这门术数擅长断什么 —— 让模型敢在强项上把话说死。 */
  scope: string;
  /** 这门术数断不了什么 —— 越界的部分要明说,不硬断。 */
  limit: string;
  /** 越界时的转介口径,一句话。 */
  referral: string;
  /** 应期口径:这门术数按什么推时间尺度。 */
  timing: string;
  /**
   * 【逐条】整行(含标题)的写法。不给就用通用口径(标签照抄输入、逐项断)。
   * 排运这类没有可逐条项的术数在这里换成自己那套,
   * 否则模型只能把「本命日主」「当日干支」这些给定项再复述一遍。
   */
  rows?: string;
}

const METHOD_GUIDES: Readonly<Record<string, MethodGuide>> = Object.freeze({
  tarot: {
    label: "塔罗牌阵",
    guide: "按牌位读,不逐张复述牌义表:先看哪些牌在互相牵制,再看牌位之间的关系(交叉、先后、分叉)。正逆位与元素(风/火/水/土)是判断语气轻重的依据:同一元素扎堆说明这股力量占了上风,缺席的元素往往是被忽略的那一面;大阿卡纳占比高说明这是转折点,占比低说明主动权还在日常选择里。不谈吉凶宿命,谈眼下的处境与可动的选择。",
    scope: "看当下处境的结构、关系与可动的选择:哪几股力量在互相牵制、主动权落在哪一步。",
    limit: "不给宿命结论,也不给具体日期;不涉疾病与法律。",
    referral: "若所问是要一个日子或一句成不成,明说牌面给不出这个,只给处境的读法。",
    timing: "以牌位顺序给阶段(眼下 / 中段 / 收尾),不给具体日期",
  },
  xiaoliuren: {
    label: "小六壬",
    guide: "以时宫(最终落宫)为主断,月宫与日宫是过程:月宫看起因、日宫看转折,三宫连起来就是这件事的时间线。六宫各有五行与方位,断事要落到具体的人事与时间尺度(几日内),不用它断生死、疾病、婚姻成败这类重事。",
    scope: "快速定一事之成败与时间尺度,几日内见分晓的事断得最准。",
    limit: "不涉生死、疾病、婚姻成败这类重事,也不断大势。",
    referral: "若所问是重事或大势,明说本门不宜,只就眼下这一步给判断。",
    timing: "以三宫落宫与五行定日数,给区间(近则三日,远则一旬)",
  },
  liuyao: {
    label: "六爻",
    guide: "以用神为主:先按所问之事取用神,看它旺衰、动静、生克,再看世应关系与动爻化出之爻。动爻是枢纽,变爻说明事情的走向;旬空、月建日辰既是判断真假的依据,也是定应期(何时见分晓)的依据。只依卦中已有的信息断,不另起他法。",
    scope: "一事之成败、得失与应期,断得最实、最可落地。",
    limit: "不涉宏大格局与方位布局。",
    referral: "若所问是大势与方位,就卦中能看的部分给判断,并说明宜另起太乙或奇门细推。",
    timing: "用神旺相不动以合冲之期断(合待冲、冲待合);休囚以生旺之期;受克以制克之期;旬空以出空之期;伏藏以出现之期;远应年月、近应日时",
  },
  taiyi: {
    label: "太乙",
    guide: "以太乙所在宫与主算、客算的对比看大势:主算看自己一侧,客算看外部与对手,计神、文昌、始击指出关键位,主客相较的差额就是这件事的轻重。太乙是大格局之术,断事用「势」与「时」,不要落到一天里的具体小事。",
    scope: "大势、主客对比与时机:这件事的轻重、谁占先、什么时候势转。",
    limit: "不落到一天里的具体小事,不应期到日。",
    referral: "若所问是眼前一件小事,明说本门看的是势不是事,建议另起六爻或小六壬细断。",
    timing: "以「势」与「时」给月或季的尺度,不给到日",
  },
  daliuren: {
    label: "大六壬",
    guide: "以三传为骨:初传发端、中传转折、末传结果,三传连起来是一条因果链。四课看事情的四个面,天地盘与天将说明各方态度。断事顺序是「课体 → 三传 → 天将神煞」,先看整体课体格局,再落到所问之事。",
    scope: "人事情态、曲折与应期早晚:人心向背、事情怎么走、何时应验。",
    limit: "不断宏观方位布局与国运大势。",
    referral: "若所问是方位布局或大势,明说本门论人事最精、于此非所长,建议另起奇门或太乙。",
    timing: "初传发端、中传转折、末传结果定先后;末传与日辰的关系定迟速;末传空亡则事虚或迟",
  },
  bazi: {
    label: "八字",
    guide: "以日主为主:先看日主在月令的旺衰与全局的寒暖燥湿,定下这个人的底色(偏急还是偏缓、外显还是内耗),再看十神格局与用神喜忌;术语出现后要顺手翻译成人话。大运流年只在与所问之事相关时才提。不做寿命、疾病诊断、婚姻必然性的断言,讲倾向与取用,不讲注定。",
    scope: "一个人的底色、十神格局与用神喜忌,以及大运流年带来的倾向。",
    limit: "不断寿命、不做疾病诊断、不做婚姻必然性断言。",
    referral: "若所问落到具体某件事的成败,明说八字看的是人的倾向而非一事之断,建议另起六爻。",
    timing: "以大运与流年给年尺度,不给到日",
  },
  ziwei: {
    label: "紫微斗数",
    guide: "以命宫与身宫为纲,先看命宫主星与三方四正的组合定出主轴,再看四化落在哪一宫(化禄机会、化权压力、化科名声、化忌卡点)。十二宫各主一事,断事只取与问题相关的一两宫及其对宫,不把十二宫挨个写一遍;每条结论都要能回扣主轴。不做生死、疾病的断言。",
    scope: "命宫三方四正定主轴、四化定卡点与机会,十二宫按事取用。",
    limit: "不断生死疾病;不把十二宫挨个罗列。",
    referral: "若所问超出一两张宫位能承载的范围,明说本门取用有限,只答相关的那一两宫。",
    timing: "以大限与流年所落宫位给年尺度",
  },
  hepan: {
    label: "八字合盘",
    guide: "先分别看两人的日主与月令,再看两盘之间的合冲刑害与五行互补:谁给谁补了什么、哪里在互相消耗 —— 这两面都要双向看,甲对乙与乙对甲不必对称。谈相处的方式与需要注意的地方,不做「合不合、能不能成」的判决,也不预判时间点。",
    scope: "两人五行互补与合冲刑害、相处的方式与要留心的地方。",
    limit: "不做「合不合、能不能成」的判决,也不预判时间点。",
    referral: "若所问是要一句成不成,明说本门不做这个判决,只答相处的方式。",
    timing: "本门不主应期,明说「本门不主应期」即可,不要硬编时间点",
  },
  fortune: {
    label: "日运月运",
    guide: "本门是「排运」不是起卦:输入是流日或流月的干支,以及它与本命日主的十神与五行关系;月运另给整月的逐日干支(按旬排开)。断法先定主气 —— 月运的主气就是流月(月柱,整月不变),日运的主气是当日;先看它落在哪一神(比劫/食伤/财/官杀/印)、与本命日主是什么五行关系,再说这一路把日主往哪个方向推(该进、该守、还是该收)。五行关系只作定性:生扶日主的一段宜推进正事,日主所生的一段是付出、宜输出不宜硬扛,日主所克的一段宜处理难题但别恋战,克日主的一段压力在前、重要决定往后放。流日的十神是十天一轮的:一旬里必然每样一天,别用「哪一路最多」这种说法,那是流月干支的事;逐日序列只用来点出哪几天当值、哪几天该收。流月按节气起算,与日历月不重合:月初到交节之间那几天还属上一个流月,别把整月当成同一路气。黄历宜忌只用来印证判断,不再复述一遍。",
    scope: "流日/流月与本命日主的十神、五行关系,以及这一段内部的进退节奏。",
    limit: "不写全年大运,不推喜忌用神(输入里给不出用神),不涉疾病与法律。",
    referral: "若所问是整年的走向,明说本门看的是这一段,建议另起八字看大运。",
    timing: "日运以时辰给节奏(上午 / 午后 / 夜里);月运以旬给进退(上旬 / 中旬 / 下旬),可在旬内点出一两个关键日,但不逐日罗列",
    rows: "【逐条】本门没有爻宫可逐条罗列,不要照抄「本命日主」「当日干支」这类输入给定项。按这几面各成一行:这一段的主气是什么、哪一路被放大、哪一路被压住(看主气与本命日主的五行关系,不看逐日十神的多少)、段内(旬内或日内)的转折在哪。标签自己起一个本门术语词(如「主气」「被压」「转折」),每行仍要用括号标出依据。最多 5 行;只有一条可写就写一条,不凑数。",
  },
});

const FALLBACK_GUIDE: MethodGuide = {
  label: "术数",
  guide: "只依据输入里已经算出的信息断,不另行起局、不虚构术语。",
  scope: "按输入里已算出的结果给判断。",
  limit: "不补算输入里没有的项。",
  referral: "若所问超出输入能支撑的范围,明说缺哪一项。",
  timing: "按输入里给出的时间信息推时间尺度",
};

export function methodGuideOf(method: string): MethodGuide {
  return METHOD_GUIDES[method] ?? FALLBACK_GUIDE;
}

/** 有专门提示词的方法;用来给「解卦能力」做白名单与测试断言。 */
export function supportedReadingMethods(): string[] {
  return Object.keys(METHOD_GUIDES);
}

/**
 * 两套提示词共用的口径:断语分寸 + 反 AI 味。
 *
 * 措辞只写一次 —— 两处各写一遍,迟早漂移成两种风格。
 * 断语分寸那张表是有意给的:只禁「大凶/必败」而不给可用的替代表达,
 * 模型只会退回「可能」「建议」「综合来看」,断卦就变成了科普。
 */
const TONE_RULES = [
  "断语分寸：实断用「主/必/定」，虚断用「恐/或/似/未免/须防」，建议用「宜/忌/莫/不妨」；不写「大凶」「必败」「命中注定」这类定论。",
  "不写空转句式：「随着…」「值得一提」「不是 X 而是 Y」「不仅 X 更 Y」「首先/其次/最后」「赋能/助力/打造/闭环」「通过…的方式」「综合来看」「需要注意的是」。",
].join("\n");

const DAILY_SYSTEM_PROMPT = [
  "你是一名讲求实用的塔罗解牌者，为一位每天只看一次面板的读者写「今日一牌」。",
  "输入是今天抽到的一张牌（牌名、正逆位、关键词、元素）与日期。",
  "输出纯文本，简体中文，三段，段与段之间空一行，全文约 200 字（180–240 字）：",
  "",
  "第一段：这张牌在说什么 —— 从牌面的图像讲这张牌此刻的分量，两三句。正逆位决定语气的轻重：",
  "正位是这股力量正在顺畅地起作用，逆位是它被卡住、被用过头，或还没到时候。",
  "",
  "第二段：落到今天 —— 这个人今天可能遇到什么、真正要留意的是什么。要指出这张牌与「今天」的接点：",
  "它更像一个提醒、一个诱惑，还是一个机会。如果它今天是阻力，就把阻力写成具体的场景",
  "（会发生在什么事上、以什么形式出现），不要停在「注意沟通」「保持平衡」这种放在谁身上都成立的话。",
  "再点出一个今天不该做的动作，并说清为什么不该做。",
  "",
  "第三段：给一条今天可执行的做法，具体到动作与时间，例如「下午三点前把那条消息发出去」。",
  "",
  "硬性要求：",
  "只写这张牌在此时此地问的这件事上意味着什么，不复述牌义表与教科书定义；",
  "不写小标题、不用 Markdown（不要 #、**、- 和表格）、不排比堆砌；",
  "正文里不写「根据牌面」「综合分析」「首先/其次/最后」这类过程话，也不解释你是怎么推出来的，直接给判断；",
  "每一句都要能挂回输入里给的牌名、正逆位、关键词或元素，输入里没有的不补、不虚构牌义；",
  "牌是镜子不是判决：不下吉凶定论，不写「今天一定会……」，不涉及疾病、法律、投资的具体决策；",
  "不要提问、不要请读者回复、不要写免责声明 —— 面板只有这一小块地方。",
  TONE_RULES,
].join("\n");

/**
 * 共同骨架:先定断 → 逐项断 → 应期 → 取用。
 *
 * 「标注依据」是这套提示词的核心,也是它和科普的分界线:每个判断都挂回输入里的
 * 具体一项,读者能复核,模型也不敢写没有凭据的判断 —— 抑制幻觉最有效的一条。
 * 但必须同时说清「标注依据不等于写推理过程」,否则它会开始写小作文,把额度吃光。
 *
 * 字数放宽到 600–1200 字是有意的:断卦的价值在推演,压字数会把判断写成口号。
 */
/**
 * 【逐条】的通用写法:逐项断,标签照抄输入。
 *
 * 这是给「一卦里有很多可断的项」(爻、宫、传)准备的;没有可逐条项的术数
 * 用 guide.rows 整段换掉(见上面的 fortune),否则这一段只会复述输入。
 */
const ROWS_SECTION = "【逐条】每项一行，写成「标签：判断（依据：输入里的具体项）→ 白话一句」。标签必须照抄输入里给出的标签；判断是断语，不是把事实行翻译一遍；依据只能取自输入；对主线无征象的项写「本项无明显征象」，不要为凑数编。最多 8 行：有征象的项逐项写透，同类项合并成一行；项多时优先写与所问之事相关的，其余归入一行「其余诸项无显著征象」。";

function methodSystemPrompt(guide: MethodGuide): string {
  return [
    `你是一位执业多年的${guide.label}顾问，为一位在面板上刚起了一卦的读者断这一卦。`,
    "",
    "【本门定位】",
    `所长：${guide.scope}`,
    `所短：${guide.limit}`,
    guide.referral,
    "",
    `【断法】${guide.guide}`,
    "",
    "【输入】下面给的是已经算好的结果，直接解读。不要重算、不要补造、不要引入输入之外的术语与卦象。",
    "",
    "【输出】纯文本，简体中文，四段，段与段之间空一行，全文 600–1200 字。宁长勿略：宁可把有征象的项写透，也不要为压字数把判断写成口号；但也别为凑长度复述输入、堆砌套话。",
    "【总断】3–5 句。第一句就所问之事给定断；读者没写问题时（排盘与排运类本来就没有问事）就这一盘或这一段本身的格局给定断，不要自己编一个问题。用「主」「宜」「恐」「未免」「须防」这类断语词，不用「可能」「建议」「综合来看」。其后说这一卦的象与势：哪一股力量占先、卡点在哪、哪一处是转机、哪些部分在互相牵制。每句末尾用括号标注依据，形如（依据：用神妻财子水得月建生）。不要逐条复述事实行，也不要每条平均用力。",
    guide.rows ?? ROWS_SECTION,
    `【应期】一到两行。${guide.timing}；写明依哪一条推出，推不出就写「应期不明」，不要硬编。`,
    "【可行】2–4 条，每条 25–45 字，以「宜」或「忌」起头，落到具体动作与时机，句末括号注明依据的输入项。禁止「多沟通」「保持耐心」「顺其自然」这类放在谁身上都成立的话。",
    "硬性要求：必须完整包含【总断】【逐条】【应期】【可行】四个方括号标题，每个标题独占一行；",
    "术语用本门通行说法，先术语后白话（「用神受克，事有阻力；说白了就是这件事上有人在压着你」）；",
    "标注依据不等于写推理过程：只写依据哪一项，不写「所以如何推出」；",
    "不复述教科书定义与牌义表，卦辞爻辞可引半句；不写「根据卦象」「综合分析」这类过程话；",
    "不涉及疾病诊断、法律判决、投资标的；不替读者做决定；输入里没有的一律不写，不虚构卦象、术语与古籍出处（不确定的出处宁可不引）。",
    "",
    "质量要求：",
    "信号互相矛盾时（旺衰与动爻打架、本卦与变卦相反），明说以哪一条为准、为什么，不要和稀泥；",
    "同一依据不重复引用：【逐条】只写总断没有展开的项；",
    "负面结论要带可改变的条件或时间窗口，用「当前格局显示……」这种口径，不替读者做决定。",
    TONE_RULES,
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
  // 有自定义【逐条】口径的方法(如日运月运)不承诺「标签照抄」——
  // 用户段答应的事,系统段却在禁止,模型只会两头不靠。
  const factsIntro = guide.rows === undefined
    ? "已经算好的卦象（按读序，标签就是【逐条】要用的标签）："
    : "已经算好的卦象（按读序）：";
  return {
    system: methodSystemPrompt(guide),
    user: [
      `起卦方式：${guide.label}，时间 ${request.momentText}。`,
      factsIntro,
      factsBlock(request.facts),
      questionLine(request),
      "请按系统提示写【总断】【逐条】【应期】【可行】四段。",
    ].join("\n"),
  };
}

/**
 * 提示词版本号:改提示词就 +1。
 *
 * 缓存键里有它,所以改完提示词,面板上旧的解卦自动失效重取 ——
 * 否则得重启 Obsidian(缓存只在内存里,不落盘)才看得到新口径。
 */
export const PROMPT_REVISION = 2;

/** 缓存键:提示词版本 + 方法 + 调用方给的种子 + 事实指纹(卦变了就必须重取) + 发出去的问题。 */
export function divinationReadingCacheKey(request: DivinationReadingRequest): string {
  const fingerprint = request.facts
    .map((fact) => `${fact.label}=${fact.value}`)
    .join("|");
  const asked = request.includeQuestion === true ? request.question.trim() : "";
  return `v${PROMPT_REVISION}|${request.kind}|${request.method}|${request.cacheKey}|${fingerprint}|${asked}`;
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

/** 术数四段的标题,按输出顺序。 */
const METHOD_SECTIONS = ["【总断】", "【逐条】", "【应期】", "【可行】"] as const;

/** 今日一牌至少要有的自然段数(提示词要求三段,少于此说明被截断了)。 */
const DAILY_MIN_PARAGRAPHS = 3;

/**
 * 标题是否按序出现。
 *
 * 只查「在不在、顺序对不对」,不查标题是否独占一行,也不查每段的字数:
 * 渲染器本来就兼容「【总断】正文…」这种写法(见 renderDivinationReading 的 heading 分支),
 * 校验比渲染更严,只会把本来读得下去的结果判成失败。
 */
function hasOrderedSections(text: string, sections: readonly string[]): boolean {
  let cursor = 0;
  for (const section of sections) {
    const at = text.indexOf(section, cursor);
    if (at < 0) return false;
    cursor = at + section.length;
  }
  return true;
}

function countParagraphs(text: string): number {
  return text
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== "").length;
}

/**
 * 收尾:判空、判长、判结构、压空行。格式不对宁可报失败,不把半截文本画进面板。
 *
 * 结构校验是 2026-10 加的:思考模式下偶发漏掉【应期】、或整段被截断,
 * 只判长度的话,半截文本会当成正常解卦画进面板 —— 用户以为「解卦就这样」。
 * 判失败会落到面板已有的失败 + 重试上,劣化立刻可见。
 */
export function parseDivinationReading(
  raw: string,
  kind: DivinationReadingKind = "method",
): string {
  const text = stripDivinationReadingFences(raw);
  if (
    text.length < MIN_DIVINATION_READING_LENGTH ||
    text.length > MAX_DIVINATION_READING_LENGTH
  ) {
    throw new InvalidDivinationReadingError();
  }
  if (kind === "daily") {
    // 只卡下限:多写一段不算错,少写说明被截断了。
    if (countParagraphs(text) < DAILY_MIN_PARAGRAPHS) {
      throw new InvalidDivinationReadingError();
    }
    return text;
  }
  if (!hasOrderedSections(text, METHOD_SECTIONS)) {
    throw new InvalidDivinationReadingError();
  }
  return text;
}
