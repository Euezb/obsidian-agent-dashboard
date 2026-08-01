import type { VaultHealth } from "../../domain/types";

export interface HealthInput {
  noteCount: number;
  notesWithFrontmatter: number;
  notesWithLinks: number;
  notesWithTags: number;
  activeWithin90Days: number;
  inboxCount: number;
}

const CAPS = {
  frontmatter: 20,
  links: 25,
  tags: 15,
  activity: 20,
  inbox: 20,
} as const;

const SUGGESTIONS: Record<keyof typeof CAPS, string> = {
  frontmatter: "为更多笔记添加 frontmatter（元数据）。",
  links: "补充笔记之间的链接。",
  tags: "为更多笔记添加标签。",
  activity: "保持更多笔记在 90 天内活跃。",
  inbox: "清理 inbox（收件箱）中的待整理笔记。",
};

export function calculateHealthScore(input: HealthInput): VaultHealth {
  const noteCount = input.noteCount;

  if (!Number.isFinite(noteCount) || noteCount <= 0) {
    return {
      score: null,
      breakdown: {
        frontmatter: 0,
        links: 0,
        tags: 0,
        activity: 0,
        inbox: 0,
      },
      suggestions: ["请先添加笔记，再评估 Vault 健康度。"],
      insufficientData: true,
    };
  }

  const inboxPoints = inboxScore(input.inboxCount);
  const ratios = {
    frontmatter: normalizedMatch(input.notesWithFrontmatter, noteCount),
    links: normalizedMatch(input.notesWithLinks, noteCount),
    tags: normalizedMatch(input.notesWithTags, noteCount),
    activity: normalizedMatch(input.activeWithin90Days, noteCount),
    inbox: inboxPoints / CAPS.inbox,
  };
  const breakdown = {
    frontmatter: CAPS.frontmatter * ratios.frontmatter,
    links: CAPS.links * ratios.links,
    tags: CAPS.tags * ratios.tags,
    activity: CAPS.activity * ratios.activity,
    inbox: inboxPoints,
  };

  const total = Object.values(breakdown).reduce(
    (sum, categoryScore) => sum + categoryScore,
    0,
  );
  const categoryOrder = Object.keys(CAPS) as Array<keyof typeof CAPS>;
  const suggestions = categoryOrder
    .map((category, order) => ({
      category,
      order,
      completion: ratios[category],
    }))
    .filter(({ completion }) => completion < 1)
    .sort(
      (left, right) =>
        left.completion - right.completion || left.order - right.order,
    )
    .slice(0, 2)
    .map(({ category }) => SUGGESTIONS[category]);

  return {
    score: Math.min(100, Math.max(0, Math.round(total))),
    breakdown,
    suggestions,
    insufficientData: false,
  };
}

function normalizedMatch(value: number, noteCount: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }

  return Math.min(value, noteCount) / noteCount;
}

function inboxScore(value: number): number {
  const count = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

  if (count <= 5) return 20;
  if (count <= 10) return 15;
  if (count <= 20) return 10;
  if (count <= 40) return 5;
  return 0;
}
