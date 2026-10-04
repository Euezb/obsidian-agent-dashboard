/**
 * 八字合盘的柱间关系(纯函数,无 DOM)。
 *
 * 口径:
 * - 只比同位置的四柱(年↔年、月↔月、日↔日、时↔时),这是本面板的既定范围;
 * - 天干:五合优先,命中即不再报相生/相克(合而不克);否则双向判相生、相克,
 *   细节里写出「谁生谁 / 谁克谁」,避免只看甲→乙单向;
 * - 地支:六合 → 相冲 → 半合(**必须两支不同**,同支不算半合);
 * - 日主就是日柱天干,不再单独报一条「日主关系」(否则同一关系会重复计数)。
 */
export type RelationTone = "good" | "warn" | "neutral";

export interface RelationPillar {
  stem: string;
  branch: string;
}

export interface RelationChart {
  fourPillars: {
    year: RelationPillar;
    month: RelationPillar;
    day: RelationPillar;
    hour: RelationPillar;
  };
}

export interface RelationHit {
  /** 位置标签,例如「年柱」。 */
  position: string;
  /** 关系名,例如「天干五合」「地支半合」。 */
  kind: string;
  /** 细节,方向已写明,例如「壬(水)克丙(火)」。 */
  detail: string;
  tone: RelationTone;
}

export interface RelationSummary {
  total: number;
  /** 五合 / 六合 / 半合 条数。 */
  he: number;
  /** 相生条数。 */
  sheng: number;
  /** 相冲 / 相克条数。 */
  chongKe: number;
  verdict: string;
}

export const PILLAR_ORDER: ReadonlyArray<readonly ["year" | "month" | "day" | "hour", string]> = [
  ["year", "年柱"],
  ["month", "月柱"],
  ["day", "日柱"],
  ["hour", "时柱"],
];

/** 天干五合(合化五行)。 */
const GAN_WU_HE: Record<string, { partner: string; element: string }> = {
  甲: { partner: "己", element: "土" },
  己: { partner: "甲", element: "土" },
  乙: { partner: "庚", element: "金" },
  庚: { partner: "乙", element: "金" },
  丙: { partner: "辛", element: "水" },
  辛: { partner: "丙", element: "水" },
  丁: { partner: "壬", element: "木" },
  壬: { partner: "丁", element: "木" },
  戊: { partner: "癸", element: "火" },
  癸: { partner: "戊", element: "火" },
};

/** 地支六合。 */
const ZHI_LIU_HE: Record<string, string> = {
  子: "丑", 丑: "子", 寅: "亥", 亥: "寅", 卯: "戌", 戌: "卯",
  辰: "酉", 酉: "辰", 巳: "申", 申: "巳", 午: "未", 未: "午",
};

/** 地支相冲。 */
const ZHI_CHONG: Record<string, string> = {
  子: "午", 午: "子", 丑: "未", 未: "丑", 寅: "申", 申: "寅",
  卯: "酉", 酉: "卯", 辰: "戌", 戌: "辰", 巳: "亥", 亥: "巳",
};

/** 三合局:半合 = 同组**两支不同**的地支。 */
const SAN_HE_GROUPS: ReadonlyArray<{ members: readonly string[]; element: string }> = [
  { members: ["申", "子", "辰"], element: "水" },
  { members: ["亥", "卯", "未"], element: "木" },
  { members: ["寅", "午", "戌"], element: "火" },
  { members: ["巳", "酉", "丑"], element: "金" },
];

const ELEMENT_OF_GAN: Record<string, string> = {
  甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土",
  己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水",
};
const ELEMENT_SHENG: Record<string, string> = {
  木: "火", 火: "土", 土: "金", 金: "水", 水: "木",
};
const ELEMENT_KE: Record<string, string> = {
  木: "土", 土: "水", 水: "火", 火: "金", 金: "木",
};

type Relation = Omit<RelationHit, "position">;

function stemRelation(stemA: string, stemB: string): Relation | null {
  if (stemA === "" || stemB === "") return null;
  const wuHe = GAN_WU_HE[stemA];
  if (wuHe !== undefined && wuHe.partner === stemB) {
    return { kind: "天干五合", detail: `${stemA}${stemB}合化${wuHe.element}`, tone: "good" };
  }
  const elementA = ELEMENT_OF_GAN[stemA] ?? "";
  const elementB = ELEMENT_OF_GAN[stemB] ?? "";
  if (elementA === "" || elementB === "") return null;
  if (ELEMENT_SHENG[elementA] === elementB) {
    return { kind: "天干相生", detail: `${stemA}(${elementA})生${stemB}(${elementB})`, tone: "good" };
  }
  if (ELEMENT_SHENG[elementB] === elementA) {
    return { kind: "天干相生", detail: `${stemB}(${elementB})生${stemA}(${elementA})`, tone: "good" };
  }
  if (ELEMENT_KE[elementA] === elementB) {
    return { kind: "天干相克", detail: `${stemA}(${elementA})克${stemB}(${elementB})`, tone: "warn" };
  }
  if (ELEMENT_KE[elementB] === elementA) {
    return { kind: "天干相克", detail: `${stemB}(${elementB})克${stemA}(${elementA})`, tone: "warn" };
  }
  return null;
}

/** 地支固定顺序,用来把「六合/相冲/半合」的文案规范化(甲乙互换后文字完全一致)。 */
const BRANCH_ORDER: readonly string[] = [
  "子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥",
];

function orderBranches(branchA: string, branchB: string): readonly [string, string] {
  const indexA = BRANCH_ORDER.indexOf(branchA);
  const indexB = BRANCH_ORDER.indexOf(branchB);
  if (indexA < 0 || indexB < 0 || indexA <= indexB) return [branchA, branchB];
  return [branchB, branchA];
}

function branchRelation(branchA: string, branchB: string): Relation | null {
  if (branchA === "" || branchB === "") return null;
  const [first, second] = orderBranches(branchA, branchB);
  if (ZHI_LIU_HE[branchA] === branchB) {
    return { kind: "地支六合", detail: `${first}${second}合`, tone: "good" };
  }
  if (ZHI_CHONG[branchA] === branchB) {
    return { kind: "地支相冲", detail: `${first}${second}冲`, tone: "warn" };
  }
  // 同支不是半合:半合必须是三合局里两支不同的地支。
  if (branchA === branchB) return null;
  for (const group of SAN_HE_GROUPS) {
    if (group.members.includes(branchA) && group.members.includes(branchB)) {
      return { kind: "地支半合", detail: `${first}${second} → ${group.element}局`, tone: "good" };
    }
  }
  return null;
}

/** 四柱同位置的柱间关系;甲/乙 互换时结果集完全一致(方向写在 detail 里)。 */
export function pillarRelations(a: RelationChart, b: RelationChart): RelationHit[] {
  const hits: RelationHit[] = [];
  for (const [key, position] of PILLAR_ORDER) {
    const pillarA = a.fourPillars[key];
    const pillarB = b.fourPillars[key];
    const stem = stemRelation(pillarA.stem, pillarB.stem);
    if (stem !== null) hits.push({ position, ...stem });
    const branch = branchRelation(pillarA.branch, pillarB.branch);
    if (branch !== null) hits.push({ position, ...branch });
  }
  return hits;
}

/** 合 / 生 / 冲克 三类分开计数,判语不再把「相生」说成「合」。 */
export function summarizeRelations(hits: readonly RelationHit[]): RelationSummary {
  const he = hits.filter((hit) => hit.kind.includes("合")).length;
  const sheng = hits.filter((hit) => hit.kind.includes("相生")).length;
  const chongKe = hits.filter((hit) => hit.kind.includes("冲") || hit.kind.includes("克")).length;
  const total = hits.length;
  const counts = `合 ${he} · 生 ${sheng} · 冲克 ${chongKe}`;
  let verdict: string;
  if (total === 0) {
    verdict = "两盘四柱没有触发明面关系,属于各管各的盘,相处贵在明说。";
  } else if (chongKe === 0) {
    verdict = `四柱无冲克（${counts}）,多数柱子对得上,配合阻力小一些。`;
  } else if (he + sheng > chongKe) {
    verdict = `顺多于冲克（${counts}）,多数柱子对得上,配合阻力小一些。`;
  } else {
    verdict = `顺与冲克相当或冲克更多（${counts}）,需要各让一步,别在同一字段上硬顶。`;
  }
  return { total, he, sheng, chongKe, verdict };
}
