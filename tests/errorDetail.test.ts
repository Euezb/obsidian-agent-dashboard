import { describe, expect, it } from "vitest";
import { describeFailure, failureDetail } from "../src/infrastructure/errorDetail";

describe("failureDetail", () => {
  it("keeps a short reason and collapses whitespace", () => {
    expect(failureDetail(new Error("  HTTP 401:  invalid key\n"))).toBe("HTTP 401: invalid key");
  });

  it("redacts secret-looking spans", () => {
    const detail = failureDetail(new Error("authorization: Bearer sk-live-abcdef123456 rejected"));

    expect(detail).not.toContain("sk-live-abcdef123456");
    expect(detail).toContain("[redacted]");
  });

  it("truncates a long reason to the presentation cap", () => {
    const detail = failureDetail(new Error("x".repeat(500)));

    expect(detail).toHaveLength(200);
    expect(detail.endsWith("…")).toBe(true);
  });

  it("returns an empty detail when the error carries no message", () => {
    expect(failureDetail(undefined)).toBe("");
    expect(failureDetail({})).toBe("");
    expect(failureDetail("   ")).toBe("");
  });
});

describe("describeFailure", () => {
  it("appends the reason when there is one", () => {
    expect(describeFailure("无法开始深度研究，请稍后重试", new Error("HTTP 429")))
      .toBe("无法开始深度研究，请稍后重试（原因：HTTP 429）");
  });

  it("falls back to the title alone", () => {
    expect(describeFailure("无法开始深度研究，请稍后重试", undefined))
      .toBe("无法开始深度研究，请稍后重试");
  });
});
