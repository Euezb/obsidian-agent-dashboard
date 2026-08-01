# Agent Dashboard Architecture

## Composition root and lifecycle

`src/main.ts` is the composition root. On load it:

1. Loads and validates persisted settings, then creates a serialized settings-persistence queue.
2. Creates local Vault scanning/actions, cache and request adapters, feed services, and filesystem-only Codex/maintenance services.
3. Registers the native `ItemView`, ribbon action, command, settings tab, and Vault file events.
4. Debounces Markdown create/modify/delete/rename events into local-only rescans. Vault events never trigger external network refreshes.

`AgentDashboardView.onOpen()` initializes loading state, starts external cache/network work without blocking the local scan, and renders local results when ready. `onClose()` invalidates both controllers, detaches renderer listeners, clears the DOM, and ignores late async results. Plugin unload cancels the Vault debounce, terminates active Codex tasks and Codex detection, clears maintenance references, and detaches dashboard leaves.

## View and controllers

- `AgentDashboardView` owns the current `DashboardState`, daily/weekly ranking selection, and render lifecycle.
- `renderState` composes four regions: header, today, Vault pulse, and discovery. Leaf renderers own their DOM and event cleanup.
- `LocalDashboardController` uses generation and revision counters so closed or superseded scans cannot overwrite current UI. It serializes each task's toggle and rescans after the source edit.
- `ExternalDashboardController` uses an open generation to ignore late cache/network snapshots and isolates observer errors.
- `ViewActivationCoordinator` deduplicates simultaneous open requests, creates at most one new leaf, and reveals an existing leaf on later activation.

## Local Vault data

`VaultScanner` performs one bounded-concurrency pass over Markdown files. It excludes `.dev`, the Obsidian config directory, the configured cache folder, and Reports. From each included note it derives:

- Standard Markdown checkbox tasks and stable source line IDs.
- Three most recently modified notes.
- 365 local-calendar creation buckets.
- A transparent health score from frontmatter, links, tags, recent activity, and Inbox count.

`VaultActions` creates or opens the daily note and edits task checkboxes through Obsidian's public Vault APIs. Task mutation checks the original path, source line, and expected checkbox; stale source state produces a typed error instead of modifying a guessed line.

## External feeds and refresh coordination

`FeedService` is cache-first. It reads four independently guarded cache entries, emits immediately usable snapshots, refreshes only missing or TTL-expired modules, and updates one module at a time. A network failure preserves valid stale data. A cache IO failure remains separate from a network failure.

`RefreshCoordinator` assigns typed keys to GitHub daily, GitHub weekly, AI news, and daily brief work. Concurrent calls with the same key share one Promise and the key is removed in `finally`. Daily-summary gating is persisted before Codex runs, so reopening the view cannot automatically start a second same-day task. Manual contextual retry may bypass the daily automatic gate while still sharing in-flight work.

GitHub collection tries `github.com/trending` first and falls back to the official Search API. Hacker News and RSS/Atom results are normalized, URL-validated, deduplicated, sorted, and bounded before caching.

## Adapters and cache repository

- `ObsidianRequestPort` adapts `requestUrl`, including text-only HTML/XML and rate-limit headers.
- `ObsidianCacheStorage` adapts Vault storage and performs temporary-write/backup replacement with recovery.
- `CacheRepository` owns schema version, generated timestamp, source label, domain guard, future-clock-skew rejection, dynamic TTL, quarantine, and per-name write queues.
- `VaultRefreshDebouncer` isolates local filesystem events from external refresh policy.
- `NodeProcessAdapter` owns `spawn` with `shell: false`, hidden Windows processes, piped stdio, byte limits, timeout, graceful termination, and forced convergence.
- `NodeRunnerFilePort` and `NodeCacheMaintenanceFilePort` apply native real-path and ancestor checks for filesystem-sensitive Codex and maintenance operations.

The four primary cache names are `github-daily`, `github-weekly`, `ai-news-sources`, and `ai-news-summary`. Each maintenance check reuses the same envelope validation and domain guard as runtime reads, including schema and future-clock-skew rules.

## Codex runner

`CodexRunner` is an allowlisted task runner, not a general command executor. It:

1. Resolves and verifies a canonical native Codex executable, rejecting WindowsApps aliases and linked ancestors.
2. Validates Vault/cache/prompt/output paths before use.
3. Writes a constrained prompt and JSON Schema with exclusive file creation.
4. Spawns Codex without a shell and enforces the ten-minute process timeout and output limits.
5. Validates exact output fields, date, item count, strings, and HTTP(S) URLs.
6. Writes the final summary through `CacheRepository` and rechecks the temporary output before best-effort cleanup.

Active tasks are tracked by allowlisted ID, duplicates are rejected, last status is recorded, and unload terminates active handles. `CodexDetector` separately allows only `--version`, tracks its handle, and is also terminated on unload.

## Settings and secrets

Folder, TTL, RSS, executable, and SecretStorage-key inputs are normalized before persistence and again when saved data is loaded. `SettingsPersistenceQueue` serializes full-setting snapshots shared by UI changes and the daily-attempt date. Failed saves restore the model; the setting-tab control helper restores the displayed value and reports a Notice.

The settings object stores `githubSecretName`, never a token. The SecretStorage value is fetched only inside the GitHub API fallback path immediately before the `api.github.com` request. It is not passed to trending HTML requests, CacheRepository, logs, Codex prompts, or summaries.

## Security boundaries

Agent Dashboard is a local, single-user Obsidian plugin. Its maintenance operations validate Vault-relative configuration, reject path traversal, and, on filesystem-backed Vaults, check the real Vault path and each existing ancestor for symbolic links or junctions. They check the relevant path immediately before and after listing, reading, removing, or renaming a cache file. Non-filesystem adapters do not receive maintenance support.

These checks are designed to prevent accidental misconfiguration, path traversal, and static or non-concurrent symbolic-link or junction escapes. They are not an atomic TOCTOU defence. A separate process running with the same Windows user permissions can race between a check and a filesystem operation; a post-operation check can detect such a change but cannot undo an operation that already occurred. Such a process can also directly modify the Vault, plugin files, Obsidian configuration, or the Codex CLI, so hostile same-user local processes are outside this plugin's threat model. Maintenance actions should only be used with a trusted local Vault and local environment.

The plugin does not claim to sandbox Obsidian, the Codex CLI, or the Windows user account. Its boundaries are command allowlisting, shell-free process creation, canonical executable/path checks, bounded IO, schema validation, least-data prompts, SecretStorage use, and explicit confirmation for destructive maintenance.
