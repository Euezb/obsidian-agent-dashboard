import type { DashboardTask } from "../domain/types";

/** Verified against Obsidian's bundled icon table; unknown names render blank. */
export const RIBBON_ICON = "scan-eye";
export const RIBBON_CLASS = "ad-ribbon";
export const RIBBON_ACTIVE_CLASS = "ad-ribbon--active";
export const RIBBON_BADGE_CLASS = "ad-ribbon__badge";
export const RIBBON_GRADIENT_ID = "ad-ribbon-warm";
export const RIBBON_GRADIENT_HOST_CLASS = "ad-ribbon-gradient-host";

export function incompleteTaskCount(tasks: readonly DashboardTask[]): number {
  return tasks.reduce((total, task) => (task.completed ? total : total + 1), 0);
}

/** The badge hides itself at zero so an empty day leaves the ribbon clean. */
export function updateRibbonBadge(badge: HTMLElement, count: number): void {
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.toggleAttribute("hidden", count === 0);
  badge.setAttribute("aria-label", `${count} 项未完成待办`);
}

export function setRibbonActive(ribbon: HTMLElement, active: boolean): void {
  ribbon.classList.toggle(RIBBON_ACTIVE_CLASS, active);
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svgNode<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string> = {},
): SVGElementTagNameMap[K] {
  const node = doc.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  return node;
}

/**
 * Injects the shared gradient once; the stylesheet then strokes the ribbon icon
 * with `url(#ad-ribbon-warm)`, which is how a CSS rule can paint a gradient.
 */
export function ensureRibbonGradient(doc: Document): void {
  if (doc.getElementById(RIBBON_GRADIENT_ID) !== null) return;
  const host = doc.createElement("div");
  host.className = RIBBON_GRADIENT_HOST_CLASS;
  host.setAttribute("aria-hidden", "true");

  const gradient = svgNode(doc, "linearGradient", {
    id: RIBBON_GRADIENT_ID, x1: "0", y1: "0", x2: "1", y2: "1",
  });
  gradient.append(
    svgNode(doc, "stop", { offset: "0%", "stop-color": "#f0a868" }),
    svgNode(doc, "stop", { offset: "100%", "stop-color": "#b25736" }),
  );
  const defs = svgNode(doc, "defs");
  defs.append(gradient);
  const svg = svgNode(doc, "svg", {
    class: "ad-ribbon-gradient", "aria-hidden": "true", focusable: "false", width: "0", height: "0",
  });
  svg.append(defs);
  host.append(svg);
  doc.body.append(host);
}
