# GitHub Top Five Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. This is a single small inline task.

**Goal:** Limit daily and weekly GitHub rankings to five items end to end.

**Architecture:** Use one exported limit in the GitHub feed module, enforce it at provider, FeedService cache, and renderer boundaries, and preserve source order.

**Tech Stack:** TypeScript, Vitest, Obsidian DOM rendering.

---

### Task 1: Enforce the five-item ranking limit

**Files:**
- Modify: `src/features/feeds/githubTrending.ts`
- Modify: `src/features/feeds/FeedService.ts`
- Modify: `src/view/renderDiscovery.ts`
- Test: `tests/githubTrending.test.ts`
- Test: `tests/feedService.test.ts`
- Test: `tests/dashboardRender.test.ts`

- [ ] Add failing tests for provider, cache/state, and legacy-cache rendering limits.
- [ ] Run focused tests and confirm failures show more than five items.
- [ ] Add a shared `MAX_GITHUB_REPOSITORIES = 5` limit and slice at all three boundaries.
- [ ] Run focused tests, full tests, build, and lint.
- [ ] Deploy `main.js`, `manifest.json`, and `styles.css`; verify source/target hashes.
