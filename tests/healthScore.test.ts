import { describe, expect, it } from "vitest";
import {
  calculateHealthScore,
  type HealthInput,
} from "../src/features/vault/healthScore";

function input(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    noteCount: 10,
    notesWithFrontmatter: 10,
    notesWithLinks: 10,
    notesWithTags: 10,
    activeWithin90Days: 10,
    inboxCount: 0,
    ...overrides,
  };
}

describe("calculateHealthScore", () => {
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "marks noteCount %s as insufficient data",
    (noteCount) => {
      expect(calculateHealthScore(input({ noteCount }))).toEqual({
        score: null,
        breakdown: {
          frontmatter: 0,
          links: 0,
          tags: 0,
          activity: 0,
          inbox: 0,
        },
        suggestions: [expect.stringContaining("添加笔记")],
        insufficientData: true,
      });
    },
  );

  it("awards every category cap and a total of 100 for a fully healthy vault", () => {
    expect(calculateHealthScore(input())).toEqual({
      score: 100,
      breakdown: {
        frontmatter: 20,
        links: 25,
        tags: 15,
        activity: 20,
        inbox: 20,
      },
      suggestions: [],
      insufficientData: false,
    });
  });

  it("keeps proportional category values unrounded and rounds only the total", () => {
    const result = calculateHealthScore(
      input({
        noteCount: 3,
        notesWithFrontmatter: 1,
        notesWithLinks: 1,
        notesWithTags: 1,
        activeWithin90Days: 1,
        inboxCount: 6,
      }),
    );

    expect(result.breakdown.frontmatter).toBeCloseTo(20 / 3);
    expect(result.breakdown.links).toBeCloseTo(25 / 3);
    expect(result.breakdown.tags).toBe(5);
    expect(result.breakdown.activity).toBeCloseTo(20 / 3);
    expect(result.breakdown.inbox).toBe(15);
    expect(result.score).toBe(42);
    const sum =
      result.breakdown.frontmatter +
      result.breakdown.links +
      result.breakdown.tags +
      result.breakdown.activity +
      result.breakdown.inbox;
    expect(result.score).toBe(Math.round(sum));
  });

  it.each([
    [5, 20],
    [6, 15],
    [10, 15],
    [11, 10],
    [20, 10],
    [21, 5],
    [40, 5],
    [41, 0],
    [5.9, 20],
    [6.1, 15],
  ])("scores inboxCount %s at %s points", (inboxCount, expectedInbox) => {
    const result = calculateHealthScore(input({ inboxCount }));

    expect(result.breakdown.inbox).toBe(expectedInbox);
    expect(result.score).toBe(80 + expectedInbox);
  });

  it("ranks suggestions by completion ratio rather than raw category points", () => {
    const result = calculateHealthScore(
      input({
        notesWithFrontmatter: 2,
        notesWithTags: 2.5,
      }),
    );

    expect(result.breakdown.frontmatter).toBe(4);
    expect(result.breakdown.tags).toBe(3.75);
    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toContain("frontmatter");
    expect(result.suggestions[1]).toContain("标签");
  });

  it("uses a deterministic category order when completion ratios tie", () => {
    const result = calculateHealthScore(
      input({
        notesWithFrontmatter: 0,
        notesWithLinks: 0,
        notesWithTags: 0,
        activeWithin90Days: 0,
        inboxCount: 41,
      }),
    );

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toContain("frontmatter");
    expect(result.suggestions[1]).toContain("链接");
  });

  it("keeps fixed suggestion order for equal fractional source ratios", () => {
    const result = calculateHealthScore(
      input({
        noteCount: 3,
        notesWithFrontmatter: 1,
        notesWithLinks: 1,
        notesWithTags: 3,
        activeWithin90Days: 3,
        inboxCount: 0,
      }),
    );

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]).toContain("frontmatter");
    expect(result.suggestions[1]).toContain("链接");
  });

  it("clamps invalid, negative, and over-count matching values", () => {
    const result = calculateHealthScore(
      input({
        notesWithFrontmatter: Number.POSITIVE_INFINITY,
        notesWithLinks: -1,
        notesWithTags: 20,
        activeWithin90Days: Number.NaN,
        inboxCount: Number.NaN,
      }),
    );

    expect(result.breakdown).toEqual({
      frontmatter: 0,
      links: 0,
      tags: 15,
      activity: 0,
      inbox: 20,
    });
    expect(result.score).toBe(35);
    expect(calculateHealthScore(input({ inboxCount: -3 })).breakdown.inbox).toBe(20);
  });

  it("uses a finite positive noteCount directly and always bounds score to 0..100", () => {
    const fractional = calculateHealthScore(
      input({
        noteCount: 2.5,
        notesWithFrontmatter: 1.5,
        notesWithLinks: 1.5,
        notesWithTags: 1.5,
        activeWithin90Days: 1.5,
      }),
    );
    const pathological = calculateHealthScore(
      input({
        noteCount: Number.MIN_VALUE,
        notesWithFrontmatter: Number.MAX_VALUE,
        notesWithLinks: Number.MAX_VALUE,
        notesWithTags: Number.MAX_VALUE,
        activeWithin90Days: Number.MAX_VALUE,
        inboxCount: Number.POSITIVE_INFINITY,
      }),
    );

    expect(fractional.breakdown).toEqual({
      frontmatter: 12,
      links: 15,
      tags: 9,
      activity: 12,
      inbox: 20,
    });
    expect(fractional.score).toBe(68);
    expect(pathological.score).toBeGreaterThanOrEqual(0);
    expect(pathological.score).toBeLessThanOrEqual(100);
  });
});
