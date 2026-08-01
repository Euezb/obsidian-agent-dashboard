# Agent Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-only Obsidian Agent Dashboard that prioritizes tasks and recent notes, explains Vault health, visualizes note activity, automatically refreshes AI news and GitHub daily/weekly rankings, and generates one controlled Codex summary per day.

**Architecture:** A native Obsidian `ItemView` renders four independently refreshable sections from a typed `DashboardState`. `RefreshCoordinator` composes local Vault scanning, versioned JSON caches, external feed adapters, and an allowlisted Codex process runner. Each adapter is isolated behind interfaces so pure logic can be tested without loading Obsidian.

**Tech Stack:** TypeScript, Obsidian public API, esbuild, native DOM/CSS, Node.js `child_process`, `requestUrl`, Vitest as a development-only test dependency.

---

## Execution rules

- Project root: `<source root>`
- Deployment target: `<vault A>\.obsidian\plugins\agent-dashboard`
- Design specification: `docs/superpowers/specs/2026-06-28-agent-dashboard-design.md`
- Do not create a Git remote, publish a repository, or run `git commit`; the user has not authorized commits.
- Use `apply_patch` for source edits.
- After every task, run its focused test and `npm run build`.
- Do not use React, Tailwind, Bootstrap, shadcn, a chart library, or unofficial Obsidian APIs.
- Do not add GSAP to v1. The approved motion is limited to short state transitions that CSS and WAAPI handle more efficiently. Reconsider GSAP only if a later approved interaction needs coordinated timelines.
- Never pass `--dangerously-bypass-approvals-and-sandbox`, `--yolo`, or equivalent flags to Codex.

## Milestones

1. **Foundation and approved UI:** Tasks 1-5 produce an installable mock-data plugin.
2. **Local Vault intelligence:** Tasks 6-10 replace local mock data with real tasks, notes, health, heatmap, and safe writes.
3. **External discovery:** Tasks 11-13 add versioned caches, GitHub rankings, Hacker News, and RSS.
4. **Codex automation and hardening:** Tasks 14-17 add allowlisted Codex summaries, error states, settings, deployment, and final verification.

## Planned file structure

```text
agent-dashboard/
├── AGENTS.md
├── CLAUDE.md
├── DESIGN.md
├── PRODUCT.md
├── manifest.json
├── package.json
├── styles.css
├── versions.json
├── vitest.config.ts
├── src/
│   ├── main.ts
│   ├── constants.ts
│   ├── data/mockDashboard.ts
│   ├── domain/
│   │   ├── types.ts
│   │   ├── cacheSchemas.ts
│   │   └── refreshState.ts
│   ├── features/
│   │   ├── vault/taskParser.ts
│   │   ├── vault/recentNotes.ts
│   │   ├── vault/heatmap.ts
│   │   ├── vault/healthScore.ts
│   │   ├── vault/VaultScanner.ts
│   │   ├── vault/VaultActions.ts
│   │   ├── feeds/githubTrending.ts
│   │   ├── feeds/hackerNews.ts
│   │   ├── feeds/rss.ts
│   │   ├── feeds/FeedService.ts
│   │   └── codex/CodexRunner.ts
│   ├── infrastructure/
│   │   ├── CacheRepository.ts
│   │   ├── ProcessAdapter.ts
│   │   └── RefreshCoordinator.ts
│   ├── settings/
│   │   ├── settings.ts
│   │   └── AgentDashboardSettingTab.ts
│   └── view/
│       ├── AgentDashboardView.ts
│       ├── renderHeader.ts
│       ├── renderToday.ts
│       ├── renderVaultPulse.ts
│       ├── renderDiscovery.ts
│       └── renderState.ts
└── tests/
    ├── taskParser.test.ts
    ├── recentNotes.test.ts
    ├── heatmap.test.ts
    ├── healthScore.test.ts
    ├── cacheRepository.test.ts
    ├── refreshCoordinator.test.ts
    ├── githubTrending.test.ts
    ├── hackerNews.test.ts
    ├── rss.test.ts
    └── codexRunner.test.ts
```

### Task 1: Initialize the official Obsidian plugin project

**Files:**
- Create from official sample: `eslint.config.mts`, `esbuild.config.mjs`, `tsconfig.json`, `version-bump.mjs`
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `versions.json`

- [ ] **Step 1: Copy the current official sample plugin without its Git history**

Run in PowerShell from the project root:

```powershell
git clone --depth 1 https://github.com/obsidianmd/obsidian-sample-plugin work/sample-plugin
Get-ChildItem -LiteralPath work/sample-plugin -Force |
  Where-Object Name -NotIn '.git','.github','README.md','LICENSE' |
  Copy-Item -Destination . -Recurse -Force
Remove-Item -LiteralPath work/sample-plugin -Recurse -Force
git init
```

Expected: sample files exist at the project root, the design documents remain intact, and no remote is configured.

- [ ] **Step 2: Set consistent plugin metadata**

Write `manifest.json` as:

```json
{
  "id": "agent-dashboard",
  "name": "Agent Dashboard",
  "version": "0.1.0",
  "minAppVersion": "1.8.0",
  "description": "A warm daily dashboard for Vault health, AI discovery, and controlled Codex workflows.",
  "author": "Euezb",
  "isDesktopOnly": true
}
```

Set `package.json` fields `name`, `version`, and `description` to the same identity. Keep the sample's existing scripts and dev dependencies. Write `versions.json` as:

```json
{
  "0.1.0": "1.8.0"
}
```

- [ ] **Step 3: Add durable project instructions**

Create identical `AGENTS.md` and `CLAUDE.md` containing:

```markdown
# Agent Dashboard

- This is a Windows-only TypeScript Obsidian community plugin, not a general web app.
- Plugin ID: `agent-dashboard`; version: `0.1.0`; minimum Obsidian: `1.8.0`.
- Source root: `<source root>`.
- Deployment target: `<vault A>\.obsidian\plugins\agent-dashboard`.
- Use Obsidian public APIs. Do not depend on undocumented internals.
- Keep UI, data acquisition, cache, and Codex process execution in separate modules.
- Network requests, Codex execution, and Vault writes must be explicit in code and covered by failure states.
- Never accept arbitrary shell commands or use approval/sandbox bypass flags.
- Runtime release files are `main.js`, `manifest.json`, and `styles.css`.
- Required verification: `npm test`, `npm run build`, and `npm run lint`.
- Do not create a remote or commit unless the user explicitly authorizes it.
```

- [ ] **Step 4: Install and verify the untouched foundation**

Run:

```powershell
npm install
npm run build
npm run lint
git remote -v
```

Expected: build and lint exit 0; `git remote -v` prints nothing.

### Task 2: Add a test harness and shared constants

**Files:**
- Create: `vitest.config.ts`
- Create: `src/constants.ts`
- Create: `tests/constants.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add Vitest as a development-only dependency**

Run:

```powershell
npm install --save-dev vitest happy-dom
npm pkg set scripts.test="vitest run"
npm pkg set scripts.test:watch="vitest"
```

Expected: `vitest` and `happy-dom` appear only under `devDependencies`; no runtime dependency is added.

- [ ] **Step 2: Configure Node tests**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    include: ["tests/**/*.test.ts"],
    clearMocks: true,
  },
});
```

- [ ] **Step 3: Write the failing identity test**

Create `tests/constants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { PLUGIN_ID, VIEW_TYPE } from "../src/constants";

describe("plugin constants", () => {
  it("keeps stable public identifiers", () => {
    expect(PLUGIN_ID).toBe("agent-dashboard");
    expect(VIEW_TYPE).toBe("agent-dashboard-view");
  });
});
```

Run `npm test`. Expected: FAIL because `src/constants.ts` does not exist.

- [ ] **Step 4: Implement constants and verify**

Create `src/constants.ts`:

```ts
export const PLUGIN_ID = "agent-dashboard";
export const VIEW_TYPE = "agent-dashboard-view";
export const CACHE_SCHEMA_VERSION = 1;
export const EXTERNAL_CACHE_TTL_MS = 60 * 60 * 1000;
export const LOCAL_REFRESH_DEBOUNCE_MS = 350;
```

Run:

```powershell
npm test
npm run build
```

Expected: tests and build pass.

### Task 3: Define domain contracts and default settings

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/domain/refreshState.ts`
- Create: `src/settings/settings.ts`
- Create: `tests/settings.test.ts`

- [ ] **Step 1: Write a failing defaults test**

Create `tests/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings/settings";

describe("default settings", () => {
  it("uses approved paths and refresh policy", () => {
    expect(DEFAULT_SETTINGS.dailyFolder).toBe("Daily");
    expect(DEFAULT_SETTINGS.cacheFolder).toBe("Dashboard/cache");
    expect(DEFAULT_SETTINGS.externalCacheTtlMinutes).toBe(60);
    expect(DEFAULT_SETTINGS.autoDailyCodexSummary).toBe(true);
  });
});
```

Run `npm test -- tests/settings.test.ts`. Expected: FAIL.

- [ ] **Step 2: Add typed settings**

Create `src/settings/settings.ts`:

```ts
export interface AgentDashboardSettings {
  dailyFolder: string;
  inboxFolder: string;
  reportsFolder: string;
  cacheFolder: string;
  rssFeeds: string[];
  externalCacheTtlMinutes: number;
  autoDailyCodexSummary: boolean;
  codexExecutable: string;
  githubSecretName: string;
}

export const DEFAULT_SETTINGS: AgentDashboardSettings = {
  dailyFolder: "Daily",
  inboxFolder: "Inbox",
  reportsFolder: "Reports",
  cacheFolder: "Dashboard/cache",
  rssFeeds: [],
  externalCacheTtlMinutes: 60,
  autoDailyCodexSummary: true,
  codexExecutable: "codex",
  githubSecretName: "",
};
```

- [ ] **Step 3: Add domain types**

Create `src/domain/types.ts` with these exported contracts:

```ts
export type ModuleStatus = "idle" | "loading" | "ready" | "stale" | "error";

export interface DashboardTask { id: string; path: string; line: number; text: string; completed: boolean; dueDate?: string; }
export interface RecentNote { path: string; title: string; modifiedAt: number; }
export interface HeatmapDay { date: string; count: number; }
export interface HealthBreakdown { frontmatter: number; links: number; tags: number; activity: number; inbox: number; }
export interface VaultHealth { score: number | null; breakdown: HealthBreakdown; suggestions: string[]; insufficientData: boolean; }
export interface NewsItem { id: string; title: string; url: string; source: string; publishedAt: string; summary?: string; }
export interface DailyBrief { date: string; generatedAt: number; items: Array<{ title: string; url: string; source: string; summary: string }>; }
export interface TrendingRepo { name: string; url: string; description: string; language?: string; stars: number; starsInPeriod?: number; source: "github-trending" | "github-search-fallback"; }
export interface ModuleState<T> { status: ModuleStatus; data: T; updatedAt?: number; message?: string; }
export interface DashboardState {
  tasks: ModuleState<DashboardTask[]>;
  recentNotes: ModuleState<RecentNote[]>;
  heatmap: ModuleState<HeatmapDay[]>;
  health: ModuleState<VaultHealth | null>;
  aiNews: ModuleState<NewsItem[]>;
  githubDaily: ModuleState<TrendingRepo[]>;
  githubWeekly: ModuleState<TrendingRepo[]>;
}
```

Create `src/domain/refreshState.ts` with `emptyDashboardState()` returning empty `idle` states for every key.

- [ ] **Step 4: Verify type contracts**

Run `npm test -- tests/settings.test.ts` and `npm run build`. Expected: PASS.

### Task 4: Register the native view and plugin lifecycle

**Files:**
- Replace: `src/main.ts`
- Create: `src/view/AgentDashboardView.ts`
- Create: `src/data/mockDashboard.ts`

- [ ] **Step 1: Create realistic mock state**

Create `src/data/mockDashboard.ts` exporting `MOCK_DASHBOARD_STATE: DashboardState` with four tasks, three recent notes, 365 heatmap entries, health score 86, three AI news items, and four repositories in each ranking. Mark numbers as mock in a source comment.

- [ ] **Step 2: Implement the ItemView shell**

Create `src/view/AgentDashboardView.ts`:

```ts
import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../constants";
import { MOCK_DASHBOARD_STATE } from "../data/mockDashboard";

export class AgentDashboardView extends ItemView {
  constructor(leaf: WorkspaceLeaf, private readonly onNewDiary: () => Promise<void>) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Agent Dashboard"; }
  getIcon(): string { return "layout-dashboard"; }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("agent-dashboard");
    this.contentEl.createEl("h1", { text: "今天从这里开始" });
    this.contentEl.createEl("p", { text: `${MOCK_DASHBOARD_STATE.tasks.data.length} 项任务` });
    const button = this.contentEl.createEl("button", { text: "新建日记" });
    button.addEventListener("click", () => void this.onNewDiary());
  }
}
```

- [ ] **Step 3: Replace sample lifecycle code**

`src/main.ts` must load settings, register `VIEW_TYPE`, add a `layout-dashboard` ribbon icon, add an `Open Agent Dashboard` command, activate or reveal the existing leaf, and unregister the view on unload. The callback passed to the view initially displays a `Notice("New diary will be enabled in the Vault milestone")`.

- [ ] **Step 4: Build and deploy the shell**

Run:

```powershell
npm run build
$target='<vault A>\.obsidian\plugins\agent-dashboard'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item main.js,manifest.json,styles.css -Destination $target -Force
```

Expected: Obsidian can enable the plugin and open an `Agent Dashboard` view.

### Task 5: Implement the approved warm Daily Desk UI with mock data

**Files:**
- Create: `src/view/renderHeader.ts`
- Create: `src/view/renderToday.ts`
- Create: `src/view/renderVaultPulse.ts`
- Create: `src/view/renderDiscovery.ts`
- Create: `src/view/renderState.ts`
- Modify: `src/view/AgentDashboardView.ts`
- Replace: `styles.css`

- [ ] **Step 1: Add renderer contracts**

Each renderer exports one function and receives an owned container plus typed state. Example:

```ts
export function renderToday(container: HTMLElement, tasks: ModuleState<DashboardTask[]>, notes: ModuleState<RecentNote[]>): void;
export function renderVaultPulse(container: HTMLElement, health: ModuleState<VaultHealth | null>, heatmap: ModuleState<HeatmapDay[]>): void;
export function renderDiscovery(container: HTMLElement, news: ModuleState<NewsItem[]>, daily: ModuleState<TrendingRepo[]>, weekly: ModuleState<TrendingRepo[]>): void;
```

- [ ] **Step 2: Build the approved hierarchy**

`AgentDashboardView.render()` creates exactly four top-level regions in this order: header, today, Vault pulse, discovery. Header contains only sync status and `新建日记`. Discovery uses two columns; GitHub owns a local daily/weekly segmented switch.

- [ ] **Step 3: Implement semantic warm tokens**

Define `.agent-dashboard` CSS custom properties for background, surface, ink, muted text, terracotta primary, cobalt focus/status, border, radii, spacing, and 150/180/250 ms motion durations. Use Georgia only for the main greeting and section titles; use Obsidian/system UI fonts everywhere else.

Required CSS behavior:

```css
.agent-dashboard button:active { transform: scale(.97); }
.agent-dashboard :focus-visible { outline: 2px solid var(--ad-focus); outline-offset: 2px; }
.ad-discovery { display:grid; grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr); }
@media (max-width:820px) { .ad-today,.ad-pulse,.ad-discovery { grid-template-columns:1fr; } }
@media (prefers-reduced-motion:reduce) { .agent-dashboard * { scroll-behavior:auto; transition-duration:0.01ms !important; } }
```

- [ ] **Step 4: Visually verify mock UI**

Build, deploy, reload Obsidian, open the view at wide and narrow widths, and compare against the approved `daily-desk-v2.html` visual companion artifact. Expected: no equal-weight card wall, one visible primary action, news left, rankings right, and daily/weekly switch inside rankings.

### Task 6: Parse standard Markdown tasks

**Files:**
- Create: `src/features/vault/taskParser.ts`
- Create: `tests/taskParser.test.ts`

- [ ] **Step 1: Write parser tests**

Test incomplete/completed boxes, due dates, indentation, non-task lines, and stable IDs:

```ts
const input = "# Today\n- [ ] Draft plan 📅 2026-06-28\n  - [x] Review notes\nplain text";
expect(parseTasks("Daily/2026-06-28.md", input)).toEqual([
  expect.objectContaining({ line: 1, text: "Draft plan", completed: false, dueDate: "2026-06-28" }),
  expect.objectContaining({ line: 2, text: "Review notes", completed: true }),
]);
```

Run focused test. Expected: FAIL.

- [ ] **Step 2: Implement a line-based parser**

Use `/^\s*- \[([ xX])\]\s+(.+)$/`, strip `📅 YYYY-MM-DD` from display text, retain zero-based source line, and generate ID as `${path}:${line}`. Do not parse Tasks-plugin-only recurrence syntax.

- [ ] **Step 3: Verify**

Run `npm test -- tests/taskParser.test.ts` and `npm run build`. Expected: PASS.

### Task 7: Compute recent notes and the activity heatmap

**Files:**
- Create: `src/features/vault/recentNotes.ts`
- Create: `src/features/vault/heatmap.ts`
- Create: `tests/recentNotes.test.ts`
- Create: `tests/heatmap.test.ts`

- [ ] **Step 1: Write failing deterministic tests**

Assert recent notes sort by `modifiedAt` descending and exclude hidden `.dev`, `.obsidian`, `Dashboard/cache`, and `Reports` paths. Assert heatmap creates one UTC-local date bucket per day for the previous 365 days and counts note `ctime` dates.

- [ ] **Step 2: Implement pure functions**

```ts
export function selectRecentNotes(notes: RecentNote[], limit: number, excludedPrefixes: string[]): RecentNote[];
export function buildHeatmap(createdAt: number[], endDate: Date, days = 365): HeatmapDay[];
```

Normalize dates with local `YYYY-MM-DD` values so the displayed day matches the user's Windows timezone.

- [ ] **Step 3: Verify**

Run both focused tests and build. Expected: PASS with exactly 365 ordered heatmap entries.

### Task 8: Implement transparent Vault health scoring

**Files:**
- Create: `src/features/vault/healthScore.ts`
- Create: `tests/healthScore.test.ts`

- [ ] **Step 1: Encode the approved scoring examples as tests**

Test category caps: frontmatter 20, links 25, tags 15, 90-day activity 20, Inbox hygiene 20. Test an empty Vault returns `score: null` and `insufficientData: true`. Test suggestions identify the lowest categories.

- [ ] **Step 2: Implement proportional scoring**

Use this input contract:

```ts
export interface HealthInput {
  noteCount: number;
  notesWithFrontmatter: number;
  notesWithLinks: number;
  notesWithTags: number;
  activeWithin90Days: number;
  inboxCount: number;
}
```

Each note-quality category receives `cap * matching / noteCount`. Inbox receives 20 for 0-5 files, 15 for 6-10, 10 for 11-20, 5 for 21-40, and 0 above 40. Round only the final total.

- [ ] **Step 3: Verify**

Run focused tests and build. Expected: score always `null` or 0-100 and breakdown sums to the score before final rounding.

### Task 9: Scan the Vault and implement safe local actions

**Files:**
- Create: `src/features/vault/VaultScanner.ts`
- Create: `src/features/vault/VaultActions.ts`
- Modify: `src/main.ts`
- Modify: `src/view/AgentDashboardView.ts`

- [ ] **Step 1: Introduce narrow Obsidian-facing adapters**

`VaultScanner.scan()` reads Markdown files, uses `cachedRead`, reads metadata cache for frontmatter/tags/links, and returns tasks, recent notes, heatmap, and health in one pass. It must exclude `.dev`, `.obsidian`, cache, and report folders.

- [ ] **Step 2: Implement `createOrOpenDailyNote()`**

Normalize `${dailyFolder}/${YYYY-MM-DD}.md`. If it exists, open it. Otherwise create the folder on demand, create this exact content, then open it:

```markdown
# YYYY-MM-DD

## Tasks

## Notes
```

- [ ] **Step 3: Implement guarded task toggling**

`toggleTask(task)` uses `Vault.process()` and verifies the expected checkbox still exists at `task.line`. If the line changed, throw a typed `StaleTaskError`; the UI shows `任务已在源笔记中变化，请打开笔记处理` and does not guess another line.

- [ ] **Step 4: Replace local mock modules**

On view open, display loading state, call the scanner, update only tasks/recent/health/heatmap, and keep external mock data until Milestone 3.

- [ ] **Step 5: Verify in the real Vault**

Create sample notes under `Daily` and `Inbox`, open the Dashboard, toggle one task, and confirm only its source line changes. Run all tests, build, and lint.

### Task 10: Add versioned cache storage and refresh coordination

**Files:**
- Create: `src/domain/cacheSchemas.ts`
- Create: `src/infrastructure/CacheRepository.ts`
- Create: `src/infrastructure/RefreshCoordinator.ts`
- Create: `tests/cacheRepository.test.ts`
- Create: `tests/refreshCoordinator.test.ts`

- [ ] **Step 1: Write cache and concurrency tests**

Test valid versioned reads, stale TTL, corrupt JSON quarantine, and two simultaneous calls returning the same in-flight Promise. Use an in-memory adapter in tests.

- [ ] **Step 2: Implement versioned envelopes**

```ts
export interface CacheEnvelope<T> {
  schemaVersion: 1;
  generatedAt: number;
  source: string;
  data: T;
}
```

`CacheRepository.read<T>(name, guard)` returns `missing`, `fresh`, `stale`, or `corrupt`. Corrupt files move to `${name}.corrupt-${timestamp}.json` before returning `corrupt`. Writes use a temporary sibling and rename so interrupted writes do not destroy the last valid cache.

- [ ] **Step 3: Implement in-flight deduplication**

`RefreshCoordinator.runOnce<T>(key, work)` stores Promises in `Map<string, Promise<unknown>>`, returns an existing Promise for the same key, and deletes the key in `finally`.

- [ ] **Step 4: Verify**

Run focused tests, full tests, and build. Expected: no duplicate work and corrupt cache never throws through the view boundary.

### Task 11: Fetch GitHub daily and weekly rankings

**Files:**
- Create: `src/features/feeds/githubTrending.ts`
- Create: `tests/githubTrending.test.ts`

- [ ] **Step 1: Save small HTML fixtures in the test file**

Cover repository name, description, language, total stars, and period stars. Include a changed/empty HTML fixture to force fallback.

- [ ] **Step 2: Implement GitHub Trending parsing**

Export:

```ts
export function parseGitHubTrending(html: string): TrendingRepo[];
export function buildGitHubSearchFallbackUrl(since: string): string;
```

Parser results use `source: "github-trending"`. Fallback URL uses GitHub Search API with `pushed:>=YYYY-MM-DD`, `sort=stars`, `order=desc`, and `per_page=20`; mapped results use `source: "github-search-fallback"` and UI label `活跃高星项目`.

- [ ] **Step 3: Add request behavior**

Request daily and weekly URLs through injected `requestUrl`. On non-2xx, parse failure, or zero repositories, call the Search fallback. Accept an optional GitHub token resolved through SecretStorage and send it only to `api.github.com`.

- [ ] **Step 4: Verify**

Run focused tests and build. Manually verify both tabs with cached fixtures before making live requests.

### Task 12: Fetch Hacker News and configurable RSS sources

**Files:**
- Create: `src/features/feeds/hackerNews.ts`
- Create: `src/features/feeds/rss.ts`
- Create: `tests/hackerNews.test.ts`
- Create: `tests/rss.test.ts`

- [ ] **Step 1: Test AI relevance and RSS normalization**

AI keywords are case-insensitive whole terms for `AI`, `agent`, `agents`, `LLM`, `model`, `OpenAI`, `Anthropic`, `MCP`, and `machine learning`. Tests must reject unrelated words containing `ai` as a substring. RSS tests cover RSS 2.0 and Atom title/link/date extraction.

- [ ] **Step 2: Implement Hacker News collection**

Fetch top story IDs, fetch at most the first 50 items with bounded concurrency of 8, filter relevant stories, sort by score descending, and keep at most 12.

- [ ] **Step 3: Implement RSS/Atom parsing without a production dependency**

Use `DOMParser` available in Obsidian's desktop renderer. Normalize feed items to `NewsItem`, reject non-http(s) links, deduplicate by normalized URL, and keep the newest 20 combined items.

- [ ] **Step 4: Verify**

Run focused tests, full tests, and build. Expected: no external parser dependency appears in `package.json`.

### Task 13: Compose feeds, caches, and automatic refresh

**Files:**
- Create: `src/features/feeds/FeedService.ts`
- Modify: `src/infrastructure/RefreshCoordinator.ts`
- Modify: `src/view/AgentDashboardView.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Display cache before network**

On view open, load and render `github-daily`, `github-weekly`, `ai-news-sources`, and `ai-news-summary` envelopes. Mark stale cache as `stale` with `暂时使用缓存` only when refresh fails.

- [ ] **Step 2: Refresh only expired external modules**

Use the configured TTL. Successful results write their own cache and update only their module state. Vault file events must not call external refresh.

- [ ] **Step 3: Add event debouncing**

Register create/modify/delete/rename handlers with `registerEvent`. Debounce local scanning by 350 ms and cancel the timer on unload.

- [ ] **Step 4: Verify behavior**

Use mocked clock tests to prove two view openings inside one hour make zero additional network calls. In Obsidian, disconnect network and confirm cached modules remain visible.

### Task 14: Add the allowlisted Codex process runner

**Files:**
- Create: `src/infrastructure/ProcessAdapter.ts`
- Create: `src/features/codex/CodexRunner.ts`
- Create: `tests/codexRunner.test.ts`

- [ ] **Step 1: Install and preflight the standalone CLI**

With user approval at execution time, run:

```powershell
npm install -g @openai/codex
codex --version
codex login status
```

Expected: a normal PATH-resolved `codex` executable runs outside the packaged Codex App and `codex login status` reports an authenticated session. Stop this milestone if either command fails.

- [ ] **Step 2: Test command allowlisting**

Tests assert only `daily-ai-brief`, `deep-research`, and `vault-lint-explanation` resolve to argument arrays. Unknown task IDs throw before process creation. Tests assert arguments never contain sandbox/approval bypass flags.

- [ ] **Step 3: Implement spawn without a shell**

`ProcessAdapter.spawn(executable, args, options)` must call Node `spawn` with `shell: false`, `windowsHide: true`, a fixed `cwd`, and captured stdout/stderr. Do not concatenate a command string.

- [ ] **Step 4: Define the daily brief task**

The runner writes a prompt file and JSON Schema under `Dashboard/cache/prompts/`. The schema requires a `date` string and an `items` array whose entries contain non-empty `title`, `url`, `source`, and `summary` strings. Then call:

```text
codex exec --cd <vault> --sandbox workspace-write --output-schema <schema-path> --output-last-message <summary-temp-path> -
```

and pipe the prompt through stdin. The prompt instructs Codex to read only `Dashboard/cache/ai-news-sources.json`, return concise Chinese summaries with source URLs, and write no other files. Parse the validated JSON output as `DailyBrief`, wrap it in the versioned cache envelope, validate the final paths remain under the cache folder, then atomically replace `ai-news-summary.json`.

- [ ] **Step 5: Track and clean up child processes**

Store active children by task ID, reject duplicate runs, enforce a 10-minute timeout, record exit code and timestamps, and terminate children during plugin unload.

- [ ] **Step 6: Verify**

Run mocked process tests before one real daily brief. Confirm the generated summary cache contains no credentials, prompts, or unrelated Vault content.

### Task 15: Integrate the daily summary and all module states

**Files:**
- Modify: `src/view/renderHeader.ts`
- Modify: `src/view/renderDiscovery.ts`
- Modify: `src/view/renderState.ts`
- Modify: `src/infrastructure/RefreshCoordinator.ts`

- [ ] **Step 1: Add daily execution gating**

If automatic summary is enabled and no valid summary has `generatedAt` on the current local date, run `daily-ai-brief` after fresh source data is cached. Reopening the view on the same date reuses the summary.

- [ ] **Step 2: Render quiet success states**

Header shows `自动更新完成` plus time. Normal modules do not show refresh buttons. Daily/weekly switching crossfades content over 180 ms without network access.

- [ ] **Step 3: Render contextual failure states**

Network failure shows stale data plus `暂时使用缓存`. Rate limit shows next update time. Missing Codex shows source headlines plus `今日摘要尚未生成` and a settings link. Only failed modules show a retry action.

- [ ] **Step 4: Verify accessibility and motion**

Use keyboard only to open notes, toggle tasks, activate retry, and switch rankings. Enable Windows reduced motion and verify positional movement disappears while state remains understandable.

### Task 16: Build the settings and maintenance UI

**Files:**
- Create: `src/settings/AgentDashboardSettingTab.ts`
- Modify: `src/main.ts`
- Modify: `src/settings/settings.ts`

- [ ] **Step 1: Add validated folder and TTL controls**

Use Obsidian `Setting` components. Normalize user paths, reject absolute paths and `..`, clamp TTL to 15-1440 minutes, and persist via `Plugin.saveData()`.

- [ ] **Step 2: Add RSS and Codex controls**

Provide one URL per line for RSS feeds, an automatic daily summary toggle, Codex executable path, and a `检测 Codex` button that runs `--version` only.

- [ ] **Step 3: Add optional GitHub secret selection**

Store only a SecretStorage key name in plugin settings. Retrieve the value immediately before `api.github.com` calls and never log or cache it.

- [ ] **Step 4: Add maintenance actions**

Provide `重新生成缓存` and `隔离损坏缓存` actions with a confirmation modal. These actions may touch only the configured cache folder.

- [ ] **Step 5: Verify**

Change every setting, reload Obsidian, and confirm values persist. Test invalid paths and TTL boundaries.

### Task 17: Final hardening, deployment, and documentation

**Files:**
- Create: `README.md`
- Create: `docs/architecture.md`
- Modify: `styles.css`
- Modify: any files identified by verification

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
npm test
npm run build
npm run lint
```

Expected: all commands exit 0 with no skipped failing tests.

- [ ] **Step 2: Deploy only release artifacts**

Run:

```powershell
$target='<vault A>\.obsidian\plugins\agent-dashboard'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item main.js,manifest.json,styles.css -Destination $target -Force
Get-ChildItem -LiteralPath $target | Select-Object -ExpandProperty Name
```

Expected names: `main.js`, `manifest.json`, `styles.css` plus Obsidian-created `data.json` only after settings are saved.

- [ ] **Step 3: Execute the real Obsidian acceptance matrix**

Verify plugin enable/disable, application restart, view restore, wide/narrow layout, empty Vault, task toggle, existing/new diary, offline cached mode, corrupt cache isolation, GitHub fallback, missing Codex, Codex timeout, daily-run deduplication, keyboard navigation, visible focus, contrast, and reduced motion.

- [ ] **Step 4: Document installation and data behavior**

`README.md` must explain Windows-only scope, build/deploy commands, folder creation, external requests, cache files, Codex prerequisite, token behavior, and how to disable automatic summaries. `docs/architecture.md` must map the view, coordinator, adapters, caches, and security boundaries.

- [ ] **Step 5: Final evidence report**

Record command outputs, Obsidian version, Codex CLI version, created Vault paths, cache freshness behavior, and any intentionally deferred non-goals. Do not claim completion unless every acceptance item has current evidence.
