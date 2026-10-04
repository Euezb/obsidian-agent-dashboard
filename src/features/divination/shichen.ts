/**
 * 时辰换算。
 *
 * taibu-core 的小六壬 `hour` 参数对 **1–12 按「时辰序号(子=1..亥=12)」解释**,
 * 只有 0 与 13–23 才被当成 0–23 时钟小时(见其 `XiaoliurenInput.hour` 注释与
 * `calculateXiaoliurenData` 里的 `hour === 0 || hour > 12` 分派)。
 *
 * 面板的表单口径是 0–23 时钟小时(默认值取 `Date.now().getHours()`),
 * 所以调用前必须自行换算,否则 1–12 点会被整体当成时辰序号:
 * 10:00(巳时)会被算成酉时,一天的 10/24 小时落宫是错的。
 */
export function clockHourToShichen(hour: number): number {
  const normalized = ((Math.trunc(hour) % 24) + 24) % 24;
  // 子时跨夜(23:00–00:59),其余每两小时一个时辰。
  if (normalized >= 23 || normalized < 1) return 1;
  return Math.floor((normalized + 1) / 2) + 1;
}
