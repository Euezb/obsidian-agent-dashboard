import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { systemTimeZone } from "../src/view/bushi/bushiUi";

/**
 * F8 回归:大六壬起课原来把时区写死成 "Asia/Shanghai"。
 * 契约:取运行环境的 IANA 时区,取不到才回落到本域默认口径。
 */
const ROOT = resolve(import.meta.dirname, "..");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("系统时区(F8)", () => {
  it("返回非空的 IANA 时区", () => {
    const zone = systemTimeZone();
    expect(typeof zone).toBe("string");
    expect(zone.length).toBeGreaterThan(0);
  });

  it("环境给不出时区时回落到默认口径", () => {
    vi.stubGlobal("Intl", {
      DateTimeFormat: () => ({ resolvedOptions: () => ({ timeZone: "" }) }),
    });
    expect(systemTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
  });

  it("环境抛错时也回落到默认口径", () => {
    vi.stubGlobal("Intl", {
      DateTimeFormat: () => {
        throw new Error("no intl");
      },
    });
    expect(systemTimeZone("Asia/Shanghai")).toBe("Asia/Shanghai");
  });

  it("大六壬面板改用系统时区,不再写死 Asia/Shanghai", () => {
    const panel = readFileSync(resolve(ROOT, "src/view/bushi/daliurenPanel.ts"), "utf8");
    expect(panel).toContain("systemTimeZone()");
    expect(panel).not.toContain('"Asia/Shanghai"');
  });
});
