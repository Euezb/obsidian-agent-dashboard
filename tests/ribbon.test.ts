/* eslint-disable obsidianmd/prefer-active-doc -- happy-dom tests intentionally use their isolated document. */
import { describe, expect, it } from "vitest";
import type { DashboardTask } from "../src/domain/types";
import {
  ensureRibbonGradient,
  incompleteTaskCount,
  RIBBON_ACTIVE_CLASS,
  RIBBON_BADGE_CLASS,
  RIBBON_GRADIENT_HOST_CLASS,
  RIBBON_GRADIENT_ID,
  setRibbonActive,
  updateRibbonBadge,
} from "../src/view/ribbon";

function task(completed: boolean): DashboardTask {
  return { id: `t-${completed}`, path: "Daily/2026-09-28.md", line: 1, text: "示例", completed };
}

describe("ribbon helpers", () => {
  it("counts only incomplete tasks", () => {
    expect(incompleteTaskCount([])).toBe(0);
    expect(incompleteTaskCount([task(false), task(true), task(false)])).toBe(2);
  });

  it("hides the badge at zero, shows the count, and caps long numbers", () => {
    const badge = document.createElement("span");
    badge.className = RIBBON_BADGE_CLASS;

    updateRibbonBadge(badge, 0);
    expect(badge.hasAttribute("hidden")).toBe(true);
    expect(badge.textContent).toBe("0");

    updateRibbonBadge(badge, 3);
    expect(badge.hasAttribute("hidden")).toBe(false);
    expect(badge.textContent).toBe("3");
    expect(badge.getAttribute("aria-label")).toContain("3 项未完成待办");

    updateRibbonBadge(badge, 120);
    expect(badge.textContent).toBe("99+");
  });

  it("toggles the active class used by the accent bar", () => {
    const ribbon = document.createElement("div");
    setRibbonActive(ribbon, true);
    expect(ribbon.classList.contains(RIBBON_ACTIVE_CLASS)).toBe(true);
    setRibbonActive(ribbon, false);
    expect(ribbon.classList.contains(RIBBON_ACTIVE_CLASS)).toBe(false);
  });

  it("injects the shared gradient exactly once", () => {
    document.body.innerHTML = "";
    ensureRibbonGradient(document);
    ensureRibbonGradient(document);
    expect(document.querySelectorAll(`.${RIBBON_GRADIENT_HOST_CLASS}`)).toHaveLength(1);
    expect(document.getElementById(RIBBON_GRADIENT_ID)).not.toBeNull();
  });
});
