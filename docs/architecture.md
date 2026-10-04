# Agent Dashboard Architecture

## Composition root and lifecycle

`src/main.ts` is the composition root. On load it:

1. Loads and validates persisted settings, then creates a serialized settings-persistence queue.
2. Creates local Vault scanning/actions, cache and request adapters, feed services, the HTTP summarizer, and filesystem-only maintenance services.
3. Registers the native `ItemView`, ribbon action, command, settings tab, and Vault file events.
4. Debounces Markdown create/modify/delete/rename events into local-only rescans. Vault events never trigger external network refreshes.

`AgentDashboardView.onOpen()` initializes loading state, starts external cache/network work without blocking the local scan, and renders local results when ready. `onClose()` invalidates both controllers, detaches renderer listeners, clears the DOM, and ignores late async results. Plugin unload cancels the Vault debounce, clears maintenance references, and detaches dashboard leaves.

## View and controllers

- `AgentDashboardView` owns the current `DashboardState`, daily/weekly ranking selection, and render lifecycle.
- `renderState` composes four regions: header, today, Vault pulse, and discovery. Leaf renderers own their DOM and event cleanup.
- `LocalDashboardController` uses generation and revision counters so closed or superseded scans cannot overwrite current UI. It serializes each task's toggle and rescans after the source edit.
- `ExternalDashboardController` uses an open generation to ignore late cache/network snapshots and isolates observer errors.
- `ViewActivationCoordinator` deduplicates simultaneous open requests, creates at most one new leaf, and reveals an existing leaf on later activation.

## Local Vault data

`VaultScanner` performs one bounded-concurrency pass over Markdown files. It excludes `.dev`, the Obsidian config directory, the configured cache folder, and Reports. From each included note it derives:

- Three most recently modified notes.
- 365 local-calendar creation buckets.
- A transparent health score from frontmatter, links, tags, recent activity, and Inbox count.

Tasks have a separate, narrower scope so that plans, templates, and archived projects cannot flood the panel:

- `isTaskSourcePath` applies `taskExcludeFolders` first and then `taskIncludeFolders`, where an empty include list means the whole Vault. Both are validated Vault-relative lists and are applied after the per-file cache, so changing them never invalidates cached scans; other modules still count every included note.
- `taskParser` parses standard Markdown checkboxes with stable source line IDs, strips the `📅` due token into `dueDate`, converts inline Markdown (emphasis, code spans, highlights, strike-through, links, wikilinks) into the plain text a row displays, and flags the rows that sit under the archive heading (`归档`). Code spans are protected from the emphasis rules.
- A task's `date` is its own due token, otherwise a `YYYY-MM-DD` date in the note's path. The file's modified day is never used as a substitute, so editing an old note cannot re-date its historical checkboxes; tasks with neither stay undated.
- `renderToday` groups rows by source note, sorts the group that contains today first and then by day descending with undated groups last, and keeps completed rows in the DOM behind a local reveal class. Group disclosure uses native `details`/`summary`. Both local choices live in a `TodayInteractionState` owned by the view: every state push rebuilds the panel, so the reveal toggle and collapsed groups would otherwise snap back.
- The view's archive step carries finished tasks forward into today's daily note. `selectArchivedTaskTexts` only accepts checked-off tasks from an *earlier daily note* (the date is read from the file name inside `dailyFolder`), never a note from another folder whose name merely contains a date, never today's own note, and never a row that already sits under the archive heading; repeated texts are collapsed. Without those rules a plans document could be copied into a daily note and each new note would carry the previous note's whole archive forward.
- File-change refreshes call `VaultScanner.scanFresh`, which waits out a running scan and then starts a new one: reusing the running scan would render the pre-edit file content under a fresh revision with no later event to correct it. Concurrent callers still share one scan.
- A folder list that names a path the Vault does not contain is saved as typed, but the settings tab reports the missing paths after the save: an unknown task folder collects nothing at all, which reads as a broken panel.

`VaultActions` creates or opens the daily note and edits task checkboxes through Obsidian's public Vault APIs. Task mutation checks the original path, source line, and expected checkbox; stale source state produces a typed error instead of modifying a guessed line.

## External feeds and refresh coordination

`FeedService` is cache-first. It reads four independently guarded cache entries, emits immediately usable snapshots, refreshes only missing or TTL-expired modules, and updates one module at a time. A network failure preserves valid stale data. A cache IO failure remains separate from a network failure.

The daily brief and the two report commands are produced by `ApiSummarizerService`: one OpenAI-compatible `/chat/completions` request that keeps the key value out of plugin data, carries the `x-opencode-session` routing header, disables the model reasoning mode with `thinking: {"type": "disabled"}` (retried once without the parameter when a provider rejects it), and reuses the same cache envelope and strict item validation. `FeedService.latestNews` feeds that request from the headlines the panel already fetched (refreshed module state, then the persisted cache) and crawls Hacker News again only when nothing usable exists, so a slow or throttled second crawl cannot fail the brief. The automatic attempt is bounded to `MAX_AUTO_SUMMARY_ATTEMPTS` (3) per local day and per session; manual retry always reruns. `FeedService` owns persistence and appends a redacted failure reason to the panel message.

`RefreshCoordinator` assigns typed keys to GitHub daily, GitHub weekly, AI news, and daily brief work. Concurrent calls with the same key share one Promise and the key is removed in `finally`. The daily-summary date is persisted only after a brief was actually produced, so a failed attempt stays retryable on the next open or 5-minute tick instead of consuming the rest of the day; automatic retries remain bounded per day, an automatic summary is skipped while the visible headlines are a previous day's stale cache, and a successful manual news retry re-runs the daily gate instead of waiting for the next tick. Manual contextual retry may bypass the daily automatic gate while still sharing in-flight work.

GitHub collection tries `github.com/trending` first and falls back to the official Search API. Hacker News and RSS/Atom results are normalized, URL-validated, deduplicated, sorted, and bounded before caching.

## Adapters and cache repository

- `ObsidianRequestPort` adapts `requestUrl`, including text-only HTML/XML and rate-limit headers.
- `ObsidianCacheStorage` adapts Vault storage and performs temporary-write/backup replacement with recovery. Removing a stale backup is best-effort: on Windows a locked backup must not discard a write whose data is already on disk.
- `CacheRepository` owns schema version, generated timestamp, source label, domain guard, future-clock-skew rejection, dynamic TTL, quarantine, and per-name write queues. A read that loses the final entry to a concurrent replacement (the final is renamed away mid-read) is retried once instead of surfacing a visible cache read error.
- `VaultRefreshDebouncer` isolates local filesystem events from external refresh policy.
- `errorDetail` renders the one-line, secret-free failure reason ("标题（原因：…）") used by panel messages and the report-command Notices, so a failure never has to be diagnosed in DevTools.
- `NodeProcessAdapter` owns `spawn` with `shell: false`, hidden Windows processes, piped stdio, byte limits, timeout, graceful termination, and forced convergence.
- `NodeRunnerFilePort` (in `src/infrastructure/safeFilePort.ts`) and `NodeCacheMaintenanceFilePort` apply native real-path and ancestor checks for filesystem-sensitive maintenance operations.

The four primary cache names are `github-daily`, `github-weekly`, `ai-news-sources`, and `ai-news-summary`. Each maintenance check reuses the same envelope validation and domain guard as runtime reads, including schema and future-clock-skew rules. Regeneration matches those names by prefix, so a cache's transactional backups, quarantined copies (`.corrupt-*`), and interrupted writes (`.tmp-*`) are cleared with it while unrelated files in the folder are never touched. A cache write that fails while the network data is usable keeps that data on screen and reports the failure per module instead of failing silently.

## HTTP summarizer

`ApiSummarizerService` is the only model client and the plugin spawns no external process at all. It:

1. Requires a complete configuration (base URL, model, and the environment-variable NAME of the key) and resolves the key value at request time.
2. Validates the requested runner date and refuses to run without cached news.
3. Sends one chat-completions request with a bearer token, the `x-opencode-session` routing header, and reasoning disabled; a provider that rejects the thinking parameter gets exactly one retry without it.
4. Validates the model's `{overview, items}` answer against the original items: unknown indices, drifted titles or URLs, empty or oversized fields, and non-JSON content are rejected before anything is stored.
5. Returns the brief to `FeedService`, which owns cache persistence and the daily-note write. The report commands consume the same service through `runText`.

Summaries and reports use a dedicated request port with a 180-second budget, because the shared feed port's 15-second timeout is far shorter than a real generation. A failure surfaces as a redacted reason in the panel — secret-looking spans are dropped before display — and the last good cached brief stays visible.

## Settings and secrets

Folder, task-scope, TTL, RSS, summarizer, and SecretStorage-key inputs are normalized before persistence and again when saved data is loaded. A task-folder list is rejected as a whole when any line is unsafe, so a half-typed setting cannot silently widen the scan scope; API-summarizer fields are normalized field-by-field (an invalid base URL, API style, or env-name clears that field instead of rejecting the block). `SettingsPersistenceQueue` serializes full-setting snapshots shared by UI changes and the daily-attempt date. Failed saves restore the model; the setting-tab control helper restores the displayed value and reports a Notice. Committing a task-folder list triggers a debounced local rescan, because no Vault file event fires for a settings change.

The settings object stores `githubSecretName`, never a token. The SecretStorage value is fetched only inside the GitHub API fallback path immediately before the `api.github.com` request. It is not passed to trending HTML requests, CacheRepository, logs, or summarizer prompts.

## Security boundaries

Agent Dashboard is a local, single-user Obsidian plugin. Its maintenance operations validate Vault-relative configuration, reject path traversal, and, on filesystem-backed Vaults, check the real Vault path and each existing ancestor for symbolic links or junctions. They check the relevant path immediately before and after listing, reading, removing, or renaming a cache file. Non-filesystem adapters do not receive maintenance support.

These checks are designed to prevent accidental misconfiguration, path traversal, and static or non-concurrent symbolic-link or junction escapes. They are not an atomic TOCTOU defence. A separate process running with the same Windows user permissions can race between a check and a filesystem operation; a post-operation check can detect such a change but cannot undo an operation that already occurred. Such a process can also directly modify the Vault, plugin files, or the Obsidian configuration, so hostile same-user local processes are outside this plugin's threat model. Maintenance actions should only be used with a trusted local Vault and local environment.

The plugin does not claim to sandbox Obsidian or the Windows user account. It spawns no external process. Its boundaries are bounded IO, strict response validation, least-data prompts, environment-variable key handling, SecretStorage use, and explicit confirmation for destructive maintenance.
