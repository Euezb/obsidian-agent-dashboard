import type { AlmanacCard } from "../features/divination/almanacCard";
import { createAlmanacCard } from "./renderAlmanacCard";
import { createElement } from "./domHelpers";

export interface HeaderRenderOptions {
  updatedAt?: number;
  status: string;
  onNewDiary: () => void;
  /** 头部黄历卡数据;缺省或 null 时不渲染卡片。 */
  almanac?: AlmanacCard | null;
}

function formatUpdatedAt(updatedAt?: number): string {
  if (updatedAt === undefined) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(updatedAt);
}

export function renderHeader(
  container: HTMLElement,
  updatedAt: number | undefined,
  status: string,
  onNewDiary: () => void,
  almanac?: AlmanacCard | null,
): () => void {
  container.replaceChildren();
  container.className = "ad-header";
  container.dataset.region = "header";

  const identity = createElement(container, "div");
  identity.className = "ad-header__identity";

  const eyebrow = createElement(container, "p");
  eyebrow.className = "ad-eyebrow";
  // eslint-disable-next-line obsidianmd/ui/sentence-case -- Product name uses title case.
  eyebrow.textContent = "Agent Dashboard";

  const greeting = createElement(container, "h1");
  greeting.className = "ad-header__greeting";
  greeting.textContent = "今天从这里开始";

  const description = createElement(container, "p");
  description.className = "ad-header__description";
  description.textContent = "先安顿今天的工作，再看看知识花园里发生了什么。";

  identity.append(eyebrow, greeting, description);

  const actions = createElement(container, "div");
  actions.className = "ad-header__actions";

  const updateStatus = createElement(container, "p");
  updateStatus.className = "ad-update-status";
  updateStatus.setAttribute("role", "status");
  updateStatus.setAttribute("aria-live", "polite");
  const time = formatUpdatedAt(updatedAt);
  updateStatus.textContent = time === "" ? status : `${status} · ${time}`;

  const diaryButton = createElement(container, "button");
  diaryButton.className = "ad-primary-action";
  diaryButton.type = "button";
  diaryButton.textContent = "新建日记";
  diaryButton.addEventListener("click", onNewDiary);

  actions.append(updateStatus, diaryButton);
  const almanacCard = almanac == null ? null : createAlmanacCard(container.ownerDocument, almanac);
  if (almanacCard !== null) container.append(identity, almanacCard, actions);
  else container.append(identity, actions);

  return () => {
    diaryButton.removeEventListener("click", onNewDiary);
  };
}

export type { HeaderRenderOptions as RenderHeaderOptions };
