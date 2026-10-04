/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import { Solar } from "lunar-javascript";
import { xiaoliurenPanel } from "../src/view/bushi/xiaoliurenPanel";

/**
 * F1 回归:小六壬的农历月/日默认值必须来自「今天的真实农历」,
 * 而不是写死的 8/8(旧实现不手动改就会按错误日期起课)。
 * 期望值用与实现同源的 lunar-javascript 独立算出,避免测试自己写死常量。
 */
describe("xiaoliuren 默认值(F1)", () => {
  it("默认农历月/日等于今天的真实农历", () => {
    const lunar = Solar.fromDate(new Date()).getLunar();
    // lunar-javascript 用负数表示闰月,表单取值范围是 1–12,故取绝对值。
    const expectedMonth = String(Math.abs(lunar.getMonth()));
    const expectedDay = String(lunar.getDay());

    const host = document.createElement("div");
    const cleanup = xiaoliurenPanel.render(host, {});

    const monthInput = host.querySelector<HTMLInputElement>('input[aria-label="农历月"]');
    const dayInput = host.querySelector<HTMLInputElement>('input[aria-label="农历日"]');
    expect(monthInput).not.toBeNull();
    expect(dayInput).not.toBeNull();

    expect(dayInput?.value).toBe(expectedDay);
    expect(monthInput?.value).toBe(expectedMonth);

    cleanup();
  });

  it("已经提交过的值优先于默认值", () => {
    const host = document.createElement("div");
    const cleanup = xiaoliurenPanel.render(host, { lunarMonth: 3, lunarDay: 27, hour: 5 });
    expect(host.querySelector<HTMLInputElement>('input[aria-label="农历月"]')?.value).toBe("3");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="农历日"]')?.value).toBe("27");
    expect(host.querySelector<HTMLInputElement>('input[aria-label="时辰(0-23)"]')?.value).toBe("5");
    cleanup();
  });
});
