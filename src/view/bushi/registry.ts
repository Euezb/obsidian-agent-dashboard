import type { BusiPanel } from "../../features/divination/bushiTypes";
import { baziPanel } from "./baziPanel";
import { daliurenPanel } from "./daliurenPanel";
import { fortunePanel } from "./fortunePanel";
import { hepanPanel } from "./hepanPanel";
import { liuyaoPanel } from "./liuyaoPanel";
import { taiyiPanel } from "./taiyiPanel";
import { tarotPanel } from "./tarotPanel";
import { xiaoliurenPanel } from "./xiaoliurenPanel";
import { ziweiPanel } from "./ziweiPanel";

/**
 * 卜筮方法注册表。切换器按数组顺序渲染。
 * 顺序:小六壬 → 塔罗 → 六爻 → 太乙 → 大六壬 → 八字 → 紫微 → 八字合盘 → 日运月运。
 */
export const BUSHI_PANELS: readonly BusiPanel[] = [
  xiaoliurenPanel,
  tarotPanel,
  liuyaoPanel,
  taiyiPanel,
  daliurenPanel,
  baziPanel,
  ziweiPanel,
  hepanPanel,
  fortunePanel,
];
