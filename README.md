# Agent Dashboard for Obsidian

Agent Dashboard is a Windows-only Obsidian community plugin that combines today's Markdown tasks, recent notes, Vault health, a 365-day activity heatmap, top-five GitHub daily and weekly project rankings, AI news, and an optional API-generated Chinese daily brief. It also carries an optional **今日运势** panel at the top of the page and a **卜筮** section below (小六壬、塔罗、六爻、太乙、大六壬、八字、紫微、八字合盘、日运月运), all computed locally.

The plugin is desktop-only. It is not designed for Obsidian Mobile, Sync execution, a browser-only Vault, or non-Windows systems.

## Requirements

- Windows 10 or 11.
- Obsidian desktop 1.8.0 or newer.
- Node.js and npm for building from source.
- An OpenAI-compatible endpoint for the daily brief and report commands, with its key in an environment variable.

The locally observed version during the 2026-06-30 verification was Obsidian app package `1.12.7` with Obsidian Electron shell/installer `1.12.4.0`. These observations are not minimum-version guarantees.

## Build and install

From the development directory:

```powershell
npm install
npm test
npm run build
npm run lint
```

Only three release artifacts are code: `main.js`, `manifest.json`, and `styles.css`. The tarot card art lives beside them in `assets/tarot/`, so a full install copies four paths. For this Vault layout:

```powershell
$source = '<source root>'
$target = '<vault A>\.obsidian\plugins\agent-dashboard'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item "$source\main.js","$source\manifest.json","$source\styles.css" -Destination $target -Force
Copy-Item "$source\assets" -Destination $target -Recurse -Force
```

Then open Obsidian → Settings → Community plugins, reload the plugin list if necessary, and enable **Agent Dashboard**. Open it from the ribbon or the `Open Agent Dashboard` command.

The commands above are installation instructions. The Task 17 documentation pass did not copy or deploy artifacts.

## Vault folders and files

Defaults are Vault-relative and may be changed in Settings → Community plugins → Agent Dashboard:

| Purpose | Default | Creation behavior |
| --- | --- | --- |
| Daily notes | `Daily` | Created on demand when **新建日记** creates the first note. |
| Inbox health input | `Inbox` | Not created by scanning; create it only if you use an Inbox workflow. |
| Reports | `Reports` | Reserved for report-producing workflows; not created by the dashboard scan. |
| Plugin cache | `Dashboard/cache` | Created on the first successful cache write. |

Folder settings must remain inside the Vault. Absolute paths, drive paths, UNC paths, traversal segments, and unsafe Windows path segments are rejected.

### Task sources, dates, and grouping

Task collection has its own scope, independent from the scan that feeds recent notes, the heatmap, and the health score:

- **任务来源文件夹** (`taskIncludeFolders`) lists the folders that may contribute tasks. Leaving it empty means the whole Vault; the default matches every note.
- **任务排除文件夹** (`taskExcludeFolders`) lists folders whose checkboxes are never collected. Exclusions win over inclusions, and both settings are validated Vault-relative paths, one per line, deduplicated case-insensitively.
- Planning documents, templates, or archived projects with `- [ ]` checkboxes are the usual reason a task panel looks noisy. Adding their folder to the exclusion list removes them without touching the notes.
- A task's day comes from its own `📅 YYYY-MM-DD` token, otherwise from a date in its note's path (for example `Daily/2026-06-28.md`). Tasks that have neither stay undated. The file's modified day is deliberately not used, so editing an old note never turns its historical checkboxes into today's tasks.
- The 待办 panel groups rows by source note, lists the group that contains today first, shows each group's day and count, and keeps completed rows in the DOM behind a local 显示已完成 toggle. Groups collapse through a native disclosure control; nothing is hidden until you ask. Both local choices survive a re-render, so an incoming feed update never reopens what you collapsed.
- Opening the dashboard carries finished tasks from **earlier daily notes** into today's note under `## 归档`. Only rows that live in an earlier daily note qualify (the day comes from the file name inside your daily folder), a row that already sits under an archive heading is never archived twice, and repeated texts collapse to one line. Notes in other folders never qualify, even when their name contains a date.

Changing either folder list rescans the open dashboard immediately. Notes outside the task scope still count toward recent notes, the heatmap, and the health score.

### Cache artifacts

The four primary versioned cache files are:

- `Dashboard/cache/github-daily.json`
- `Dashboard/cache/github-weekly.json`
- `Dashboard/cache/ai-news-sources.json`
- `Dashboard/cache/ai-news-summary.json`

Transactional writes may briefly create `.tmp-*` or `.backup.json` siblings. Invalid envelopes are renamed to `.corrupt-<timestamp>.json` rather than trusted. The plugin never puts credentials in cache files. A read that loses the file to a concurrent replacement is retried once, so the panel does not report a cache error for an entry that is perfectly fine, and a cache write that fails while the fetched data is still usable keeps that data visible and says so on the module instead of failing silently.

Freshness is controlled by the external-cache TTL setting, default 60 minutes and constrained to 15–1440 minutes. Cached data is rendered before a network refresh. If refresh fails, valid old data stays visible with `暂时使用缓存`. Changing TTL applies to subsequent reads in the current plugin session.

## External requests and data

The plugin makes only these classes of external request:

| Destination | Purpose | Data sent |
| --- | --- | --- |
| `https://github.com/trending` | Daily and weekly public trending pages | Period query only. |
| `https://api.github.com/search/repositories` | Fallback when Trending cannot be parsed | Public search query and optional Authorization header. |
| `https://hacker-news.firebaseio.com/v0/` | Top-story IDs and story metadata | Public item IDs. |
| User-configured HTTP(S) RSS/Atom URLs | AI-news sources | Normal feed request. |
| OpenAI-compatible endpoint configured in 直连 API 摘要 | Generate the Chinese daily brief and the report commands | The constrained prompt and the cached AI-news list. |

GitHub, Hacker News, and RSS requests do not upload Vault notes. RSS is user-configurable, so each configured feed host receives the normal network metadata associated with a request. When the daily brief or a report command runs, the plugin sends its prompt and the cached AI-news list to the endpoint you configured; no other Vault content is sent. Provider processing, retention, and account policy are determined by that endpoint, not by this plugin.

Nothing in 今日运势 or 卜筮 makes a request for the divination itself: the almanac, the tarot draw, and every 术数 panel run on `taibu-core` and `lunar-javascript` inside the plugin, and the card art is read from the plugin's own `assets/tarot/` folder (see below). The one exception is the optional 解卦 (see 今日运势 and 卜筮 below): when it is on, the cast result — plus the question you typed, unless you turn that off — is sent to the same endpoint as the daily brief to write the reading.

For GitHub authentication, the plugin setting stores only a SecretStorage key name. The token value remains in Obsidian SecretStorage, is retrieved immediately before an `api.github.com` fallback request, and is not logged or cached. On Obsidian versions without SecretStorage, the UI accepts only a key name for compatibility; it never asks the user to paste a token into plugin data.

## Direct-HTTP summarizer

The daily brief and the two report commands (深度研究 / Vault 体检) are produced by one OpenAI-compatible `/chat/completions` request. Configure it in Settings → Agent Dashboard → 直连 API 摘要:

- **接口地址** — the base URL, for example `https://opencode.ai/zen/go/v1`.
- **API 模型** — the model id at that endpoint, for example `deepseek-v4.1-flash`.
- **API 密钥环境变量名** — the NAME of the environment variable that holds the key, for example `OPENCODE_API_KEY`. The value is read at request time and never written to plugin data.

Requests carry the key as a bearer token, send `thinking: {"type": "disabled"}` to switch off the model's reasoning mode (retried once without the parameter when a provider rejects it), and include an `x-opencode-session` header, which OpenCode-family gateways require for routing and other OpenAI-compatible servers ignore. Summaries and reports use a 180-second budget instead of the 15-second feed timeout, because a real brief takes 20–60 seconds. A failure shows a redacted reason — in the panel for the brief, and in the command's Notice for 深度研究 / Vault 体检, with the full error in the developer console: secret-looking spans are dropped and long reasons truncated before display.

The key must be visible to Obsidian's own process environment. Set a user environment variable once and restart Obsidian completely — a window reload does not re-read the environment:

```powershell
setx OPENCODE_API_KEY "<your key>"
```

To stop automatic summaries, turn off **自动生成每日摘要**. Existing cached summaries stay visible until they expire or are cleared, and the panel keeps a manual 重试摘要 action. A failed automatic attempt stays retryable on the next open or 5-minute tick (at most three automatic attempts per day, per session) and is never recorded as today's summary; the brief is built from the headlines the panel already shows, so it does not repeat the Hacker News crawl.

## 今日运势 and 卜筮

Both sections are gated by one setting (**卜筮**, on by default). Turning it off hides the almanac card in the header, the 今日运势 panel, and the whole 卜筮 section; nothing is computed while it is off.

**今日运势** sits between the header and 今天 and has no inputs:

- Left: the day's single-card tarot draw. The draw is seeded with the **local** date, so the card is stable from the moment the day starts until it ends, and reopening the dashboard never redraws it. Reversed cards are allowed; a reversed card is drawn upside down with a 逆 badge and uses the reversed keywords.
- Right: the 小六壬 **hour lesson**. It takes today's lunar month and day plus the 时辰 of the moment you look at it, so the landing palace changes every two hours; the six-palace strip shows where 月 → 日 → 时 land instead of only naming the final palace.
- The panel is computed when the dashboard opens and re-checked on every external refresh (the same 5-minute tick that ages the feeds). It recomputes only when the local date or the 时辰 changes, keeps the previous result if a computation fails, and never writes to the Vault or to `Dashboard/cache`.

**卜筮 · 塔罗** draws against the spread you pick, and the spread is laid out as a spread rather than as a wrapped row of equally-sized cells. Each `taibu-core` spread carries fixed positions, and a position is part of the reading:

| Spread | Cards | Layout |
| --- | --- | --- |
| 单牌 / 是否 | 1 | card plus full reading, unchanged |
| 三牌阵 / 身心灵 / 处境·障碍·建议 | 3 | one row, left to right (the existing order is already the reading order) |
| 爱情牌阵 | 4 | 2×2: the two people on top, the relationship and the advice below |
| 马蹄形 | 7 | an arc, highest in the middle — the arc is the timeline |
| 抉择 | 5 | the situation on the left, the two options forking up and down, their outcomes on the right |
| 凯尔特十字 | 10 | the cross (4 left · 1 centre · 6 right · 5 above · 3 below) with card 2 lying across card 1, plus the staff 7→10 down the right |

In a shaped spread each slot keeps a compact caption — index, position, card name, and at most two keywords — because a slot is only as wide as a card; the full position and keyword list is on the slot's tooltip. When the 卜筮 panel is narrower than 700px (a docked sidebar) the geometry is dropped and the cards fall back to one row per card in reading order, numbered so the order survives.

**解卦** is optional and covers **every** 卜筮 method plus 今日一牌 — 塔罗、小六壬、六爻、太乙、大六壬、八字、紫微、八字合盘、日运月运. It uses the same endpoint, model, and key environment variable as the daily brief; there is no second place to configure it. Turn it on with **卜筮解卦** and decide with **解卦发送所问之事** whether the question you typed is sent along with the cast:

- Each panel folds its own result into labelled facts — positions and cards for 塔罗, the three palaces for 小六壬, 用神/动爻/旬空 for 六爻, 三传/课体 for 大六壬, 主星/吉凶征 for 太乙, 四柱十神/柱间关系 for 八字, 命宫三方四正/四化 for 紫微, both charts for 八字合盘, the day's or month's 干支 against the birth day master for 日运月运. Those labels are the ones the model must reuse for its per-item lines, so the reply stays anchored to what the panel actually computed.
- The reading renders as the same 解卦 slip under the result (今日一牌 keeps its 解牌 slip inline next to the card), with `【总断】`, one line per fact, and `【可行】`.
- A reading is requested once per cast — keyed by the panel's own seed (draw seed, four pillars, cast inputs, chart inputs) and the fact fingerprint — and cached in memory for the session, so re-renders, panel switches, and the 5-minute tick never re-send a request. Reopening Obsidian asks again for the current casts.
- Failures keep the chart on screen and offer a retry; when the switch is off or the endpoint is not configured, no request is made and the panels keep their local-only wording instead of claiming a model was involved.

**Card art** is the public-domain Rider-Waite deck (Pamela Colman Smith, 1909). The 78 scans live in `assets/tarot/` inside the plugin folder, are read through `FileSystemAdapter.getResourcePath`, and are never fetched at runtime — the 卜筮 note "本地计算 · 不联网" stays true. They are produced by `work/build-tarot-assets.ps1` (downloads the 720×1200 scans, resizes to 400×667 JPEG q72, ~5 MB total) and mapped to card names by `src/features/divination/tarotFace.ts`, whose test walks all 78 cards and checks every file is present.

## Settings and maintenance

The settings page provides:

- Daily, Inbox, Reports, and cache folder validation.
- Task-source and task-exclusion folder lists, one Vault-relative path per line. A saved list whose folder does not exist yet is kept as typed and reported in a Notice, because an unknown task folder silently empties the 待办 panel.
- External cache TTL.
- One HTTP(S) RSS/Atom URL per line, with trimming and deduplication.
- Automatic daily-summary toggle.
- Direct-HTTP summarizer: base URL, model, and the environment-variable NAME of the key. The key itself is never stored.
- Divination reading toggles: **卜筮解卦** (on by default, covers 今日一牌 and all nine 卜筮 methods) and **解卦发送所问之事** (on by default; turning it off keeps the typed question on this machine). The 0.2.0 names `tarotReadingEnabled` / `tarotReadingSendsQuestion` are still read so an upgrade cannot silently switch reading back on.
- Optional GitHub SecretStorage key selection.
- Confirmed **重新生成缓存** and **隔离损坏缓存** actions.

Invalid edits are not saved. Save failures restore both the in-memory value and the visible control. Settings writes, including the internal daily-summary date, are serialized so delayed writes cannot overwrite newer complete settings.

Maintenance is available only for a filesystem-backed Windows Vault and touches only the four allowlisted caches and the artifacts they produce (transactional backups, quarantined copies, interrupted writes); nothing else in the folder is ever removed. Confirmation cancellation has no side effects. Use maintenance only with a trusted local Vault; its exact threat-model limits are documented in [docs/architecture.md](docs/architecture.md#security-boundaries).

## Development verification

Run:

```powershell
npm test
npm run build
npm run lint
```

Automated evidence and the remaining real-Obsidian checks are separated in [docs/acceptance-report.md](docs/acceptance-report.md). Automated tests do not substitute for application restart, real keyboard navigation, offline mode, or visual checks inside Obsidian.
