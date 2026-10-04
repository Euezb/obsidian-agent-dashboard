import { describe, expect, it } from "vitest";
import { clockHourToShichen } from "../src/features/divination/shichen";

/**
 * R1 回归:面板的输入口径是 0–23 时钟小时,而 taibu-core 的小六壬 hour
 * 对 1–12 按「时辰序号」解释。24 小时全部锁定,避免再退回时钟小时直传。
 */
describe("clockHourToShichen", () => {
  it("maps every clock hour to the 12 时辰序号 (子=1..亥=12)", () => {
    const expected: Record<number, number> = {
      0: 1, 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5, 9: 6, 10: 6, 11: 7,
      12: 7, 13: 8, 14: 8, 15: 9, 16: 9, 17: 10, 18: 10, 19: 11, 20: 11, 21: 12, 22: 12, 23: 1,
    };
    for (let hour = 0; hour <= 23; hour += 1) {
      expect(clockHourToShichen(hour), `hour=${hour}`).toBe(expected[hour]);
    }
  });

  it("keeps 子时 on both sides of midnight and 午时 at noon", () => {
    expect(clockHourToShichen(23)).toBe(1);
    expect(clockHourToShichen(0)).toBe(1);
    expect(clockHourToShichen(11)).toBe(7);
    expect(clockHourToShichen(12)).toBe(7);
  });

  it("normalizes out-of-range hours instead of returning NaN", () => {
    expect(clockHourToShichen(24)).toBe(1);
    expect(clockHourToShichen(-1)).toBe(1);
    expect(clockHourToShichen(34)).toBe(6);
  });
});
