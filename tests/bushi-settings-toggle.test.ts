import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * F6 回归(源码契约):切换「启用卜筮」原来只写设置、不通知已打开的面板,
 * 用户关掉开关后板块还在,要等下一次整页重渲染(≤5 分钟)或重开面板才消失。
 * 契约:保存成功后立刻让所有打开的视图就地重渲染。
 * 说明:这里用源码契约而非挂载测试,因为插件与设置页都直接依赖 obsidian 运行时,
 * 仓库既有 viewArchitecture/settingsArchitecture 测试也是同样的做法。
 */
const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

describe("卜筮开关即时生效(F6)", () => {
  it("设置页在保存成功后调用插件的刷新入口", () => {
    const tab = read("src/settings/AgentDashboardSettingTab.ts");
    const index = tab.indexOf('"bushiEnabled"');
    expect(index).toBeGreaterThan(-1);
    const snippet = tab.slice(index, index + 400);
    expect(snippet).toContain("refreshOpenViews");
  });

  it("插件提供 refreshOpenViews 并让打开的视图重渲染", () => {
    const main = read("src/main.ts");
    const index = main.indexOf("refreshOpenViews(): void");
    expect(index).toBeGreaterThan(-1);
    const snippet = main.slice(index, index + 320);
    expect(snippet).toContain("getLeavesOfType(VIEW_TYPE)");
    expect(snippet).toContain("renderNow()");
  });

  it("视图暴露纯重渲染入口,不触发重新抓取或重扫", () => {
    const view = read("src/view/AgentDashboardView.ts");
    const index = view.indexOf("renderNow(): void");
    expect(index).toBeGreaterThan(-1);
    const snippet = view.slice(index, index + 200);
    expect(snippet).toContain("renderCurrent()");
  });
});
