import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F5 回归(样式契约):
 * - 头部从两栏变成三栏(问候语 + 黄历卡 + 动作)后必须允许换行,
 *   否则 821–1100px 这段既不走 ≤820px 的竖排、又塞不下三栏,黄历卡会被挤成细条;
 * - 新增的并排盘面(六爻双栏、八字四柱、大六壬十二宫、紫微十二宫、合盘、太乙)必须有窄屏降级,
 *   否则在窄面板里每格只剩几十像素。
 * 这些是纯 CSS 行为,用文本契约锁住,避免以后调样式时被静默改掉。
 */
const css = readFileSync(resolve(process.cwd(), "styles.css"), "utf8");

function ruleFor(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) return "";
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

function mediaBlock(maxWidth: number): string {
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
  if (start === -1) return "";
  // 取到下一个媒体查询或文件末尾,足以覆盖该断点内的所有规则。
  const next = css.indexOf("@media", start + 10);
  return css.slice(start, next === -1 ? css.length : next);
}

describe("头部三栏换行(F5/B5)", () => {
  it(" .ad-header 允许换行", () => {
    expect(ruleFor(".ad-header")).toContain("flex-wrap: wrap");
  });

  it("黄历卡在窄屏占满整行", () => {
    expect(mediaBlock(820)).toContain(".ad-almanac");
  });
});

describe("并排盘面的窄屏降级(F5/B7)", () => {
  const panels = [
    ".ad-ly-chart",
    ".ad-bz-pillars",
    ".ad-dlr-pan",
    ".ad-zw-grid",
    ".ad-hp-sides",
    ".ad-ty-board",
    ".ad-fortune__grid",
  ];

  it("≤820px 断点为每个并排盘面提供降级规则", () => {
    const block = mediaBlock(820);
    for (const selector of panels) {
      expect(block, `${selector} 缺少 820px 降级`).toContain(selector);
    }
  });

  it("今日运势按容器宽度响应,而不只看视口(侧栏被拖窄时也要塌成一栏)", () => {
    expect(css).toContain("container-type: inline-size");
    expect(css).toContain("container-name: ad-fortune");
    expect(css).toContain("@container ad-fortune (max-width: 700px)");
    expect(css).toContain("@container ad-fortune (max-width: 520px)");
  });

  it("≤480px 断点进一步收成单列", () => {
    const block = mediaBlock(480);
    expect(block).toContain(".ad-bz-pillars");
    expect(block).toContain(".ad-zw-grid");
  });

  it("紫微中心块在窄屏改为整行排在末尾(不再依赖 2×2 定位)", () => {
    const block = mediaBlock(820);
    expect(block).toContain(".ad-zw-center");
    expect(block).toContain("grid-column: 1 / -1");
  });
});
