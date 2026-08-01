# Agent Dashboard for Obsidian

Agent Dashboard is a Windows-only Obsidian community plugin that combines today's Markdown tasks, recent notes, Vault health, a 365-day activity heatmap, top-five GitHub daily and weekly project rankings, AI news, and an optional Codex-generated Chinese daily brief.

The plugin is desktop-only. It is not designed for Obsidian Mobile, Sync execution, a browser-only Vault, or non-Windows systems.

## Requirements

- Windows 10 or 11.
- Obsidian desktop 1.8.0 or newer.
- Node.js and npm for building from source.
- Optional: the standalone Codex CLI for daily summaries.

The locally observed versions during the 2026-06-30 verification were running Obsidian app package `1.12.7`, Obsidian Electron shell/installer `1.12.4.0`, and `codex-cli 0.142.4`. These observations are not minimum-version guarantees.

## Build and install

From the development directory:

```powershell
npm install
npm test
npm run build
npm run lint
```

Only three release artifacts belong in the Obsidian plugin folder: `main.js`, `manifest.json`, and `styles.css`. For this Vault layout:

```powershell
$source = '<source root>'
$target = '<vault A>\.obsidian\plugins\agent-dashboard'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item "$source\main.js","$source\manifest.json","$source\styles.css" -Destination $target -Force
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
| Plugin cache | `Dashboard/cache` | Created on the first successful cache or Codex prompt write. |

Folder settings must remain inside the Vault. Absolute paths, drive paths, UNC paths, traversal segments, and unsafe Windows path segments are rejected.

### Cache and Codex artifacts

The four primary versioned cache files are:

- `Dashboard/cache/github-daily.json`
- `Dashboard/cache/github-weekly.json`
- `Dashboard/cache/ai-news-sources.json`
- `Dashboard/cache/ai-news-summary.json`

Transactional writes may briefly create `.tmp-*` or `.backup.json` siblings. Invalid envelopes are renamed to `.corrupt-<timestamp>.json` rather than trusted. The configured cache folder's `prompts/` subfolder contains the constrained daily-brief prompt and JSON Schema. Codex's last-message output is a nonce-named temporary file in the configured cache folder; it is size-limited, validated, incorporated into the summary envelope, and removed on a best-effort basis only after a fresh path-safety check. The plugin never puts credentials in these cache or prompt files.

Freshness is controlled by the external-cache TTL setting, default 60 minutes and constrained to 15–1440 minutes. Cached data is rendered before a network refresh. If refresh fails, valid old data stays visible with `暂时使用缓存`. Changing TTL applies to subsequent reads in the current plugin session.

## External requests and data

The plugin makes only these classes of external request:

| Destination | Purpose | Data sent |
| --- | --- | --- |
| `https://github.com/trending` | Daily and weekly public trending pages | Period query only. |
| `https://api.github.com/search/repositories` | Fallback when Trending cannot be parsed | Public search query and optional Authorization header. |
| `https://hacker-news.firebaseio.com/v0/` | Top-story IDs and story metadata | Public item IDs. |
| User-configured HTTP(S) RSS/Atom URLs | AI-news sources | Normal feed request. |
| Model/provider configured in the user's Codex CLI | Generate the optional Chinese daily brief | The constrained daily prompt and the contents of `ai-news-sources.json` under the configured cache folder. |

GitHub, Hacker News, and RSS requests do not upload Vault notes. RSS is user-configurable, so each configured feed host receives the normal network metadata associated with a request. When the daily brief runs, Codex transmits its prompt and the AI-news source-cache content to the model/provider selected by the user's Codex CLI configuration. The plugin instructs Codex not to read or send other Vault content. Provider processing, retention, and account policy are determined by that CLI/provider configuration, not by this plugin.

For GitHub authentication, the plugin setting stores only a SecretStorage key name. The token value remains in Obsidian SecretStorage, is retrieved immediately before an `api.github.com` fallback request, and is not logged or cached. On Obsidian versions without SecretStorage, the UI accepts only a key name for compatibility; it never asks the user to paste a token into plugin data.

## Codex prerequisite and safety

Install and authenticate the standalone Codex CLI outside Obsidian:

```powershell
npm install -g @openai/codex
codex --version
codex login
codex login status
```

The settings page's **检测 Codex** action resolves a canonical native `.exe` and runs only `--version`, with no shell, a five-second timeout, and bounded output. Daily brief execution also uses process arguments rather than a command string, `shell: false`, bounded output, and a ten-minute timeout.

The runner recognizes only `daily-ai-brief`, `deep-research`, and `vault-lint-explanation`; unknown IDs fail before process creation. The current dashboard automatically invokes only `daily-ai-brief`. The other two IDs are reserved allowlist entries and are not arbitrary-command interfaces. The daily prompt instructs Codex to read only `ai-news-sources.json` under the configured cache folder, return schema-conforming Chinese JSON, and write no unrelated files. Codex provider/network handling remains subject to the user's CLI configuration and account.

To disable automatic Codex use, open Agent Dashboard settings and turn off **自动生成每日摘要**. Existing cached summaries may remain visible until they become obsolete or are cleared; disabling the toggle prevents new automatic daily attempts.

## Settings and maintenance

The settings page provides:

- Daily, Inbox, Reports, and cache folder validation.
- External cache TTL.
- One HTTP(S) RSS/Atom URL per line, with trimming and deduplication.
- Automatic daily-summary toggle.
- Codex executable selection and version detection.
- Optional GitHub SecretStorage key selection.
- Confirmed **重新生成缓存** and **隔离损坏缓存** actions.

Invalid edits are not saved. Save failures restore both the in-memory value and the visible control. Settings writes, including the internal daily-attempt date, are serialized so delayed writes cannot overwrite newer complete settings.

Maintenance is available only for a filesystem-backed Windows Vault and touches only the four allowlisted cache basenames and their transactional backups. Confirmation cancellation has no side effects. Use maintenance only with a trusted local Vault; its exact threat-model limits are documented in [docs/architecture.md](docs/architecture.md#security-boundaries).

## Development verification

Run:

```powershell
npm test
npm run build
npm run lint
```

Automated evidence and the remaining real-Obsidian checks are separated in [docs/acceptance-report.md](docs/acceptance-report.md). Automated tests do not substitute for application restart, real keyboard navigation, offline mode, or visual checks inside Obsidian.
