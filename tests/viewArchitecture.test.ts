import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "..");

function read(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

function relativeLuminance(hex: string): number {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255);
  if (channels === undefined) throw new Error(`Invalid color: ${hex}`);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const light = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const dark = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (light + 0.05) / (dark + 0.05);
}

describe("dashboard view architecture", () => {
  it("wins the Obsidian theme cascade for the dashboard canvas", () => {
    const css = read("styles.css");
    expect(css).toMatch(
      /\.workspace-leaf-content\[data-type=["']agent-dashboard-view["']\]\s+\.view-content\.agent-dashboard\s*{[^}]*background-color:\s*var\(--ad-bg\)/s,
    );
  });

  it("wins the theme cascade for the primary action and draws its own mark", () => {
    const css = read("styles.css");
    expect(css).toMatch(
      /\.workspace-leaf-content\[data-type=["']agent-dashboard-view["']\]\s+\.ad-primary-action\s*{[^}]*background-color:\s*var\(--ad-primary\)/s,
    );
    expect(css).toMatch(
      /\.ad-eyebrow::before\s*{[^}]*repeating-conic-gradient/s,
    );
  });

  it("keeps contextual recovery actions subtle in dark Obsidian themes", () => {
    const css = read("styles.css");
    expect(css).toMatch(
      /\.workspace-leaf-content\[data-type=["']agent-dashboard-view["']\]\s+\.ad-inline-action\s*{[^}]*background-color:\s*transparent[^}]*color:\s*var\(--ad-primary-strong\)/s,
    );
  });

  it("uses a WCAG AA eyebrow token without changing the primary token", () => {
    const css = read("styles.css");
    const background = css.match(/--ad-bg:\s*(#[\da-f]{6})/i)?.[1];
    const primary = css.match(/--ad-primary:\s*(#[\da-f]{6})/i)?.[1];
    const strong = css.match(/--ad-primary-strong:\s*(#[\da-f]{6})/i)?.[1];
    expect(background).toBeDefined();
    // C5「批注 · 轴线」定稿的朱砂(2026-09-29 由 #b25736 调深)。
    expect(primary).toBe("#a8482b");
    expect(strong).toBeDefined();
    expect(contrastRatio(strong ?? "#ffffff", background ?? "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/\.ad-eyebrow\s*{[^}]*color:\s*var\(--ad-primary-strong\)/s);
  });

  it("keeps the column-major weekly heatmap inside its own horizontal scroller", () => {
    const css = read("styles.css");
    expect(css).toMatch(/\.ad-heatmap__scroller\s*{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
    expect(css).toMatch(/\.ad-heatmap__grid\s*{[^}]*grid-auto-flow:\s*column[^}]*grid-template-rows:\s*repeat\(7,/s);
    expect(css).toMatch(/\.ad-heatmap__months\s*{[^}]*grid-auto-flow:\s*column/s);
  });

  it("keeps keyboard focus visible and removes routine motion when reduced motion is requested", () => {
    const css = read("styles.css");
    expect(css).toMatch(/\.agent-dashboard\s+:focus-visible\s*{[^}]*outline:\s*2px solid var\(--ad-focus\)[^}]*outline-offset:\s*2px/s);
    expect(css).toMatch(/\.agent-dashboard button:active\s*{[^}]*transform:\s*scale\(\.97\)/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*transition-duration:\s*0\.01ms\s*!important/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*{[\s\S]*?\.agent-dashboard button:active\s*{[^}]*transform:\s*none/s);
  });

  it("uses the AA strong terracotta token for ranking numbers", () => {
    const css = read("styles.css");
    expect(css).toMatch(/\.ad-ranking__rank\s*{[^}]*color:\s*var\(--ad-primary-strong\)/s);
  });

  it("keeps health metric labels and values in stable non-wrapping columns", () => {
    const css = read("styles.css");
    expect(css).toMatch(/\.ad-health__breakdown\s*>\s*div\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
    expect(css).toMatch(/\.ad-health__breakdown\s+(?:dt,\s*\n?\.ad-health__breakdown\s+dd|dt)\s*{[^}]*white-space:\s*nowrap/s);
  });

  it("keeps leaf renderers independent from the renderState composer", () => {
    for (const file of [
      "src/view/renderHeader.ts",
      "src/view/renderToday.ts",
      "src/view/renderVaultPulse.ts",
      "src/view/renderDiscovery.ts",
    ]) {
      expect(read(file), file).not.toMatch(/from\s+["']\.\/renderState["']/);
    }
    expect(read("src/view/renderState.ts")).toContain('from "./domHelpers"');
  });

  it("wires cache-first feeds and Vault-only debounced refresh through public APIs", () => {
    const main = read("src/main.ts");
    const view = read("src/view/AgentDashboardView.ts");

    expect(main).toContain("requestUrl");
    expect(main).toContain("new FeedService(");
    expect(main).toContain("new ObsidianCacheStorage(this.app.vault.adapter)");
    expect(main).toContain("new VaultRefreshDebouncer(");
    expect(main).toContain("isMarkdownVaultEvent");
    expect(main).toContain("shouldRefreshForRename");
    for (const event of ["create", "modify", "delete", "rename"]) {
      expect(main).toContain(`this.app.vault.on("${event}"`);
    }
    expect(view).toContain("public refreshLocal(): void");
    expect(view).toContain("ExternalDashboardController");
    expect(view).toContain("latestDashboardUpdate(this.state)");
    expect(view).not.toContain("MOCK_DASHBOARD_STATE");
    expect(view).not.toContain('from "../data/mockDashboard"');
  });

  it("keeps the ribbon button styled, active-aware, and badge-driven by the task scan", () => {
    const main = read("src/main.ts");
    const css = read("styles.css");
    const ribbon = read("src/view/ribbon.ts");

    // scan-eye is verified against Obsidian's bundled icon table (unknown names render blank).
    expect(ribbon).toContain('export const RIBBON_ICON = "scan-eye"');
    expect(main).toContain("addRibbonIcon(RIBBON_ICON");
    expect(main).toContain("ensureRibbonGradient(activeDocument)");
    expect(main).toContain("refreshRibbonBadge()");
    expect(main).toContain('on("active-leaf-change", syncRibbonActive)');
    expect(css).toContain("stroke: url(#ad-ribbon-warm)");
    expect(css).toContain(".ad-ribbon__badge");
    expect(css).toContain(".ad-ribbon--active::before");
  });
  it("persists both dragged column widths through one shared split handle", () => {
    const main = read("src/main.ts");
    const view = read("src/view/AgentDashboardView.ts");
    const renderState = read("src/view/renderState.ts");
    const renderToday = read("src/view/renderToday.ts");
    const renderDiscovery = read("src/view/renderDiscovery.ts");
    const splitHandle = read("src/view/splitHandle.ts");

    // One shared handle owns the pointer/keyboard interaction and its a11y contract.
    expect(splitHandle).toContain("ad-splitter");
    expect(splitHandle).toContain('setAttribute("role", "separator")');
    expect(splitHandle).toContain("ad-split-host--dragging");
    // Each section maps that handle onto its own grid track.
    expect(renderToday).toContain("--ad-notes-track");
    expect(renderDiscovery).toContain("--ad-ranking-track");
    // Both widths travel the same callback path into a single settings write.
    expect(renderState).toContain("onTodayNotesWidthChange?: (width: number) => void");
    expect(renderState).toContain("onDiscoveryRankingWidthChange?: (width: number) => void");
    expect(view).toContain("todayNotesWidth: settings.todayNotesWidth");
    expect(view).toContain("discoveryRankingWidth: settings.discoveryRankingWidth");
    expect(view).toContain("ColumnWidthKey");
    expect(main).toContain("updateSetting(key,");
  });

  it("opens a recent note through the workspace without triggering a rescan", () => {
    const view = read("src/view/AgentDashboardView.ts");
    const renderState = read("src/view/renderState.ts");
    const renderToday = read("src/view/renderToday.ts");

    expect(view).toContain("private openRecentNote(note: RecentNote): void");
    expect(view).toContain('getLeaf("tab").openFile(target)');
    expect(view).toContain("onOpenNote: (note) => this.openRecentNote(note)");
    expect(renderState).toContain("onOpenNote?: (note: RecentNote) => void");
    expect(renderToday).toContain("ad-note__open");
  });
  it("wires the direct-HTTP summarizer and contextual retries into the native view", () => {
    const main = read("src/main.ts");
    const view = read("src/view/AgentDashboardView.ts");
    const externalState = read("src/view/externalDashboardState.ts");
    const summarizer = read("src/features/feeds/ApiSummarizerService.ts");

    expect(main).toContain("new ApiSummarizerService(");
    expect(main).toContain("runText(prompt)");
    expect(main).toContain("SUMMARY_REQUEST_TIMEOUT_MS");
    expect(summarizer).toContain("x-opencode-session");
    expect(summarizer).toContain('type: "disabled"');
    expect(main).toContain("lastSummaryAttemptDate");
    expect(main).toContain("feedService.retry(module, listener)");
    expect(view).toContain("this.externalController.retry(module)");
    expect(view).toContain("dashboardAutomationStatus(this.state)");
    expect(externalState).toContain('return "自动更新完成"');
  });

  it("surfaces report-command failures with a redacted reason instead of a bare Notice", () => {
    const main = read("src/main.ts");
    const detail = read("src/infrastructure/errorDetail.ts");

    expect(main).toContain("describeFailure");
    expect(main).toContain("console.error");
    expect(main).not.toContain("详见控制台");
    expect(detail).toContain("SECRET_SPANS");
    expect(detail).toContain("MAX_DETAIL_LENGTH");
  });
});
