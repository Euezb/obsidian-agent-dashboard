/* eslint-disable obsidianmd/hardcoded-config-path -- exclusion fixtures must cover the configured prefix literally. */
import { describe, expect, it } from "vitest";
import type { RecentNote } from "../src/domain/types";
import { selectRecentNotes } from "../src/features/vault/recentNotes";

describe("selectRecentNotes", () => {
  it("sorts newest first and breaks timestamp ties by ordinal path order", () => {
    const notes: RecentNote[] = [
      { path: "zeta.md", title: "Zeta", modifiedAt: 20 },
      { path: "old.md", title: "Old", modifiedAt: 10 },
      { path: "Ωmega.md", title: "Omega", modifiedAt: 20 },
      { path: "alpha.md", title: "Alpha", modifiedAt: 20 },
    ];

    expect(selectRecentNotes(notes, 10, [])).toEqual([
      notes[3],
      notes[0],
      notes[2],
      notes[1],
    ]);
  });

  it("sorts all non-finite timestamps after finite timestamps deterministically", () => {
    const notes: RecentNote[] = [
      { path: "z-invalid.md", title: "NaN", modifiedAt: Number.NaN },
      { path: "finite-old.md", title: "Finite old", modifiedAt: 10 },
      {
        path: "a-invalid.md",
        title: "Positive infinity",
        modifiedAt: Number.POSITIVE_INFINITY,
      },
      { path: "finite-new.md", title: "Finite new", modifiedAt: 20 },
      {
        path: "m-invalid.md",
        title: "Negative infinity",
        modifiedAt: Number.NEGATIVE_INFINITY,
      },
    ];

    expect(selectRecentNotes(notes, 10, []).map((note) => note.path)).toEqual([
      "finite-new.md",
      "finite-old.md",
      "a-invalid.md",
      "m-invalid.md",
      "z-invalid.md",
    ]);
  });

  it("excludes each configured prefix itself and its descendants", () => {
    const notes: RecentNote[] = [
      { path: ".dev", title: "Dev", modifiedAt: 10 },
      { path: ".DEV\\scratch.md", title: "Scratch", modifiedAt: 9 },
      { path: ".obsidian/plugins.json", title: "Plugins", modifiedAt: 8 },
      { path: "dashboard\\CACHE\\feed.json", title: "Feed", modifiedAt: 7 },
      { path: "Reports", title: "Reports", modifiedAt: 6 },
      { path: "reports/weekly.md", title: "Weekly", modifiedAt: 5 },
      { path: "Reports-archive/old.md", title: "Archive", modifiedAt: 4 },
      { path: ".developer/notes.md", title: "Developer", modifiedAt: 3 },
    ];

    expect(
      selectRecentNotes(notes, 20, [
        ".dev",
        ".obsidian",
        "Dashboard/cache",
        "Reports",
      ]),
    ).toEqual([notes[6], notes[7]]);
  });

  it("normalizes separators in excluded prefixes without rewriting returned data", () => {
    const kept = {
      path: String.raw`Projects\Agent\Today.md`,
      title: "Original title",
      modifiedAt: 2,
    };
    const excluded = {
      path: "REPORTS/daily.md",
      title: "Daily",
      modifiedAt: 3,
    };

    const result = selectRecentNotes([kept, excluded], 10, ["reports\\"]);

    expect(result).toEqual([kept]);
    expect(result[0]).toBe(kept);
  });

  it.each([
    { limit: 0, expected: [] },
    { limit: -1, expected: [] },
    { limit: 1.9, expected: ["new.md"] },
    { limit: 2, expected: ["new.md", "middle.md"] },
  ])("handles limit $limit", ({ limit, expected }) => {
    const notes: RecentNote[] = [
      { path: "old.md", title: "Old", modifiedAt: 1 },
      { path: "new.md", title: "New", modifiedAt: 3 },
      { path: "middle.md", title: "Middle", modifiedAt: 2 },
    ];

    expect(selectRecentNotes(notes, limit, []).map((note) => note.path)).toEqual(
      expected,
    );
  });

  it("does not mutate the input array", () => {
    const notes: RecentNote[] = [
      { path: "old.md", title: "Old", modifiedAt: 1 },
      { path: "new.md", title: "New", modifiedAt: 2 },
    ];
    const originalOrder = [...notes];

    selectRecentNotes(notes, 10, []);

    expect(notes).toEqual(originalOrder);
    expect(notes[0]).toBe(originalOrder[0]);
    expect(notes[1]).toBe(originalOrder[1]);
  });
});
