import { describe, expect, it } from "vitest";
import { buildHeatmap } from "../src/features/vault/heatmap";

function at(
  year: number,
  monthIndex: number,
  day: number,
  hour = 12,
): number {
  return new Date(year, monthIndex, day, hour).getTime();
}

describe("buildHeatmap", () => {
  it("builds an inclusive ascending local-date window and counts only timestamps inside it", () => {
    const createdAt = [
      at(2026, 5, 24),
      at(2026, 5, 25, 1),
      at(2026, 5, 25, 23),
      at(2026, 5, 27, 23),
      at(2026, 5, 28, 0),
      at(2026, 5, 28, 22),
      at(2026, 5, 29, 0),
    ];

    expect(buildHeatmap(createdAt, new Date(2026, 5, 28, 18), 4)).toEqual([
      { date: "2026-06-25", count: 2 },
      { date: "2026-06-26", count: 0 },
      { date: "2026-06-27", count: 1 },
      { date: "2026-06-28", count: 2 },
    ]);
  });

  it("returns exactly 365 local calendar dates by default", () => {
    const result = buildHeatmap([], new Date(2026, 5, 28, 23, 59));

    expect(result).toHaveLength(365);
    expect(result[0]).toEqual({ date: "2025-06-29", count: 0 });
    expect(result[364]).toEqual({ date: "2026-06-28", count: 0 });
  });

  it("uses calendar-day arithmetic across daylight-saving transitions", () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";

    try {
      const midnights = [6, 7, 8, 9, 10].map(
        (day) => new Date(2026, 2, day),
      );
      const hoursPerCalendarDay = midnights.slice(1).map((midnight, index) => {
        const previous = midnights[index];
        if (previous === undefined) throw new Error("Missing prior midnight");
        return (midnight.getTime() - previous.getTime()) / 3_600_000;
      });

      expect(hoursPerCalendarDay).toEqual([24, 24, 23, 24]);
      expect(
        buildHeatmap([], new Date(2026, 2, 10, 16), 5).map(
          (day) => day.date,
        ),
      ).toEqual([
        "2026-03-06",
        "2026-03-07",
        "2026-03-08",
        "2026-03-09",
        "2026-03-10",
      ]);
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = originalTimezone;
      }
    }
  });

  it("supports a one-day window and normalizes the end time to its local date", () => {
    const createdAt = [
      at(2026, 5, 27, 23),
      at(2026, 5, 28, 0),
      at(2026, 5, 28, 23),
      at(2026, 5, 29, 0),
    ];

    expect(buildHeatmap(createdAt, new Date(2026, 5, 28, 3), 1)).toEqual([
      { date: "2026-06-28", count: 2 },
    ]);
  });

  it.each([0, -1, -100])("returns an empty list when days is %s", (days) => {
    expect(buildHeatmap([at(2026, 5, 28)], new Date(2026, 5, 28), days)).toEqual(
      [],
    );
  });

  it("does not mutate the timestamp input", () => {
    const createdAt = [at(2026, 5, 28), at(2026, 5, 27)];
    const original = [...createdAt];

    buildHeatmap(createdAt, new Date(2026, 5, 28), 2);

    expect(createdAt).toEqual(original);
  });
});
