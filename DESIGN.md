<!-- SEED: re-run $impeccable document once there's code to capture the actual tokens and components. -->
---
name: Agent Dashboard
description: A warm, editorial daily desk for Obsidian work, Vault health, and curated AI discovery.
---

# Design System: Agent Dashboard

## Overview

**Creative North Star: "The Morning Desk"**

The interface should feel like opening a well-arranged personal desk at the beginning of the day: calm, familiar, and immediately useful. It combines the warmth of the supplied editorial reference with the clarity and restraint expected from a frequently used desktop product.

Information hierarchy is explicit. Today's tasks and recent notes lead, Vault health follows, and external discovery closes the page. Automatic work stays quiet and reports status without competing with the user's work.

**Key Characteristics:**

- Warm editorial character with disciplined product spacing.
- One strong daily reading path rather than an equal-weight card wall.
- Restrained state motion, always under 250 ms.
- A serif display voice reserved for greetings and section titles.
- Familiar, accessible controls for routine actions.

## Colors

The palette uses a warm neutral surface, dark brown ink, a restrained terracotta identity color, and a calm blue reserved for focus, links, and automatic-update state.

**The Restrained Color Rule.** Brand colors occupy less than ten percent of the screen. Terracotta identifies primary intent; blue communicates interactive or synchronized state. Neither is decorative.

## Typography

**Direction:** Serif display plus sans-serif body.

Display type gives the greeting and major section titles an editorial tone. All buttons, labels, task text, metadata, and dense data remain in a highly readable sans-serif UI face. Numbers use tabular figures where layout stability matters.

**The Two-Voice Rule.** Serif is forbidden in controls, status labels, feed metadata, and data-dense rows.

## Elevation

The system is flat by default. Hierarchy comes from spacing, subtle tonal surfaces, and sparse dividers. A small structural shadow may appear only on the primary action or a temporary overlay; wide soft shadows and glass effects are forbidden.

## Components

The primary surface is the approved "Daily Desk" composition. It contains a single visible primary action for creating a diary entry, a task and recent-note workspace, a combined health-score and activity-heatmap section, and a two-column discovery section with AI news and a daily/weekly GitHub switch.

Automatic refresh controls remain hidden. The interface exposes only compact status text such as "Updating" or "Updated at 09:42" and provides contextual retry controls only when a refresh fails.

Routine interaction motion is responsive rather than choreographed: button press feedback, crossfades between daily and weekly rankings, and brief updates for changed numbers or inserted rows. Reduced-motion mode removes positional movement.

## Do's and Don'ts

### Do

- **Do** put today's tasks and recent notes first.
- **Do** show health-score causes and actionable suggestions.
- **Do** separate AI news from GitHub rankings and keep the daily/weekly switch inside the ranking module.
- **Do** reserve space for loading content so automatic refresh never shifts the page unexpectedly.
- **Do** provide keyboard focus, text labels, and non-color status cues.

### Don't

- **Don't** use a dark cyberpunk or terminal-style dashboard.
- **Don't** build a generic SaaS wall where every metric and feed receives an identical card.
- **Don't** use excessive rounding, wide ghost shadows, glassmorphism, or decorative gradients.
- **Don't** run loud page-load choreography, parallax, or motion that delays access to information.
- **Don't** render dense news feeds without hierarchy, summaries, or clear recency.
- **Don't** expose refresh, research, or Vault-check buttons during healthy automatic operation.
