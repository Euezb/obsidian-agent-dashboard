/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it, vi } from "vitest";
import {
  READING_COLLAPSE_THRESHOLD,
  renderDivinationReadingNote,
} from "../src/view/renderDivinationReading";
import { createReadingSlot, type ReadingSlotState } from "../src/view/bushi/readingSlot";

/**
 * 解卦块「展开 / 收起」的契约:
 * - 断卦放宽到 600–1200 字之后,通栏会拉得很长,超过折叠线默认只露前八行;
 * - 折叠只压正文那一层,页脚(口径小字与按钮)始终看得见;
 * - 展开状态由宿主保存,重画回来还是展开的 —— 5 分钟一次心跳都会重建 DOM;
 * - 宿主不给 onToggleExpand 时(今日一牌走的那条路)不折叠,免得折起来打不开。
 */

const LONG_TEXT = `【总断】${"这一卦没有外力，卡住的是不肯把话摊开。".repeat(24)}`;

describe("解卦块的展开与收起", () => {
  it("长断卦默认折叠,按钮写「展开全文」", () => {
    const host = document.createElement("div");
    expect(LONG_TEXT.length).toBeGreaterThan(READING_COLLAPSE_THRESHOLD);
    renderDivinationReadingNote(host, {
      status: "ready",
      text: LONG_TEXT,
      meta: "deepseek-v4.1-flash",
      onToggleExpand: () => undefined,
    });
    expect(host.querySelector(".ad-note")?.classList.contains("ad-note--collapsed")).toBe(true);
    const buttons = host.querySelectorAll<HTMLButtonElement>(".ad-note__foot button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("展开全文");
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
  });

  it("短断卦不折叠,也不出按钮", () => {
    const host = document.createElement("div");
    renderDivinationReadingNote(host, {
      status: "ready",
      text: "【总断】短的一卦。\n【逐条】本卦：无。\n【应期】不明。\n【可行】宜静。",
      onToggleExpand: () => undefined,
    });
    expect(host.querySelector(".ad-note--collapsed")).toBeNull();
    expect(host.querySelector(".ad-note__foot")).toBeNull();
  });

  it("expanded 为真时展开,按钮写「收起」", () => {
    const host = document.createElement("div");
    renderDivinationReadingNote(host, {
      status: "ready",
      text: LONG_TEXT,
      expanded: true,
      onToggleExpand: () => undefined,
    });
    expect(host.querySelector(".ad-note--collapsed")).toBeNull();
    expect(host.querySelector(".ad-note__foot button")?.textContent).toBe("收起");
  });

  it("折叠压的是正文那一层,页脚在折叠区外", () => {
    const host = document.createElement("div");
    renderDivinationReadingNote(host, {
      status: "ready",
      text: LONG_TEXT,
      meta: "deepseek-v4.1-flash",
      onToggleExpand: () => undefined,
    });
    const text = host.querySelector(".ad-note__text");
    const foot = host.querySelector(".ad-note__foot");
    expect(text).not.toBeNull();
    expect(foot).not.toBeNull();
    // 页脚不能落在折叠层里面,否则「展开全文」自己会被裁掉。
    expect(text?.contains(foot ?? null)).toBe(false);
    expect(host.querySelector(".ad-note__body")?.contains(foot ?? null)).toBe(true);
  });

  it("宿主不给 onToggleExpand 时不折叠(今日一牌那条路)", () => {
    const host = document.createElement("div");
    renderDivinationReadingNote(host, { status: "ready", text: LONG_TEXT });
    expect(host.querySelector(".ad-note--collapsed")).toBeNull();
    expect(host.querySelector(".ad-note__foot")).toBeNull();
  });

  it("点一下就把展开状态写回 storage,重画后仍是展开的", () => {
    const host = document.createElement("div");
    const storage: { reading?: ReadingSlotState } = {
      reading: { status: "ready", text: LONG_TEXT },
    };
    const slot = createReadingSlot({ host, storage, build: () => null });
    slot.paintInto(host);
    expect(host.querySelector(".ad-note--collapsed")).not.toBeNull();

    const toggle = vi.fn();
    host.querySelector<HTMLButtonElement>(".ad-note__foot button")?.addEventListener("click", toggle);
    host.querySelector<HTMLButtonElement>(".ad-note__foot button")?.click();

    expect(storage.reading?.expanded).toBe(true);
    expect(host.querySelector(".ad-note--collapsed")).toBeNull();
    expect(host.querySelector(".ad-note__foot button")?.textContent).toBe("收起");

    // 再点一次收回:状态是同一个字段在翻。
    host.querySelector<HTMLButtonElement>(".ad-note__foot button")?.click();
    expect(storage.reading?.expanded).toBe(false);
    expect(host.querySelector(".ad-note--collapsed")).not.toBeNull();
  });
});
