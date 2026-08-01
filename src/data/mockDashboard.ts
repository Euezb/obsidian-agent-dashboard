import type { DashboardState, HeatmapDay } from "../domain/types";

// Mock-only: every numeric value and metric in this file is deterministic sample data,
// not a measurement from the user's vault, GitHub, or any external service.
const MOCK_UPDATED_AT = Date.parse("2025-12-31T09:00:00.000Z");
const HEATMAP_START = Date.UTC(2025, 0, 1);
const DAY_IN_MS = 24 * 60 * 60 * 1000;

const heatmap: HeatmapDay[] = Array.from({ length: 365 }, (_, index) => ({
  date: new Date(HEATMAP_START + index * DAY_IN_MS).toISOString().slice(0, 10),
  count: (index * 7 + (index % 5)) % 12,
}));

export const MOCK_DASHBOARD_STATE: DashboardState = {
  dailyBrief: { status: "ready", data: null },
  tasks: {
    status: "ready",
    data: [
      {
        id: "task-review-inbox",
        path: "Inbox.md",
        line: 8,
        text: "Review the vault inbox",
        completed: false,
        dueDate: "2025-12-31",
      },
      {
        id: "task-daily-note",
        path: "Daily/2025-12-31.md",
        line: 14,
        text: "Write today's reflection",
        completed: false,
        dueDate: "2025-12-31",
      },
      {
        id: "task-link-notes",
        path: "Projects/Knowledge Garden.md",
        line: 22,
        text: "Link three unconnected notes",
        completed: false,
      },
      {
        id: "task-archive-project",
        path: "Projects/Launch.md",
        line: 31,
        text: "Archive the completed launch project",
        completed: true,
      },
    ],
    updatedAt: MOCK_UPDATED_AT,
  },
  recentNotes: {
    status: "ready",
    data: [
      {
        path: "Daily/2025-12-31.md",
        title: "December 31, 2025",
        modifiedAt: Date.parse("2025-12-31T08:45:00.000Z"),
      },
      {
        path: "Projects/Knowledge Garden.md",
        title: "Knowledge Garden",
        modifiedAt: Date.parse("2025-12-30T16:20:00.000Z"),
      },
      {
        path: "Reading/AI Interfaces.md",
        title: "AI Interfaces",
        modifiedAt: Date.parse("2025-12-29T11:10:00.000Z"),
      },
    ],
    updatedAt: MOCK_UPDATED_AT,
  },
  heatmap: {
    status: "ready",
    data: heatmap,
    updatedAt: MOCK_UPDATED_AT,
  },
  health: {
    status: "ready",
    data: {
      score: 86,
      breakdown: {
        frontmatter: 88,
        links: 84,
        tags: 90,
        activity: 92,
        inbox: 76,
      },
      suggestions: [
        "Add frontmatter to recent reading notes.",
        "Review the remaining inbox notes.",
      ],
      insufficientData: false,
    },
    updatedAt: MOCK_UPDATED_AT,
  },
  aiNews: {
    status: "ready",
    data: [
      {
        id: "ai-news-local-models",
        title: "Local AI models become easier to run",
        url: "https://example.com/ai/local-models",
        source: "AI Daily",
        publishedAt: "2025-12-31T06:00:00.000Z",
        summary: "A mock briefing about smaller models and local workflows.",
      },
      {
        id: "ai-news-agents",
        title: "Agent workflows move into everyday tools",
        url: "https://example.com/ai/agent-workflows",
        source: "Tooling Weekly",
        publishedAt: "2025-12-30T12:00:00.000Z",
        summary: "A mock overview of agent-assisted knowledge work.",
      },
      {
        id: "ai-news-evaluation",
        title: "Evaluation practices mature for AI applications",
        url: "https://example.com/ai/evaluation",
        source: "Model Review",
        publishedAt: "2025-12-29T09:30:00.000Z",
        summary: "A mock report on repeatable evaluation techniques.",
      },
    ],
    updatedAt: MOCK_UPDATED_AT,
  },
  githubDaily: {
    status: "ready",
    data: [
      {
        name: "sample-org/agent-kit",
        url: "https://github.com/sample-org/agent-kit",
        description: "A mock toolkit for composing small agents.",
        language: "TypeScript",
        stars: 12400,
        starsInPeriod: 420,
        source: "github-trending",
      },
      {
        name: "sample-org/local-search",
        url: "https://github.com/sample-org/local-search",
        description: "A mock local-first semantic search project.",
        language: "Rust",
        stars: 8600,
        starsInPeriod: 315,
        source: "github-trending",
      },
      {
        name: "sample-org/note-tools",
        url: "https://github.com/sample-org/note-tools",
        description: "Mock utilities for connected notes.",
        language: "Python",
        stars: 5300,
        starsInPeriod: 240,
        source: "github-trending",
      },
      {
        name: "sample-org/tiny-evals",
        url: "https://github.com/sample-org/tiny-evals",
        description: "A mock evaluation harness for AI prototypes.",
        language: "Go",
        stars: 3100,
        starsInPeriod: 180,
        source: "github-search-fallback",
      },
    ],
    updatedAt: MOCK_UPDATED_AT,
  },
  githubWeekly: {
    status: "ready",
    data: [
      {
        name: "sample-labs/context-engine",
        url: "https://github.com/sample-labs/context-engine",
        description: "A mock engine for preparing agent context.",
        language: "TypeScript",
        stars: 18200,
        starsInPeriod: 1450,
        source: "github-trending",
      },
      {
        name: "sample-labs/vault-index",
        url: "https://github.com/sample-labs/vault-index",
        description: "A mock indexer for local Markdown vaults.",
        language: "Rust",
        stars: 9700,
        starsInPeriod: 980,
        source: "github-trending",
      },
      {
        name: "sample-labs/research-canvas",
        url: "https://github.com/sample-labs/research-canvas",
        description: "A mock visual workspace for research notes.",
        language: "Vue",
        stars: 7400,
        starsInPeriod: 720,
        source: "github-trending",
      },
      {
        name: "sample-labs/prompt-tests",
        url: "https://github.com/sample-labs/prompt-tests",
        description: "Mock test fixtures for prompt-driven products.",
        language: "Python",
        stars: 6100,
        starsInPeriod: 610,
        source: "github-search-fallback",
      },
    ],
    updatedAt: MOCK_UPDATED_AT,
  },
};
