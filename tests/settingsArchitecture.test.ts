import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string): string => fs.readFileSync(path.join(root, file), "utf8");

describe("Task 16 settings architecture", () => {
  it("registers a real settings tab with all approved controls and accessible labels", () => {
    const source = read("src/settings/AgentDashboardSettingTab.ts");
    for (const text of [
      "日记文件夹", "收件箱文件夹", "报告文件夹", "缓存文件夹", "缓存有效期",
      "RSS 订阅", "自动生成每日摘要", "Codex 可执行文件", "检测 Codex",
      "GitHub 密钥", "重新生成缓存", "隔离损坏缓存",
    ]) expect(source).toContain(text);
    expect(source).toContain("aria-label");
    expect(source).toContain("ConfirmationModal");
    expect(source).not.toContain("Configuration options will be available");
  });

  it("uses public registration and never opens settings through app.setting", () => {
    const main = read("src/main.ts");
    expect(main).toContain("this.addSettingTab(new AgentDashboardSettingTab");
    expect(main).not.toMatch(/app\.setting/);
    expect(main).toContain("设置 → 第三方插件 → Agent Dashboard");
  });

  it("retrieves GitHub secrets immediately before requests without logging or caching the token", () => {
    const main = read("src/main.ts");
    const settings = read("src/settings/settings.ts");
    expect(main).toContain("getSecret(secretName)");
    expect(main).not.toMatch(/console\.(?:log|debug|info).*secret/i);
    expect(main.match(/getSecret\(/g)).toHaveLength(1);
    expect(settings).not.toMatch(/githubToken|tokenValue/);
  });

  it("serializes and catches setting, detection, and maintenance actions", () => {
    const source = read("src/settings/AgentDashboardSettingTab.ts");
    expect(source).toContain("SafeActionQueue");
    expect(source).toContain("this.dashboardPlugin.updateSetting(key, next)");
    expect(source).toContain("保存设置失败，已恢复原值");
    expect(source).toContain("缓存维护失败");
    expect(source).toContain("Codex 检测失败");
    expect(source).not.toMatch(/button\.onClick\(async/);
  });

  it("restores every setting control when persistence fails", () => {
    const source = read("src/settings/AgentDashboardSettingTab.ts");
    expect(source).toContain("commitControlValue");
    expect(source.match(/this\.commitControl\(/g)?.length).toBeGreaterThanOrEqual(8);
  });

  it("enables native cache maintenance only for a FileSystemAdapter", () => {
    const main = read("src/main.ts");
    expect(main).toContain("new NodeCacheMaintenanceFilePort(");
    expect(main).toMatch(/if \(adapter instanceof FileSystemAdapter\)[\s\S]*new CacheMaintenance\(/);
    expect(main).not.toMatch(/new CacheMaintenance\(\s*adapter,/);
  });
});
