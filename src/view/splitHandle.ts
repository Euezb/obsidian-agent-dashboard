import { createElement } from "./domHelpers";

/**
 * Column splitter shared by the 今天 and 今日发现 grids. Dragging rewrites one
 * custom property on the grid container, so both columns resize together while
 * each panel keeps its own alignment, padding and typography.
 */
export interface SplitHandleOptions {
  /** Custom property written on the grid container, e.g. `--ad-notes-track`. */
  trackProperty: string;
  /** Smallest width the resized column may reach, in px. */
  minWidth: number;
  /** Width kept for the neighbouring column, in px. */
  siblingMinWidth: number;
  /** Persisted width in px; 0 or missing keeps the responsive default. */
  width?: number;
  /** Called once per completed drag or keyboard nudge, never during the drag itself. */
  onWidthChange?: (width: number) => void;
  /** Localised accessible name for the separator. */
  ariaLabel: string;
}

/** Upper bound used only when the container cannot be measured (headless tests). */
const FALLBACK_MAX_WIDTH = 720;
const KEYBOARD_STEP = 24;

export function renderSplitHandle(
  layout: HTMLElement,
  panel: HTMLElement,
  options: SplitHandleOptions,
): () => void {
  const handle = createElement(panel, "div");
  handle.className = "ad-splitter";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-label", options.ariaLabel);
  handle.tabIndex = 0;
  panel.append(handle);

  const maxWidth = (): number => {
    const total = layout.getBoundingClientRect().width;
    return total > 0
      ? Math.max(options.minWidth, total - options.siblingMinWidth)
      : FALLBACK_MAX_WIDTH;
  };
  const clampWidth = (width: number): number =>
    Math.round(Math.min(Math.max(width, options.minWidth), maxWidth()));
  /** Measured width, or the applied track when layout data is unavailable. */
  const currentWidth = (): number => {
    const measured = panel.getBoundingClientRect().width;
    if (measured > 0) return Math.round(measured);
    const applied = Number.parseFloat(layout.style.getPropertyValue(options.trackProperty));
    return Number.isFinite(applied) && applied > 0 ? applied : options.minWidth;
  };
  const updateLimits = (): void => {
    handle.setAttribute("aria-valuemin", String(options.minWidth));
    handle.setAttribute("aria-valuemax", String(Math.round(maxWidth())));
  };
  const applyTrack = (width: number): number => {
    layout.style.setProperty(options.trackProperty, `${width}px`);
    handle.setAttribute("aria-valuenow", String(width));
    updateLimits();
    return width;
  };

  const stored = options.width ?? 0;
  if (stored > 0) {
    // 初始应用存量宽度时不按上限 clamp：此刻容器往往尚未挂载，
    // getBoundingClientRect() 恒为 0，clampWidth 会把 FALLBACK_MAX_WIDTH 当成真实上限，
    // 把用户存的宽度压回 720px。上限交给挂载后的首次拖拽/键盘操作（那时布局可测量）。
    applyTrack(Math.max(options.minWidth, Math.round(stored)));
  } else {
    updateLimits();
  }

  let dragging = false;
  let startX = 0;
  let startWidth = 0;
  let draggedWidth = 0;

  const onPointerMove = (event: PointerEvent): void => {
    if (!dragging) return;
    event.preventDefault();
    draggedWidth = applyTrack(clampWidth(startWidth - (event.clientX - startX)));
  };
  const finishDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    layout.classList.remove("ad-split-host--dragging");
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
    handle.removeEventListener("lostpointercapture", finishDrag);
    if (draggedWidth > 0) options.onWidthChange?.(draggedWidth);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    startX = event.clientX;
    startWidth = currentWidth();
    draggedWidth = 0;
    layout.classList.add("ad-split-host--dragging");
    if (typeof event.pointerId === "number" && typeof handle.setPointerCapture === "function") {
      handle.setPointerCapture(event.pointerId);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finishDrag);
    // 触控被系统手势抢走、或指针捕获丢失时也要收尾：否则 dragging 卡在 true，
    // window 上的监听要等到下一次 pointerup 或视图销毁才摘掉。
    window.addEventListener("pointercancel", finishDrag);
    handle.addEventListener("lostpointercapture", finishDrag);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    // ArrowLeft moves the divider left, which widens the resized column.
    const delta = event.key === "ArrowLeft" ? KEYBOARD_STEP : -KEYBOARD_STEP;
    options.onWidthChange?.(applyTrack(clampWidth(currentWidth() + delta)));
  };

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("keydown", onKeyDown);

  return () => {
    // 拖拽中被销毁（视图重渲染会清空 DOM）：先把进行中的这次结算掉，
    // 否则 draggedWidth 随闭包丢失，用户刚拖到的宽度不会持久化、重渲染还会弹回去。
    finishDrag();
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("keydown", onKeyDown);
    handle.removeEventListener("lostpointercapture", finishDrag);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finishDrag);
    window.removeEventListener("pointercancel", finishDrag);
  };
}
