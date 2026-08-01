# Acceptance Report

Date: 2026-06-30  
Workspace: `<source root>`  
Vault: `<vault A>`

This report separates reproducible automated evidence from checks that still require the real Obsidian GUI. It does not claim that pending GUI items passed.

## Observed environment

- Windows timezone: Asia/Shanghai (`+08:00`).
- Obsidian executable: `<obsidian install>\Obsidian.exe`.
- Running Obsidian app package: `1.12.7`. `%APPDATA%\obsidian\obsidian.log` recorded `Loaded updated app package ...\obsidian-1.12.7.asar` on 2026-06-30.
- Obsidian Electron shell/installer at `<obsidian install>\Obsidian.exe`: file version `1.12.4`; product version `1.12.4.0`.
- `codex --version`: `codex-cli 0.142.4`.
- Codex login status was not rechecked during Task 17.
- Task 17 test and review commands did not explicitly invoke a Codex Agent task. Starting the already-deployed Obsidian plugin did trigger its configured automatic daily task; that separate runtime event is recorded below. The final three release artifacts were deployed only after review approval.

## Current Vault paths and cache observation

Observed read-only on 2026-06-30 around 10:05 local time:

| Path | Observed |
| --- | --- |
| `<vault A>` | Exists |
| `Daily`, `Inbox`, `Reports` | Not yet present; each is optional/on-demand as described in README |
| `Dashboard/cache` | Exists |
| `Dashboard/cache/prompts` | Exists |
| `.obsidian/plugins/agent-dashboard` | Final release artifacts deployed after review; Obsidian-created `data.json` preserved |

Runtime timeline observed after the deployed plugin was opened:

- 10:05:43–10:05:45: `github-daily.json`, `github-weekly.json`, and `ai-news-sources.json` refreshed.
- 10:05:45: installed plugin `data.json` persisted `lastCodexSummaryAttemptDate: "2026-06-30"`, and the automatic daily Codex process started.
- 10:08:01: `ai-news-summary.json` was written successfully with source `codex-daily-ai-brief`, date `2026-06-30`, and four items.
- The generated prompt explicitly says to read only `Dashboard/cache/ai-news-sources.json` and not other Vault files.
- No `ai-news-summary.tmp-*` or other task temporary output remained in the cache root after completion.

This is evidence of one successful real automatic refresh and daily-summary run. It is not evidence that GUI rendering, restart behavior, same-day deduplication across reopen/restart, or all acceptance-matrix cases passed.

## Automated acceptance evidence

Fresh fail-fast verification on 2026-06-30 completed with:

```powershell
npm test
npm run build
npm run lint
```

Results: 37 test files and 449 tests passed; TypeScript/esbuild production build exited 0; ESLint exited 0.

Covered behaviors include:

| Acceptance area | Automated evidence |
| --- | --- |
| Empty Vault | `vaultScanner.test.ts` verifies complete empty local data, 365 heatmap days, and insufficient health data without reads. Renderer tests verify empty messaging. |
| View open/reveal | `viewActivation.test.ts` verifies concurrent-open deduplication and later existing-leaf reveal. Real restart restoration remains manual. |
| Offline stale mode | `feedService.test.ts` preserves stale GitHub/news data with exact `暂时使用缓存`. |
| Corrupt cache | `cacheRepository.test.ts`, `feedService.test.ts`, and `cacheMaintenance.test.ts` verify quarantine, collision handling, schema/domain/future-date rejection, and filesystem safety guards. |
| GitHub fallback | `githubTrending.test.ts` verifies fallback on request, status, parse, and empty-result failures, plus mapping and rate-limit behavior. |
| Missing Codex | `codexRunner.test.ts` and `codexDetector.test.ts` reject missing/unsafe executables; renderer tests retain source headlines and expose settings/retry context. |
| Codex timeout and unload | `processAdapter.test.ts`, `codexRunner.test.ts`, and `codexDetector.test.ts` verify timeout mapping, termination convergence, and unload termination. |
| Daily-run deduplication | `feedServiceSummary.test.ts`, `refreshCoordinator.test.ts`, and runner tests verify same-day gating, mark-before-run, manual retry sharing, and duplicate rejection. |
| Keyboard semantics | Renderer tests verify buttons, links, a segmented ranking button group (`role="group"` with `aria-pressed`), labelled controls, and a keyboard-scrollable heatmap. Full keyboard traversal remains manual. |
| Visible focus / reduced motion | CSS architecture tests verify the focus outline, press feedback, and `prefers-reduced-motion` override. Actual Windows rendering remains manual. |
| Settings persistence | Settings validation, persistence-queue, control rollback, and safe-button tests verify normalization, serialization, rollback, failure isolation, and duplicate-action prevention. |
| Security boundaries | Runner, executable, process, cache maintenance, and settings tests cover traversal, linked ancestors, output limits, command allowlisting, shell-free spawn, and the accepted non-atomic local threat model. |

User-supplied Obsidian screenshots on 2026-06-30 verified the wide Dashboard composition, live task/recent-note data, successful automatic-update status, rendered AI news and GitHub rankings, and the complete native settings page. The screenshots also exposed overflowing health breakdown decimals. That defect was fixed by rendering rounded category completion percentages and using stable non-wrapping metric columns. A post-reload screenshot confirmed the deployed values `7%`, `50%`, `7%`, `100%`, and `100%` render without overlap or unwanted wrapping.

## Required real-Obsidian GUI acceptance

These items remain **not verified in this Task 17 pass**:

- Enable, disable, and re-enable the community plugin in Obsidian.
- Restart Obsidian and verify the dashboard leaf restores without duplicate leaves or blank state.
- Test the narrow layout for clipping or unintended horizontal page scroll.
- Verify a truly empty Vault visually, including all instructional empty states.
- Toggle a task in a real Markdown note and confirm only the intended source line changes.
- Create a new daily note, then press the action again and confirm the existing note opens.
- Disconnect networking and verify cached content, stale messaging, and contextual retry in the real view.
- Deliberately provide a corrupt cache copy and verify automatic/manual quarantine through Obsidian Notices.
- Exercise a live GitHub fallback/rate-limit condition without exposing a token.
- Verify the missing-Codex state and settings action with the executable unavailable.
- Verify a real Codex timeout/termination in a controlled test; the observed real run completed successfully and did not exercise timeout handling.
- Verify automatic daily execution occurs at most once across real app reopen/restart; one successful run and persisted attempt date were observed, but reopen/restart deduplication was not exercised.
- Navigate every task, note, retry, ranking switch, setting, modal, and action using keyboard only.
- Confirm visible focus and contrast in the active Obsidian theme.
- Enable Windows reduced motion and visually confirm positional motion is removed while state changes remain understandable.
- Confirm settings survive an actual Obsidian restart, including RSS, TTL, toggle, executable, and SecretStorage key name.
- Confirm maintenance confirmation cancellation and button-disabled state in the real settings UI.

## Release artifact check

After review approval, only `main.js`, `manifest.json`, and `styles.css` were copied from the development project to `<vault A>\.obsidian\plugins\agent-dashboard`. Obsidian-created `data.json` was preserved. Source and installed SHA-256 hashes matched:

| Artifact | SHA-256 | Match |
| --- | --- | --- |
| `main.js` | `913DFA9E58D0099AD083220E585B01E5E0C3D57FC14C4616AD36686D556FB12C` | Yes |
| `manifest.json` | `773D6DA0C29BBC7F2C4E4E7B7804BC817DC9D7CB568F470B275FC77D155F3721` | Yes |
| `styles.css` | `10A94D505BA6BEE314AA0F8A0DF656C9FC9BABD095CF0FED10ECD3BFA10E2852` | Yes |
