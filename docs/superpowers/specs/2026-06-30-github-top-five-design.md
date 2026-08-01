# GitHub Top Five Design

## Goal

Both GitHub daily and weekly rankings contain and display at most the first five repositories in source order.

## Behavior

- The GitHub trending parser and Search API fallback return at most five results.
- FeedService defensively truncates fetched results before writing cache and emitting state.
- The renderer truncates to five so existing caches created by older versions cannot show a sixth item.
- Daily/weekly switching, retries, rate-limit handling, and ranking order are unchanged.

## Verification

Tests cover provider output, `per_page=5`, cached refresh output, and rendering of old caches containing more than five entries.
