/**
 * 干支小工具:十神映射与五行关系话术(纯函数,无 DOM、无状态)。
 *
 * 十神口径:同我(比肩/劫财)、我生(食神/伤官)、生我(偏印/正印)、
 * 我克(偏财/正财)、克我(七杀/正官);每组内按阴阳同性/异性分开。
 */
const GAN_ELEMENT: Record<string, string> = {
  甲: "木", 乙: "木", 丙: "火", 丁: "火", 戊: "土",
  己: "土", 庚: "金", 辛: "金", 壬: "水", 癸: "水",
};

const GAN_YANG: Record<string, boolean> = {
  甲: true, 乙: false, 丙: true, 丁: false, 戊: true,
  己: false, 庚: true, 辛: false, 壬: true, 癸: false,
};

const ELEMENT_SHENG: Record<string, string> = { 木: "火", 火: "土", 土: "金", 金: "水", 水: "木" };
const ELEMENT_KE: Record<string, string> = { 木: "土", 土: "水", 水: "火", 火: "金", 金: "木" };

/** 日主对某个天干的十神;未知天干返回空串。 */
export function tenGodOf(dayMaster: string, targetGan: string): string {
  const masterElement = GAN_ELEMENT[dayMaster] ?? "";
  const targetElement = GAN_ELEMENT[targetGan] ?? "";
  if (masterElement === "" || targetElement === "") return "";
  const samePolarity = (GAN_YANG[dayMaster] ?? true) === (GAN_YANG[targetGan] ?? true);
  if (masterElement === targetElement) return samePolarity ? "比肩" : "劫财";
  if (ELEMENT_SHENG[masterElement] === targetElement) return samePolarity ? "食神" : "伤官";
  if (ELEMENT_SHENG[targetElement] === masterElement) return samePolarity ? "偏印" : "正印";
  if (ELEMENT_KE[masterElement] === targetElement) return samePolarity ? "偏财" : "正财";
  if (ELEMENT_KE[targetElement] === masterElement) return samePolarity ? "七杀" : "正官";
  return "";
}

/**
 * 日主与某个天干的五行关系话术。
 * `unit` 决定「付出日 / 付出月」这类单位词,日运与月运共用同一套口径。
 */
export function elementRelationNote(dayMaster: string, gan: string, unit: "日" | "月" = "日"): string {
  const masterElement = GAN_ELEMENT[dayMaster] ?? "";
  const targetElement = GAN_ELEMENT[gan] ?? "";
  if (masterElement === "" || targetElement === "") return "";
  if (masterElement === targetElement) return "与日主同五行,气场持平,适合按部就班。";
  if (ELEMENT_SHENG[masterElement] === targetElement) return `日主生此气,付出${unit},宜输出不宜硬扛。`;
  if (ELEMENT_SHENG[targetElement] === masterElement) return `此气生扶日主,补给${unit},适合推进正事。`;
  if (ELEMENT_KE[masterElement] === targetElement) return `日主克此气,掌控${unit},适合处理难题但别恋战。`;
  if (ELEMENT_KE[targetElement] === masterElement) return `此气克日主,压力${unit},重要决定往后放。`;
  return "";
}
