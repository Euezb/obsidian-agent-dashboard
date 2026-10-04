import { createElement } from "./domHelpers";

export interface SectionHeadOptions {
  /**
   * 批注栏里的短信息 —— 这个板块的口径:完成数、覆盖天数、条数、方法数。
   * 只写事实,不写装饰;缺省时该列留空。
   */
  meta?: string;
  /** 标题右侧的操作(可选)。 */
  actions?: HTMLElement[];
}

/**
 * 四个板块共用的头骨架:[批注] [标题] [……] [操作]。
 *
 * 旧版每个板块只有一个大标题,四块等重、边界不清;统一成同一副骨架之后,
 * 板块之间才看得出起止(配合 CSS 里的轴线、圆点、从内容列起的分隔线)。
 * 标题仍用 .ad-section__title 类名,保持既有测试与样式钩子的连续性。
 */
export function renderSectionHead(
  container: HTMLElement,
  title: string,
  options: SectionHeadOptions = {},
): HTMLElement {
  const head = createElement(container, "div");
  head.className = "ad-section__head";

  if (options.meta !== undefined && options.meta !== "") {
    const meta = createElement(container, "span");
    meta.className = "ad-section__meta";
    meta.textContent = options.meta;
    head.append(meta);
  }

  const heading = createElement(container, "h2");
  heading.className = "ad-section__title";
  heading.textContent = title;
  head.append(heading);

  if (options.actions !== undefined && options.actions.length > 0) {
    const actions = createElement(container, "div");
    actions.className = "ad-section__actions";
    actions.append(...options.actions);
    head.append(actions);
  }

  container.append(head);
  return head;
}
